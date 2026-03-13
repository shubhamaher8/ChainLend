# ChainLend — Simplified Architecture Document
## One-Way LayerZero Messaging Pattern

---

## 1. What Is ChainLend (Simple Version)

ChainLend lets a user do this:

```
"I have tokens on Polygon Amoy.
 I want to borrow tokens on Ethereum Sepolia.
 Without selling or bridging my original tokens."
```

The user **locks** their tokens on Amoy as collateral.
In exchange, they **receive** tokens on Sepolia as a loan.
When they **repay** on Sepolia, their Amoy collateral is **unlocked**.

The cross-chain communication (telling Amoy to lock/unlock)
is done via **LayerZero V2 real messages**.

---

## 2. The Three Layers

```
┌─────────────────────────────────────────────────┐
│                  USER LAYER                      │
│         MetaMask Wallet (0x003b73...)            │
│    Same wallet address on Amoy AND Sepolia       │
└─────────────────────┬───────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│               FRONTEND LAYER                     │
│          Vercel Hosted Web App                   │
│                                                  │
│  index.html   app.js   web3.js (ethers v6)       │
│                                                  │
│  Role: Coordinator — talks to both chains        │
│        Polls Amoy to detect LZ delivery          │
│        Calls adminRelease after confirmation     │
└──────────────┬──────────────────────┬────────────┘
               │                      │
               ▼                      ▼
┌──────────────────────┐  ┌──────────────────────────┐
│   POLYGON AMOY       │  │   ETHEREUM SEPOLIA        │
│  (Collateral Chain)  │  │   (Loan Chain)            │
│                      │  │                           │
│  MockUSDC (mUSDC)   │  │  MockUSDC (sUSDC)         │
│  LendingPool         │  │  LendingPool              │
│  ChainLendBridge     │  │  ChainLendBridge          │
│                      │  │                           │
│  EID: 40267          │  │  EID: 40161               │
└──────────────────────┘  └──────────────────────────┘
          ▲                            │
          │      LayerZero V2          │
          └────── REAL MESSAGES ───────┘
                  (one-way only)
                  Sepolia → Amoy
```

---

## 3. Contract Roles (What Each Contract Does)

```
POLYGON AMOY
─────────────────────────────────────────────────────
MockUSDC (mUSDC)
  → The token user deposits as collateral
  → Standard ERC-20, 6 decimals
  → Address: 0x255447fD05AE643662a351e8b33730297283C4be

LendingPool (Amoy)
  → Holds user deposits
  → Locks collateral when borrow is confirmed
  → Unlocks collateral when repay is confirmed
  → Tracks: balances[user], locked[user]
  → Address: 0x4851d5211dfe3fa12E1eAA3e97aFAA55889de9AA

ChainLendBridge (Amoy)
  → Receives LayerZero messages FROM Sepolia
  → Decodes message type (BORROW or REPAY)
  → Calls LendingPool.lock() or LendingPool.unlock()
  → Does NOT send any message back (no ABA)
  → Address: 0xaAFE5a3d4bD40092A637c60A6f331FF7e20a9d78


ETHEREUM SEPOLIA
─────────────────────────────────────────────────────
MockUSDC (sUSDC)
  → The token user receives as loan
  → Standard ERC-20, 6 decimals
  → Address: 0xef2B880E4653381A613Abd215aE5f13ce6d5Ef9d

LendingPool (Sepolia)
  → Holds loan liquidity (pre-funded with 500k sUSDC)
  → Tracks user loan amounts and interest
  → adminReleaseLoan() — releases sUSDC to user
  → repay() — collects sUSDC back from user
  → Address: 0x125A5348bE74073b03970dB888549258d6d5db99

ChainLendBridge (Sepolia)
  → Sends LayerZero messages TO Amoy
  → MSG_BORROW_REQUEST (type 1) — triggered by borrow
  → MSG_REPAY_UNLOCK (type 3)  — triggered by repay
  → Address: 0x3C972A74Fc0dAD0Fa32CeD08C8334B521E44aC83
```

---

## 4. Message Types (What Goes Over LayerZero)

```
Only TWO message types travel over LayerZero.
Both go in ONE direction: Sepolia → Amoy.

Message Type 1: MSG_BORROW_REQUEST
─────────────────────────────────
Payload:  abi.encode(uint8(1), userAddress, amount)
Meaning:  "User wants to borrow. Lock their collateral."
From:     Sepolia Bridge
To:       Amoy Bridge
Effect:   Amoy LendingPool.lock(user, amount)

Message Type 3: MSG_REPAY_UNLOCK
─────────────────────────────────
Payload:  abi.encode(uint8(3), userAddress, amount)
Meaning:  "User repaid. Unlock their collateral."
From:     Sepolia Bridge
To:       Amoy Bridge
Effect:   Amoy LendingPool.unlock(user, amount)
```

---

## 5. Full User Flow — Borrow

