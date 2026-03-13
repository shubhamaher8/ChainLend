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
    // Amoy balances — switch read contracts
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

    // Max borrowable = locked / 2 (50% LTV)
    // But we show what they CAN borrow based on available deposit
    const maxBorrow = amoyAvailable / 2n;
    document.getElementById("max-borrow").textContent =
      formatUSDC(maxBorrow) + " sUSDC";

    // Sepolia balances — use read-only provider
    const sepoliaReadProvider = new ethers.JsonRpcProvider(
      NETWORKS.sepolia.rpcUrls[0]
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

    const [debt, sepoliaBalance] = await Promise.all([
      sepoliaLP.getDebt(userAddress),
      sepoliaUSDC.balanceOf(userAddress),
    ]);

    document.getElementById("sepolia-debt").textContent =
      formatUSDC(debt) + " sUSDC";
    document.getElementById("sepolia-balance").textContent =
      formatUSDC(sepoliaBalance) + " sUSDC";

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

    // Step 1: Approve
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

    // Get LayerZero fee quote
    setStatus("Getting LayerZero fee quote...", "info");
    const lzFee = await contracts.sepolia.bridge.quote(
      MSG_BORROW_REQUEST,
      userAddress,
      amountBN
    );

    // Add 20% buffer to fee for gas fluctuations
    const feeWithBuffer = (lzFee * 120n) / 100n;

    setStatus(
      `LayerZero fee: ${ethers.formatEther(lzFee)} ETH. Sending borrow request...`,
      "info"
    );

    // Send borrow request → LayerZero message to Amoy
    const tx = await contracts.sepolia.bridge.requestBorrow(amountBN, {
      value: feeWithBuffer,
    });
    const receipt = await tx.wait();

    setStatus(
      "📡 Cross-chain message sent via LayerZero! Waiting for Amoy confirmation...",
      "info"
    );

    // Show LayerZero scan link
    const lzLink = `https://testnet.layerzeroscan.com`;
    document.getElementById("lz-scan-link").href = lzLink;
    document.getElementById("lz-scan-link").style.display = "inline";

    // Poll Amoy until collateral is locked (LZ delivered)
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
  const amount = document.getElementById("repay-amount").value;
  if (!amount || Number(amount) <= 0) {
    setStatus("Enter a valid repay amount.", "error");
    return;
  }

  try {
    setStatus("Switching to Sepolia...", "info");
    await switchToSepolia();

    const amountBN = parseUSDC(amount);

    // Get current debt to check what user actually owes
    const totalDebt = await contracts.sepolia.lendingPool.getDebt(userAddress);
    if (totalDebt === 0n) {
      setStatus("No active loan to repay.", "error");
      return;
    }

    // Approve sUSDC spend (full debt amount including interest)
    setStatus(`Step 1/3 — Approving ${formatUSDC(totalDebt)} sUSDC (includes interest)...`, "info");
    const approveTx = await contracts.sepolia.mockUSDC.approve(
      ADDRESSES.sepolia.lendingPool,
      totalDebt
    );
    await approveTx.wait();

    // Get LZ fee for unlock message
    const lzFee = await contracts.sepolia.bridge.quote(
      MSG_REPAY_UNLOCK,
      userAddress,
      amountBN
    );
    const feeWithBuffer = (lzFee * 120n) / 100n;

    // Repay + send LayerZero unlock message to Amoy
    setStatus("Step 2/3 — Repaying loan + sending unlock message via LayerZero...", "info");
    const repayTx = await contracts.sepolia.bridge.repayAndUnlock(amountBN, {
      value: feeWithBuffer,
    });
    await repayTx.wait();

    setStatus(
      "📡 Unlock message sent to Amoy via LayerZero! Waiting for confirmation...",
      "info"
    );

    // Poll Amoy until collateral is unlocked
    const unlocked = await pollUntilUnlocked(userAddress);

    if (!unlocked) {
      setStatus(
        "⚠️ Timeout waiting for Amoy unlock. Check LayerZero Scan.",
        "error"
      );
      return;
    }

    setStatus(
      "🎉 Step 3/3 — Collateral unlocked on Amoy! You can now withdraw.",
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
 * Polls Amoy LendingPool.locked(user) every 10 seconds.
 * Returns true when locked >= expectedAmount.
 * Returns false after 5 minute timeout.
 *
 * 10s interval chosen to avoid RPC 429 rate limiting on free tier.
 */
async function pollUntilLocked(user, expectedLockedAmount) {
  const amoyRead = getAmoyReadContracts();
  const startTime = Date.now();
  isPolling = true;

  setStatus("⏳ Polling Amoy for lock confirmation (checking every 10s)...", "info");

  // Get locked amount before polling starts (baseline)
  let baselineLocked = 0n;
  try {
    baselineLocked = await amoyRead.lendingPool.getLockedBalance(user);
  } catch (_) {}

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
      // RPC hiccup — log and continue polling
      console.warn("Poll error (will retry):", err.message);
    }
  }

  return false;
}

// ─── POLLING: Wait Until Unlocked ────────────────────────────────────────────
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
  // Surface clean error messages from contract reverts
  if (err?.reason) return err.reason;
  if (err?.data?.message) return err.data.message;
  if (err?.message) {
    // Trim long ethers error messages
    const msg = err.message;
    if (msg.includes("user rejected")) return "Transaction rejected by user.";
    if (msg.includes("insufficient funds")) return "Insufficient ETH/MATIC for gas.";
    if (msg.includes("NotEnoughNative")) return "Insufficient ETH for LayerZero fee.";
    if (msg.includes("OnlyPeer")) return "Bridge peer not set correctly.";
    return msg.slice(0, 120);
  }
  return "Unknown error.";
}

function stopPolling() {
  isPolling = false;
}
