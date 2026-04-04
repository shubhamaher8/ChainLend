// ─── ChainLend App Logic ──────────────────────────────────────────────────────

// ─── UI State ─────────────────────────────────────────────────────────────────
let isPolling = false;

// ─── On Load ──────────────────────────────────────────────────────────────────
window.addEventListener("load", () => {
  setupWalletListeners(
    (addr) => {
      userAddress = addr;
      if (addr) { refreshAllBalances(); fetchLoanHistory(); }
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
    fetchLoanHistory();
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
    const amoyReadProvider = new ethers.JsonRpcProvider(NETWORKS.amoy.rpcUrls[0]);
    const amoyUSDC = new ethers.Contract(ADDRESSES.amoy.mockUSDC, ERC20_ABI, amoyReadProvider);

    const [amoyAvailable, amoyLocked, amoyInterest, amoyWallet] = await Promise.all([
      amoyRead.lendingPool.getAvailableBalance(userAddress),
      amoyRead.lendingPool.getLockedBalance(userAddress),
      amoyRead.lendingPool.getAccruedInterest(userAddress),
      amoyUSDC.balanceOf(userAddress),
    ]);

    document.getElementById("amoy-wallet-balance").textContent =
      formatUSDC(amoyWallet) + " mUSDC";
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
      // Use NETWORKS.sepolia.rpcUrls[0] — no hardcoded URL
      // Change RPC in constants.js and it updates everywhere automatically
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

      const [repayAmount, sepoliaBalance] = await Promise.all([
        sepoliaLP.getRepayAmount(userAddress),
        sepoliaUSDC.balanceOf(userAddress),
      ]);

      document.getElementById("sepolia-debt").textContent =
        repayAmount > 0n
          ? formatUSDC(repayAmount) + " sUSDC"
          : "0.00 sUSDC";

      document.getElementById("sepolia-balance").textContent =
        formatUSDC(sepoliaBalance) + " sUSDC";

      // Update repay section debt display
      const repayEl = document.getElementById("repay-debt-amount");
      if (repayEl) {
        repayEl.textContent = repayAmount > 0n
          ? formatUSDC(repayAmount) + " sUSDC"
          : "No active loan";
      }

      // --- Borrow Gating Logic ---
      const borrowInput = document.getElementById("borrow-amount");
      const borrowBtn = document.getElementById("borrow-btn");
      
      if (repayAmount > 0n) {
        if (borrowInput) borrowInput.disabled = true;
        if (borrowBtn) {
          borrowBtn.disabled = true;
          borrowBtn.textContent = "REPAY ACTIVE LOAN FIRST";
          borrowBtn.style.opacity = "0.5";
          borrowBtn.style.cursor = "not-allowed";
        }
        document.getElementById("max-borrow").textContent = "0.00 sUSDC (loan active)";
      } else {
        if (borrowInput) borrowInput.disabled = false;
        if (borrowBtn) {
          borrowBtn.disabled = false;
          borrowBtn.textContent = "Borrow";
          borrowBtn.style.opacity = "1";
          borrowBtn.style.cursor = "pointer";
        }
        document.getElementById("max-borrow").textContent = formatUSDC(amoyAvailable / 2n) + " sUSDC";
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
    fetchLoanHistory();

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

    // Get LayerZero fee quote + 20% buffer
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

    // Send borrow request → LZ message fires to Amoy
    const tx = await contracts.sepolia.bridge.requestBorrow(amountBN, {
      value: feeWithBuffer,
    });
    await tx.wait();

    setStatus(
      "📡 Cross-chain message sent via LayerZero! Waiting for Amoy collateral lock...",
      "info"
    );



    // Poll Amoy until collateral locked — expectedLocked = amount * 2 (50% LTV)
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
    fetchLoanHistory();

  } catch (err) {
    setStatus("Borrow failed: " + _parseError(err), "error");
  }
}

// ─── PHASE 3: REPAY + UNLOCK (cross-chain via LayerZero) ─────────────────────
async function handleRepay() {
  try {
    setStatus("Switching to Sepolia...", "info");
    await switchToSepolia();

    // Fetch exact repay amount — principal + flat 10 sUSDC fee
    const repayAmount = await contracts.sepolia.lendingPool.getRepayAmount(userAddress);
    if (repayAmount === 0n) {
      setStatus("No active loan to repay.", "error");
      return;
    }

    setStatus(
      `Total to repay: ${formatUSDC(repayAmount)} sUSDC (principal + 10 sUSDC flat fee). Approving...`,
      "info"
    );

    // Step 1: Approve SepoliaLendingPool for exact repay amount
    // Approve POOL not bridge — pool pulls tokens inside repay()
    const approveTx = await contracts.sepolia.mockUSDC.approve(
      ADDRESSES.sepolia.lendingPool,
      repayAmount
    );
    await approveTx.wait();
    setStatus("Approved! Getting LayerZero fee...", "info");

    // Step 2: Get LZ fee — need principal for quote
    const [principal] = await contracts.sepolia.lendingPool.loans(userAddress);
    const lzFee = await contracts.sepolia.bridge.quote(
      MSG_REPAY_UNLOCK,
      userAddress,
      principal
    );
    const feeWithBuffer = (lzFee * 120n) / 100n;

    // Step 3: repayAndUnlock — no amount param, bridge reads from pool internally
    setStatus("Step 2/2 — Repaying loan + sending unlock message to Amoy...", "info");
    const repayTx = await contracts.sepolia.bridge.repayAndUnlock({
      value: feeWithBuffer,
    });
    await repayTx.wait();

    setStatus(
      "📡 Unlock message sent to Amoy via LayerZero! Waiting for collateral unlock...",
      "info"
    );



    // Poll Amoy until collateral unlocked
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
    fetchLoanHistory();

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
    fetchLoanHistory();

  } catch (err) {
    setStatus("Withdraw failed: " + _parseError(err), "error");
  }
}

// ─── POLLING: Wait Until Locked ───────────────────────────────────────────────
async function pollUntilLocked(user, expectedLockedAmount) {
  const amoyRead = getAmoyReadContracts();
  const startTime = Date.now();
  isPolling = true;

  setStatus("⏳ Polling Amoy for lock confirmation (checking every 10s)...", "info");

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
    if (msg.includes("user rejected"))       return "Transaction rejected by user.";
    if (msg.includes("insufficient funds"))  return "Insufficient ETH/MATIC for gas.";
    if (msg.includes("NotEnoughNative"))     return "Insufficient ETH for LayerZero fee.";
    if (msg.includes("OnlyPeer"))            return "Bridge peer not set correctly.";
    if (msg.includes("No active loan"))      return "No active loan found.";
    if (msg.includes("Loan already active")) return "You already have an active loan. Repay first.";
    if (msg.includes("Only bridge"))         return "Internal error: wrong caller.";
    return msg.slice(0, 120);
  }
  return "Unknown error.";
}

function stopPolling() {
  isPolling = false;
}

// ─── LOAN HISTORY ─────────────────────────────────────────────────────────────

// State for loan history
let historyEvents     = []; // all fetched events (unfiltered)
let filteredEvents    = []; // after filter applied
let historyPage       = 1;
let historyFetching   = false;
const blockTsCache    = {};  // { "amoy-12345": timestamp }

// ─── Fetch Loan History from Sepolia ──────────────────────────────────────────
async function fetchLoanHistory() {
  if (!userAddress) return;
  if (historyFetching) return;
  historyFetching = true;

  _showHistoryLoading(true);

  try {
    // Read-only Sepolia provider
    const sepoliaProvider = new ethers.JsonRpcProvider(NETWORKS.sepolia.rpcUrls[0]);

    // Contract instances for event querying
    const sepoliaLP = new ethers.Contract(
      ADDRESSES.sepolia.lendingPool, SEPOLIA_LENDING_POOL_ABI, sepoliaProvider
    );
    const sepoliaBridge = new ethers.Contract(
      ADDRESSES.sepolia.bridge, SEPOLIA_BRIDGE_ABI, sepoliaProvider
    );

    // Get current block number
    const sepoliaBlock = await sepoliaProvider.getBlockNumber();
    const sepoliaFrom  = Math.max(0, sepoliaBlock - HISTORY_BLOCK_RANGE);

    // Only Borrow Requested + Loan Repaid
    const eventDefs = [
      { contract: sepoliaLP,     event: "LoanRepaid",      chain: "sepolia", type: "repay",  label: "Loan Repaid",      provider: sepoliaProvider, from: sepoliaFrom, to: sepoliaBlock },
      { contract: sepoliaBridge, event: "BorrowRequested", chain: "sepolia", type: "borrow", label: "Borrow Requested", provider: sepoliaProvider, from: sepoliaFrom, to: sepoliaBlock },
    ];

    // Fetch all events in parallel (chunked internally)
    const allResults = await Promise.all(
      eventDefs.map(def => _fetchEventsChunked(def))
    );

    // Flatten
    historyEvents = allResults.flat();

    // Sort descending by timestamp (most recent first)
    historyEvents.sort((a, b) => b.timestamp - a.timestamp);

    // Apply filters and render
    historyPage = 1;
    applyHistoryFilters();

  } catch (err) {
    console.error("Loan history fetch error:", err);
    _showHistoryEmpty("Failed to fetch history — check console");
  } finally {
    historyFetching = false;
    _showHistoryLoading(false);
  }
}

// ─── Fetch Events in Chunks (avoids RPC block range limits) ───────────────────
async function _fetchEventsChunked(def) {
  const { contract, event, chain, type, label, provider, from, to } = def;
  const results = [];
  const filter = contract.filters[event](userAddress);

  for (let start = from; start <= to; start += HISTORY_CHUNK_SIZE) {
    const end = Math.min(start + HISTORY_CHUNK_SIZE - 1, to);
    try {
      const logs = await contract.queryFilter(filter, start, end);
      for (const log of logs) {
        const parsed = _parseEventLog(log, event, chain, type, label, provider);
        if (parsed) results.push(parsed);
      }
    } catch (err) {
      // Some chunks may fail on public RPCs — skip, don't crash
      console.warn(`Chunk ${start}-${end} failed for ${event} on ${chain}:`, err.message);
    }
  }

  // Resolve timestamps in batch
  await _resolveTimestamps(results, provider, chain);

  return results;
}

// ─── Parse a Single Event Log ─────────────────────────────────────────────────
function _parseEventLog(log, eventName, chain, type, label, provider) {
  try {
    const args = log.args;
    let amount = 0n;
    let extra  = {};

    switch (eventName) {
      case "Deposited":
        amount = args.amount;
        break;
      case "Withdrawn":
        amount = args.amount;
        extra.interest = args.interest;
        break;
      case "Locked":
      case "Unlocked":
        amount = args.amount;
        break;
      case "LoanReleased":
        amount = args.amount;
        break;
      case "LoanRepaid":
        amount = args.principal;
        extra.fee = args.fee;
        break;
      case "BorrowRequested":
        amount = args.amount;
        extra.guid = args.guid;
        break;
      case "RepayUnlockSent":
        amount = args.principal;
        extra.guid = args.guid;
        break;
      case "BorrowRequestReceived":
      case "RepayUnlockReceived":
      case "LockFailed":
      case "UnlockFailed":
        amount = args.amount;
        break;
      default:
        amount = 0n;
    }

    return {
      chain,
      type,
      label,
      amount,
      extra,
      blockNumber: log.blockNumber,
      txHash:      log.transactionHash,
      timestamp:   0,  // resolved later
    };
  } catch (err) {
    console.warn("Event parse error:", err.message);
    return null;
  }
}

// ─── Batch-Resolve Block Timestamps ───────────────────────────────────────────
async function _resolveTimestamps(events, provider, chain) {
  // Collect unique block numbers
  const blocks = [...new Set(events.map(e => e.blockNumber))];

  // Fetch in small batches to avoid rate-limiting
  const BATCH = 5;
  for (let i = 0; i < blocks.length; i += BATCH) {
    const batch = blocks.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async bn => {
        const key = `${chain}-${bn}`;
        if (blockTsCache[key]) return { bn, ts: blockTsCache[key] };
        try {
          const block = await provider.getBlock(bn);
          const ts = block ? block.timestamp : 0;
          blockTsCache[key] = ts;
          return { bn, ts };
        } catch {
          return { bn, ts: 0 };
        }
      })
    );
    for (const { bn, ts } of results) {
      events.filter(e => e.blockNumber === bn).forEach(e => e.timestamp = ts);
    }
  }
}

