// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SepoliaLendingPool
 * @notice Manages loans on Ethereum Sepolia (the Loan Chain).
 * @dev Receives loan releases via adminReleaseLoan() called by frontend owner
 *      after LayerZero confirms collateral is locked on Amoy.
 */
contract SepoliaLendingPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ───────────────────────────────────────────────────
    uint256 public constant BORROW_APR       = 8;    // 8% per year
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 public constant LTV_PERCENT      = 50;   // 50% loan-to-value

    // ─── State ───────────────────────────────────────────────────────
    IERC20 public immutable token;     // sUSDC on Sepolia
    address public bridge;             // ChainLendBridge on Sepolia
    uint256 public totalBorrowed;      // total outstanding loans

    struct LoanInfo {
        uint256 principal;             // original loan amount
        uint256 interestSnapshot;      // accrued interest at last snapshot
        uint256 lastSnapshotTime;      // timestamp of last snapshot
    }

    mapping(address => LoanInfo) public loans;

    // ─── Events ──────────────────────────────────────────────────────
    event LoanReleased(address indexed user, uint256 amount);
    event LoanRepaid(address indexed user, uint256 principal, uint256 interest);
    event BridgeSet(address indexed bridge);

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

    // ─── Core: Release Loan (called by frontend owner after LZ confirms) ──
    /**
     * @notice Release sUSDC loan to user after Amoy collateral is confirmed locked.
     * @dev Owner calls this after frontend detects locked[user] change on Amoy.
     *      MUST use _snapshotLoan to start the 8% APR clock correctly.
     *      MUST update totalBorrowed for accurate pool accounting.
     * @param user  The borrower address.
     * @param amount The loan amount in sUSDC (6 decimals).
     */
    function adminReleaseLoan(
        address user,
        uint256 amount
    ) external onlyOwner nonReentrant {
        require(user != address(0), "Zero address");
        require(amount > 0, "Zero amount");
        require(loans[user].principal == 0, "Loan already active");
        require(
            token.balanceOf(address(this)) >= amount,
            "Insufficient liquidity in pool"
        );

        // Start the interest clock — critical for getDebt() to work correctly
        _snapshotLoan(user);

        // Record the loan principal
        loans[user].principal = amount;

        // Update global pool accounting
        totalBorrowed += amount;

        // Transfer sUSDC to borrower
        token.safeTransfer(user, amount);

        emit LoanReleased(user, amount);
    }

    // ─── Core: Repay ─────────────────────────────────────────────────
    /**
     * @notice User repays their sUSDC loan + accrued interest.
     * @dev After repay, Sepolia Bridge sends LZ message to unlock Amoy collateral.
     *      This function only handles the token collection and state clearing.
     */
    function repay(uint256 amount) external nonReentrant {
        LoanInfo storage loan = loans[msg.sender];
        require(loan.principal > 0, "No active loan");

        uint256 totalDebt = getDebt(msg.sender);
        require(amount >= totalDebt, "Amount less than total debt");

        uint256 principal = loan.principal;
        uint256 interest  = totalDebt - principal;

        // Clear loan state BEFORE transfer (reentrancy protection)
        delete loans[msg.sender];
        totalBorrowed -= principal;

        // Collect repayment
        token.safeTransferFrom(msg.sender, address(this), totalDebt);

        emit LoanRepaid(msg.sender, principal, interest);
    }

    // ─── View: Get Total Debt ─────────────────────────────────────────
    /**
     * @notice Returns current total debt (principal + accrued 8% APR interest).
     */
    function getDebt(address user) public view returns (uint256) {
        LoanInfo memory loan = loans[user];
        if (loan.principal == 0) return 0;

        uint256 timeElapsed = block.timestamp - loan.lastSnapshotTime;

        uint256 accruedInterest = (loan.principal * BORROW_APR * timeElapsed)
            / (100 * SECONDS_PER_YEAR);

        return loan.principal + loan.interestSnapshot + accruedInterest;
    }

    // ─── Internal: Snapshot ──────────────────────────────────────────
    /**
     * @notice Snapshots current accrued interest and resets the clock.
     * @dev Must be called before any principal change to preserve interest.
     */
    function _snapshotLoan(address user) internal {
        LoanInfo storage loan = loans[user];

        if (loan.lastSnapshotTime != 0 && loan.principal > 0) {
            uint256 timeElapsed = block.timestamp - loan.lastSnapshotTime;
            uint256 newInterest = (loan.principal * BORROW_APR * timeElapsed)
                / (100 * SECONDS_PER_YEAR);
            loan.interestSnapshot += newInterest;
        }

        loan.lastSnapshotTime = block.timestamp;
    }

    // ─── View: Pool Info ─────────────────────────────────────────────
    function getPoolLiquidity() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function getLoanInfo(address user) external view returns (
        uint256 principal,
        uint256 totalDebt,
        uint256 startTime
    ) {
        LoanInfo memory loan = loans[user];
        return (
            loan.principal,
            getDebt(user),
            loan.lastSnapshotTime
        );
    }
}
