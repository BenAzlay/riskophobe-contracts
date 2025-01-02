import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers, network } from "hardhat";
import { vars } from "hardhat/config";

import { IERC20Metadata, RiskophobeProtocol } from "../../types";

describe("Riskophobe General Tests", function () {
  let buyerAccount: SignerWithAddress;
  let offererAccount: SignerWithAddress;

  let soldToken: IERC20Metadata;
  let collateralToken: IERC20Metadata;

  let riskophobeContract: RiskophobeProtocol;
  let riskophobeContractAddress: string;

  let deployerCollateralTokenInitialBalance: bigint;
  let offererSoldTokenInitialBalance: bigint;

  const infuraApiKey: string = vars.get("INFURA_API_KEY");

  before(async function () {
    [buyerAccount, offererAccount] = await ethers.getSigners();

    const jsonRpcUrl: string = `https://mainnet.infura.io/v3/${infuraApiKey}`;

    // Reset hardhat fork to avoid changes affecting subsequent tests
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl, // mainnet rpc
            blockNumber: 21294024, // Nov-29-2024 02:44:23 PM +UTC | Timestamp: 1732891463
          },
        },
      ],
    });

    // Load testing addresses with enough ETH to pay for gas
    await network.provider.send("hardhat_setBalance", [
      buyerAccount.address,
      "0x314DC6448D932AE0A456589C0000", // 999999999999999 ETH
    ]);
    await network.provider.send("hardhat_setBalance", [
      offererAccount.address,
      "0x314DC6448D932AE0A456589C0000", // 999999999999999 ETH
    ]);

    // Sold token is WETH
    soldToken = <IERC20Metadata>(
      await ethers.getContractAt("IERC20Metadata", "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2")
    );

    // Collateral token is USDC
    collateralToken = <IERC20Metadata>(
      await ethers.getContractAt("IERC20Metadata", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48")
    );

    // Deploy the Riskophobe Protocol
    const riskophobeContractFactory = await ethers.getContractFactory("RiskophobeProtocol");
    riskophobeContract = await riskophobeContractFactory.deploy();
    riskophobeContractAddress = await riskophobeContract.getAddress();
  });

  it("transfer 10000 collateral tokens (USDC) to account 1", async () => {
    // Fork Ethereum Mainnet and impersonate a USDC-rich address
    const usdcRichAddress = "0x55fe002aeff02f77364de339a1292923a15844b8"; // USDC-rich address
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [usdcRichAddress],
    });
    const impersonatedSigner = await ethers.getSigner(usdcRichAddress);

    // Transfer 10,000 USDC to buyerAccount
    deployerCollateralTokenInitialBalance = ethers.parseUnits("10000", 6);
    await collateralToken
      .connect(impersonatedSigner)
      .transfer(buyerAccount.address, deployerCollateralTokenInitialBalance);

    // Stop impersonation
    await network.provider.request({
      method: "hardhat_stopImpersonatingAccount",
      params: [usdcRichAddress],
    });
  });

  it("transfer 10 sold tokens (WETH) to account 2", async () => {
    // Fork Ethereum Mainnet and impersonate a WETH-rich address
    const wethRichAddress = "0x57757E3D981446D585Af0D9Ae4d7DF6D64647806"; // WETH-rich address
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [wethRichAddress],
    });
    const impersonatedSigner = await ethers.getSigner(wethRichAddress);

    // Transfer 10 WETH to offererAccount
    offererSoldTokenInitialBalance = ethers.parseEther("10");
    await soldToken.connect(impersonatedSigner).transfer(offererAccount.address, offererSoldTokenInitialBalance);

    // Stop impersonation
    await network.provider.request({
      method: "hardhat_stopImpersonatingAccount",
      params: [wethRichAddress],
    });
  });

  describe("Offer management", function () {
    it("Should create an offer of WETH for USDC with 1:1000 exchange rate", async function () {
      const _startTime = 1732977863; // Nov-30-2024 02:44:23 PM +UTC
      const _endTime = 1735569863; // Dec-30-2024 02:44:23 PM +UTC => 1 month later

      const _collateralToken = await collateralToken.getAddress();
      const _soldToken = await soldToken.getAddress();
      const _soldTokenAmount: bigint = ethers.parseEther("2"); // 2 WETH sold => 2000 USDC buyable
      const correspondingCollateralAmount: bigint = ethers.parseUnits("2000", 6); // 2000 USDC
      // exchangeRate = ((2 * 10**18) * 10**18) / (2000 * 10**6)
      const _exchangeRate = (_soldTokenAmount * BigInt(10 ** 18)) / correspondingCollateralAmount;
      const _creatorFeeBp = 100; // 1% fee

      // Approve the RiskophobeProtocol contract to transfer sold tokens
      await soldToken.connect(offererAccount).approve(riskophobeContractAddress, _soldTokenAmount);

      // Test that startTime cannot be after endTime
      await expect(
        riskophobeContract
          .connect(offererAccount)
          .createOffer(
            _collateralToken,
            _soldToken,
            _soldTokenAmount,
            _exchangeRate,
            _creatorFeeBp,
            _endTime + 1209600,
            _endTime,
          ),
      ).to.be.revertedWith("Start time must be before end time");

      const latestTime = await time.latest();

      // Test that startTime is not in the past
      await expect(
        riskophobeContract
          .connect(offererAccount)
          .createOffer(
            _collateralToken,
            _soldToken,
            _soldTokenAmount,
            _exchangeRate,
            _creatorFeeBp,
            latestTime - 1,
            _endTime,
          ),
      ).to.be.revertedWith("Start time cannot be in the past");

      // Test that creator fee cannot be about 50%
      await expect(
        riskophobeContract
          .connect(offererAccount)
          .createOffer(_collateralToken, _soldToken, _soldTokenAmount, _exchangeRate, 5001, _startTime, _endTime),
      ).to.be.revertedWith("Fee basis points must not exceed 50%");

      // Test that exchange rate cannot be 0
      await expect(
        riskophobeContract
          .connect(offererAccount)
          .createOffer(_collateralToken, _soldToken, _soldTokenAmount, 0, _creatorFeeBp, _startTime, _endTime),
      ).to.be.revertedWith("Exchange rate must be greater than zero");

      // Working createOffer txn
      await expect(
        riskophobeContract
          .connect(offererAccount)
          .createOffer(
            _collateralToken,
            _soldToken,
            _soldTokenAmount,
            _exchangeRate,
            _creatorFeeBp,
            _startTime,
            _endTime,
          ),
      ).to.not.be.reverted;

      // Check offererAccount and contract balances
      const newOffererSoldTokenBalance = await soldToken.balanceOf(offererAccount.address);
      expect(newOffererSoldTokenBalance).to.be.eq(
        offererSoldTokenInitialBalance - _soldTokenAmount,
        "Initial balance minus amount offered",
      );
      const newContractSoldTokenBalance = await soldToken.balanceOf(riskophobeContractAddress);
      expect(newContractSoldTokenBalance).to.be.eq(_soldTokenAmount, "Amount offered");
    });

    it("Should revert buyTokens because offer has not started yet", async function () {
      const _collateralAmountIn = ethers.parseUnits("1000", 6);

      // Approve the RiskophobeProtocol contract to transfer collateral tokens
      await collateralToken.connect(buyerAccount).approve(riskophobeContractAddress, _collateralAmountIn);

      await expect(riskophobeContract.connect(buyerAccount).buyTokens(0, _collateralAmountIn, 0)).to.be.revertedWith(
        "Offer has not yet started",
      );
    });

    it("set current block number to offer ID 0 start time", async () => {
      const offer0StartTime: bigint = (await riskophobeContract.offers(0)).startTime;
      const newBlockTs: string = offer0StartTime.toString();

      await network.provider.send("evm_setNextBlockTimestamp", [newBlockTs]);
      await network.provider.send("evm_mine");
    });

    it("Should buy 1 WETH for 1000 USDC from offer ID 0", async function () {
      const _collateralAmountIn = ethers.parseUnits("1000", 6);
      const tooHighCollateralAmountIn = ethers.parseUnits("3000", 6);

      // Approve the RiskophobeProtocol contract to transfer collateral tokens
      await collateralToken.connect(buyerAccount).approve(riskophobeContractAddress, tooHighCollateralAmountIn);

      // Test that buyer cannot buy above exchange rate availability
      await expect(
        riskophobeContract.connect(buyerAccount).buyTokens(0, tooHighCollateralAmountIn, 0),
      ).to.be.revertedWith("Not enough sold tokens available");

      // Test slippage
      const tooHighMinSoldTokenAmountOut = ethers.parseEther("0.999"); // Max should be 0.99 because of 1% fee
      await expect(
        riskophobeContract.connect(buyerAccount).buyTokens(0, _collateralAmountIn, tooHighMinSoldTokenAmountOut),
      ).to.be.revertedWith("Slippage exceeded");

      // Working buyTokens txn
      await expect(riskophobeContract.connect(buyerAccount).buyTokens(0, _collateralAmountIn, 0)).not.to.be.reverted;

      // Check buyerAccount and contract balances
      const boughtAmount = ethers.parseEther("0.99");
      const newBuyerSoldTokenBalance = await soldToken.balanceOf(buyerAccount.address);
      expect(newBuyerSoldTokenBalance).to.be.eq(boughtAmount, "Bought amount sould be 0.99 WETH");
      const remainingSoldTokens = ethers.parseEther("1.01");
      const newContractSoldTokenBalance = await soldToken.balanceOf(riskophobeContractAddress);
      expect(newContractSoldTokenBalance).to.be.eq(
        remainingSoldTokens,
        "Sold token amount remaining should be 1.01 WETH",
      );
    });
  });
});