// ─── Apply Filters ────────────────────────────────────────────────────────────
function applyHistoryFilters() {
  const eventFilter = document.getElementById("history-event-filter").value;

  filteredEvents = historyEvents.filter(e => {
    if (eventFilter !== "all" && e.type !== eventFilter) return false;
    return true;
  });

  historyPage = 1;
  _renderHistoryTable();
}

// ─── Render Table ─────────────────────────────────────────────────────────────
function _renderHistoryTable() {
  const tbody     = document.getElementById("history-tbody");
  const tableWrap = document.getElementById("history-table-wrap");
  const emptyEl   = document.getElementById("history-empty");
  const pagEl     = document.getElementById("history-pagination");
  const countEl   = document.getElementById("history-count");

  const total     = filteredEvents.length;
  const totalPages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));

  countEl.textContent = `${total} event${total !== 1 ? "s" : ""}`;

  if (total === 0) {
    tableWrap.style.display = "none";
    pagEl.style.display     = "none";
    emptyEl.style.display   = "block";
    emptyEl.querySelector("p").textContent = historyEvents.length > 0
      ? "No events match the current filter"
      : "No loan history found for this wallet";
    emptyEl.querySelector(".empty-sub").textContent = historyEvents.length > 0
      ? "Try changing the event filter"
      : "Borrow or repay a loan to see events here";
    return;
  }

  emptyEl.style.display   = "none";
  tableWrap.style.display = "block";
  pagEl.style.display     = "flex";

  // Clamp page
  if (historyPage > totalPages) historyPage = totalPages;

  const start = (historyPage - 1) * HISTORY_PAGE_SIZE;
  const page  = filteredEvents.slice(start, start + HISTORY_PAGE_SIZE);

  tbody.innerHTML = page.map(e => {
    const timeStr    = _formatTimeAgo(e.timestamp);
    const exactTime  = e.timestamp ? new Date(e.timestamp * 1000).toLocaleString() : "—";
    const amountStr  = formatUSDC(e.amount);
    const explorer   = "https://testnet.layerzeroscan.com";
    const txShort    = e.txHash ? e.txHash.slice(0, 8) + "…" + e.txHash.slice(-4) : "—";
    const eventClass = `event-${e.type}`;

    // Extra info for certain events
    let extraInfo = "";
    if (e.extra?.fee) {
      extraInfo = ` (+${formatUSDC(e.extra.fee)} fee)`;
    }

    return `<tr>
      <td class="time-cell">
        <span class="time-relative">${timeStr}</span>
        <span class="time-exact">${exactTime}</span>
      </td>
      <td>
        <span class="event-badge ${eventClass}">
          <span class="event-dot"></span>
          ${e.label}
        </span>
      </td>
      <td>${amountStr} sUSDC${extraInfo}</td>
      <td>
        <a class="tx-link" href="${explorer}/tx/${e.txHash}" target="_blank" rel="noopener">
          ${txShort} <span class="tx-icon">↗</span>
        </a>
      </td>
    </tr>`;
  }).join("");

  // Update pagination
  document.getElementById("history-page-info").textContent = `Page ${historyPage} / ${totalPages}`;
  document.getElementById("history-prev").disabled = historyPage <= 1;
  document.getElementById("history-next").disabled = historyPage >= totalPages;
}

