// frontend/constants.js

// ─── Network Config ──────────────────────────────────────────────────────────
const NETWORKS = {
  amoy: {
    chainId: "0x13882",
    chainName: "Polygon Amoy",
    rpcUrls: ["https://rpc-amoy.polygon.technology"],
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    blockExplorerUrls: ["https://amoy.polygonscan.com"],
  },
  sepolia: {
    chainId: "0xaa36a7",
    chainName: "Ethereum Sepolia",
    rpcUrls: ["https://rpc.sepolia.org"],
    nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://sepolia.etherscan.io"],
  },
};

// ─── Deployed Contract Addresses ─────────────────────────────────────────────
const ADDRESSES = {
  amoy: {
    mockUSDC:    "0x255447fD05AE643662a351e8b33730297283C4be",
    lendingPool: "0x4851d5211dfe3fa12E1eAA3e97aFAA55889de9AA",
    bridge:      "0xaAFE5a3d4bD40092A637c60A6f331FF7e20a9d78",
  },
  sepolia: {
    mockUSDC:    "0xef2B880E4653381A613Abd215aE5f13ce6d5Ef9d",
    lendingPool: "0x125A5348bE74073b03970dB888549258d6d5db99",
    bridge:      "0x3C972A74Fc0dAD0Fa32CeD08C8334B521E44aC83",
  },
};

// ─── ABIs ─────────────────────────────────────────────────────────────────────
const ABIS = {
  MockUSDC: [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
    "function mint(address to, uint256 amount)",
  ],

  LendingPool: [
    "function deposit(uint256 amount)",
    "function withdraw(uint256 amount)",
    "function getBalance(address user) view returns (uint256 available, uint256 locked, uint256 accruedInterest)",
    "function getMaxBorrow(uint256 collateralAmount) pure returns (uint256)",
    "function getDebt(address user) view returns (uint256 principal, uint256 interest)",
    "event Deposited(address indexed user, uint256 amount)",
    "event Withdrawn(address indexed user, uint256 amount, uint256 interest)",
    "event Borrowed(address indexed user, uint256 amount)",
    "event Repaid(address indexed user, uint256 principal, uint256 interest)",
  ],

  ChainLendBridge: [
    "function requestBorrow(uint256 borrowAmount) payable",
    "function repayAndUnlock(uint256 collateralAmount) payable",
    "function quoteBorrow(uint256 borrowAmount) view returns (uint256 nativeFee)",
    "event BorrowRequested(address indexed user, uint256 amount, uint256 collateralRequired)",
    "event RepayAndUnlockInitiated(address indexed user, uint256 collateralAmount)",
  ],
};

// ─── Protocol Constants ───────────────────────────────────────────────────────
const PROTOCOL = {
  USDC_DECIMALS:   6,
  DEPOSIT_APY_PCT: 5,
  BORROW_APR_PCT:  8,
  MAX_LTV_PCT:     50,
};

if (typeof module !== "undefined") {
  module.exports = { NETWORKS, ADDRESSES, ABIS, PROTOCOL };
}