// ─── ChainLend Web3 Layer ─────────────────────────────────────────────────────
// Handles wallet connection and contract instances using ethers.js v6

let provider    = null;
let signer      = null;
let userAddress = null;

// Contract instances — populated after wallet connects + chain switch
let amoyReadProvider = null; // read-only provider for Amoy polling (no signer)
let contracts = {
  amoy: {
    mockUSDC:    null,
    lendingPool: null,
  },
  sepolia: {
    mockUSDC:    null,
    lendingPool: null,
    bridge:      null,
  },
};

// ─── Connect Wallet ───────────────────────────────────────────────────────────
async function connectWallet() {
  if (!window.ethereum) {
    throw new Error("MetaMask not found. Please install MetaMask.");
  }

  provider    = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  signer      = await provider.getSigner();
  userAddress = await signer.getAddress();

  // Read-only provider for Amoy — used during polling, no MetaMask needed
  amoyReadProvider = new ethers.JsonRpcProvider(
    NETWORKS.amoy.rpcUrls[0]
  );

  return userAddress;
}

// ─── Switch Network ───────────────────────────────────────────────────────────
// IMPORTANT: Re-instantiate BrowserProvider + signer after every chain switch.
// ethers v6 requires this — stale provider after switch causes wrong chain errors.

async function switchToAmoy() {
  await _switchNetwork(NETWORKS.amoy);
  provider = new ethers.BrowserProvider(window.ethereum);
  signer   = await provider.getSigner();
  _initAmoyContracts(signer);
}

async function switchToSepolia() {
  await _switchNetwork(NETWORKS.sepolia);
  provider = new ethers.BrowserProvider(window.ethereum);
  signer   = await provider.getSigner();
  _initSepoliaContracts(signer);
}

async function _switchNetwork(network) {
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: network.chainId }],
    });
  } catch (err) {
    // Chain not added to MetaMask yet — add it automatically
    if (err.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [network],
      });
    } else {
      throw err;
    }
  }
}

// ─── Init Contracts ───────────────────────────────────────────────────────────
function _initAmoyContracts(signerOrProvider) {
  contracts.amoy.mockUSDC = new ethers.Contract(
    ADDRESSES.amoy.mockUSDC,
    ERC20_ABI,
    signerOrProvider
  );
  contracts.amoy.lendingPool = new ethers.Contract(
    ADDRESSES.amoy.lendingPool,
    AMOY_LENDING_POOL_ABI,
    signerOrProvider
  );
}

function _initSepoliaContracts(signerOrProvider) {
  contracts.sepolia.mockUSDC = new ethers.Contract(
    ADDRESSES.sepolia.mockUSDC,
    ERC20_ABI,
    signerOrProvider
  );
  contracts.sepolia.lendingPool = new ethers.Contract(
    ADDRESSES.sepolia.lendingPool,
    SEPOLIA_LENDING_POOL_ABI,
    signerOrProvider
  );
  contracts.sepolia.bridge = new ethers.Contract(
    ADDRESSES.sepolia.bridge,
    SEPOLIA_BRIDGE_ABI,
    signerOrProvider
  );
}

// ─── Read-only Amoy contracts (for polling — no MetaMask needed) ──────────────
function getAmoyReadContracts() {
  return {
    lendingPool: new ethers.Contract(
      ADDRESSES.amoy.lendingPool,
      AMOY_LENDING_POOL_ABI,
      amoyReadProvider
    ),
  };
}

// ─── Chain Helpers ────────────────────────────────────────────────────────────
async function getCurrentChainId() {
  const network = await provider.getNetwork();
  return Number(network.chainId);
}

async function isOnAmoy() {
  const chainId = await getCurrentChainId();
  return chainId === 80002;
}

async function isOnSepolia() {
  const chainId = await getCurrentChainId();
  return chainId === 11155111;
}

// ─── Format / Parse Helpers ───────────────────────────────────────────────────
function formatUSDC(rawAmount) {
  // BigInt with 6 decimals → human readable string with 2 decimal places
  return (Number(rawAmount) / 1_000_000).toFixed(2);
}

function parseUSDC(humanAmount) {
  // string/number → BigInt with 6 decimals
  return ethers.parseUnits(String(humanAmount), 6);
}

// ─── Wallet Event Listeners ───────────────────────────────────────────────────
function setupWalletListeners(onAccountChange, onChainChange) {
  if (!window.ethereum) return;

  window.ethereum.on("accountsChanged", (accounts) => {
    userAddress = accounts[0] || null;
    if (onAccountChange) onAccountChange(userAddress);
  });

  window.ethereum.on("chainChanged", (chainId) => {
    if (onChainChange) onChainChange(parseInt(chainId, 16));
  });
}
