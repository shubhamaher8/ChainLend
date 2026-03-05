// frontend/app.js
// UI logic — connects DOM to Web3Manager

// ─── State ──────────────────────────────────────────────────────────────────
const State = {
  connected: false,
  currentChain: null,   // "amoy" | "sepolia" | "unknown"
};

const CHAIN_ID_MAP = {
  80002:    "amoy",
  11155111: "sepolia",
};

// ─── DOM Helpers ─────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

function setStatus(msg, type = "info") {
  // type: "info" | "success" | "error" | "loading"
  const el = $("status-bar");
  el.textContent = msg;
  el.className   = `status-bar status-${type}`;
  el.style.display = msg ? "block" : "none";
}

function showTxLink(networkKey, receipt) {
  const url = Web3Manager.getExplorerTxUrl(networkKey, receipt.hash);
  setStatus(`✅ Transaction confirmed! View on explorer →`, "success");
  const link = document.createElement("a");
  link.href   = url;
  link.target = "_blank";
  link.textContent = " " + receipt.hash.slice(0, 10) + "...";
  $("status-bar").appendChild(link);
}

function setLoading(buttonId, loading) {
  const btn = $(buttonId);
  if (!btn) return;
  btn.disabled = loading;
  btn.dataset.original = btn.dataset.original || btn.textContent;
  btn.textContent = loading ? "Processing..." : btn.dataset.original;
}

function updateWalletUI(address) {
  $("btn-connect").style.display    = "none";
  $("wallet-info").style.display    = "flex";
  $("wallet-address").textContent   = Web3Manager.shortenAddress(address);
}

function updateChainBadge(chainKey) {
  const badge = $("chain-badge");
  if (chainKey === "amoy") {
    badge.textContent   = "Polygon Amoy";
    badge.className     = "chain-badge amoy";
  } else if (chainKey === "sepolia") {
    badge.textContent   = "Ethereum Sepolia";
    badge.className     = "chain-badge sepolia";
  } else {
    badge.textContent   = "Unknown Network";
    badge.className     = "chain-badge unknown";
  }
}

function showPanel(panelId) {
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  const el = $(panelId);
  if (el) el.classList.add("active");
  document.querySelectorAll(".nav-tab").forEach(t => t.classList.remove("active"));
  const tab = document.querySelector(`[data-panel="${panelId}"]`);
  if (tab) tab.classList.add("active");
}

// ─── Wallet Connect ──────────────────────────────────────────────────────────

$("btn-connect").addEventListener("click", async () => {
  try {
    setStatus("Connecting wallet...", "loading");
    const address = await Web3Manager.connectWallet();
    const chainId = await Web3Manager.getCurrentChainId();
    State.connected  = true;
    State.currentChain = CHAIN_ID_MAP[chainId] || "unknown";

    updateWalletUI(address);
    updateChainBadge(State.currentChain);
    setStatus("Wallet connected!", "success");

    // Load balances for the active chain
    await refreshBalances();
    setTimeout(() => setStatus("", ""), 3000);
  } catch (err) {
    setStatus(err.message, "error");
  }
});

// ─── Network Switcher ────────────────────────────────────────────────────────

$("btn-switch-amoy").addEventListener("click", async () => {
  try {
    setStatus("Switching to Polygon Amoy...", "loading");
    await Web3Manager.switchNetwork("amoy");
    State.currentChain = "amoy";
    updateChainBadge("amoy");
    await refreshBalances();
    setStatus("Switched to Polygon Amoy", "success");
    setTimeout(() => setStatus("", ""), 2000);
  } catch (err) {
    setStatus(err.message, "error");
  }
});

$("btn-switch-sepolia").addEventListener("click", async () => {
  try {
    setStatus("Switching to Ethereum Sepolia...", "loading");
    await Web3Manager.switchNetwork("sepolia");
    State.currentChain = "sepolia";
    updateChainBadge("sepolia");
    await refreshBalances();
    setStatus("Switched to Ethereum Sepolia", "success");
    setTimeout(() => setStatus("", ""), 2000);
  } catch (err) {
    setStatus(err.message, "error");
  }
});

// ─── Balance Refresh ─────────────────────────────────────────────────────────

async function refreshBalances() {
  if (!State.connected) return;
  try {
    if (State.currentChain === "amoy") {
      const b = await Web3Manager.getAmoyBalances();
      $("amoy-wallet-bal").textContent   = b.walletBalance + " mUSDC";
      $("amoy-deposited").textContent    = b.available + " mUSDC";
      $("amoy-locked").textContent       = b.locked + " mUSDC";
      $("amoy-interest").textContent     = b.accruedInterest + " mUSDC";
      $("amoy-max-borrow").textContent   =
        (parseFloat(b.available) * 0.5).toFixed(2) + " sUSDC";
    } else if (State.currentChain === "sepolia") {
      const b = await Web3Manager.getSepoliaBalances();
      $("sep-wallet-bal").textContent    = b.walletBalance + " sUSDC";
      $("sep-principal").textContent     = b.debtPrincipal + " sUSDC";
      $("sep-interest").textContent      = b.debtInterest + " sUSDC";
      $("sep-total-debt").textContent    = b.totalDebt + " sUSDC";
    }
  } catch (err) {
    console.warn("Balance refresh failed:", err.message);
  }
}

