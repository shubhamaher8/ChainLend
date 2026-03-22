// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SepoliaLendingPool
 * @notice Manages loans on Ethereum Sepolia (the Loan Chain).
 * @dev Loans use a flat 10 sUSDC repayment fee — no time-based interest.
 *      adminReleaseLoan() is called by frontend owner after LZ confirms lock on Amoy.
 *      repay() is called by SepoliaBridge after user approves repayment.
 */
contract SepoliaLendingPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ───────────────────────────────────────────────────
    uint256 public constant FLAT_FEE = 10e6; // 10 sUSDC flat repayment fee (6 decimals)

    // ─── State ───────────────────────────────────────────────────────
    IERC20  public immutable token;  // sUSDC on Sepolia
    address public bridge;           // SepoliaBridge address
    uint256 public totalBorrowed;    // total outstanding principal

    struct LoanInfo {
        uint256 principal; // original loan amount
        bool    active;    // true = loan exists
    }

    mapping(address => LoanInfo) public loans;

    // ─── Events ──────────────────────────────────────────────────────
    event LoanReleased(address indexed user, uint256 amount);
    event LoanRepaid(address indexed user, uint256 principal, uint256 fee);
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

    // ─── Core: Release Loan ──────────────────────────────────────────
    /**
     * @notice Releases sUSDC loan to user after Amoy collateral confirmed locked.
     * @dev onlyOwner — frontend calls this after polling detects lock on Amoy.
     * @param user   The borrower address.
     * @param amount The loan amount in sUSDC (6 decimals).
     */
    function adminReleaseLoan(
        address user,
        uint256 amount
    ) external onlyOwner nonReentrant {
        require(user != address(0), "Zero address");
        require(amount > 0, "Zero amount");
        require(!loans[user].active, "Loan already active");
        require(
            token.balanceOf(address(this)) >= amount,
            "Insufficient pool liquidity"
        );

        loans[user].principal = amount;
        loans[user].active    = true;
        totalBorrowed        += amount;

        token.safeTransfer(user, amount);

        emit LoanReleased(user, amount);
    }

    // ─── Core: Repay ─────────────────────────────────────────────────
    /**
     * @notice Collects repayment from user. Called by SepoliaBridge only.
     * @dev Pulls principal + FLAT_FEE (10 sUSDC) from user wallet.
     *      User must approve SepoliaLendingPool for (principal + 10e6) before calling.
     *      msg.sender context: bridge calls this, so user address passed explicitly.
     * @param user The borrower address.
     */
    function repay(address user) external nonReentrant {
        require(msg.sender == bridge, "Only bridge");

        LoanInfo storage loan = loans[user];
        require(loan.active, "No active loan");

        uint256 principal   = loan.principal;
        uint256 repayAmount = principal + FLAT_FEE;

        // Clear loan BEFORE transfer (reentrancy protection)
        delete loans[user];
        totalBorrowed -= principal;

        // Pull repayment directly from user wallet
        // User must have approved this contract for repayAmount
        token.safeTransferFrom(user, address(this), repayAmount);

        emit LoanRepaid(user, principal, FLAT_FEE);
    }

    // ─── View ─────────────────────────────────────────────────────────
    /**
     * @notice Returns total amount user needs to repay (principal + flat fee).
     */
    function getRepayAmount(address user) external view returns (uint256) {
        if (!loans[user].active) return 0;
        return loans[user].principal + FLAT_FEE;
    }

    function getPoolLiquidity() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function getLoanInfo(address user) external view returns (
        uint256 principal,
        uint256 repayAmount,
        bool    active
    ) {
        LoanInfo memory loan = loans[user];
        return (
            loan.principal,
            loan.active ? loan.principal + FLAT_FEE : 0,
            loan.active
        );
    }
}