```
PHASE 1: DEPOSIT (on Amoy)
══════════════════════════════════════════════════

User
 │
 │  1. Approve mUSDC spend
 ▼
MockUSDC.approve(LendingPool, amount)
 │
 │  2. Deposit into pool
 ▼
LendingPool.deposit(amount)
 │
 │  mUSDC moves: User Wallet → LendingPool
 │  balances[user] += amount
 ▼
✅ Deposit complete. Funds sitting in Amoy LendingPool.


PHASE 2: BORROW (starts on Sepolia, confirms on Amoy)
══════════════════════════════════════════════════════

User (on Sepolia frontend)
 │
 │  3. Click "Borrow" — enters amount (max 50% of deposit)
 ▼
Frontend calls: SepoliaBridge.quote(amount)
 │             → gets LayerZero fee in ETH
 │
 │  4. Frontend sends borrow request
 ▼
SepoliaBridge.borrow(amount, { value: lzFee })
 │
 │  Encodes: abi.encode(1, userAddress, amount)
 │  Calls:   _lzSend(amoyEid, payload, options, fee)
 ▼
── LayerZero Network ──────────────────────────────→
                                                    │
                        [1-3 minutes delivery time] │
                                                    ▼
                                        AmoyBridge._lzReceive()
                                                    │
                                        Decodes msgType = 1
                                                    │
                                        LendingPool.lock(user, amount)
                                                    │
                                        locked[user] += amount
                                        balances[user] -= amount
                                                    │
                                                    ▼
                                        ✅ Collateral LOCKED on Amoy

Meanwhile on Frontend:
 │
 │  5. Frontend polls Amoy LendingPool every 3 seconds
 │     "Is locked[user] >= amount yet?"
 │
 │     Attempt 1: locked = 0 ... wait
 │     Attempt 2: locked = 0 ... wait
 │     Attempt N: locked = amount ← LayerZero delivered!
 ▼
Frontend detects lock confirmed
 │
 │  6. Frontend calls adminReleaseLoan (owner wallet)
 ▼
SepoliaLendingPool.adminReleaseLoan(user, amount)
 │
 │  sUSDC moves: LendingPool → User Wallet
 │  loans[user] = amount
 ▼
✅ User receives sUSDC on Sepolia


WHAT USER SEES ON SCREEN:
─────────────────────────
[Deposit mUSDC]  → MetaMask popup → ✅ Deposited
[Borrow sUSDC]   → MetaMask popup (LZ fee)
                 → "📡 Cross-chain message sent..."
                 → "⏳ Waiting for Amoy confirmation..."
                 → (1-3 mins real wait)
                 → "✅ Collateral locked on Amoy!"
                 → MetaMask popup (adminRelease)
                 → "🎉 sUSDC received in your wallet!"
```

---

## 6. Full User Flow — Repay

```
PHASE 3: REPAY (starts on Sepolia)
══════════════════════════════════════════════════

User (on Sepolia, has sUSDC to repay)
 │
 │  1. Approve sUSDC spend
 ▼
MockUSDC.approve(SepoliaLendingPool, repayAmount)
 │
 │  2. Click "Repay"
 ▼
SepoliaBridge.repay(amount, { value: lzFee })
 │
 │  sUSDC moves: User Wallet → LendingPool
 │  loans[user] = 0
 │
 │  Encodes: abi.encode(3, userAddress, amount)
 │  Calls:   _lzSend(amoyEid, payload, options, fee)
 ▼
── LayerZero Network ──────────────────────────────→
                                                    │
                        [1-3 minutes delivery time] │
                                                    ▼
                                        AmoyBridge._lzReceive()
                                                    │
                                        Decodes msgType = 3
                                                    │
                                        LendingPool.unlock(user, amount)
                                                    │
                                        locked[user] -= amount
                                        balances[user] += amount
                                                    ▼
                                        ✅ Collateral UNLOCKED on Amoy

Frontend polls Amoy until unlock detected
 ▼
✅ "Collateral unlocked! You can now withdraw on Amoy."


PHASE 4: WITHDRAW (on Amoy)
══════════════════════════════════════════════════

User (switches to Amoy)
 │
 │  3. Click "Withdraw"
 ▼
AmoyLendingPool.withdraw(amount)
 │
 │  mUSDC moves: LendingPool → User Wallet
 │  balances[user] -= amount
 ▼
✅ Original mUSDC back in wallet. Flow complete.
```

---

## 7. Frontend Polling Logic (How it Detects LZ Delivery)

```
PROBLEM:
Frontend sends LZ message from Sepolia.
LayerZero takes 1-3 minutes to deliver to Amoy.
Frontend needs to know WHEN Amoy received it.

SOLUTION: Poll Amoy Contract State

function waitUntilLocked(user, expectedAmount):
│
├── Start timer (max 5 minutes)
│
└── Loop every 3 seconds:
    │
    ├── Read AmoyLendingPool.locked(user)
    │
    ├── If locked >= expectedAmount:
    │       → LayerZero delivered ✅
    │       → Break loop
    │
    ├── If timer > 5 minutes:
    │       → Show error: "Check LayerZero Scan"
    │       → Break loop
    │
    └── Else: wait 3 seconds, try again


WHY THIS WORKS:
─────────────────────────────────────────────
AmoyBridge._lzReceive() is called by LayerZero
It calls LendingPool.lock(user, amount)
locked[user] value changes on-chain
Frontend reads this public variable
When it changes → we know LZ delivered
No webhook. No backend. Pure on-chain state.
```

