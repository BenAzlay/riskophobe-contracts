import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers, network } from "hardhat";
import { vars } from "hardhat/config";

import { IERC20Metadata, RiskophobeProtocol } from "../../types";

const getAmountToReturn = (collateralReturned: bigint, exchangeRate: bigint) => {
  return (collateralReturned * exchangeRate) / BigInt(10 ** 18);
};

describe("Riskophobe Edge Cases Tests", function () {
  let buyerAccount: SignerWithAddress;
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

  it("transfer 1,000,000 collateral tokens (USDC) to buyerAccount", async () => {
    // Fork Ethereum Mainnet and impersonate a USDC-rich address
    const usdcRichAddress = "0x55fe002aeff02f77364de339a1292923a15844b8"; // USDC-rich address
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [usdcRichAddress],
    });
    const impersonatedSigner = await ethers.getSigner(usdcRichAddress);

    // Transfer 1M USDC to buyerAccount
    deployerCollateralTokenInitialBalance = ethers.parseUnits("1000000", 6);
    await collateralToken
      .connect(impersonatedSigner)
      .transfer(buyerAccount.address, deployerCollateralTokenInitialBalance);

    // Stop impersonation
    await network.provider.request({
      method: "hardhat_stopImpersonatingAccount",
      params: [usdcRichAddress],
    });
  });

  it("transfer 10 sold tokens (WETH) to offererAccount", async () => {
    // Fork Ethereum Mainnet and impersonate a WETH-rich address
    const wethRichAddress = "0x57757E3D981446D585Af0D9Ae4d7DF6D64647806"; // WETH-rich address
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [wethRichAddress],
    });
    const impersonatedSigner = await ethers.getSigner(wethRichAddress);

    // Transfer 10 WETH to offererAccount
    offererSoldTokenBalance = ethers.parseEther("10");
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
});
