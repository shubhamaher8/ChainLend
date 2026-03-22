// ─── ChainLend App Logic ──────────────────────────────────────────────────────

// ─── UI State ─────────────────────────────────────────────────────────────────
let isPolling = false;

// ─── On Load ──────────────────────────────────────────────────────────────────
window.addEventListener("load", () => {
  setupWalletListeners(
    (addr) => {
      userAddress = addr;
      if (addr) refreshAllBalances();
      else resetUI();
    },
    () => refreshAllBalances()
  );
});

// ─── Connect Wallet ───────────────────────────────────────────────────────────
async function handleConnect() {
  try {
    setStatus("Connecting wallet...", "info");
    const addr = await connectWallet();
    document.getElementById("wallet-address").textContent =
      addr.slice(0, 6) + "..." + addr.slice(-4);
    document.getElementById("connect-btn").textContent = "Connected";
    document.getElementById("connect-btn").disabled = true;
    setStatus("Wallet connected!", "success");
    await refreshAllBalances();
  } catch (err) {
    setStatus("Connection failed: " + err.message, "error");
  }
}

// ─── Refresh All Balances ─────────────────────────────────────────────────────
async function refreshAllBalances() {
  if (!userAddress) return;

  try {
    // ── Amoy balances ─────────────────────────────────────────────────
    const amoyRead = getAmoyReadContracts();
    const [amoyAvailable, amoyLocked, amoyInterest] = await Promise.all([
      amoyRead.lendingPool.getAvailableBalance(userAddress),
      amoyRead.lendingPool.getLockedBalance(userAddress),
      amoyRead.lendingPool.getAccruedInterest(userAddress),
    ]);

    document.getElementById("amoy-available").textContent =
      formatUSDC(amoyAvailable) + " mUSDC";
    document.getElementById("amoy-locked").textContent =
      formatUSDC(amoyLocked) + " mUSDC";
    document.getElementById("amoy-interest").textContent =
      formatUSDC(amoyInterest) + " mUSDC";

    // Max borrowable = available / 2 (50% LTV)
    const maxBorrow = amoyAvailable / 2n;
    document.getElementById("max-borrow").textContent =
      formatUSDC(maxBorrow) + " sUSDC";

    // ── Sepolia balances — separate try/catch so Amoy always shows ────
    try {
      const sepoliaReadProvider = new ethers.JsonRpcProvider(
        "https://ethereum-sepolia-rpc.publicnode.com"
      );
      const sepoliaLP = new ethers.Contract(
        ADDRESSES.sepolia.lendingPool,
        SEPOLIA_LENDING_POOL_ABI,
        sepoliaReadProvider
      );
      const sepoliaUSDC = new ethers.Contract(
        ADDRESSES.sepolia.mockUSDC,
        ERC20_ABI,
        sepoliaReadProvider
      );

      const [repayAmount, sepoliaBalance] = await Promise.all([
        sepoliaLP.getRepayAmount(userAddress),   // principal + 10 sUSDC flat fee
        sepoliaUSDC.balanceOf(userAddress),
      ]);

      // Active debt display — show repay amount (what user owes)
      document.getElementById("sepolia-debt").textContent =
        repayAmount > 0n
          ? formatUSDC(repayAmount) + " sUSDC"
          : "0.00 sUSDC";

      document.getElementById("sepolia-balance").textContent =
        formatUSDC(sepoliaBalance) + " sUSDC";

      // Update repay button debt display
      const repayEl = document.getElementById("repay-debt-amount");
      if (repayEl) {
        repayEl.textContent = repayAmount > 0n
          ? formatUSDC(repayAmount) + " sUSDC"
          : "No active loan";
      }

    } catch (sepoliaErr) {
      console.error("Sepolia balance fetch failed:", sepoliaErr.message);
      document.getElementById("sepolia-balance").textContent = "RPC error — refresh";
      document.getElementById("sepolia-debt").textContent    = "RPC error — refresh";
    }

  } catch (err) {
    console.error("Balance refresh error:", err);
  }
}

// ─── PHASE 1: DEPOSIT ─────────────────────────────────────────────────────────
async function handleDeposit() {
  const amount = document.getElementById("deposit-amount").value;
  if (!amount || Number(amount) <= 0) {
    setStatus("Enter a valid deposit amount.", "error");
    return;
  }

  try {
    setStatus("Switching to Amoy...", "info");
    await switchToAmoy();

    const amountBN = parseUSDC(amount);

    // Step 1: Approve LendingPool to spend mUSDC
    setStatus("Step 1/2 — Approving mUSDC spend...", "info");
    const approveTx = await contracts.amoy.mockUSDC.approve(
      ADDRESSES.amoy.lendingPool,
      amountBN
    );
    await approveTx.wait();
    setStatus("Approved! Step 2/2 — Depositing...", "info");

    // Step 2: Deposit
    const depositTx = await contracts.amoy.lendingPool.deposit(amountBN);
    await depositTx.wait();

    setStatus(`✅ Deposited ${amount} mUSDC on Amoy!`, "success");
    await refreshAllBalances();

  } catch (err) {
    setStatus("Deposit failed: " + _parseError(err), "error");
  }
}

