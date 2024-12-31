import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import hre, { ethers, network } from "hardhat";
import { vars } from "hardhat/config";

import { IERC20Metadata, RiskophobeProtocol } from "../../types";

describe("Riskophobe General Tests", function () {
  let deployer: SignerWithAddress;
  let otherAccount: SignerWithAddress;

  let soldToken: IERC20Metadata;
  let collateralToken: IERC20Metadata;

  let riskophobeContract: RiskophobeProtocol;
  let riskophobeContractAddress: string;

  const infuraApiKey: string = vars.get("INFURA_API_KEY");

  before(async function () {
    [deployer, otherAccount] = await ethers.getSigners();

    const jsonRpcUrl: string = "https://mainnet.infura.io/v3/" + infuraApiKey;

    // Reset hardhat fork to avoid changes affecting subsequent tests
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl, // mainnet rpc
            blockNumber: 21523652, // Dec-31-2024 04:30:11 PM +UTC
          },
        },
      ],
    });

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

  it("transfer 1000 collateral tokens (USDC) to account 1", async () => {
    // Fork Ethereum Mainnet and impersonate a USDC-rich address
    const usdcRichAddress = "0x55fe002aeff02f77364de339a1292923a15844b8"; // USDC-rich address
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [usdcRichAddress],
    });
    const impersonatedSigner = await ethers.getSigner(usdcRichAddress);

    // Transfer 1000 USDC to deployer
    const usdcAmount = ethers.parseUnits("1000", 6);
    await collateralToken.connect(impersonatedSigner).transfer(deployer.address, usdcAmount);

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

    // Transfer 10 WETH to deployer
    const wethAmount = ethers.parseUnits("10", 18);
    await soldToken.connect(impersonatedSigner).transfer(otherAccount.address, wethAmount);

    // Stop impersonation
    await network.provider.request({
      method: "hardhat_stopImpersonatingAccount",
      params: [wethRichAddress],
    });
    const deployerUSDCBalance = await soldToken.balanceOf(otherAccount.address);
    expect(deployerUSDCBalance).to.equal(wethAmount);
  });

  describe("Offer management", function () {
    it("Should fail if start time is greater than end time", async function () {
      const latestTime = await time.latest();
      const _startTime = latestTime + 10000;
      const _endTime = latestTime + 1000;

      const _collateralToken = await collateralToken.getAddress();
      const _soldToken = await soldToken.getAddress();
      const _soldTokenAmount = ethers.parseEther("100");
      const _exchangeRate = ethers.parseUnits("1", 18); // 1 COLL = 1 SOLD
      const _creatorFeeBp = 100; // 1% fee

      // Approve the RiskophobeProtocol contract to transfer sold tokens
      await soldToken.connect(deployer).approve(riskophobeContractAddress, _soldTokenAmount);

      // Attempt to create an offer and expect it to revert
      await expect(
        riskophobeContract
          .connect(deployer)
          .createOffer(
            _collateralToken,
            _soldToken,
            _soldTokenAmount,
            _exchangeRate,
            _creatorFeeBp,
            _startTime,
            _endTime,
          ),
      ).to.be.revertedWith("Start time must be before end time");
    });
  });

  it("Should fail if offer creator does not have enough sold token balance", async function () {
    const latestTime = await time.latest();
    const _startTime = latestTime;
    const _endTime = latestTime + 10000;

    const _collateralToken = await collateralToken.getAddress();
    const _soldToken = await soldToken.getAddress();
    const _soldTokenAmount = ethers.parseEther("100");
    const _exchangeRate = ethers.parseUnits("1", 18); // 1 COLL = 1 SOLD
    const _creatorFeeBp = 100; // 1% fee

    // Approve the RiskophobeProtocol contract to transfer sold tokens
    await soldToken.connect(deployer).approve(riskophobeContractAddress, _soldTokenAmount);

    // Attempt to create an offer and expect it to revert
    await expect(
      riskophobeContract
        .connect(deployer)
        .createOffer(
          _collateralToken,
          _soldToken,
          _soldTokenAmount,
          _exchangeRate,
          _creatorFeeBp,
          _startTime,
          _endTime,
        ),
    ).to.be.reverted;
  });
});
