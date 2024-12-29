import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import hre, { ethers } from "hardhat";

import { IERC20Metadata, RiskophobeProtocol } from "../../types";

describe("Riskophobe General Tests", function () {
  let deployer: SignerWithAddress;
  let otherAccount: SignerWithAddress;

  let soldToken: IERC20Metadata;
  let collateralToken: IERC20Metadata;

  let riskophobeContract: RiskophobeProtocol;
  let riskophobeContractAddress: string;

  before(async function () {
    [deployer, otherAccount] = await ethers.getSigners();

    // Sold token is WETH
    soldToken = <IERC20Metadata>(
      await ethers.getContractAt("IERC20Metadata", "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2")
    );

    // Collateral token is USDC
    collateralToken = <IERC20Metadata>(
      await ethers.getContractAt("IERC20Metadata", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48")
    );

    // Deploy the Riskophobe Protocol
    const epochUpsideFactory = await ethers.getContractFactory("RiskophobeProtocol");
    riskophobeContract = await epochUpsideFactory.deploy();
    riskophobeContractAddress = await riskophobeContract.getAddress();
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
});
