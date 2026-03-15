// ─── ChainLend Constants ─────────────────────────────────────────────────────

// ─── Network Config ───────────────────────────────────────────────────────────
const NETWORKS = {
  amoy: {
    chainId: "0x13882", // 80002 in hex
    chainName: "Polygon Amoy Testnet",
    rpcUrls: ["https://rpc-amoy.polygon.technology"],
    nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
    blockExplorerUrls: ["https://amoy.polygonscan.com"],
  },
  sepolia: {
    chainId: "0xaa36a7", // 11155111 in hex
    chainName: "Ethereum Sepolia Testnet",
    rpcUrls: ["https://rpc.sepolia.org"],
    nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://sepolia.etherscan.io"],
  },
};

// ─── Contract Addresses ───────────────────────────────────────────────────────
const ADDRESSES = {
  amoy: {
    mockUSDC:     "0x26b37304CF6d608098c47E55A93D68e410A4879B",
    lendingPool:  "0xc459C937Fe31Dbc67285b023F325fFAF52D7EfdB",
    bridge:       "0xe5c7BeF3C839Bc1a6915B4211c3D74Ca77B5975a",
  },
  sepolia: {
    mockUSDC:     "0x013906BDE4a34b1dE06A7A8eDB0958337eb7FCA8",
    lendingPool:  "0xC90344e41265aA345183Aa36b9D2f27010F3c150",
    bridge:       "0x659aA7C850Cd57e0978856D3fdfABBB9CD776caa",
  },
};

// ─── Protocol Params ──────────────────────────────────────────────────────────
const LTV_PERCENT        = 50;     // 50% — borrow up to half of collateral
const DEPOSIT_APY        = 5;      // 5% APY on deposits
const BORROW_APR         = 8;      // 8% APR on borrows
const USDC_DECIMALS      = 6;
const USDC_UNIT          = 10n ** 6n; // 1 USDC = 1_000_000 units

// ─── Polling Config ───────────────────────────────────────────────────────────
const POLL_INTERVAL_MS   = 10_000; // 10 seconds — avoids RPC 429 rate limit
const POLL_TIMEOUT_MS    = 300_000; // 5 minutes max wait

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const AMOY_LENDING_POOL_ABI = [
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function lock(address user, uint256 amount)",
  "function unlock(address user, uint256 amount)",
  "function getAvailableBalance(address user) view returns (uint256)",
  "function getLockedBalance(address user) view returns (uint256)",
  "function getAccruedInterest(address user) view returns (uint256)",
  "function deposits(address) view returns (uint256 amount, uint256 interestSnapshot, uint256 lastSnapshotTime)",
  "function locked(address) view returns (uint256)",
  "event Deposited(address indexed user, uint256 amount)",
  "event Withdrawn(address indexed user, uint256 amount, uint256 interest)",
  "event Locked(address indexed user, uint256 amount)",
  "event Unlocked(address indexed user, uint256 amount)",
];

const SEPOLIA_LENDING_POOL_ABI = [
  "function adminReleaseLoan(address user, uint256 amount)",
  "function repay(uint256 amount)",
  "function getDebt(address user) view returns (uint256)",
  "function getLoanInfo(address user) view returns (uint256 principal, uint256 totalDebt, uint256 startTime)",
  "function getPoolLiquidity() view returns (uint256)",
  "function loans(address) view returns (uint256 principal, uint256 interestSnapshot, uint256 lastSnapshotTime)",
  "event LoanReleased(address indexed user, uint256 amount)",
  "event LoanRepaid(address indexed user, uint256 principal, uint256 interest)",
];

const SEPOLIA_BRIDGE_ABI = [
  "function requestBorrow(uint256 amount) payable returns (bytes32 guid)",
  "function repayAndUnlock(uint256 amount) payable",
  "function quote(uint8 msgType, address user, uint256 amount) view returns (uint256 nativeFee)",
  "event BorrowRequested(address indexed user, uint256 amount, bytes32 guid)",
  "event RepayUnlockSent(address indexed user, uint256 amount, bytes32 guid)",
];

// Message types (matches contract constants)
const MSG_BORROW_REQUEST = 1;
const MSG_REPAY_UNLOCK   = 3;
