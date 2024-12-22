// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title RiskophobeProtocol
 * @dev A protocol for creating and managing token swap offers with collateral and fees.
 */
contract RiskophobeProtocol {
    using SafeERC20 for IERC20;

    /// @notice Represents an Offer in the protocol.
    struct Offer {
        address creator; // Address of the offer creator
        uint16 creatorFeeBp; // Creator fee in basis points
        uint32 startTime; // Offer start timestamp
        uint32 endTime; // Offer end timestamp
        IERC20 collateralToken; // Token used as collateral
        IERC20 soldToken; // Token being sold
        uint256 soldTokenAmount; // Amount of sold token available in the offer
        uint256 exchangeRate; // Exchange rate: amount of soldToken per collateralToken
        uint256 collateralBalance; // Amount of collateral token in the offer
    }

    /// @notice Array of all active offers.
    Offer[] public offers;

    /// @notice Tracks collateral deposits for each offer and participant.
    mapping(uint256 => mapping(address => uint256)) public collateralDeposits;

    /// @notice Mapping to store accumulated creator fees for each creator and token.
    mapping(address => mapping(IERC20 => uint256)) public creatorFees;

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

    event TokensBought(uint256 indexed offerId, address indexed participant, uint256 soldTokenAmount);
    event TokensReturned(uint256 indexed offerId, address indexed participant, uint256 collateralAmount);

    /// @notice Event emitted when an offer is removed.
    event OfferRemoved(uint256 indexed offerId);

    /// @notice Event emitted when a creator claims fees for a collateral token
    event FeesClaimed(address indexed creator, address indexed token, uint256 amount);

    /// @notice Creates a new offer with the specified parameters.
    function createOffer(
        address collateralTokenAddress,
        address soldTokenAddress,
        uint256 soldTokenAmount,
        uint256 exchangeRate,
        uint32 startTime,
        uint32 endTime,
        uint16 creatorFeeBp
    ) external {
        require(collateralTokenAddress != address(0), "Invalid collateral token address");
        require(soldTokenAddress != address(0), "Invalid sold token address");
        require(soldTokenAmount > 0, "Sold token amount must be greater than zero");
        require(exchangeRate > 0, "Exchange rate must be greater than zero");
        require(startTime < endTime, "Start time must be before end time");
        require(creatorFeeBp <= 10000, "Fee basis points must not exceed 100%");

        IERC20 soldToken = IERC20(soldTokenAddress);

        // Transfer the sold tokens from the creator to the contract
        soldToken.safeTransferFrom(msg.sender, address(this), soldTokenAmount);

        // Create and store the new offer
        offers.push(
            Offer({
                creator: msg.sender,
                creatorFeeBp: creatorFeeBp,
                startTime: startTime,
                endTime: endTime,
                collateralToken: IERC20(collateralTokenAddress),
                soldToken: soldToken,
                soldTokenAmount: soldTokenAmount,
                exchangeRate: exchangeRate,
                collateralBalance: 0
            })
        );

        emit OfferCreated(
            offers.length - 1,
            msg.sender,
            collateralTokenAddress,
            soldTokenAddress,
            soldTokenAmount,
            exchangeRate
        );
    }

    /// @notice Add more sold tokens into an offer
    function addSoldTokens(uint256 offerId, uint256 soldTokenAmount) external {
        Offer storage offer = offers[offerId];
        require(msg.sender == offer.creator, "Only the creator can add sold tokens");
        require(block.timestamp <= offer.endTime, "Offer has ended");
        require(soldTokenAmount > 0, "Collateral amount must be greater than zero");

        // Transfer collateral from the participant to the contract
        offer.soldToken.safeTransferFrom(msg.sender, address(this), soldTokenAmount);

        // Update state
        offer.soldTokenAmount += soldTokenAmount;

        emit SoldTokensAdded(offerId, soldTokenAmount);
    }

    function buyTokens(uint256 offerId, uint256 soldTokenAmount) external {
        Offer storage offer = offers[offerId];
        require(block.timestamp >= offer.startTime, "Offer has not yet started");
        require(block.timestamp <= offer.endTime, "Offer has ended");
        require(soldTokenAmount > 0, "Sold token amount must be greater than zero");
        require(soldTokenAmount <= offer.soldTokenAmount, "Not enough sold tokens available");

        uint256 collateralAmount = (soldTokenAmount * 1e18) / offer.exchangeRate;

        // Compute creator fees
        uint256 creatorFee = (collateralAmount * offer.creatorFeeBp) / 10000;
        uint256 netCollateralAmount = collateralAmount - creatorFee;

        // Transfer sold tokens to the participant
        offer.soldToken.safeTransfer(msg.sender, soldTokenAmount);

        // Accumulate creator fees
        if (creatorFee > 0) {
            creatorFees[offer.creator][offer.collateralToken] += creatorFee;
        }

        // Update offer
        offer.soldTokenAmount -= soldTokenAmount;
        offer.collateralBalance += netCollateralAmount;

        // Update deposit
        collateralDeposits[offerId][msg.sender] += netCollateralAmount;

        emit TokensBought(offerId, msg.sender, soldTokenAmount);
    }

    function returnTokens(uint256 offerId, uint256 collateralAmount) external {
        Offer storage offer = offers[offerId];
        require(block.timestamp >= offer.startTime, "Offer has not yet started");
        require(block.timestamp <= offer.endTime, "Offer has ended");
        require(collateralAmount > 0, "Collateral amount must be greater than zero");
        require(
            collateralAmount <= collateralDeposits[offerId][msg.sender],
            "Collateral amount is higher than deposited"
        );

        uint256 soldTokenAmount = (collateralAmount * offer.exchangeRate) / 1e18;

        // Transfer sold tokens to the participant
        offer.collateralToken.safeTransfer(msg.sender, collateralAmount);

        // Update offer
        offer.soldTokenAmount += soldTokenAmount;
        offer.collateralBalance -= collateralAmount;

        // Update deposit
        collateralDeposits[offerId][msg.sender] -= collateralAmount;

        emit TokensReturned(offerId, msg.sender, collateralAmount);
    }

    /// @notice Removes an offer, transferring remaining tokens back to the creator.
    function removeOffer(uint256 offerId) external {
        Offer storage offer = offers[offerId];
        // An offer can be removed only if it has ended OR if no collateral was deposited into it
        require(offer.collateralBalance == 0 || block.timestamp > offer.endTime, "Offer is still ongoing");
        require(msg.sender == offer.creator, "Only the creator can remove the offer");

        // Transfer remaining sold tokens and collateral back to the creator
        if (offer.soldTokenAmount > 0) {
            offer.soldToken.safeTransfer(offer.creator, offer.soldTokenAmount);
        }
        if (offer.collateralBalance > 0) {
            offer.collateralToken.safeTransfer(offer.creator, offer.collateralBalance);
        }

        // Delete the offer
        delete offers[offerId];

        emit OfferRemoved(offerId);
    }

    /// @notice Claims creator fees (all or part of available amount)
    function claimFees(IERC20 token, uint256 claimAmount) external {
        uint256 maxClaimAmount = creatorFees[msg.sender][token];
        require(maxClaimAmount > 0, "No fees available to claim");
        require(maxClaimAmount >= claimAmount, "claimAmount is greater than available fees");

        // Remove claimed amount from available fees
        creatorFees[msg.sender][token] = maxClaimAmount - claimAmount;

        // Transfer the accumulated fees to the creator
        token.safeTransfer(msg.sender, claimAmount);

        emit FeesClaimed(msg.sender, address(token), claimAmount);
    }
}
