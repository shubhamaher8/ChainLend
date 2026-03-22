// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AmoyLendingPool
 * @notice Manages collateral deposits on Polygon Amoy (the Collateral Chain).
 * @dev Users deposit mUSDC here. Bridge calls lock()/unlock() when
 *      LayerZero messages arrive from Sepolia.
 *
 *      Balances per user:
 *        available[user] — free to withdraw
 *        locked[user]    — locked as collateral for active loan
 */
contract AmoyLendingPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ───────────────────────────────────────────────────
    uint256 public constant DEPOSIT_APY      = 5;    // 5% per year
    uint256 public constant SECONDS_PER_YEAR = 365 days;

    // ─── State ───────────────────────────────────────────────────────
    IERC20  public immutable token;   // mUSDC on Amoy
    address public bridge;            // ChainLendBridge on Amoy

    struct DepositInfo {
        uint256 amount;               // deposited principal
        uint256 interestSnapshot;     // accrued interest at last snapshot
        uint256 lastSnapshotTime;     // timestamp of last snapshot
    }

    mapping(address => DepositInfo) public deposits;
    mapping(address => uint256)     public locked;   // collateral locked per user

    // ─── Events ──────────────────────────────────────────────────────
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount, uint256 interest);
    event Locked(address indexed user, uint256 amount);
    event Unlocked(address indexed user, uint256 amount);
    event BridgeSet(address indexed bridge);

    // ─── Modifiers ───────────────────────────────────────────────────
    modifier onlyBridge() {
        require(msg.sender == bridge, "Only bridge");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────
    constructor(
        address _token,
        address _delegate
    ) Ownable(_delegate) {
        require(_token != address(0), "Zero address");
        token = IERC20(_token);
    }

    // ─── Admin ───────────────────────────────────────────────────────
    function setBridge(address _bridge) external onlyOwner {
        require(_bridge != address(0), "Zero address");
        bridge = _bridge;
        emit BridgeSet(_bridge);
    }

    // ─── User: Deposit ───────────────────────────────────────────────
    /**
     * @notice Deposit mUSDC into the pool as collateral.
     * @dev User must approve this contract first.
     */
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");

        _snapshotDeposit(msg.sender);

        deposits[msg.sender].amount += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);

        emit Deposited(msg.sender, amount);
    }

    // ─── User: Withdraw ──────────────────────────────────────────────
    /**
     * @notice Withdraw available (unlocked) mUSDC + earned interest.
     */
    function withdraw(uint256 amount) external nonReentrant {
        _snapshotDeposit(msg.sender);

        DepositInfo storage dep = deposits[msg.sender];
        uint256 available = dep.amount;
        require(available >= amount, "Insufficient unlocked balance");
        require(locked[msg.sender] == 0, "Collateral is locked - repay loan first");

        uint256 interest = dep.interestSnapshot;

        dep.amount           -= amount;
        dep.interestSnapshot  = 0;

        uint256 totalPayout = amount + interest;
        require(
            token.balanceOf(address(this)) >= totalPayout,
            "Pool insufficient for interest payout"
        );

        token.safeTransfer(msg.sender, totalPayout);

        emit Withdrawn(msg.sender, amount, interest);
    }

    // ─── Bridge: Lock Collateral ─────────────────────────────────────
    /**
     * @notice Called by bridge when MSG_BORROW_REQUEST arrives from Sepolia.
     * @dev Moves funds from available → locked.
     *      Frontend detects this change by polling locked[user].
     */
    function lock(address user, uint256 amount) external onlyBridge {
        require(deposits[user].amount >= amount, "Insufficient deposit to lock");
        require(locked[user] == 0, "Already has active lock");

        deposits[user].amount -= amount;
        locked[user]          += amount;

        emit Locked(user, amount);
    }

    // ─── Bridge: Unlock Collateral ───────────────────────────────────
    /**
     * @notice Called by bridge when MSG_REPAY_UNLOCK arrives from Sepolia.
     * @dev Moves funds from locked → available.
     */
    function unlock(address user, uint256 amount) external onlyBridge {
        require(locked[user] >= amount, "Not enough locked");

        locked[user]          -= amount;
        deposits[user].amount += amount;

        emit Unlocked(user, amount);
    }

    // ─── View ────────────────────────────────────────────────────────
    function getAvailableBalance(address user) external view returns (uint256) {
        return deposits[user].amount;
    }

    function getLockedBalance(address user) external view returns (uint256) {
        return locked[user];
    }

    function getAccruedInterest(address user) external view returns (uint256) {
        DepositInfo memory dep = deposits[user];
        if (dep.amount == 0 || dep.lastSnapshotTime == 0) return dep.interestSnapshot;

        uint256 timeElapsed = block.timestamp - dep.lastSnapshotTime;
        uint256 newInterest = (dep.amount * DEPOSIT_APY * timeElapsed)
            / (100 * SECONDS_PER_YEAR);

        return dep.interestSnapshot + newInterest;
    }

    // ─── Internal ────────────────────────────────────────────────────
    function _snapshotDeposit(address user) internal {
        DepositInfo storage dep = deposits[user];

        if (dep.lastSnapshotTime != 0 && dep.amount > 0) {
            uint256 timeElapsed = block.timestamp - dep.lastSnapshotTime;
            uint256 newInterest = (dep.amount * DEPOSIT_APY * timeElapsed)
                / (100 * SECONDS_PER_YEAR);
            dep.interestSnapshot += newInterest;
        }

        dep.lastSnapshotTime = block.timestamp;
    }
}
