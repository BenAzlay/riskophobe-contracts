import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const protocol = await deploy("RiskophobeProtocol", {
    from: deployer,
    log: true,
  });

  console.log(`RiskophobeProtocol contract: `, protocol.address);
};
export default func;
func.id = "deploy_riskophobeprotocol"; // id required to prevent reexecution
func.tags = ["RiskophobeProtocol"];
