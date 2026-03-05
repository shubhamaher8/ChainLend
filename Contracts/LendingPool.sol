// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract LendingPool is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant DEPOSIT_APY_BPS  = 500;
    uint256 public constant BORROW_APR_BPS   = 800;
    uint256 public constant MAX_LTV_BPS      = 5000;
    uint256 public constant BPS_DENOMINATOR  = 10_000;
    uint256 public constant SECONDS_PER_YEAR = 365 days;

    IERC20 public immutable token;
    address public bridge;

    struct DepositInfo {
        uint256 availableBalance;
        uint256 lockedBalance;
        uint256 depositTimestamp;
    }
    mapping(address => DepositInfo) public deposits;

    struct LoanInfo {
        uint256 principal;
        uint256 borrowTimestamp;
    }
    mapping(address => LoanInfo) public loans;

    event BridgeSet(address indexed bridge);
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount, uint256 interest);
    event CollateralLocked(address indexed user, uint256 amount);
    event CollateralUnlocked(address indexed user, uint256 amount);
    event Borrowed(address indexed user, uint256 amount);
    event Repaid(address indexed user, uint256 principal, uint256 interest);

    error BridgeNotSet();
    error OnlyBridge();
    error ZeroAmount();
    error InsufficientBalance(uint256 requested, uint256 available);
    error NoActiveLoan();
    error LoanAlreadyExists();

    modifier onlyBridge() {
        if (msg.sender != bridge) revert OnlyBridge();
        _;
    }

    modifier nonZero(uint256 amount) {
        if (amount == 0) revert ZeroAmount();
        _;
    }

    constructor(address _token) Ownable(msg.sender) {
        token = IERC20(_token);
    }

    function setBridge(address _bridge) external onlyOwner {
        require(_bridge != address(0), "Zero address");
        bridge = _bridge;
        emit BridgeSet(_bridge);
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ── Amoy side ──────────────────────────────────────────────────────────────

    function deposit(uint256 amount) external nonReentrant whenNotPaused nonZero(amount) {
        _settleDepositInterest(msg.sender);
        token.safeTransferFrom(msg.sender, address(this), amount);
        deposits[msg.sender].availableBalance += amount;
        deposits[msg.sender].depositTimestamp  = block.timestamp;
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant whenNotPaused nonZero(amount) {
        _settleDepositInterest(msg.sender);
        uint256 available = deposits[msg.sender].availableBalance;
        if (amount > available) revert InsufficientBalance(amount, available);
        deposits[msg.sender].availableBalance -= amount;
        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount, 0);
    }

    function lockCollateral(address user, uint256 amount) external onlyBridge nonZero(amount) {
        uint256 available = deposits[user].availableBalance;
        if (amount > available) revert InsufficientBalance(amount, available);
        deposits[user].availableBalance -= amount;
        deposits[user].lockedBalance    += amount;
        emit CollateralLocked(user, amount);
    }

    function unlockCollateral(address user, uint256 amount) external onlyBridge nonZero(amount) {
        uint256 locked = deposits[user].lockedBalance;
        if (amount > locked) revert InsufficientBalance(amount, locked);
        deposits[user].lockedBalance    -= amount;
        deposits[user].availableBalance += amount;
        emit CollateralUnlocked(user, amount);
    }

    // ── Sepolia side ───────────────────────────────────────────────────────────

    function borrow(address user, uint256 amount)
        external onlyBridge nonReentrant whenNotPaused nonZero(amount)
    {
        if (loans[user].principal > 0) revert LoanAlreadyExists();
        loans[user] = LoanInfo({ principal: amount, borrowTimestamp: block.timestamp });
        token.safeTransfer(user, amount);
        emit Borrowed(user, amount);
    }

    /**
     * @notice Direct repay — user calls this themselves on Sepolia.
     */
    function repay() external nonReentrant whenNotPaused {
        _repay(msg.sender);
    }

    /**
     * @notice Repay on behalf of a user — called only by the bridge.
     * @dev    FIX: This is the new function that solves the msg.sender bug.
     *         The bridge calls repayFor(user) passing the real borrower address.
     */
    function repayFor(address user) external onlyBridge nonReentrant whenNotPaused {
        _repay(user);
    }

    // ── Internal ───────────────────────────────────────────────────────────────

    function _repay(address user) internal {
        if (loans[user].principal == 0) revert NoActiveLoan();
        (uint256 principal, uint256 interest) = getDebt(user);
        uint256 total = principal + interest;
        delete loans[user];
        token.safeTransferFrom(user, address(this), total);
        emit Repaid(user, principal, interest);
    }

    // ── View functions ─────────────────────────────────────────────────────────

    function getDebt(address user) public view returns (uint256 principal, uint256 interest) {
        LoanInfo memory loan = loans[user];
        if (loan.principal == 0) return (0, 0);
        principal = loan.principal;
        uint256 elapsed = block.timestamp - loan.borrowTimestamp;
        interest = (principal * BORROW_APR_BPS * elapsed) / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
    }

    function getMaxBorrow(uint256 collateralAmount) public pure returns (uint256) {
        return (collateralAmount * MAX_LTV_BPS) / BPS_DENOMINATOR;
    }

    function getBalance(address user)
        external view
        returns (uint256 available, uint256 locked, uint256 accruedInterest)
    {
        DepositInfo memory d = deposits[user];
        available       = d.availableBalance;
        locked          = d.lockedBalance;
        accruedInterest = _calculateDepositInterest(user);
    }

    function _calculateDepositInterest(address user) internal view returns (uint256) {
        DepositInfo memory d = deposits[user];
        if (d.availableBalance == 0 || d.depositTimestamp == 0) return 0;
        uint256 elapsed = block.timestamp - d.depositTimestamp;
        return (d.availableBalance * DEPOSIT_APY_BPS * elapsed) /
               (BPS_DENOMINATOR * SECONDS_PER_YEAR);
    }

    function _settleDepositInterest(address user) internal {
        uint256 interest = _calculateDepositInterest(user);
        if (interest > 0) {
            deposits[user].availableBalance += interest;
            deposits[user].depositTimestamp  = block.timestamp;
        }
    }
}
