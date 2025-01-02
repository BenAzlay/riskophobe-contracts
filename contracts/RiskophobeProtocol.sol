// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title RiskophobeProtocol
 * @dev A protocol for creating and managing token option offers.
 */
contract RiskophobeProtocol {
    using SafeERC20 for IERC20Metadata;

    /// @notice Represents an Offer in the protocol.
    struct Offer {
        address creator; // Address of the offer creator
        uint16 creatorFeeBp; // Creator fee in basis points
        uint32 startTime; // Offer start timestamp
        uint32 endTime; // Offer end timestamp
        IERC20Metadata collateralToken; // Token used as collateral
        IERC20Metadata soldToken; // Token being sold
        uint256 soldTokenAmount; // Amount of sold token available in the offer
        uint256 exchangeRate; // Exchange rate: amount of soldToken per collateralToken
        uint256 collateralBalance; // Amount of collateral token in the offer
    }

    /// @notice Array of all active offers.
    Offer[] public offers;

    /// @notice Tracks collateral deposits for each offer and participant.
    mapping(uint256 offerId => mapping(address => uint256)) public collateralDeposits;

    /// @notice Mapping to store accumulated creator fees for each creator and token.
    mapping(address creator => mapping(address => uint256)) public creatorFees;

    /// @notice Event emitted when a new offer is created.
    event OfferCreated(
        uint256 indexed offerId,
        address indexed creator,
        address collateralToken,
        address soldToken,
        uint256 soldTokenAmount,
        uint256 exchangeRate
    );

    /// @notice Event emitted when a creator add more sold tokens into an offer.
    event SoldTokensAdded(uint256 indexed offerId, uint256 amount);

    event TokensBought(
        uint256 indexed offerId,
        address indexed participant,
        uint256 soldTokenAmount,
        uint256 netCollateralAmount
    );
    event TokensReturned(uint256 indexed offerId, address indexed participant, uint256 collateralAmount);

    /// @notice Event emitted when an offer is removed.
    event OfferRemoved(uint256 indexed offerId);

    /// @notice Event emitted when a creator claims fees for a collateral token
    event FeesClaimed(address indexed creator, address indexed token, uint256 amount);

    /// @notice Creates a new token option offer.
    /// @dev Allows an offer creator to specify the exchange rate, collateral, and sold token details.
    /// The creator must deposit the required collateral upfront.
    /// Emits an {OfferCreated} event.
    /// @dev _exchangeRate is computed as with the following formula:
    /// ((soldTokenAmount * 10**soldTokenDecimals) * 10**18) / (collateralToken * 10**collateralTokenDecimals))
    /// @dev EXAMPLE 1: 1 WETH sold for 1000 USDC collateral
    /// _exchangeRate = ((1 * 10**18) * 10**18) / (1000 * 10**6) = 1000000000000000000000000000
    /// @dev EXAMPLE 2: 30 WETH sold for 1 WBTC collateral
    /// _exchangeRate = ((30 * 10**18) * 10**18) / (1 * 10**8) = 300000000000000000000000000000
    /// @dev EXAMPLE 3: 1 WBTC sold for 80000 USDC collateral
    /// _exchangeRate = ((1 * 10**8) * 10**18) / (80000 * 10**6) = 1250000000000000
    /// @param _collateralToken The ERC20 token used as collateral in the offer.
    /// @param _soldToken The ERC20 token being sold in the offer.
    /// @param _soldTokenAmount The total amount of the sold token to be offered.
    /// @param _exchangeRate The exchange rate: amount of soldToken per unit of collateralToken.
    /// @param _creatorFeeBp The fee charged by the offer creator, in basis points (1 bp = 0.01%).
    /// @param _startTime The timestamp (in seconds) when the offer becomes active.
    /// @param _endTime The timestamp (in seconds) when the offer expires.
    function createOffer(
        address _collateralToken,
        address _soldToken,
        uint256 _soldTokenAmount,
        uint256 _exchangeRate,
        uint16 _creatorFeeBp,
        uint32 _startTime,
        uint32 _endTime
    ) external {
        require(_collateralToken != address(0), "Invalid collateral token address");
        require(_soldToken != address(0), "Invalid sold token address");
        require(_soldTokenAmount > 0, "Sold token amount must be greater than zero");
        require(_exchangeRate > 0, "Exchange rate must be greater than zero");
        require(_startTime >= block.timestamp, "Start time cannot be in the past");
        require(_startTime < _endTime, "Start time must be before end time");
        require(_creatorFeeBp <= 5000, "Fee basis points must not exceed 50%");

        IERC20Metadata soldToken = IERC20Metadata(_soldToken);

        // Create and store the new offer
        offers.push(
            Offer({
                creator: msg.sender,
                creatorFeeBp: _creatorFeeBp,
                startTime: _startTime,
                endTime: _endTime,
                collateralToken: IERC20Metadata(_collateralToken),
                soldToken: soldToken,
                soldTokenAmount: _soldTokenAmount,
                exchangeRate: _exchangeRate,
                collateralBalance: 0
            })
        );

        // Transfer the sold tokens from the creator to the contract
        soldToken.safeTransferFrom(msg.sender, address(this), _soldTokenAmount);

        emit OfferCreated(offers.length - 1, msg.sender, _collateralToken, _soldToken, _soldTokenAmount, _exchangeRate);
    }

    /// @notice Add more sold tokens into an offer
    /// @dev Allows an offer creator to add more sold tokens to an already created, non-ended offer
    /// Emits an {SoldTokensAdded} event.
    /// @param _offerId The ID of the offer to which to add the sold tokens
    /// @param _soldTokenAmount The amount of sold tokens to add to the offer
    function addSoldTokens(uint256 _offerId, uint256 _soldTokenAmount) external {
        Offer storage offer = offers[_offerId];

        require(msg.sender == offer.creator, "Only the creator can add sold tokens");
        require(block.timestamp <= offer.endTime, "Offer has ended");
        require(_soldTokenAmount > 0, "Sold token amount must be greater than zero");

        // Update state
        offer.soldTokenAmount += _soldTokenAmount;

        // Transfer collateral from the participant to the contract
        offer.soldToken.safeTransferFrom(msg.sender, address(this), _soldTokenAmount);

        emit SoldTokensAdded(_offerId, _soldTokenAmount);
    }

    /// @notice Buyer accepts the offer from creator
    /// @dev Allows any buyer to buy the sold token at the fixed exchange rate for collateral tokens
    /// Fees are deduced from the collateral that can later be retrieved
    /// The fees are updating creatorFees
    /// If a buyer has already bought from this offer, the corresponding collateralDeposits entry is updated
    /// Else the corresponding collateralDeposits entry is set
    /// Emits an {TokensBought} event.
    /// @param _offerId The ID of the offer from which to buy
    /// @param _collateralAmountIn The maximum amount of collateral to provide
    /// @param _minSoldTokenAmountOut The minimum amount of sold tokens to receive (can be 0)
    function buyTokens(uint256 _offerId, uint256 _collateralAmountIn, uint256 _minSoldTokenAmountOut) external {
        Offer storage offer = offers[_offerId];

        require(block.timestamp >= offer.startTime, "Offer has not yet started");
        require(block.timestamp <= offer.endTime, "Offer has ended");
        require(_collateralAmountIn > 0, "Collateral token amount in must be greater than zero");

        // Compute creator fees
        uint256 creatorFee = (_collateralAmountIn * offer.creatorFeeBp) / 10000;
        uint256 netCollateralAmount = _collateralAmountIn - creatorFee;

        // Calculate received sold token amount based on exchange rate and creator fees
        uint256 soldTokenAmount = (netCollateralAmount * offer.exchangeRate) / 1e18;

        // Slippage control
        require(soldTokenAmount >= _minSoldTokenAmountOut, "Slippage exceeded");

        // Ensure there are enough sold tokens available in the offer
        require(soldTokenAmount <= offer.soldTokenAmount, "Not enough sold tokens available");

        // Update the offer state before making transactions
        offer.soldTokenAmount -= soldTokenAmount;
        offer.collateralBalance += netCollateralAmount;

        // Update the buyer's collateral deposit
        collateralDeposits[_offerId][msg.sender] += netCollateralAmount;

        // Accumulate fees for the offer creator
        if (creatorFee > 0) {
            creatorFees[offer.creator][address(offer.collateralToken)] += creatorFee;
        }

        // Transfer the required collateral tokens from the buyer to the contract
        offer.collateralToken.safeTransferFrom(msg.sender, address(this), _collateralAmountIn);

        // Transfer the sold tokens to the buyer
        offer.soldToken.safeTransfer(msg.sender, soldTokenAmount);

        emit TokensBought(_offerId, msg.sender, soldTokenAmount, netCollateralAmount);
    }

    /// @notice Buyer returns the sold tokens to offer
    /// @dev Allows a buyer to return all or part of the bought sold token at the fixed exchange rate
    /// The buyer receives all or part of their collateral tokens in return
    /// The retrieved amount is deduced from the corresponding collateralDeposits entry
    /// Else the corresponding collateralDeposits value is set
    /// Emits an {TokensReturned} event.
    /// @param _offerId The ID of the offer to which to return
    /// @param _collateralAmount The amount of collateral tokens to retrieve
    function returnTokens(uint256 _offerId, uint256 _collateralAmount) external {
        Offer storage offer = offers[_offerId];
        require(block.timestamp >= offer.startTime, "Offer has not yet started");
        require(block.timestamp <= offer.endTime, "Offer has ended");
        require(_collateralAmount > 0, "Collateral amount must be greater than zero");
        require(
            _collateralAmount <= collateralDeposits[_offerId][msg.sender],
            "Collateral amount is higher than deposited"
        );

        uint256 soldTokenAmount = (_collateralAmount * offer.exchangeRate) / 1e18;

        // Update offer
        offer.soldTokenAmount += soldTokenAmount;
        offer.collateralBalance -= _collateralAmount;

        // Update deposit
        collateralDeposits[_offerId][msg.sender] -= _collateralAmount;

        // Transfer the sold tokens from the buyer to the contract
        offer.soldToken.safeTransferFrom(msg.sender, address(this), soldTokenAmount);

        // Transfer the collateral to the buyer
        offer.collateralToken.safeTransfer(msg.sender, _collateralAmount);

        emit TokensReturned(_offerId, msg.sender, _collateralAmount);
    }

    /// @notice Removes an offer, transferring remaining tokens back to the creator.
    /// @dev Deletes the offer, only if the offer is ended or has no buyers.
    /// Emits a {OfferRemoved} event.
    /// @param _offerId THe ID of the offer being removed.
    function removeOffer(uint256 _offerId) external {
        Offer memory offer = offers[_offerId];
        // An offer can be removed only if it has ended OR if no collateral was deposited into it
        require(offer.collateralBalance == 0 || block.timestamp > offer.endTime, "Offer is still ongoing");
        require(msg.sender == offer.creator, "Only the creator can remove the offer");

        // Delete the offer
        delete offers[_offerId];

        // Transfer remaining sold tokens and collateral back to the creator
        if (offer.soldTokenAmount > 0) {
            offer.soldToken.safeTransfer(offer.creator, offer.soldTokenAmount);
        }
        if (offer.collateralBalance > 0) {
            offer.collateralToken.safeTransfer(offer.creator, offer.collateralBalance);
        }

        emit OfferRemoved(_offerId);
    }

    /// @notice Claims creator fees
    /// @dev Allows an offer creator to claim all or part of the fees earned of a specific token.
    /// Decreases the corresponding creatorFees entry accordingly
    /// Emits a {FeesClaimed} event.
    /// @param _tokenAddress The address of the token of which to claim fees
    /// @param _claimAmount The amount of fees to claim for the specified token (part or all the available fees)
    function claimFees(address _tokenAddress, uint256 _claimAmount) external {
        require(_claimAmount > 0, "Claim amount must be greater than zero");

        uint256 maxClaimAmount = creatorFees[msg.sender][_tokenAddress];

        require(maxClaimAmount > 0, "No fees available to claim");
        require(maxClaimAmount >= _claimAmount, "claimAmount is greater than available fees");

        // Remove claimed amount from available fees
        creatorFees[msg.sender][_tokenAddress] = maxClaimAmount - _claimAmount;

        // Transfer the accumulated fees to the creator
        IERC20Metadata(_tokenAddress).safeTransfer(msg.sender, _claimAmount);

        emit FeesClaimed(msg.sender, _tokenAddress, _claimAmount);
    }
}
