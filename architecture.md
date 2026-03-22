# ChainLend — Architecture Document
## One-Way LayerZero Messaging Pattern

---

## 1. What Is ChainLend

ChainLend lets a user do this:

```
"I have tokens on Polygon Amoy.
 I want to borrow tokens on Ethereum Sepolia.
 Without selling or bridging my original tokens."
```

The user **locks** their tokens on Amoy as collateral.
In exchange, they **receive** tokens on Sepolia as a loan.
When they **repay** on Sepolia, their Amoy collateral is **unlocked**.

Cross-chain communication (telling Amoy to lock/unlock)
is done via **LayerZero V2 real messages**. Tokens never cross chains — only messages do.

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
│        Polls Amoy every 10s to detect LZ delivery│
│        Calls adminReleaseLoan after confirmation │
└──────────────┬──────────────────────┬────────────┘
               │                      │
               ▼                      ▼
┌──────────────────────┐  ┌──────────────────────────┐
│   POLYGON AMOY       │  │   ETHEREUM SEPOLIA        │
│  (Collateral Chain)  │  │   (Loan Chain)            │
│                      │  │                           │
│  MockUSDC (mUSDC)    │  │  MockUSDC (sUSDC)         │
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

## 3. Contract Roles

```
POLYGON AMOY
─────────────────────────────────────────────────────
MockUSDC (mUSDC)
  → Token user deposits as collateral
  → Standard ERC-20, 6 decimals

LendingPool (Amoy)
  → Holds user deposits
  → Locks collateral when borrow request arrives via LZ
  → Unlocks collateral when repay message arrives via LZ
  → Tracks: deposits[user].amount, locked[user]
  → onlyBridge modifier on lock() and unlock()

ChainLendBridge (Amoy)
  → Receives LayerZero messages FROM Sepolia
  → Decodes message type (BORROW or REPAY)
  → Calls LendingPool.lock() or LendingPool.unlock()
  → Uses try/catch — _lzReceive must NEVER revert
  → Does NOT send any message back (one-way only)


ETHEREUM SEPOLIA
─────────────────────────────────────────────────────
MockUSDC (sUSDC)
  → Token user receives as loan
  → Standard ERC-20, 6 decimals
  → Pool pre-funded with 500,000 sUSDC

LendingPool (Sepolia)
  → Holds loan liquidity
  → Tracks user loan principal
  → adminReleaseLoan(user, amount) — onlyOwner, releases sUSDC to user
  → repay(user) — called by bridge, collects principal + 10 sUSDC flat fee

ChainLendBridge (Sepolia)
  → Sends LayerZero messages TO Amoy
  → requestBorrow(amount) — triggers MSG_BORROW_REQUEST
  → repayAndUnlock()      — triggers MSG_REPAY_UNLOCK
  → quote(msgType, user, amount) — fee estimation for frontend
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
Effect:   AmoyLendingPool.lock(user, amount * 2)
          (2x because 50% LTV — borrow 500, lock 1000)

Message Type 3: MSG_REPAY_UNLOCK
─────────────────────────────────
Payload:  abi.encode(uint8(3), userAddress, amount)
Meaning:  "User repaid. Unlock their collateral."
From:     Sepolia Bridge
To:       Amoy Bridge
Effect:   AmoyLendingPool.unlock(user, amount * 2)
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
 │  deposits[user].amount += amount
 ▼
✅ Deposit complete. Funds sitting in Amoy LendingPool.


PHASE 2: BORROW (starts on Sepolia, confirms on Amoy)
══════════════════════════════════════════════════════

User (switches to Sepolia)
 │
 │  3. Click "Borrow" — enters amount (max 50% of deposit)
 ▼
Frontend calls: SepoliaBridge.quote(MSG_BORROW_REQUEST, user, amount)
              → gets LayerZero fee in ETH
 │
 │  4. Frontend sends borrow request WITH lz fee as msg.value
 ▼
SepoliaBridge.requestBorrow(amount, { value: lzFee })
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
                                        try LendingPool.lock(user, amount * 2)
                                                    │
                                        locked[user] += amount * 2
                                        deposits[user].amount -= amount * 2
                                                    │
                                                    ▼
                                        ✅ Collateral LOCKED on Amoy

Meanwhile on Frontend:
 │
 │  5. Frontend polls Amoy LendingPool.locked(user) every 10 seconds
 │     (10s interval avoids RPC 429 rate limiting on free tier)
 │     Max wait: 5 minutes
 │
 │     Attempt 1: locked = 0 ... wait 10s
 │     Attempt 2: locked = 0 ... wait 10s
 │     Attempt N: locked = amount*2 ← LayerZero delivered!
 ▼
Frontend detects lock confirmed
 │
 │  6. Owner wallet calls adminReleaseLoan (onlyOwner)
 ▼
SepoliaLendingPool.adminReleaseLoan(user, amount)
 │
 │  sUSDC moves: LendingPool → User Wallet
 │  loans[user].principal = amount
 │  loans[user].active = true
 ▼
✅ User receives sUSDC on Sepolia


WHAT USER SEES ON SCREEN:
─────────────────────────
[Approve mUSDC]  → MetaMask popup 1 → ✅ Approved
[Deposit mUSDC]  → MetaMask popup 2 → ✅ Deposited
[Borrow sUSDC]   → MetaMask popup 3 (LZ fee in ETH)
                 → "📡 Cross-chain message sent..."
                 → "⏳ Waiting for Amoy confirmation..."
                 → (1-3 mins real wait)
                 → "✅ Collateral locked on Amoy!"
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
 │     repayAmount = principal + 10 sUSDC (flat fee)
 ▼
MockUSDC.approve(SepoliaLendingPool, repayAmount)
 │
 │  2. Click "Repay"
 ▼
SepoliaBridge.repayAndUnlock({ value: lzFee })
 │
 │  Bridge reads principal from LendingPool
 │  Calls LendingPool.repay(user)
 │     → pulls principal + 10 sUSDC flat fee from user
 │     → clears loans[user]
 │
 │  Encodes: abi.encode(3, userAddress, principal)
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
                                        try LendingPool.unlock(user, amount * 2)
                                                    │
                                        locked[user] -= amount * 2
                                        deposits[user].amount += amount * 2
                                                    ▼
                                        ✅ Collateral UNLOCKED on Amoy

Frontend polls Amoy until locked[user] == 0
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
 │  deposits[user].amount -= amount
 ▼
✅ Original mUSDC back in wallet. Flow complete.
```

