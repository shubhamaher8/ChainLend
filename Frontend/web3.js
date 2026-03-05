// frontend/web3.js
// All blockchain interaction logic — wallet, contracts, transactions
// Requires: ethers (loaded via CDN in index.html), constants.js

const Web3Manager = (() => {
  let provider = null;
  let signer   = null;
  let userAddress = null;

  // ─── Wallet ────────────────────────────────────────────────────────────────

  async function connectWallet() {
    if (!window.ethereum) throw new Error("MetaMask not detected. Please install MetaMask.");

    provider    = new ethers.BrowserProvider(window.ethereum);
    const accounts = await provider.send("eth_requestAccounts", []);
    signer      = await provider.getSigner();
    userAddress = accounts[0];

    // Listen for account/chain changes
    window.ethereum.on("accountsChanged", () => window.location.reload());
    window.ethereum.on("chainChanged",    () => window.location.reload());

    return userAddress;
  }

  async function getCurrentChainId() {
    if (!provider) throw new Error("Wallet not connected");
    const network = await provider.getNetwork();
    return Number(network.chainId);
  }

  async function switchNetwork(networkKey) {
    const net = NETWORKS[networkKey];
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: net.chainId }],
      });
    } catch (err) {
      // Chain not added to MetaMask yet — add it
      if (err.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [net],
        });
      } else {
        throw err;
      }
    }
  }

  // ─── Contract Getters ─────────────────────────────────────────────────────

  function getContract(name, networkKey) {
    if (!signer) throw new Error("Wallet not connected");
    const address = ADDRESSES[networkKey][name === "mockUSDC" ? "mockUSDC"
                             : name === "lendingPool" ? "lendingPool"
                             : "bridge"];
    const abi = ABIS[
      name === "mockUSDC"    ? "MockUSDC"
    : name === "lendingPool" ? "LendingPool"
    : "ChainLendBridge"
    ];
    return new ethers.Contract(address, abi, signer);
  }

  // ─── Amoy (Collateral Chain) Functions ────────────────────────────────────

  async function getAmoyBalances() {
    if (!userAddress) throw new Error("Wallet not connected");

    const usdc = getContract("mockUSDC", "amoy");
    const pool = getContract("lendingPool", "amoy");

    const [walletBal, poolBal] = await Promise.all([
      usdc.balanceOf(userAddress),
      pool.getBalance(userAddress),
    ]);

    return {
      walletBalance:    formatUSDC(walletBal),
      available:        formatUSDC(poolBal.available),
      locked:           formatUSDC(poolBal.locked),
      accruedInterest:  formatUSDC(poolBal.accruedInterest),
    };
  }

  async function deposit(amountHuman) {
    const amount = parseUSDC(amountHuman);
    const usdc   = getContract("mockUSDC", "amoy");
    const pool   = getContract("lendingPool", "amoy");
    const poolAddr = ADDRESSES.amoy.lendingPool;

    // 1. Approve
    const allowance = await usdc.allowance(userAddress, poolAddr);
    if (allowance < amount) {
      const approveTx = await usdc.approve(poolAddr, ethers.MaxUint256);
      await approveTx.wait();
    }

    // 2. Deposit
    const tx = await pool.deposit(amount);
    return tx.wait();
  }

  async function withdraw(amountHuman) {
    const amount = parseUSDC(amountHuman);
    const pool   = getContract("lendingPool", "amoy");
    const tx     = await pool.withdraw(amount);
    return tx.wait();
  }

  // ─── Sepolia (Loan Chain) Functions ───────────────────────────────────────

  async function getSepoliaBalances() {
    if (!userAddress) throw new Error("Wallet not connected");

    const usdc   = getContract("mockUSDC", "sepolia");
    const pool   = getContract("lendingPool", "sepolia");

    const [walletBal, debt] = await Promise.all([
      usdc.balanceOf(userAddress),
      pool.getDebt(userAddress),
    ]);

    return {
      walletBalance: formatUSDC(walletBal),
      debtPrincipal: formatUSDC(debt.principal),
      debtInterest:  formatUSDC(debt.interest),
      totalDebt:     formatUSDC(debt.principal + debt.interest),
    };
  }

  async function quoteBorrow(amountHuman) {
    const amount  = parseUSDC(amountHuman);
    const bridge  = getContract("bridge", "sepolia");
    const feeBig  = await bridge.quoteBorrow(amount);
    return feeBig; // raw BigInt — pass directly to requestBorrow
  }

  async function requestBorrow(amountHuman) {
    const amount  = parseUSDC(amountHuman);
    const bridge  = getContract("bridge", "sepolia");

    // Get the LZ fee first
    const fee = await bridge.quoteBorrow(amount);
    // Add 10% buffer for safety
    const feeWithBuffer = fee + (fee / 10n);

    const tx = await bridge.requestBorrow(amount, { value: feeWithBuffer });
    return tx.wait();
  }

  async function repayAndUnlock(collateralAmountHuman) {
    const collateral = parseUSDC(collateralAmountHuman);
    const usdc       = getContract("mockUSDC", "sepolia");
    const pool       = getContract("lendingPool", "sepolia");
    const bridge     = getContract("bridge", "sepolia");
    const bridgeAddr = ADDRESSES.sepolia.bridge;
    const poolAddr   = ADDRESSES.sepolia.lendingPool;

    // 1. Get total debt
    const debt  = await pool.getDebt(userAddress);
    const total = debt.principal + debt.interest;

    // 2. Approve pool to pull repayment
    const allowance = await usdc.allowance(userAddress, poolAddr);
    if (allowance < total) {
      const approveTx = await usdc.approve(poolAddr, ethers.MaxUint256);
      await approveTx.wait();
    }

    // 3. Quote LZ fee for unlock message
    // (use quoteBorrow as a proxy — same gas structure)
    const lzFee = await bridge.quoteBorrow(total);
    const feeWithBuffer = lzFee + (lzFee / 10n);

    // 4. Call repayAndUnlock on bridge
    const tx = await bridge.repayAndUnlock(collateral, { value: feeWithBuffer });
    return tx.wait();
  }

  // ─── Mint Test Tokens (for testnet only) ─────────────────────────────────

  async function mintTestTokens(networkKey, amountHuman) {
    const amount = parseUSDC(amountHuman);
    const usdc   = getContract("mockUSDC", networkKey);
    const mintAbi = ["function mint(address to, uint256 amount)"];
    const usdcWithMint = new ethers.Contract(
      ADDRESSES[networkKey].mockUSDC,
      [...ABIS.MockUSDC, ...mintAbi],
      signer
    );
    const tx = await usdcWithMint.mint(userAddress, amount);
    return tx.wait();
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function parseUSDC(human) {
    return ethers.parseUnits(String(human), PROTOCOL.USDC_DECIMALS);
  }

  function formatUSDC(raw) {
    return parseFloat(ethers.formatUnits(raw, PROTOCOL.USDC_DECIMALS)).toFixed(2);
  }

  function shortenAddress(addr) {
    if (!addr) return "";
    return addr.slice(0, 6) + "..." + addr.slice(-4);
  }

  function getExplorerTxUrl(networkKey, txHash) {
    const base = NETWORKS[networkKey].blockExplorerUrls[0];
    return `${base}/tx/${txHash}`;
  }

  // ─── Public API ───────────────────────────────────────────────────────────
  return {
    connectWallet,
    getCurrentChainId,
    switchNetwork,
    getAmoyBalances,
    deposit,
    withdraw,
    getSepoliaBalances,
    quoteBorrow,
    requestBorrow,
    repayAndUnlock,
    mintTestTokens,
    shortenAddress,
    getExplorerTxUrl,
    get userAddress() { return userAddress; },
  };
})();