---

## 8. What Is Real vs What Is Simplified

```
REAL (genuine cross-chain):
────────────────────────────────────────────────────
✅ LayerZero V2 messages sent from Sepolia → Amoy
✅ Real message hash visible on layerzeroscan.com
✅ Real _lzReceive execution on Amoy
✅ Real collateral locking on Amoy chain
✅ Real token movement on both chains
✅ Real MetaMask transactions on both chains
✅ Real LZ fees paid in ETH

SIMPLIFIED (vs original design):
────────────────────────────────────────────────────
❌ Removed: ABA return message (Amoy → Sepolia)
❌ Removed: Auto-release on Sepolia via LZ message
✅ Replaced with: Frontend polls + adminRelease

WHY THIS IS STILL VALID:
────────────────────────────────────────────────────
The CORE concept — using LayerZero to coordinate
cross-chain collateral — is fully demonstrated.

The ABA return leg is an optimization, not the concept.
Many production protocols use off-chain relayers
(like Chainlink Automation, Gelato) instead of ABA.

Our frontend acting as coordinator = same pattern.
```

---

## 9. Deployed Contract Addresses

```
POLYGON AMOY (EID: 40267)
──────────────────────────────────────────────────
MockUSDC:      0x255447fD05AE643662a351e8b33730297283C4be
LendingPool:   0x4851d5211dfe3fa12E1eAA3e97aFAA55889de9AA
Bridge:        0xaAFE5a3d4bD40092A637c60A6f331FF7e20a9d78

ETHEREUM SEPOLIA (EID: 40161)
──────────────────────────────────────────────────
MockUSDC:      0xef2B880E4653381A613Abd215aE5f13ce6d5Ef9d
LendingPool:   0x125A5348bE74073b03970dB888549258d6d5db99
Bridge:        0x3C972A74Fc0dAD0Fa32CeD08C8334B521E44aC83

SHARED
──────────────────────────────────────────────────
LayerZero Endpoint: 0x6EDCE65403992e310A62460808c4b910D972f10f
Deployer/Owner:     0x003b739410f14b248A2A24cd4FC4021F40Fc2B20
```

---

## 10. Protocol Parameters

```
LTV (Loan to Value):     50%
  → Deposit 1000 mUSDC → Borrow max 500 sUSDC

Deposit APY:             5% per year
  → Earned on Amoy collateral

Borrow APR:              8% per year
  → Accrues on Sepolia loan

Example:
  Deposit  1000 mUSDC on Amoy
  Borrow    500 sUSDC on Sepolia
  After 1 year:
    Amoy collateral earns:  50 mUSDC interest
    Sepolia debt grows to:  540 sUSDC owed
```

---

## 11. What Needs to Change in Contracts

```
CHANGE 1: Amoy Bridge _lzReceive
──────────────────────────────────────────────────
REMOVE this block (the ABA return send):

  // DELETE THIS ENTIRE SECTION
  bytes memory returnPayload = abi.encode(MSG_LOCK_CONFIRMED, user, amount);
  bytes memory options = OptionsBuilder.newOptions()
      .addExecutorLzReceiveOption(300_000, 0);
  _lzSend(srcEid, returnPayload, options, MessagingFee(msg.value, 0), payable(this));

KEEP this (the actual lock):
  lendingPool.lock(user, amount);   // ✅ KEEP


CHANGE 2: Sepolia LendingPool
──────────────────────────────────────────────────
ADD this new function:

  function adminReleaseLoan(
      address user,
      uint256 amount
  ) external onlyOwner {
      require(loans[user] == 0, "Loan already active");
      token.transfer(user, amount);
      loans[user] = amount;
      emit LoanReleased(user, amount);
  }


NOTHING ELSE CHANGES.
All wiring, peers, endpoints stay the same.
Only 2 small edits total.
```

---

## 12. Next Steps

```
Step 1: Edit Amoy Bridge
  → Remove _lzSend block from _lzReceive
  → Redeploy on Amoy
  → Set peer again (setPeer)

Step 2: Edit Sepolia LendingPool
  → Add adminReleaseLoan function
  → Redeploy on Sepolia
  → Set bridge again (setBridge)

Step 3: Update Frontend
  → Add polling logic (waitUntilLocked)
  → Add adminRelease call after lock detected
  → Add status messages for user

Step 4: End-to-End Test
  → Mint mUSDC on Amoy
  → Deposit → Borrow flow
  → Check layerzeroscan.com for proof
  → Repay → Withdraw flow

Step 5: Deploy Frontend to Vercel
  → Push to GitHub
  → Connect to Vercel
  → Done
```

---

*ChainLend — Cross-Chain DeFi Lending using LayerZero V2 OApp*
*Polygon Amoy (Collateral) ↔ Ethereum Sepolia (Loans)*