---

## 7. Frontend Polling Logic

```
PROBLEM:
Frontend sends LZ message from Sepolia.
LayerZero takes 1-3 minutes to deliver to Amoy.
Frontend needs to know WHEN Amoy received it.

SOLUTION: Poll Amoy Contract State

function pollUntilLocked(user, expectedAmount):
│
├── Start timer (max 5 minutes)
│
└── Loop every 10 seconds:
    │
    ├── Read AmoyLendingPool.locked(user)
    │
    ├── If locked >= expectedAmount:
    │       → LayerZero delivered ✅
    │       → Break loop, call adminReleaseLoan
    │
    ├── If timer > 5 minutes:
    │       → Show error: "Check LayerZero Scan"
    │       → Break loop
    │
    └── Else: wait 10 seconds, try again

WHY 10 SECONDS NOT LESS:
─────────────────────────────────────────────
Free tier RPC providers (publicnode, polygon rpc)
rate limit aggressively at ~10 req/minute per IP.
3 second polling = instant 429 errors during demo.
10 second polling = stable, never rate limited.

WHY THIS WORKS:
─────────────────────────────────────────────
AmoyBridge._lzReceive() is called by LayerZero executor.
It calls LendingPool.lock(user, amount).
locked[user] value changes on-chain.
Frontend reads this public mapping.
When it changes → LZ delivered.
No webhook. No backend. Pure on-chain state polling.
```

---

## 8. What Is Real vs What Is Simplified

