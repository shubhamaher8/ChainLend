# ChainLend — Cross-Chain DeFi Lending Platform

Cross-chain lending protocol: deposit collateral on **Polygon Amoy**, borrow against it on **Ethereum Sepolia** via **LayerZero V2**.

## Architecture

```
User (MetaMask)
    │
    ▼
Frontend (Vercel) — index.html + Ethers.js
    │
    ├── Polygon Amoy (Collateral Chain)
    │     MockUSDC (mUSDC) → LendingPool → ChainLendBridge
    │                                            │
    │                                      LayerZero V2
    │                                            │
    └── Ethereum Sepolia (Loan Chain)            │
          MockUSDC (sUSDC) → LendingPool → ChainLendBridge
```

## Protocol Parameters

| Parameter       | Value  |
|-----------------|--------|
| Deposit APY     | 5%     |
| Borrow APR      | 8%     |
| Max LTV         | 50%    |
| Collateral Token | mUSDC (6 decimals) |
| Loan Token      | sUSDC (6 decimals) |

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in PRIVATE_KEY, AMOY_RPC_URL, SEPOLIA_RPC_URL
```

Get testnet tokens:
- MATIC (Amoy): https://faucet.polygon.technology/
- ETH (Sepolia): https://sepoliafaucet.com/

### 3. Compile contracts

```bash
npm run compile
```

### 4. Run tests

```bash
npm test
```

### 5. Deploy

Deploy to Amoy first, then Sepolia:

```bash
npm run deploy:amoy
npm run deploy:sepolia
```

Copy the deployed addresses into:
- `scripts/configureBridge.js` — `DEPLOYED` object
- `frontend/constants.js` — `ADDRESSES` object

### 6. Configure LayerZero peers

This is mandatory — bridges won't accept messages until peers are registered:

```bash
npx hardhat run scripts/configureBridge.js --network amoy
npx hardhat run scripts/configureBridge.js --network sepolia
```

### 7. Deploy frontend

Push to GitHub and connect to [Vercel](https://vercel.com). Set the root directory to `frontend/`.

## User Workflow

1. **Phase 1** — Connect MetaMask to Amoy, deposit mUSDC into LendingPool
2. **Phase 2** — Switch to Sepolia, call `requestBorrow()` (max 50% of collateral)
3. **Phase 3** — Use sUSDC freely on Sepolia (interest accrues at 8% APR)
4. **Phase 4** — Repay debt on Sepolia via `repayAndUnlock()`
5. **Phase 5** — Switch back to Amoy, withdraw collateral + 5% APY

## LayerZero EIDs

| Network         | EID   |
|-----------------|-------|
| Polygon Amoy    | 40267 |
| Ethereum Sepolia| 40161 |

Endpoint (both chains): `0x6EDCE65403992e310A62460808c4b91000972f10f`

## Contract Addresses

> Fill in after deployment

| Contract       | Amoy | Sepolia |
|----------------|------|---------|
| MockUSDC       | —    | —       |
| LendingPool    | —    | —       |
| ChainLendBridge| —    | —       |
