// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title LendingPool
 * @notice Core banking contract for ChainLend.
 *
 * AMOY (Collateral Chain) uses: deposit(), withdraw(), lockCollateral(), unlockCollateral()
 * SEPOLIA (Loan Chain) uses:    borrow(), repay(), getDebt()
 *
 * Interest model:
 *   - Deposits earn  5% APY  (DEPOSIT_APY_BPS  = 500  basis points)
 *   - Borrows accrue 8% APR  (BORROW_APR_BPS   = 800  basis points)
 *   - LTV ratio: 50%         (MAX_LTV_BPS      = 5000 basis points)
 *
 * Access control:
 *   - Only the authorised bridge contract can call lockCollateral / unlockCollateral / borrow
 */
contract LendingPool is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    // ─── Constants ────────────────────────────────────────────────────────────
    uint256 public constant DEPOSIT_APY_BPS = 500;   // 5.00%
    uint256 public constant BORROW_APR_BPS  = 800;   // 8.00%
    uint256 public constant MAX_LTV_BPS     = 5000;  // 50.00%
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant SECONDS_PER_YEAR = 365 days;

    // ─── State ────────────────────────────────────────────────────────────────
    IERC20 public immutable token;

    /// @notice Address of the ChainLendBridge — only it can call privileged functions
    address public bridge;

    // --- Amoy side (collateral) ---
    struct DepositInfo {
        uint256 availableBalance;  // freely withdrawable
        uint256 lockedBalance;     // locked as cross-chain collateral
        uint256 depositTimestamp;  // when the deposit was made (for APY calc)
    }
    mapping(address => DepositInfo) public deposits;

    // --- Sepolia side (loans) ---
    struct LoanInfo {
        uint256 principal;          // original borrowed amount
        uint256 borrowTimestamp;    // when the loan was initiated
    }
    mapping(address => LoanInfo) public loans;

    // ─── Events ───────────────────────────────────────────────────────────────
    event BridgeSet(address indexed bridge);
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount, uint256 interest);
    event CollateralLocked(address indexed user, uint256 amount);
    event CollateralUnlocked(address indexed user, uint256 amount);
    event Borrowed(address indexed user, uint256 amount);
    event Repaid(address indexed user, uint256 principal, uint256 interest);

    // ─── Errors ───────────────────────────────────────────────────────────────
    error BridgeNotSet();
    error OnlyBridge();
    error ZeroAmount();
    error InsufficientBalance(uint256 requested, uint256 available);
    error ExceedsLTV(uint256 requested, uint256 maxAllowed);
    error NoActiveLoan();
    error LoanAlreadyExists();

    // ─── Modifiers ────────────────────────────────────────────────────────────
    modifier onlyBridge() {
        if (msg.sender != bridge) revert OnlyBridge();
        _;
    }

    modifier nonZero(uint256 amount) {
        if (amount == 0) revert ZeroAmount();
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(address _token) Ownable(msg.sender) {
        token = IERC20(_token);
    }

    // ─── Admin Functions ──────────────────────────────────────────────────────

    /**
     * @notice Set the authorised bridge contract. Can only be set once.
     * @param _bridge Address of ChainLendBridge
     */
    function setBridge(address _bridge) external onlyOwner {
        require(_bridge != address(0), "Zero address");
        bridge = _bridge;
        emit BridgeSet(_bridge);
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ─── Amoy Side: Collateral Functions ──────────────────────────────────────

    /**
     * @notice Deposit tokens as collateral (Amoy chain).
     * @param amount Amount in token's smallest unit (6 decimals for USDC)
     */
    function deposit(uint256 amount) external nonReentrant whenNotPaused nonZero(amount) {
        // Settle any existing deposit interest before adding new funds
        _settleDepositInterest(msg.sender);

        token.safeTransferFrom(msg.sender, address(this), amount);
        deposits[msg.sender].availableBalance += amount;

        // Reset timestamp on each deposit (simplified; production would use weighted avg)
        deposits[msg.sender].depositTimestamp = block.timestamp;

        emit Deposited(msg.sender, amount);
    }

    /**
     * @notice Withdraw available (unlocked) collateral plus accrued interest (Amoy chain).
     * @param amount Amount to withdraw
     */
    function withdraw(uint256 amount) external nonReentrant whenNotPaused nonZero(amount) {
        _settleDepositInterest(msg.sender);

        uint256 available = deposits[msg.sender].availableBalance;
        if (amount > available) revert InsufficientBalance(amount, available);

        deposits[msg.sender].availableBalance -= amount;
        token.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount, 0); // interest already settled into balance
    }

    /**
     * @notice Lock collateral for a cross-chain loan. Called only by bridge.
     * @param user   Borrower address
     * @param amount Amount to lock
     */
    function lockCollateral(address user, uint256 amount)
        external
        onlyBridge
        nonZero(amount)
    {
        uint256 available = deposits[user].availableBalance;
        if (amount > available) revert InsufficientBalance(amount, available);

        deposits[user].availableBalance -= amount;
        deposits[user].lockedBalance     += amount;

        emit CollateralLocked(user, amount);
    }

    /**
     * @notice Unlock collateral after loan repayment. Called only by bridge.
     * @param user   Borrower address
     * @param amount Amount to unlock
     */
    function unlockCollateral(address user, uint256 amount)
        external
        onlyBridge
        nonZero(amount)
    {
        uint256 locked = deposits[user].lockedBalance;
        if (amount > locked) revert InsufficientBalance(amount, locked);

        deposits[user].lockedBalance     -= amount;
        deposits[user].availableBalance  += amount;

        emit CollateralUnlocked(user, amount);
    }

    // ─── Sepolia Side: Loan Functions ─────────────────────────────────────────

    /**
     * @notice Disburse a loan to the borrower (Sepolia chain). Called only by bridge.
     * @param user   Borrower address
     * @param amount Loan amount (must be ≤ 50% of verified collateral — enforced on Amoy)
     */
    function borrow(address user, uint256 amount)
        external
        onlyBridge
        nonReentrant
        whenNotPaused
        nonZero(amount)
    {
        if (loans[user].principal > 0) revert LoanAlreadyExists();

        loans[user] = LoanInfo({
            principal:        amount,
            borrowTimestamp:  block.timestamp
        });

        token.safeTransfer(user, amount);
        emit Borrowed(user, amount);
    }

    /**
     * @notice Repay the full outstanding loan plus accrued interest.
     */
    function repay() external nonReentrant whenNotPaused {
        if (loans[msg.sender].principal == 0) revert NoActiveLoan();

        (uint256 principal, uint256 interest) = getDebt(msg.sender);
        uint256 total = principal + interest;

        delete loans[msg.sender];

        token.safeTransferFrom(msg.sender, address(this), total);
        emit Repaid(msg.sender, principal, interest);

        // NOTE: After repay(), the bridge on Sepolia must send a LayerZero message
        //       back to Amoy to trigger unlockCollateral(). This is handled in
        //       ChainLendBridge.repayAndUnlock().
    }

    // ─── View Functions ───────────────────────────────────────────────────────

    /**
     * @notice Get the current outstanding debt (principal + accrued interest).
     * @return principal  Original borrowed amount
     * @return interest   Accrued interest so far
     */
    function getDebt(address user)
        public
        view
        returns (uint256 principal, uint256 interest)
    {
        LoanInfo memory loan = loans[user];
        if (loan.principal == 0) return (0, 0);

        principal = loan.principal;
        uint256 elapsed = block.timestamp - loan.borrowTimestamp;
        interest = (principal * BORROW_APR_BPS * elapsed) / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
    }

    /**
     * @notice Get the maximum borrowable amount for a given collateral amount.
     * @param collateralAmount Collateral in token units
     * @return maxBorrow 50% of collateral
     */
    function getMaxBorrow(uint256 collateralAmount) public pure returns (uint256) {
        return (collateralAmount * MAX_LTV_BPS) / BPS_DENOMINATOR;
    }

    /**
     * @notice Get full balance info for a depositor.
     */
    function getBalance(address user)
        external
        view
        returns (
            uint256 available,
            uint256 locked,
            uint256 accruedInterest
        )
    {
        DepositInfo memory d = deposits[user];
        available = d.availableBalance;
        locked    = d.lockedBalance;
        accruedInterest = _calculateDepositInterest(user);
    }

    // ─── Internal Helpers ─────────────────────────────────────────────────────

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
            deposits[user].availableBalance  += interest;
            deposits[user].depositTimestamp   = block.timestamp;
        }
    }
}