$("btn-refresh").addEventListener("click", async () => {
  try {
    setStatus("Refreshing balances...", "loading");
    await refreshBalances();
    setStatus("Balances updated", "success");
    setTimeout(() => setStatus("", ""), 1500);
  } catch (err) {
    setStatus(err.message, "error");
  }
});

// ─── Deposit ─────────────────────────────────────────────────────────────────

$("btn-deposit").addEventListener("click", async () => {
  const amount = $("input-deposit").value.trim();
  if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
    setStatus("Enter a valid deposit amount", "error"); return;
  }
  try {
    setLoading("btn-deposit", true);
    setStatus("Approving & depositing...", "loading");
    const receipt = await Web3Manager.deposit(amount);
    showTxLink("amoy", receipt);
    $("input-deposit").value = "";
    await refreshBalances();
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    setLoading("btn-deposit", false);
  }
});

// ─── Withdraw ────────────────────────────────────────────────────────────────

$("btn-withdraw").addEventListener("click", async () => {
  const amount = $("input-withdraw").value.trim();
  if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
    setStatus("Enter a valid withdraw amount", "error"); return;
  }
  try {
    setLoading("btn-withdraw", true);
    setStatus("Withdrawing...", "loading");
    const receipt = await Web3Manager.withdraw(amount);
    showTxLink("amoy", receipt);
    $("input-withdraw").value = "";
    await refreshBalances();
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    setLoading("btn-withdraw", false);
  }
});

// ─── Borrow ──────────────────────────────────────────────────────────────────

$("btn-quote-borrow").addEventListener("click", async () => {
  const amount = $("input-borrow").value.trim();
  if (!amount || isNaN(amount)) { setStatus("Enter a borrow amount first", "error"); return; }
  try {
    setLoading("btn-quote-borrow", true);
    setStatus("Fetching LayerZero fee...", "loading");
    const fee = await Web3Manager.quoteBorrow(amount);
    const feeEth = parseFloat(ethers.formatEther(fee)).toFixed(6);
    $("borrow-fee").textContent = `LayerZero fee: ~${feeEth} ETH`;
    setStatus("Fee fetched. Proceed with borrow.", "success");
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    setLoading("btn-quote-borrow", false);
  }
});

$("btn-borrow").addEventListener("click", async () => {
  const amount = $("input-borrow").value.trim();
  if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
    setStatus("Enter a valid borrow amount", "error"); return;
  }
  try {
    setLoading("btn-borrow", true);
    setStatus("Sending cross-chain borrow request via LayerZero...", "loading");
    const receipt = await Web3Manager.requestBorrow(amount);
    showTxLink("sepolia", receipt);
    $("input-borrow").value = "";
    $("borrow-fee").textContent = "";
    setStatus("✅ Borrow request sent! LayerZero is relaying to Amoy. Funds arrive in ~1-2 minutes.", "success");
    await refreshBalances();
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    setLoading("btn-borrow", false);
  }
});

// ─── Repay & Unlock ──────────────────────────────────────────────────────────

$("btn-repay").addEventListener("click", async () => {
  const collateral = $("input-repay-collateral").value.trim();
  if (!collateral || isNaN(collateral) || parseFloat(collateral) <= 0) {
    setStatus("Enter the collateral amount to unlock on Amoy", "error"); return;
  }
  try {
    setLoading("btn-repay", true);
    setStatus("Approving repayment & sending unlock message via LayerZero...", "loading");
    const receipt = await Web3Manager.repayAndUnlock(collateral);
    showTxLink("sepolia", receipt);
    $("input-repay-collateral").value = "";
    setStatus("✅ Repaid! LayerZero is signaling Amoy to unlock your collateral. Ready in ~1-2 minutes.", "success");
    await refreshBalances();
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    setLoading("btn-repay", false);
  }
});

// ─── Mint Test Tokens (Faucet) ────────────────────────────────────────────────

$("btn-mint-amoy").addEventListener("click", async () => {
  try {
    setLoading("btn-mint-amoy", true);
    setStatus("Minting 10,000 mUSDC on Amoy...", "loading");
    const receipt = await Web3Manager.mintTestTokens("amoy", "10000");
    showTxLink("amoy", receipt);
    await refreshBalances();
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    setLoading("btn-mint-amoy", false);
  }
});

$("btn-mint-sepolia").addEventListener("click", async () => {
  try {
    setLoading("btn-mint-sepolia", true);
    setStatus("Minting 10,000 sUSDC on Sepolia...", "loading");
    const receipt = await Web3Manager.mintTestTokens("sepolia", "10000");
    showTxLink("sepolia", receipt);
    await refreshBalances();
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    setLoading("btn-mint-sepolia", false);
  }
});

// ─── Nav Tabs ────────────────────────────────────────────────────────────────

document.querySelectorAll(".nav-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    showPanel(tab.dataset.panel);
  });
});

// ─── Init ────────────────────────────────────────────────────────────────────

showPanel("panel-amoy");