```
REAL (genuine cross-chain):
────────────────────────────────────────────────────
✅ LayerZero V2 OApp messages sent Sepolia → Amoy
✅ Real message hash visible on testnet.layerzeroscan.com
✅ Real _lzReceive execution on Amoy by LZ executor
✅ Real collateral locking/unlocking on Amoy chain
✅ Real token movement on both chains
✅ Real MetaMask transactions on both chains
✅ Real LZ fees paid in ETH (Sepolia side)

SIMPLIFIED (vs theoretical full design):
────────────────────────────────────────────────────
❌ Removed: ABA return message (Amoy → Sepolia)
❌ Removed: Auto-release on Sepolia via LZ message
✅ Replaced with: Frontend polling + adminReleaseLoan (onlyOwner)
✅ Replaced: Time-based 8% APR with flat 10 sUSDC repayment fee

WHY THIS IS STILL VALID:
────────────────────────────────────────────────────
The CORE concept — using LayerZero to coordinate
cross-chain collateral — is fully demonstrated.

The ABA return leg is an optimization, not the concept.
Many production protocols use off-chain coordination
(Chainlink Automation, Gelato) instead of ABA messages.
Our frontend acting as coordinator = same pattern.

Flat fee replaces APR for demo clarity.
In production: time-based variable rate replaces flat fee.
```

---

## 9. Protocol Parameters

```
LTV (Loan to Value):     50%
  → Deposit 1000 mUSDC → Borrow max 500 sUSDC
  → 2x collateral always locked vs loan amount

Deposit APY:             5% per year
  → Earned on Amoy collateral while deposited

Borrow Fee:              Flat 10 sUSDC per loan
  → Fixed fee, no time-based calculation
  → Borrow 500 sUSDC → repay 510 sUSDC

LayerZero Gas:           300,000 units
  → Executor gas limit for _lzReceive on destination

Polling Interval:        10 seconds
Polling Timeout:         5 minutes

Example:
  Deposit  1000 mUSDC on Amoy → locked as collateral
  Borrow    500 sUSDC on Sepolia
  Repay     510 sUSDC on Sepolia (500 principal + 10 flat fee)
  Unlock   1000 mUSDC on Amoy → available to withdraw
```

---

## 10. Security Design

```
onlyBridge modifier
  → Only ChainLendBridge can call lock() and unlock()
  → Prevents anyone from locking/unlocking directly

try/catch in _lzReceive
  → If lock() or unlock() fails, _lzReceive does NOT revert
  → A revert in _lzReceive permanently blocks the LZ channel
  → Failure is logged as an event, channel stays open

adminReleaseLoan is onlyOwner
  → Intentional — prevents unauthorized loan releases
  → Owner calls this only after polling confirms lock
  → In production: replaced with on-chain LZ confirmation

One loan per user
  → require(!loans[user].active) on borrow
  → Prevents overlapping cross-chain state
  → Simplifies collateral tracking significantly

msg.value forwarding
  → bridge.repayAndUnlock{value: msg.value}()
  → ETH explicitly forwarded or bridge gets 0 → NotEnoughNative error

Emergency unlock (future)
  → 30 minute timeout if LZ message never arrives
  → Protects user from permanently locked collateral
```

---

## 11. Deployed Contract Addresses

> Addresses will be updated after each redeployment.
> Always use addresses from constants.js as the source of truth.

```
POLYGON AMOY (Chain ID: 80002 | EID: 40267)
──────────────────────────────────────────────────
MockUSDC:      TBD
LendingPool:   TBD
Bridge:        TBD

ETHEREUM SEPOLIA (Chain ID: 11155111 | EID: 40161)
──────────────────────────────────────────────────
MockUSDC:      TBD
LendingPool:   TBD
Bridge:        TBD

SHARED
──────────────────────────────────────────────────
LayerZero Endpoint: 0x6EDCE65403992e310A62460808c4b910D972f10f
Deployer/Owner:     0x003b739410f14b248A2A24cd4FC4021F40Fc2B20
Amoy  EID:          40267
Sepolia EID:        40161
```

---

*ChainLend — Cross-Chain DeFi Lending using LayerZero V2 OApp*
*Polygon Amoy (Collateral) → Ethereum Sepolia (Loans)*
