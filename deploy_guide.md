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
8. [Set Enforced Options](#8-set-enforced-options)
9. [Update Frontend constants.js](#9-update-frontend-constantsjs)
10. [E2E Test — Full Borrow/Repay Flow](#10-e2e-test--full-borrowrepay-flow)
11. [Verify on Explorers](#11-verify-on-explorers)
12. [Deployed Addresses Log](#12-deployed-addresses-log)
13. [Troubleshooting](#13-troubleshooting)

---

## Reference Constants (keep this open the whole time)

```
LayerZero Endpoint (SAME address on both chains):
  0x6EDCE65403992e310A62460808c4b910D972f10f

Amoy   EID : 40267
Sepolia EID : 40161

Deployer/Owner wallet:
  0x003b739410f14b248A2A24cd4FC4021F40Fc2B20

Amoy   RPC : https://rpc-amoy.polygon.technology
Sepolia RPC : https://ethereum-sepolia-rpc.publicnode.com
              ↑ use this one — rpc.sepolia.org is unreliable

Amoy   Explorer : https://amoy.polygonscan.com
Sepolia Explorer : https://sepolia.etherscan.io

LayerZero Scan : https://testnet.layerzeroscan.com
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
  - RPC: `https://ethereum-sepolia-rpc.publicnode.com`
  - Chain ID: `11155111`
  - Symbol: `ETH`
  - Explorer: `https://sepolia.etherscan.io`
- [ ] Wallet has **at least 1 MATIC** on Amoy (faucet: https://faucet.polygon.technology)
- [ ] Wallet has **at least 0.1 ETH** on Sepolia (faucet: https://sepoliafaucet.com)
- [ ] All 5 `.sol` files ready:
  - `MockUSDC.sol`
  - `AmoyLendingPool.sol`
  - `AmoyBridge.sol`
  - `SepoliaLendingPool.sol`
  - `SepoliaBridge.sol`

---

## 2. Remix Setup

### 2.1 Open Remix
Go to https://remix.ethereum.org

### 2.2 Create file structure
In the `contracts/` folder, create 5 files:
```
contracts/
  MockUSDC.sol
  AmoyLendingPool.sol
  AmoyBridge.sol
  SepoliaLendingPool.sol
  SepoliaBridge.sol
```

### 2.3 Configure Compiler
- Click the **Solidity Compiler** tab (second icon in left sidebar)
- Compiler version: `0.8.19`
- EVM Version: `paris`
- Enable optimization: **YES**, runs: `200`
- Compile each file — should show green checkmarks

> If you see import errors for `@layerzerolabs` or `@openzeppelin`,
> Remix auto-resolves npm packages from unpkg. Wait 10 seconds and retry.

### 2.4 Connect MetaMask
- Click the **Deploy & Run** tab (third icon)
- Environment: `Injected Provider - MetaMask`
- MetaMask will prompt to connect — approve
- Confirm the "Account" field shows your deployer wallet

---

## 3. Deploy on Polygon Amoy

> Switch MetaMask to **Polygon Amoy** before this section.
> Remix network badge should show "Custom (80002) network".

### 3.1 Deploy MockUSDC (mUSDC) on Amoy

- Contract: `MockUSDC`
- Constructor inputs:
  ```
  _name:          Mock USDC
  _symbol:        mUSDC
  _delegate: 0x003b739410f14b248A2A24cd4FC4021F40Fc2B20
  ```
- Click **Deploy** → approve MetaMask tx
- ✅ Save address as `AMOY_MUSDC`

> This mints 1,000,000 mUSDC (6 decimals) to your deployer wallet.

### 3.2 Deploy AmoyLendingPool

- Contract: `AmoyLendingPool`
- Constructor inputs:
  ```
  _token:    <AMOY_MUSDC>
  _delegate: 0x003b739410f14b248A2A24cd4FC4021F40Fc2B20
  ```
- Click **Deploy** → approve MetaMask tx
- ✅ Save address as `AMOY_POOL`

### 3.3 Deploy AmoyBridge

- Contract: `AmoyBridge` (ChainLendBridge)
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
> Remix network badge should show "Custom (11155111) network".

### 4.1 Deploy MockUSDC (sUSDC) on Sepolia

- Contract: `MockUSDC`
- Constructor inputs:
  ```
  _name:          Synthetic USDC
  _symbol:        sUSDC
  _delegate: 0x003b739410f14b248A2A24cd4FC4021F40Fc2B20
  ```
- Click **Deploy** → approve MetaMask tx
- ✅ Save address as `SEPOLIA_SUSDC`

> Initial supply is 0 — we mint directly to the pool in Step 7.

### 4.2 Deploy SepoliaLendingPool

- Contract: `SepoliaLendingPool`
- Constructor inputs:
  ```
  _token:    <SEPOLIA_SUSDC>
  _delegate: 0x003b739410f14b248A2A24cd4FC4021F40Fc2B20
  ```
- Click **Deploy** → approve MetaMask tx
- ✅ Save address as `SEPOLIA_POOL`

### 4.3 Deploy SepoliaBridge

- Contract: `SepoliaBridge` (ChainLendBridge)
- Constructor inputs:
  ```
  _endpoint: 0x6EDCE65403992e310A62460808c4b910D972f10f
  _delegate:  0x003b739410f14b248A2A24cd4FC4021F40Fc2B20
  ```
- Click **Deploy** → approve MetaMask tx
- ✅ Save address as `SEPOLIA_BRIDGE`

---

## 5. Wire Amoy Contracts

> Switch MetaMask to **Polygon Amoy**.

### 5.1 AmoyBridge → AmoyPool

Select `AmoyBridge` at `AMOY_BRIDGE`, call:
```
setLendingPool(_lendingPool): <AMOY_POOL>
```
→ Approve MetaMask tx

### 5.2 Set Peer on AmoyBridge

The peer address must be zero-padded to `bytes32`.
```
Take SEPOLIA_BRIDGE address without 0x prefix
Pad with zeros on the LEFT to make 64 hex characters total
Add 0x prefix back

Example: SEPOLIA_BRIDGE = 0xba029eF4dA8f8771217A37ebc5196E42ec6ada0a
Result:  0x000000000000000000000000ba029eF4dA8f8771217A37ebc5196E42ec6ada0a
```

Call on `AmoyBridge`:
```
setPeer(_eid, _peer):
  _eid:  40161
  _peer: 0x000000000000000000000000<SEPOLIA_BRIDGE_WITHOUT_0x>
```
→ Approve MetaMask tx

### 5.3 AmoyPool → AmoyBridge

Select `AmoyLendingPool` at `AMOY_POOL`, call:
```
setBridge(_bridge): <AMOY_BRIDGE>
```
→ Approve MetaMask tx

---

## 6. Wire Sepolia Contracts

> Switch MetaMask to **Ethereum Sepolia**.

### 6.1 SepoliaBridge → SepoliaPool

Select `SepoliaBridge` at `SEPOLIA_BRIDGE`, call:
```
setLendingPool(_pool): <SEPOLIA_POOL>
```
→ Approve MetaMask tx

```
setAmoyEid(_eid): 40267
```
→ Approve MetaMask tx

### 6.2 Set Peer on SepoliaBridge

```
Take AMOY_BRIDGE address without 0x prefix
Pad with zeros on LEFT to 64 hex characters
Add 0x prefix

Example: AMOY_BRIDGE = 0xe5c7BeF3C839Bc1a6915B4211c3D74Ca77B5975a
Result:  0x000000000000000000000000e5c7BeF3C839Bc1a6915B4211c3D74Ca77B5975a
```

Call on `SepoliaBridge`:
```
setPeer(_eid, _peer):
  _eid:  40267
  _peer: 0x000000000000000000000000<AMOY_BRIDGE_WITHOUT_0x>
```
→ Approve MetaMask tx

### 6.3 SepoliaPool → SepoliaBridge

Select `SepoliaLendingPool` at `SEPOLIA_POOL`, call:
```
setBridge(_bridge): <SEPOLIA_BRIDGE>
```
→ Approve MetaMask tx

---

## 7. Fund the Pools

### 7.1 Mint sUSDC to Sepolia Pool (loan capital)

> Still on **Ethereum Sepolia**.

Select `MockUSDC` at `SEPOLIA_SUSDC`, call:
```
mint(_to, _amount):
  _to:     <SEPOLIA_POOL>
  _amount: 500000000000    ← 500,000 sUSDC (6 decimals: 500000 × 10^6)
```
→ Approve MetaMask tx

**Verify:** Call `getPoolLiquidity()` on `SEPOLIA_POOL` → should return `500000000000`

### 7.2 Verify mUSDC on Amoy

> Switch MetaMask to **Polygon Amoy**.

Your deployer wallet already has 1,000,000 mUSDC from Step 3.1.

**Verify:** Call `balanceOf(<your_wallet>)` on `AMOY_MUSDC` → should return `1000000000000`

---

## 8. Set Enforced Options

> This step is only needed on **Sepolia Bridge**.
> Amoy Bridge only receives — it never sends messages — so no enforced options needed there.

### On Sepolia Bridge only

> On **Ethereum Sepolia**, select `SepoliaBridge` at `SEPOLIA_BRIDGE`.

Call `setEnforcedOptions`:
```
_eid:     40267
_msgType: 1
_options: 0x00030100110100000000000000000000000000049510
```
→ Approve MetaMask tx

> **What is that hex?**
> = `OptionsBuilder.newOptions().addExecutorLzReceiveOption(300_000, 0)`
> encoded as Type 3 options bytes.
> 300,000 gas is the executor gas limit for `_lzReceive` on Amoy.

---

## 9. Update Frontend constants.js

After all contracts are deployed and wired, update `constants.js` with new addresses:

```javascript
const ADDRESSES = {
  amoy: {
    mockUSDC:    "<AMOY_MUSDC>",
    lendingPool: "<AMOY_POOL>",
    bridge:      "<AMOY_BRIDGE>",
  },
  sepolia: {
    mockUSDC:    "<SEPOLIA_SUSDC>",
    lendingPool: "<SEPOLIA_POOL>",
    bridge:      "<SEPOLIA_BRIDGE>",
  },
};
```

Also confirm the Sepolia RPC in `constants.js` is set to the reliable one:
```javascript
sepolia: {
  rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
  ...
}
```

---

## 10. E2E Test — Full Borrow/Repay Flow

Go step by step. Do not skip ahead.

---

### PHASE 1 — Deposit Collateral on Amoy

> Switch MetaMask to **Polygon Amoy**.

**Step 1: Approve mUSDC spend to Amoy Pool**

Select `MockUSDC` at `AMOY_MUSDC`, call:
```
approve(_spender, _value):
  _spender: <AMOY_POOL>
  _value:   2000000000    ← 2,000 mUSDC
```
→ Approve MetaMask tx

**Step 2: Deposit into Amoy Pool**

Select `AmoyLendingPool` at `AMOY_POOL`, call:
```
deposit(_amount): 2000000000    ← 2,000 mUSDC
```
→ Approve MetaMask tx

**Step 3: Verify deposit**

Call `getAvailableBalance(<your_wallet>)` on `AMOY_POOL`:
```
Expected: 2000000000
```
✅ Phase 1 complete

---

### PHASE 2 — Cross-Chain Borrow on Sepolia

> Switch MetaMask to **Ethereum Sepolia**.
> Borrow is ALWAYS initiated from Sepolia — NOT from Amoy.

**Step 1: Get the LayerZero fee quote**

Select `SepoliaBridge` at `SEPOLIA_BRIDGE`, call:
```
quote(_msgType, _user, _amount):
  _msgType: 1
  _user:    <your_wallet>
  _amount:  1000000000    ← 1,000 sUSDC to borrow
```
→ This is a `view` call, no tx needed.
→ Returns a number in wei, e.g. `123456789000000`
→ Add 20% buffer: multiply by 1.2
✅ Note this value as `FEE_ETH`

**Step 2: Call requestBorrow**

Still on `SepoliaBridge` at `SEPOLIA_BRIDGE`:
- Set the **VALUE** field in Remix to `FEE_ETH` (in wei, with 20% buffer)
```
requestBorrow(_amount): 1000000000    ← 1,000 sUSDC
```
→ Approve MetaMask tx (you pay ETH for LZ fee)

**Step 3: Track on LayerZero Scan**

Go to https://testnet.layerzeroscan.com
Search your tx hash from Step 2.
Wait for status: `DELIVERED` ✅ (usually 1-3 minutes)

**Step 4: Confirm collateral locked on Amoy**

> Switch MetaMask to **Polygon Amoy**.

Call `getLockedBalance(<your_wallet>)` on `AMOY_POOL`:
```
Expected: 2000000000   ← 2,000 mUSDC (2× borrow amount)
```

**Step 5: Release loan via adminReleaseLoan**

> Switch MetaMask to **Ethereum Sepolia**.

Select `SepoliaLendingPool` at `SEPOLIA_POOL`, call:
```
adminReleaseLoan(_user, _amount):
  _user:   <your_wallet>
  _amount: 1000000000    ← 1,000 sUSDC
```
→ Approve MetaMask tx

**Step 6: Verify sUSDC received**

Call `balanceOf(<your_wallet>)` on `MockUSDC` at `SEPOLIA_SUSDC`:
```
Expected: 1000000000   ← 1,000 sUSDC in wallet
```
✅ Phase 2 complete

---

### PHASE 3 — Repay Loan on Sepolia

> Still on **Ethereum Sepolia**.

**Step 1: Check your principal**

Call `loans(<your_wallet>)` on `SEPOLIA_POOL`:
```
Returns: principal (e.g. 1000000000)
```
Repay amount = principal + 10,000,000 (flat 10 sUSDC fee)
Example: `1000000000 + 10000000 = 1010000000`

**Step 2: Approve sUSDC to Sepolia Pool**

Select `MockUSDC` at `SEPOLIA_SUSDC`, call:
```
approve(_spender, _value):
  _spender: <SEPOLIA_POOL>    ← approve the POOL, not the bridge
  _value:   1010000000        ← principal + 10 sUSDC flat fee
```
→ Approve MetaMask tx

**Step 3: Get LayerZero fee quote for repay**

Select `SepoliaBridge` at `SEPOLIA_BRIDGE`, call:
```
quote(_msgType, _user, _amount):
  _msgType: 3
  _user:    <your_wallet>
  _amount:  1000000000    ← principal amount
```
→ Returns fee in wei. Add 20% buffer. Note as `FEE_ETH`.

**Step 4: Call repayAndUnlock**

Still on `SepoliaBridge` at `SEPOLIA_BRIDGE`:
- Set **VALUE** field in Remix to `FEE_ETH` (with 20% buffer)
```
repayAndUnlock()
```
→ Approve MetaMask tx (ETH fee + sUSDC pulled from wallet)

**Step 5: Verify debt cleared**

Call `loans(<your_wallet>)` on `SEPOLIA_POOL`:
```
Expected: principal = 0, active = false
```

**Step 6: Track on LayerZero Scan**

Search repay tx hash → wait for `DELIVERED` ✅

---

### PHASE 4 — Withdraw Collateral on Amoy

> Switch MetaMask to **Polygon Amoy**.

**Step 1: Verify collateral unlocked**

Call `getLockedBalance(<your_wallet>)` on `AMOY_POOL`:
```
Expected: 0   ← unlocked by LZ message
```

Call `getAvailableBalance(<your_wallet>)` on `AMOY_POOL`:
```
Expected: 2000000000   ← back to available
```

**Step 2: Withdraw mUSDC**

Select `AmoyLendingPool` at `AMOY_POOL`, call:
```
withdraw(_amount): 2000000000
```
→ Approve MetaMask tx

**Step 3: Verify wallet balance**

Call `balanceOf(<your_wallet>)` on `AMOY_MUSDC`:
```
Expected: original amount back in wallet
```

✅ **Full cycle complete!**
Deposited → Borrowed → Repaid → Unlocked → Withdrawn.

---

## 11. Verify on Explorers

After the full test, confirm on each explorer:

### Amoy (https://amoy.polygonscan.com)
| Contract | Check |
|---|---|
| `AMOY_MUSDC` | Token transfers visible |
| `AMOY_POOL` | `deposits` mapping shows your address, `locked` is 0 after repay |
| `AMOY_BRIDGE` | `lendingPool` and `peers` correctly set |

### Sepolia (https://sepolia.etherscan.io)
| Contract | Check |
|---|---|
| `SEPOLIA_SUSDC` | Token transfers visible |
| `SEPOLIA_POOL` | `loans` mapping shows principal=0 after repay |
| `SEPOLIA_BRIDGE` | `lendingPool`, `amoyEid`, `peers` correctly set |

### LayerZero Scan (https://testnet.layerzeroscan.com)
- Borrow message: `DELIVERED` ✅
- Repay message: `DELIVERED` ✅
- Source OApp = Sepolia Bridge address
- Destination OApp = Amoy Bridge address

---

## 12. Deployed Addresses Log

Fill this in as you deploy. Update `constants.js` immediately after.

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

## 13. Troubleshooting

### ❌ Remix compile error: "File not found @layerzerolabs/..."
- Wait 10 seconds and click Compile again
- Remix fetches npm packages from unpkg on first compile — it is slow
- If it persists: Settings → Clear Cache → refresh page

### ❌ MetaMask: "Transaction underpriced"
- Click Edit Gas in MetaMask and increase gas price slightly
- Amoy can be congested — wait 1-2 minutes and retry

### ❌ requestBorrow reverts: "NotEnoughNative"
- msg.value passed is less than the LZ fee
- Re-run `quote()` — fee changes each block
- Always add 20% buffer: `fee * 120 / 100`

### ❌ requestBorrow reverts: "Amoy EID not set"
- Call `setAmoyEid(40267)` on SepoliaBridge first

### ❌ LayerZero message BLOCKED on scan
- `_lzReceive` on Amoy reverted — channel is now blocked
- Common cause: `setBridge` not called on AmoyPool, so `onlyBridge` rejects lock()
- Fix: verify `AMOY_BRIDGE` is correctly set via `setBridge` on `AMOY_POOL`
- To unblock: call `EndpointV2.lzReceive()` manually on Amoy with higher gas

### ❌ LayerZero message WAITING FOR ULN CONFIG
- The source OApp address does not match what is deployed/wired
- Check: is `constants.js` pointing to the correct `SEPOLIA_BRIDGE` address?
- This error means the bridge contract calling `_lzSend` was never registered with LZ DVNs
- Solution: verify you are using the correctly deployed and wired bridge address

### ❌ repayAndUnlock reverts: "No active loan"
- `loans[user].active` is false — loan does not exist on Sepolia
- Either borrow message never delivered (check LZ scan) or already repaid

### ❌ repayAndUnlock reverts: "ERC20: insufficient allowance"
- You approved the BRIDGE instead of the POOL
- Approve `SEPOLIA_POOL` address for sUSDC, not the bridge address

### ❌ Collateral still locked after repay message DELIVERED
- Check `setBridge` on AmoyPool — is it set to `AMOY_BRIDGE`?
- Check Amoy Bridge events for `UnlockFailed` — means unlock() silently failed
- Verify `locked[user]` >= `amount * 2` before unlock is called

### ❌ OnlyPeer error on LayerZero Scan
- `setPeer` is wrong or missing on one side
- Re-check bytes32 padding — must be exactly 32 bytes, left-padded with zeros
- Format: `0x000000000000000000000000{40-char-address-no-0x}`
- Both bridges must have each other set as peer

---

*End of deployment guide.*
*All 6 contracts deployed, wired and funded = ChainLend fully operational.*
