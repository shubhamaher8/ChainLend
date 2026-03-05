// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockUSDC
 * @notice Mock stablecoin used as collateral (mUSDC on Amoy) and loan token (sUSDC on Sepolia).
 * @dev 6 decimals to match real USDC. Minting can be permanently disabled.
 *
 * Deploy on Amoy   → name: "Mock USDC",    symbol: "mUSDC"
 * Deploy on Sepolia → name: "Sepolia USDC", symbol: "sUSDC"
 */
contract MockUSDC is ERC20, Ownable {
    // ─── State ────────────────────────────────────────────────────────────────
    bool public mintingDisabled;

    // ─── Events ───────────────────────────────────────────────────────────────
    event MintingDisabled(address indexed caller);

    // ─── Errors ───────────────────────────────────────────────────────────────
    error MintingIsPermanentlyDisabled();
    error ZeroAddressNotAllowed();
    error ZeroAmountNotAllowed();

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply,
        address initialHolder
    ) ERC20(name, symbol) Ownable(msg.sender) {
        if (initialHolder == address(0)) revert ZeroAddressNotAllowed();
        _mint(initialHolder, initialSupply * (10 ** decimals()));
    }

    // ─── External Functions ───────────────────────────────────────────────────

    /**
     * @notice Mint tokens to a recipient. Only callable by owner.
     * @param to    Recipient address
     * @param amount Amount in token units (NOT wei — will be scaled by decimals)
     */
    function mint(address to, uint256 amount) external onlyOwner {
        if (mintingDisabled) revert MintingIsPermanentlyDisabled();
        if (to == address(0)) revert ZeroAddressNotAllowed();
        if (amount == 0) revert ZeroAmountNotAllowed();
        _mint(to, amount);
    }

    /**
     * @notice Permanently disable minting. Cannot be reversed.
     */
    function disableMinting() external onlyOwner {
        mintingDisabled = true;
        emit MintingDisabled(msg.sender);
    }

    // ─── Overrides ────────────────────────────────────────────────────────────

    /**
     * @dev Override to enforce 6 decimals (matching real USDC)
     */
    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
