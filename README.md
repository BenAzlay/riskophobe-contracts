# Riskophobe Contracts

This repository contains the Solidity smart contracts that power the Riskophobe protocol. The contracts enable
decentralized options trading, allowing users to buy tokens with the flexibility to return them and reclaim their
collateral.

---

## Overview

The smart contracts in this repository are developed using the Hardhat framework. They are designed to be efficient,
transparent, and secure, adhering to best practices in Ethereum smart contract development.

Key features:

- **Options Trading**: Supports the creation and management of tokenized options.
- **Collateral Management**: Handles collateral deposits and returns securely.
- **Fee Mechanism**: Enables fee collection for offer creators.
- **Event Logging**: Emits events for transparency and off-chain integrations.

### Deployed Contract Address

Riskophobe Protocol is deployed on the Base network:

**`0x0bBEeEab55594F1A03A2b34A6e454fb1d85519e4`**

---

## Requirements

Ensure you have the following installed before proceeding:

- [Node.js](https://nodejs.org/) (version 16 or higher)
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)
- [Hardhat](https://hardhat.org/)

---

## Installation

Follow these steps to set up the project:

### Clone the Repository

```bash
# Clone the repository
$ git clone https://github.com/your-repo/riskophobe-contracts.git

# Navigate into the project directory
$ cd riskophobe-contracts
```

### Install Dependencies

```bash
# Using npm
$ npm install

# Or using yarn
$ yarn install
```

---

## Available Scripts

### Compile Contracts

Compile the Solidity contracts using the Hardhat framework:

```bash
# Using npm
$ npx hardhat compile

# Or using yarn
$ yarn hardhat compile
```

### Run Tests

Run the test suite to ensure contract functionality:

```bash
# Using npm
$ npx hardhat test

# Or using yarn
$ yarn hardhat test
```

### Deploy Contracts

Deploy the contracts to a local or test network:

1. Configure the network in `hardhat.config.ts`.
2. Run the deployment script:

```bash
# Using npm
$ npx hardhat run scripts/deploy.ts --network <network-name>

# Or using yarn
$ yarn hardhat run scripts/deploy.ts --network <network-name>
```

### Linting

Check the code for linting issues:

```bash
# Using npm
$ npm run lint

# Or using yarn
$ yarn lint
```

---

## Project Structure

The repository is organized as follows:

```
contracts/
├── RiskophobeProtocol.sol    # Main protocol contract
scripts/
├── deploy.ts                 # Deployment script
test/
├── RiskophobeProtocol.test.ts  # Unit tests
hardhat.config.ts            # Hardhat configuration file
```

---

## Technology Stack

- **Hardhat**: Development environment for Ethereum smart contracts
- **Solidity**: Smart contract programming language
- **TypeScript**: Scripting and testing language
- **Ethers.js**: Library for Ethereum blockchain interactions
- **Mocha & Chai**: Testing framework and assertion library

---

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.
