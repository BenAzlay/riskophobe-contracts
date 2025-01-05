import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network } from "hardhat";
import { vars } from "hardhat/config";

import { IERC20Metadata, RiskophobeProtocol } from "../../types";

describe("Riskophobe Edge Cases Tests", function () {
  let buyerAccount: SignerWithAddress;
  let secondBuyerAccount: SignerWithAddress;
  let offererAccount: SignerWithAddress;

  let soldToken: IERC20Metadata;
  let collateralToken: IERC20Metadata;

  let riskophobeContract: RiskophobeProtocol;
  let riskophobeContractAddress: string;

  let deployerCollateralTokenInitialBalance: bigint;
  let offererSoldTokenBalance: bigint;

  let exchangeRate: bigint;

  const infuraApiKey: string = vars.get("INFURA_API_KEY");

  before(async function () {
    [buyerAccount, offererAccount, secondBuyerAccount] = await ethers.getSigners();

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
      secondBuyerAccount.address,
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

  it("transfer 1,000,000 collateral tokens (USDC) to buyerAccount and secondBuyerAccount", async () => {
    // Fork Ethereum Mainnet and impersonate a USDC-rich address
    const usdcRichAddress = "0x55fe002aeff02f77364de339a1292923a15844b8"; // USDC-rich address
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [usdcRichAddress],
    });
    const impersonatedSigner = await ethers.getSigner(usdcRichAddress);

    // Transfer 10M USDC to buyerAccount
    deployerCollateralTokenInitialBalance = ethers.parseUnits("10000000", 6);
    await collateralToken
      .connect(impersonatedSigner)
      .transfer(buyerAccount.address, deployerCollateralTokenInitialBalance);

    // Transfer 10M USDC to secondBuyerAccount
    deployerCollateralTokenInitialBalance = ethers.parseUnits("10000000", 6);
    await collateralToken
      .connect(impersonatedSigner)
      .transfer(secondBuyerAccount.address, deployerCollateralTokenInitialBalance);

    // Stop impersonation
    await network.provider.request({
      method: "hardhat_stopImpersonatingAccount",
      params: [usdcRichAddress],
    });
  });

  it("transfer 100 sold tokens (WETH) to offererAccount", async () => {
    // Fork Ethereum Mainnet and impersonate a WETH-rich address
    const wethRichAddress = "0x57757E3D981446D585Af0D9Ae4d7DF6D64647806"; // WETH-rich address
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [wethRichAddress],
    });
    const impersonatedSigner = await ethers.getSigner(wethRichAddress);

    // Transfer 10 WETH to offererAccount
    offererSoldTokenBalance = ethers.parseEther("100");
    await soldToken.connect(impersonatedSigner).transfer(offererAccount.address, offererSoldTokenBalance);

    // Stop impersonation
    await network.provider.request({
      method: "hardhat_stopImpersonatingAccount",
      params: [wethRichAddress],
    });
  });

  it("Should create an offer of WETH for USDC with exchange rate eq 1", async function () {
    const _startTime = 1732977863; // Nov-30-2024 02:44:23 PM +UTC
    const _endTime = 1735569863; // Dec-30-2024 02:44:23 PM +UTC => 1 month later

    const _collateralToken = await collateralToken.getAddress();
    const _soldToken = await soldToken.getAddress();
    const _soldTokenAmount: bigint = ethers.parseEther("1"); // 1 WETH sold => 1e30 USDC buyable
    const correspondingCollateralAmount: bigint = ethers.parseUnits("1000000000000000000000000000000", 6); // 1e30 USDC
    exchangeRate = (_soldTokenAmount * BigInt(10 ** 18)) / correspondingCollateralAmount;
    // wrong exchange rate: 0.5 is impossible because it must be an integer => comes out as 0
    const wrongExchangeRate = (_soldTokenAmount * BigInt(10 ** 18)) / (correspondingCollateralAmount * BigInt(2)); // 0n
    const _creatorFeeBp = 100; // 1% fee

    // Approve the RiskophobeProtocol contract to transfer sold tokens
    await soldToken.connect(offererAccount).approve(riskophobeContractAddress, _soldTokenAmount);

    // Should fail because exchange rate cannot be 0
    await expect(
      riskophobeContract.connect(offererAccount).createOffer(
        _collateralToken,
        _soldToken,
        _soldTokenAmount,
        wrongExchangeRate, // Failing exchange rate
        _creatorFeeBp,
        _startTime,
        _endTime,
      ),
    ).to.be.revertedWith("Exchange rate must be greater than zero");

    // Working createOffer txn
    await expect(
      riskophobeContract
        .connect(offererAccount)
        .createOffer(_collateralToken, _soldToken, _soldTokenAmount, exchangeRate, _creatorFeeBp, _startTime, _endTime),
    ).to.not.be.reverted;
  });

  it("set current block number to offer ID 0 start time", async () => {
    const offer0StartTime: bigint = (await riskophobeContract.offers(0)).startTime;
    const newBlockTs: string = offer0StartTime.toString();

    await network.provider.send("evm_setNextBlockTimestamp", [newBlockTs]);
    await network.provider.send("evm_mine");
  });

  it("Should buy 0 WETH for 1M USDC from offer ID 0", async function () {
    const _collateralAmountIn = ethers.parseUnits("1000000", 6);

    // Approve the RiskophobeProtocol contract to transfer collateral tokens
    await collateralToken.connect(buyerAccount).approve(riskophobeContractAddress, _collateralAmountIn);

    // Working buyTokens txn
    await expect(riskophobeContract.connect(buyerAccount).buyTokens(0, _collateralAmountIn, 0)).not.to.be.reverted;

    // Check buyerAccount and contract balances
    const boughtAmount = ethers.parseEther("0");
    const newBuyerSoldTokenBalance = await soldToken.balanceOf(buyerAccount.address);
    expect(newBuyerSoldTokenBalance).to.be.eq(boughtAmount, "Bought amount sould be 0 WETH");
  });

  it("Should create an offer of WETH for USDC with 1:1000 exchange rate", async function () {
    const _startTime = 1732995840; // Nov 30, 2024 7:44:00 PM
    const _endTime = 1735569863; // Dec-30-2024 02:44:23 PM +UTC => 1 month later

    const _collateralToken = await collateralToken.getAddress();
    const _soldToken = await soldToken.getAddress();
    const _soldTokenAmount: bigint = ethers.parseEther("20"); // 20 WETH sold => 20,000 USDC buyable
    const correspondingCollateralAmount: bigint = ethers.parseUnits("20000", 6); // 20,000 USDC
    exchangeRate = (_soldTokenAmount * BigInt(10 ** 18)) / correspondingCollateralAmount;
    const _creatorFeeBp = 100; // 1% fee

    // Approve the RiskophobeProtocol contract to transfer sold tokens
    await soldToken.connect(offererAccount).approve(riskophobeContractAddress, _soldTokenAmount);

    // Working createOffer txn
    await expect(
      riskophobeContract
        .connect(offererAccount)
        .createOffer(_collateralToken, _soldToken, _soldTokenAmount, exchangeRate, _creatorFeeBp, _startTime, _endTime),
    ).to.not.be.reverted;
  });

  it("set current block number to offer ID 1 start time", async () => {
    const offer0StartTime: bigint = (await riskophobeContract.offers(1)).startTime;
    const newBlockTs: string = offer0StartTime.toString();

    await network.provider.send("evm_setNextBlockTimestamp", [newBlockTs]);
    await network.provider.send("evm_mine");
  });

  it("Simulates two buyers buying simultaneously to test slippage", async function () {
    // Buyers approve collateral token transfer
    const buyerCollateralAmount = ethers.parseUnits("5000", 6); // 5000 USDC for Buyer 1
    const secondBuyerCollateralAmount = ethers.parseUnits("6000", 6); // 6000 USDC for Buyer 2

    await collateralToken.connect(buyerAccount).approve(riskophobeContractAddress, buyerCollateralAmount);
    await collateralToken.connect(secondBuyerAccount).approve(riskophobeContractAddress, secondBuyerCollateralAmount);

    // Simulate simultaneous buys using `Promise.all`
    const buyerAccountTx = riskophobeContract
      .connect(buyerAccount)
      .buyTokens(1, buyerCollateralAmount, ethers.parseEther("4.95")); // Expecting ~4.95 WETH
    const secondBuyerAccountTx = riskophobeContract
      .connect(secondBuyerAccount)
      .buyTokens(1, secondBuyerCollateralAmount, ethers.parseEther("5.94")); // Expecting ~5.94 WETH

    // Execute transactions simultaneously
    await Promise.all([buyerAccountTx, secondBuyerAccountTx]);

    // Check buyerAccount's and secondBuyerAccount's sold token balances
    const buyerAccountSoldTokenBalance = await soldToken.balanceOf(buyerAccount.address);
    const secondBuyerAccountSoldTokenBalance = await soldToken.balanceOf(secondBuyerAccount.address);

    expect(buyerAccountSoldTokenBalance).to.be.closeTo(ethers.parseEther("4.95"), ethers.parseEther("0.01")); // Allowing slight variance
    expect(secondBuyerAccountSoldTokenBalance).to.be.closeTo(ethers.parseEther("5.94"), ethers.parseEther("0.01")); // Allowing slight variance

    // Check the remaining sold tokens in the contract
    const remainingSoldTokens = await soldToken.balanceOf(riskophobeContractAddress);
    expect(remainingSoldTokens).to.be.closeTo(ethers.parseEther("10.11"), ethers.parseEther("0.01")); // Minimal remaining tokens
  });
});