// ─── PHASE 2: BORROW (cross-chain via LayerZero) ──────────────────────────────
async function handleBorrow() {
  const amount = document.getElementById("borrow-amount").value;
  if (!amount || Number(amount) <= 0) {
    setStatus("Enter a valid borrow amount.", "error");
    return;
  }

  try {
    setStatus("Switching to Sepolia...", "info");
    await switchToSepolia();

    const amountBN = parseUSDC(amount);

    // Get LayerZero fee quote + 20% buffer for gas fluctuations
    setStatus("Getting LayerZero fee quote...", "info");
    const lzFee = await contracts.sepolia.bridge.quote(
      MSG_BORROW_REQUEST,
      userAddress,
      amountBN
    );
    const feeWithBuffer = (lzFee * 120n) / 100n;

    setStatus(
      `LayerZero fee: ${ethers.formatEther(lzFee)} ETH. Sending borrow request...`,
      "info"
    );

    // Send borrow request → LayerZero message fires to Amoy
    const tx = await contracts.sepolia.bridge.requestBorrow(amountBN, {
      value: feeWithBuffer,
    });
    await tx.wait();

    setStatus(
      "📡 Cross-chain message sent via LayerZero! Waiting for Amoy collateral lock...",
      "info"
    );

    // Show LayerZero scan link
    document.getElementById("lz-scan-link").href = "https://testnet.layerzeroscan.com";
    document.getElementById("lz-scan-link").style.display = "inline";

    // Poll Amoy until collateral is locked (LZ delivered)
    // expectedLockedAmount = amountBN * 2 because 50% LTV locks 2x
    const locked = await pollUntilLocked(userAddress, amountBN * 2n);

    if (!locked) {
      setStatus(
        "⚠️ Timeout waiting for Amoy lock. Check LayerZero Scan for message status.",
        "error"
      );
      return;
    }

    // Collateral confirmed locked — release loan on Sepolia
    setStatus("✅ Collateral locked on Amoy! Releasing sUSDC on Sepolia...", "info");

    const releaseTx = await contracts.sepolia.lendingPool.adminReleaseLoan(
      userAddress,
      amountBN
    );
    await releaseTx.wait();

    setStatus(`🎉 Done! ${amount} sUSDC received in your wallet on Sepolia!`, "success");
    await refreshAllBalances();

  } catch (err) {
    setStatus("Borrow failed: " + _parseError(err), "error");
  }
}

// ─── PHASE 3: REPAY + UNLOCK (cross-chain via LayerZero) ─────────────────────
async function handleRepay() {
  try {
    setStatus("Switching to Sepolia...", "info");
    await switchToSepolia();

    // Step 1: Fetch exact repay amount from contract (principal + flat 10 sUSDC fee)
    // Use getRepayAmount — single source of truth, no manual calculation needed
    const repayAmount = await contracts.sepolia.lendingPool.getRepayAmount(userAddress);
    if (repayAmount === 0n) {
      setStatus("No active loan to repay.", "error");
      return;
    }

    setStatus(
      `Total to repay: ${formatUSDC(repayAmount)} sUSDC (principal + 10 sUSDC flat fee). Approving...`,
      "info"
    );

    // Step 2: Approve SepoliaLendingPool for exact repay amount
    // Approve the POOL not the bridge — pool pulls tokens inside repay()
    const approveTx = await contracts.sepolia.mockUSDC.approve(
      ADDRESSES.sepolia.lendingPool,
      repayAmount
    );
    await approveTx.wait();
    setStatus("Approved! Getting LayerZero fee...", "info");

    // Step 3: Get LZ fee quote for repay unlock message
    // quote needs principal — fetch from loan info
    const [principal] = await contracts.sepolia.lendingPool.loans(userAddress);
    const lzFee = await contracts.sepolia.bridge.quote(
      MSG_REPAY_UNLOCK,
      userAddress,
      principal
    );
    const feeWithBuffer = (lzFee * 120n) / 100n;

    // Step 4: Call repayAndUnlock — no amount needed, bridge reads from pool internally
    setStatus("Step 2/2 — Repaying loan + sending unlock message to Amoy...", "info");
    const repayTx = await contracts.sepolia.bridge.repayAndUnlock({
      value: feeWithBuffer,
    });
    await repayTx.wait();

    setStatus(
      "📡 Unlock message sent to Amoy via LayerZero! Waiting for collateral unlock...",
      "info"
    );

    // Show LayerZero scan link
    document.getElementById("lz-scan-link").href = "https://testnet.layerzeroscan.com";
    document.getElementById("lz-scan-link").style.display = "inline";

    // Step 5: Poll Amoy until collateral is unlocked
    const unlocked = await pollUntilUnlocked(userAddress);

    if (!unlocked) {
      setStatus(
        "⚠️ Timeout waiting for Amoy unlock. Check LayerZero Scan.",
        "error"
      );
      return;
    }

    setStatus(
      "🎉 Collateral unlocked on Amoy! Switch to Amoy to withdraw.",
      "success"
    );
    await refreshAllBalances();

  } catch (err) {
    setStatus("Repay failed: " + _parseError(err), "error");
  }
}