// ─── Pagination Controls ──────────────────────────────────────────────────────
function historyPrevPage() {
  if (historyPage > 1) {
    historyPage--;
    _renderHistoryTable();
  }
}

function historyNextPage() {
  const totalPages = Math.ceil(filteredEvents.length / HISTORY_PAGE_SIZE);
  if (historyPage < totalPages) {
    historyPage++;
    _renderHistoryTable();
  }
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────
function _showHistoryLoading(show) {
  document.getElementById("history-loading").style.display = show ? "flex" : "none";
  if (show) {
    document.getElementById("history-table-wrap").style.display = "none";
    document.getElementById("history-empty").style.display      = "none";
    document.getElementById("history-pagination").style.display = "none";
  }
}

function _showHistoryEmpty(message) {
  const el = document.getElementById("history-empty");
  el.style.display = "block";
  el.querySelector("p").textContent = message;
  el.querySelector(".empty-sub").textContent = "";
  document.getElementById("history-table-wrap").style.display = "none";
  document.getElementById("history-pagination").style.display = "none";
}

function _formatTimeAgo(unixTs) {
  if (!unixTs) return "—";
  const now  = Math.floor(Date.now() / 1000);
  const diff = now - unixTs;

  if (diff < 60)          return `${diff}s ago`;
  if (diff < 3600)        return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)       return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30)  return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixTs * 1000).toLocaleDateString();
}

