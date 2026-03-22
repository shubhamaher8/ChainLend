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
    rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"], // reliable RPC
    nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://sepolia.etherscan.io"],
  },
};

// ─── Contract Addresses ───────────────────────────────────────────────────────
// UPDATE THESE after every redeploy — always keep in sync with deployed contracts
const ADDRESSES = {
  amoy: {
    mockUSDC:    "0x26b37304CF6d608098c47E55A93D68e410A4879B",
    lendingPool: "0xc459C937Fe31Dbc67285b023F325fFAF52D7EfdB",
    bridge:      "0xe5c7BeF3C839Bc1a6915B4211c3D74Ca77B5975a",
  },
  sepolia: {
    mockUSDC:    "0x013906BDE4a34b1dE06A7A8eDB0958337eb7FCA8",
    lendingPool: "REDEPLOY_AND_PASTE_HERE", // SepoliaLendingPool — update after redeploy
    bridge:      "REDEPLOY_AND_PASTE_HERE", // SepoliaBridge      — update after redeploy
  },
};

// ─── Protocol Params ──────────────────────────────────────────────────────────
const LTV_PERCENT        = 50;       // 50% — borrow up to half of collateral
const DEPOSIT_APY        = 5;        // 5% APY on deposits (Amoy)
const FLAT_REPAY_FEE     = 10;       // flat 10 sUSDC repayment fee (no APR math)
const USDC_DECIMALS      = 6;
const USDC_UNIT          = 10n ** 6n; // 1 USDC = 1_000_000 units

// ─── Polling Config ───────────────────────────────────────────────────────────
const POLL_INTERVAL_MS   = 10_000;  // 10 seconds — avoids RPC 429 rate limit
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
  // Admin
  "function adminReleaseLoan(address user, uint256 amount)",
  // Core — repay takes user address only, amount computed internally
  "function repay(address user)",
  // Views
  "function getRepayAmount(address user) view returns (uint256)",
  "function getPoolLiquidity() view returns (uint256)",
  "function getLoanInfo(address user) view returns (uint256 principal, uint256 repayAmount, bool active)",
  // Loan mapping — simplified struct (principal + active only)
  "function loans(address) view returns (uint256 principal, bool active)",
  // Events
  "event LoanReleased(address indexed user, uint256 amount)",
  "event LoanRepaid(address indexed user, uint256 principal, uint256 fee)",
];

const SEPOLIA_BRIDGE_ABI = [
  // Borrow — sends LZ message to lock collateral on Amoy
  "function requestBorrow(uint256 amount) payable returns (bytes32 guid)",
  // Repay — no amount param, reads principal from pool internally
  "function repayAndUnlock() payable",
  // Fee quote — always call before borrow or repay, add 20% buffer
  "function quote(uint8 msgType, address user, uint256 amount) view returns (uint256 nativeFee)",
  // Events
  "event BorrowRequested(address indexed user, uint256 amount, bytes32 guid)",
  "event RepayUnlockSent(address indexed user, uint256 principal, bytes32 guid)",
];

// Message types (matches contract constants)
const MSG_BORROW_REQUEST = 1;
const MSG_REPAY_UNLOCK   = 3;