// ─── PHASE 4: WITHDRAW ────────────────────────────────────────────────────────
async function handleWithdraw() {
  const amount = document.getElementById("withdraw-amount").value;
  if (!amount || Number(amount) <= 0) {
    setStatus("Enter a valid withdraw amount.", "error");
    return;
  }

  try {
    setStatus("Switching to Amoy...", "info");
    await switchToAmoy();

    const amountBN = parseUSDC(amount);

    setStatus("Withdrawing mUSDC + earned interest from Amoy...", "info");
    const tx = await contracts.amoy.lendingPool.withdraw(amountBN);
    await tx.wait();

    setStatus(`✅ Withdrawn ${amount} mUSDC + interest from Amoy!`, "success");
    await refreshAllBalances();

  } catch (err) {
    setStatus("Withdraw failed: " + _parseError(err), "error");
  }
}

// ─── POLLING: Wait Until Locked ───────────────────────────────────────────────
/**
 * Polls AmoyLendingPool.locked(user) every 10 seconds.
 * Returns true when locked >= expectedLockedAmount.
 * Returns false after 5 minute timeout.
 *
 * 10s interval — avoids RPC 429 rate limiting on free tier RPCs.
 */
async function pollUntilLocked(user, expectedLockedAmount) {
  const amoyRead = getAmoyReadContracts();
  const startTime = Date.now();
  isPolling = true;

  setStatus("⏳ Polling Amoy for lock confirmation (checking every 10s)...", "info");

  while (isPolling) {
    // Timeout check
    if (Date.now() - startTime > POLL_TIMEOUT_MS) {
      isPolling = false;
      return false;
    }

    await sleep(POLL_INTERVAL_MS);

    try {
      const currentLocked = await amoyRead.lendingPool.getLockedBalance(user);
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      setStatus(
        `⏳ Waiting for LayerZero delivery... (${elapsed}s elapsed, locked: ${formatUSDC(currentLocked)} mUSDC)`,
        "info"
      );

      if (currentLocked >= expectedLockedAmount) {
        isPolling = false;
        return true;
      }
    } catch (err) {
      // RPC hiccup — log and continue, never crash the poll loop
      console.warn("Poll error (will retry):", err.message);
    }
  }

  return false;
}

// ─── POLLING: Wait Until Unlocked ────────────────────────────────────────────
/**
 * Polls AmoyLendingPool.locked(user) every 10 seconds.
 * Returns true when locked === 0.
 * Returns false after 5 minute timeout.
 */
async function pollUntilUnlocked(user) {
  const amoyRead = getAmoyReadContracts();
  const startTime = Date.now();
  isPolling = true;

  setStatus("⏳ Polling Amoy for unlock confirmation (checking every 10s)...", "info");

  while (isPolling) {
    if (Date.now() - startTime > POLL_TIMEOUT_MS) {
      isPolling = false;
      return false;
    }

    await sleep(POLL_INTERVAL_MS);

    try {
      const currentLocked = await amoyRead.lendingPool.getLockedBalance(user);
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      setStatus(
        `⏳ Waiting for unlock... (${elapsed}s elapsed, still locked: ${formatUSDC(currentLocked)} mUSDC)`,
        "info"
      );

      if (currentLocked === 0n) {
        isPolling = false;
        return true;
      }
    } catch (err) {
      console.warn("Poll error (will retry):", err.message);
    }
  }

  return false;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setStatus(message, type = "info") {
  const el = document.getElementById("status-message");
  if (!el) return;
  el.textContent = message;
  el.className = "status-box status-" + type;
  el.style.display = "block";
  console.log(`[${type.toUpperCase()}] ${message}`);
}

function resetUI() {
  document.getElementById("wallet-address").textContent = "Not connected";
  document.getElementById("connect-btn").textContent = "Connect Wallet";
  document.getElementById("connect-btn").disabled = false;
}

function _parseError(err) {
  if (err?.reason) return err.reason;
  if (err?.data?.message) return err.data.message;
  if (err?.message) {
    const msg = err.message;
    if (msg.includes("user rejected"))        return "Transaction rejected by user.";
    if (msg.includes("insufficient funds"))   return "Insufficient ETH/MATIC for gas.";
    if (msg.includes("NotEnoughNative"))      return "Insufficient ETH for LayerZero fee.";
    if (msg.includes("OnlyPeer"))             return "Bridge peer not set correctly.";
    if (msg.includes("No active loan"))       return "No active loan found.";
    if (msg.includes("Loan already active"))  return "You already have an active loan. Repay first.";
    if (msg.includes("Only bridge"))          return "Internal error: wrong caller.";
    return msg.slice(0, 120);
  }
  return "Unknown error.";
}

function stopPolling() {
  isPolling = false;
}
