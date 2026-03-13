# ChainLend — Complete Deployment Guide
> Fresh deploy from zero to live E2E test on Polygon Amoy + Ethereum Sepolia
> Tool: Remix IDE only | Wallet: MetaMask

---

## Table of Contents
1. [Pre-Flight Checklist](#1-pre-flight-checklist)
2. [Remix Setup](#2-remix-setup)
3. [Deploy on Polygon Amoy](#3-deploy-on-polygon-amoy)
4. [Deploy on Ethereum Sepolia](#4-deploy-on-ethereum-sepolia)
5. [Wire Amoy Contracts](#5-wire-amoy-contracts)
6. [Wire Sepolia Contracts](#6-wire-sepolia-contracts)
7. [Fund the Pools](#7-fund-the-pools)
8. [Set Enforced Options (Critical)](#8-set-enforced-options-critical)
9. [E2E Test — Full Borrow/Repay Flow](#9-e2e-test--full-borrowrepay-flow)
10. [Verify Everything on Explorers](#10-verify-everything-on-explorers)
11. [Deployed Addresses Log](#11-deployed-addresses-log)
12. [Troubleshooting](#12-troubleshooting)

---

## Reference Constants (keep this open)

```
LayerZero Endpoint (SAME on both chains):
  0x6EDCE65403992e310A62460808c4b910D972f10f

Amoy  EID : 40267
Sepolia EID: 40161

Your deployer wallet (owner + delegate):
  0x003b739410f14b248A2A24cd4FC4021F40Fc2B20

Amoy  RPC : https://rpc-amoy.polygon.technology
Sepolia RPC: https://rpc.sepolia.org (or Infura/Alchemy)

Amoy  Explorer : https://amoy.polygonscan.com
Sepolia Explorer: https://sepolia.etherscan.io

LayerZero Scan: https://testnet.layerzeroscan.com
```

---

## 1. Pre-Flight Checklist

Before touching Remix, confirm all of these:

- [ ] MetaMask installed and unlocked
- [ ] Deployer wallet `0x003b739...` imported in MetaMask
- [ ] **Polygon Amoy** added to MetaMask
  - Network Name: Polygon Amoy Testnet
  - RPC: `https://rpc-amoy.polygon.technology`
  - Chain ID: `80002`
  - Symbol: `MATIC`
  - Explorer: `https://amoy.polygonscan.com`
- [ ] **Ethereum Sepolia** added to MetaMask
  - Network Name: Sepolia
  - RPC: `https://rpc.sepolia.org`
  - Chain ID: `11155111`
  - Symbol: `ETH`
  - Explorer: `https://sepolia.etherscan.io`
- [ ] Wallet has **at least 1 MATIC** on Amoy (get from https://faucet.polygon.technology)
- [ ] Wallet has **at least 0.1 ETH** on Sepolia (get from https://sepoliafaucet.com)
- [ ] All 3 `.sol` files ready: `MockUSDC.sol`, `LendingPool.sol`, `ChainLendBridge.sol`

---

## 2. Remix Setup

### 2.1 Open Remix
Go to https://remix.ethereum.org

### 2.2 Create file structure
In the `contracts/` folder, create these 3 files and paste the code:
```
contracts/
  MockUSDC.sol
  LendingPool.sol
  ChainLendBridge.sol
```

### 2.3 Configure Compiler
- Click the **Solidity Compiler** tab (second icon in left sidebar)
- Compiler version: `0.8.19` (or `^0.8.19` auto-selects it)
- EVM Version: `paris`
- Enable optimization: **YES**, runs: `200`
- Click **Compile MockUSDC.sol** → should show green checkmark
- Repeat for **LendingPool.sol** and **ChainLendBridge.sol**

> If you see import errors for `@layerzerolabs` or `@openzeppelin`, Remix auto-resolves
> npm packages from unpkg. Just wait 5–10 seconds and retry compile.

### 2.4 Connect MetaMask
- Click the **Deploy & Run** tab (third icon)
- Environment: `Injected Provider - MetaMask`
- MetaMask will prompt to connect — approve
- Confirm "Account" shows your deployer wallet address

---

## 3. Deploy on Polygon Amoy

> Switch MetaMask to **Polygon Amoy** before this section.
> Confirm the network badge in Remix shows "Custom (80002) network".

### 3.1 Deploy MockUSDC (mUSDC) on Amoy

- Contract: `MockUSDC`
- In the **Deploy** section, expand the constructor inputs:
  ```
  _name:          Mock USDC
  _symbol:        mUSDC
  _initialSupply: 1000000
  ```
- Click **Deploy** → approve MetaMask tx
- ✅ Save address as `AMOY_MUSDC`

> This mints 1,000,000 mUSDC (6 decimals) to your deployer wallet.

### 3.2 Deploy LendingPool on Amoy

- Contract: `LendingPool`
- Constructor input:
  ```
  _token: <AMOY_MUSDC address>
  ```
- Click **Deploy** → approve MetaMask tx
- ✅ Save address as `AMOY_POOL`

### 3.3 Deploy ChainLendBridge on Amoy

- Contract: `ChainLendBridge`
- Constructor inputs:
  ```
  _endpoint: 0x6EDCE65403992e310A62460808c4b910D972f10f
  _delegate:  0x003b739410f14b248A2A24cd4FC4021F40Fc2B20
  ```
- Click **Deploy** → approve MetaMask tx
- ✅ Save address as `AMOY_BRIDGE`

---

## 4. Deploy on Ethereum Sepolia

> Switch MetaMask to **Ethereum Sepolia** before this section.
> Confirm the network badge in Remix shows "Custom (11155111) network".

### 4.1 Deploy MockUSDC (sUSDC) on Sepolia

- Contract: `MockUSDC`
- Constructor inputs:
  ```
  _name:          Synthetic USDC
  _symbol:        sUSDC
  _initialSupply: 0
  ```
- Click **Deploy** → approve MetaMask tx
- ✅ Save address as `SEPOLIA_SUSDC`

> Initial supply is 0. We mint to the pool in Step 7.

### 4.2 Deploy LendingPool on Sepolia

- Contract: `LendingPool`
- Constructor input:
  ```
  _token: <SEPOLIA_SUSDC address>
  ```
- Click **Deploy** → approve MetaMask tx
- ✅ Save address as `SEPOLIA_POOL`

### 4.3 Deploy ChainLendBridge on Sepolia

- Contract: `ChainLendBridge`
- Constructor inputs:
  ```
  _endpoint: 0x6EDCE65403992e310A62460808c4b910D972f10f
  _delegate:  0x003b739410f14b248A2A24cd4FC4021F40Fc2B20
  ```
- Click **Deploy** → approve MetaMask tx
- ✅ Save address as `SEPOLIA_BRIDGE`

---

## 5. Wire Amoy Contracts

> Switch MetaMask back to **Polygon Amoy**.
> In Remix Deploy tab, select the correct deployed contract from the dropdown.

### 5.1 Wire AmoyBridge → AmoyPool

Select `ChainLendBridge` at `AMOY_BRIDGE`, call:

```
setLendingPool(_pool): <AMOY_POOL>
```
→ Approve MetaMask tx

```
setRemoteEid(_eid): 40161
```
→ Approve MetaMask tx

### 5.2 Set Peer on Amoy Bridge

The peer address must be zero-padded to `bytes32`.
Calculate it like this:
```
Take SEPOLIA_BRIDGE address (no 0x prefix)
Pad with zeros on the LEFT to make 64 hex chars total
Add 0x prefix

Example: if SEPOLIA_BRIDGE = 0x3C972A74Fc0dAD0Fa32CeD08C8334B521E44aC83
Result:  0x0000000000000000000000003C972A74Fc0dAD0Fa32CeD08C8334B521E44aC83
```

Call on Amoy Bridge:
```
setPeer(_eid, _peer):
  _eid:  40161
  _peer: 0x000000000000000000000000<SEPOLIA_BRIDGE_NO_0x>
```
→ Approve MetaMask tx

### 5.3 Wire AmoyPool → AmoyBridge

Select `LendingPool` at `AMOY_POOL`, call:
```
setBridge(_bridge): <AMOY_BRIDGE>
```
→ Approve MetaMask tx

---

## 6. Wire Sepolia Contracts

> Switch MetaMask to **Ethereum Sepolia**.

### 6.1 Wire SepoliaBridge → SepoliaPool

Select `ChainLendBridge` at `SEPOLIA_BRIDGE`, call:

```
setLendingPool(_pool): <SEPOLIA_POOL>
```
→ Approve MetaMask tx

```
setRemoteEid(_eid): 40267
```
→ Approve MetaMask tx

### 6.2 Set Peer on Sepolia Bridge

Calculate bytes32 for AMOY_BRIDGE:
```
Take AMOY_BRIDGE address (no 0x prefix)
Pad with zeros on the LEFT to 64 hex chars
Add 0x prefix

Example: if AMOY_BRIDGE = 0xaAFE5a3d4bD40092A637c60A6f331FF7e20a9d78
Result:  0x000000000000000000000000aAFE5a3d4bD40092A637c60A6f331FF7e20a9d78
```

Call on Sepolia Bridge:
```
setPeer(_eid, _peer):
  _eid:  40267
  _peer: 0x000000000000000000000000<AMOY_BRIDGE_NO_0x>
```
→ Approve MetaMask tx

### 6.3 Wire SepoliaPool → SepoliaBridge

Select `LendingPool` at `SEPOLIA_POOL`, call:
```
setBridge(_bridge): <SEPOLIA_BRIDGE>
```
→ Approve MetaMask tx

---

## 7. Fund the Pools

### 7.1 Mint sUSDC to Sepolia Pool (loan capital)

> Still on Sepolia.

Select `MockUSDC` at `SEPOLIA_SUSDC`, call:
```
mint(_to, _amount):
  _to:     <SEPOLIA_POOL>
  _amount: 500000000000     ← 500,000 sUSDC (6 decimals: 500000 × 10^6)
```
→ Approve MetaMask tx

**Verify:** Call `getPoolLiquidity()` on `SEPOLIA_POOL` → should return `500000000000`

### 7.2 Add mUSDC to your wallet on Amoy (for testing)

> Switch MetaMask to **Polygon Amoy**.

Your deployer wallet already has 1,000,000 mUSDC from Step 3.1.
No extra minting needed for testing.

**Verify:** Call `balanceOf(your_wallet)` on `AMOY_MUSDC` → should return `1000000000000`

---

## 8. Set Enforced Options (Critical)

This tells LayerZero DVNs the minimum gas your `_lzReceive` requires.
Without this, messages may be rejected with `InvalidOptions` on some DVN configs.

### 8.1 On Amoy Bridge

> On **Polygon Amoy**, select `ChainLendBridge` at `AMOY_BRIDGE`.

Call `setEnforcedOptions`:
```
_eid:     40161
_msgType: 1
_options: 0x00030100110100000000000000000000000000049510
```
→ Approve MetaMask tx

### 8.2 On Sepolia Bridge

> Switch to **Ethereum Sepolia**, select `ChainLendBridge` at `SEPOLIA_BRIDGE`.

Call `setEnforcedOptions`:
```
_eid:     40267
_msgType: 1
_options: 0x00030100110100000000000000000000000000049510
```
→ Approve MetaMask tx

> **What is that hex?**
> `0x00030100110100000000000000000000000000049510`
> = `OptionsBuilder.newOptions().addExecutorLzReceiveOption(300_000, 0)`
> encoded as Type 3 options bytes.
> 300,000 gas is the executor gas limit for your `_lzReceive` function.

---

## 9. E2E Test — Full Borrow/Repay Flow

This is the full 5-phase user journey. Go step by step and do not skip ahead.

---

### PHASE 1 — Deposit Collateral on Amoy

> Switch MetaMask to **Polygon Amoy**.

**Step 1: Approve mUSDC spend to Amoy Pool**

Select `MockUSDC` at `AMOY_MUSDC`, call:
```
approve(_spender, _value):
  _spender: <AMOY_POOL>
  _value:   2000000000    ← 2,000 mUSDC (we'll borrow 1,000, need 2× collateral)
```
→ Approve MetaMask tx

**Step 2: Deposit into Amoy Pool**

Select `LendingPool` at `AMOY_POOL`, call:
```
deposit(_amount): 2000000000    ← 2,000 mUSDC
```
→ Approve MetaMask tx

**Step 3: Verify deposit**

Call `getBalance(your_wallet)` on `AMOY_POOL`:
```
Expected:
  principal: 2000000000
  locked:    0
  available: 2000000000
  interest:  ~0 (tiny, just deposited)
```
✅ Phase 1 complete

---

### PHASE 2 — Cross-Chain Borrow on Sepolia

> Still on **Polygon Amoy** — you pay MATIC gas here.

**Step 1: Get the LayerZero fee quote**

Select `ChainLendBridge` at `AMOY_BRIDGE`, call:
```
quoteBorrow(_borrowAmount): 1000000000    ← 1,000 sUSDC to borrow
```
→ This is a `view` call, no tx needed.
→ Returns a number like `1234567890000000` (in wei)
→ Convert to MATIC: divide by 1e18 (e.g., 0.00123 MATIC)
✅ Note this value — call it `FEE_MATIC`

**Step 2: Call lockAndBorrow**

Still on `ChainLendBridge` at `AMOY_BRIDGE`:
- Set **VALUE** field in Remix to `FEE_MATIC` (in wei, the exact number from quoteBorrow)
  > In Remix: above the function inputs, set "VALUE" field to the quoted fee in wei
```
lockAndBorrow(_borrowAmount): 1000000000    ← 1,000 sUSDC
```
→ Approve MetaMask tx (you'll pay MATIC)

**Step 3: Confirm collateral locked on Amoy**

Call `getBalance(your_wallet)` on `AMOY_POOL`:
```
Expected:
  principal: 2000000000
  locked:    2000000000   ← all locked as 2× collateral
  available: 0
  interest:  ~0
```

**Step 4: Track the message on LayerZero Scan**

Go to: https://testnet.layerzeroscan.com
Search your tx hash from Step 2.
Wait for status: `DELIVERED` ✅ (usually 30–90 seconds)

> If status stays `INFLIGHT` for >5 minutes, see Troubleshooting section.

---

### PHASE 3 — Verify Loan on Sepolia

> Switch MetaMask to **Ethereum Sepolia**.

**Step 1: Check your sUSDC balance**

In MetaMask, import the sUSDC token: `SEPOLIA_SUSDC` address.
Balance should show **1,000 sUSDC**.

Or call `balanceOf(your_wallet)` on `MockUSDC` at `SEPOLIA_SUSDC`:
```
Expected: 1000000000
```

**Step 2: Check your debt**

Call `getDebt(your_wallet)` on `LendingPool` at `SEPOLIA_POOL`:
```
Expected:
  principal: 1000000000
  interest:  ~0 (small, just borrowed)
  total:     ~1000000000
```
✅ Phase 3 confirmed. You now have borrowed sUSDC on Sepolia.

---

### PHASE 4 — Repay Loan on Sepolia

> Still on **Ethereum Sepolia**.

**Step 1: Check exact debt**

Call `getDebt(your_wallet)` on `SEPOLIA_POOL`:
```
Returns: (principal, interest, total)
```
Note the `total` value. Add ~1% buffer for interest accruing during tx.
Example: total = `1000001234` → use `1010000000` to be safe.
Call this `REPAY_AMOUNT`.

**Step 2: Approve sUSDC to Sepolia Pool (NOT the bridge)**

Select `MockUSDC` at `SEPOLIA_SUSDC`, call:
```
approve(_spender, _value):
  _spender: <SEPOLIA_POOL>    ← approve the POOL, not the bridge
  _value:   <REPAY_AMOUNT>
```
→ Approve MetaMask tx

**Step 3: Get the LayerZero fee quote for repay**

Select `ChainLendBridge` at `SEPOLIA_BRIDGE`, call:
```
quoteRepay(_amount): <REPAY_AMOUNT>
```
→ Returns fee in wei (ETH). Call it `FEE_ETH`.

**Step 4: Call repayAndUnlock**

Still on `ChainLendBridge` at `SEPOLIA_BRIDGE`:
- Set **VALUE** field in Remix to `FEE_ETH` (in wei)
```
repayAndUnlock(_amount): <REPAY_AMOUNT>
```
→ Approve MetaMask tx (you'll pay ETH + sUSDC pulled from wallet)

**Step 5: Verify debt cleared on Sepolia**

Call `getDebt(your_wallet)` on `SEPOLIA_POOL`:
```
Expected:
  principal: 0
  interest:  0
  total:     0
```

**Step 6: Track on LayerZero Scan**

Go to https://testnet.layerzeroscan.com
Search repay tx hash → wait for `DELIVERED` ✅

---

### PHASE 5 — Withdraw Collateral on Amoy

> Switch MetaMask to **Polygon Amoy**.

**Step 1: Verify collateral unlocked**

Call `getBalance(your_wallet)` on `AMOY_POOL`:
```
Expected:
  principal: 2000000000
  locked:    0            ← unlocked by LayerZero message
  available: 2000000000
  interest:  <some small amount>
```

**Step 2: Withdraw mUSDC**

Select `LendingPool` at `AMOY_POOL`, call:
```
withdraw(_amount): 2000000000
```
→ Approve MetaMask tx

**Step 3: Verify wallet balance**

Call `balanceOf(your_wallet)` on `MockUSDC` at `AMOY_MUSDC`:
```
Expected: ~998000000000  (original 1M minus what you kept in pool, roughly)
```

✅ **Full cycle complete!** Deposited → Locked → Borrowed → Repaid → Unlocked → Withdrawn.

---

## 10. Verify Everything on Explorers

After the full test, confirm all 6 contracts are working:

### Amoy (https://amoy.polygonscan.com)
| Contract | Check |
|---|---|
| `AMOY_MUSDC` | Token transfers visible |
| `AMOY_POOL` | `deposits` mapping shows your address |
| `AMOY_BRIDGE` | `lendingPool`, `remoteEid`, `peers` all set |

### Sepolia (https://sepolia.etherscan.io)
| Contract | Check |
|---|---|
| `SEPOLIA_SUSDC` | Token transfers visible |
| `SEPOLIA_POOL` | `loans` mapping cleared after repay |
| `SEPOLIA_BRIDGE` | `lendingPool`, `remoteEid`, `peers` all set |

### LayerZero Scan (https://testnet.layerzeroscan.com)
- Both messages (borrow + repay) show `DELIVERED`
- Source → Destination chain correctly shown

---

## 11. Deployed Addresses Log

Fill this in as you deploy — keep it safe.

```
=== POLYGON AMOY ===
AMOY_MUSDC  : 0x___________________________________________
AMOY_POOL   : 0x___________________________________________
AMOY_BRIDGE : 0x___________________________________________

=== ETHEREUM SEPOLIA ===
SEPOLIA_SUSDC  : 0x___________________________________________
SEPOLIA_POOL   : 0x___________________________________________
SEPOLIA_BRIDGE : 0x___________________________________________

=== SHARED ===
Deployer/Owner : 0x003b739410f14b248A2A24cd4FC4021F40Fc2B20
LZ Endpoint    : 0x6EDCE65403992e310A62460808c4b910D972f10f
Amoy  EID      : 40267
Sepolia EID    : 40161
```

---

## 12. Troubleshooting

### ❌ Remix compile error: "File not found @layerzerolabs/..."
- Wait 10 seconds and click Compile again
- Remix fetches npm packages from unpkg on first compile — it's slow
- If persists: try clearing Remix cache (Settings → Clear Cache)

### ❌ MetaMask: "Transaction underpriced"
- In MetaMask, click Edit Gas → increase gas price slightly
- Amoy can be congested — try again after 1-2 minutes

### ❌ `lockAndBorrow` reverts: "LendingPool: insufficient collateral"
- Your available balance on Amoy Pool is less than `borrowAmount × 2`
- Either deposit more mUSDC or reduce borrow amount
- Check: `getBalance(wallet)` → `available` must be >= `borrowAmount × 2`

### ❌ `lockAndBorrow` reverts: "NotEnoughNative"
- msg.value < quoted fee
- Re-run `quoteBorrow()` — fee changes slightly each block
- Add 10% buffer to the quoted fee when setting VALUE in Remix

### ❌ LayerZero message stuck `INFLIGHT` for >5 min
- Usually means `_lzReceive` reverted on destination, blocking the channel
- Go to destination chain explorer, find the EndpointV2 contract
- Call `lzReceive()` manually with higher gas
- Or check: is `setPeer` correct on both sides? Is `setBridge` done?

### ❌ `repayAndUnlock` reverts: "Bridge: no active loan"
- `getDebt()` returned principal=0 — loan doesn't exist on Sepolia pool
- Either borrow message never delivered (check LZ scan) or already repaid

### ❌ `repayAndUnlock` reverts: "ERC20: insufficient allowance"
- You approved the BRIDGE instead of the POOL
- Approve `SEPOLIA_POOL` address for sUSDC, not the bridge

### ❌ `repayAndUnlock` reverts: "LendingPool: must cover at least principal"
- `_amount` passed is less than the principal (1,000,000,000 = 1000 sUSDC)
- Use `getDebt()` total + 1% buffer

### ❌ Collateral still locked after repay message DELIVERED
- Check events on Amoy Bridge: `CollateralUnlocked(user, amount, success=false)`
- If `success=false`, the `pool.unlock()` call failed silently (try/catch)
- Check: `AMOY_BRIDGE` is set as bridge on `AMOY_POOL` via `setBridge`?
- Check: the `amount * 2` passed to unlock <= `d.locked` on Amoy pool?

### ❌ `OnlyPeer` error on LayerZero Scan
- `setPeer` is wrong or missing on one side
- Re-check the bytes32 padding — must be 32 bytes total, left-padded with zeros
- Format: `0x000000000000000000000000{40-char-address-no-0x}`

---

*End of deployment guide. All 6 contracts deployed and wired = ChainLend fully operational.*
