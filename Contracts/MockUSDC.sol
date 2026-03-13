// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockUSDC
 * @notice Fake USDC for testnet. 6 decimals like real USDC.
 * @dev Deploy on BOTH Amoy (mUSDC) and Sepolia (sUSDC).
 *      After minting initial supply, call disableMinting() to lock supply.
 */
contract MockUSDC is ERC20, Ownable {

    bool public mintingDisabled;

    event MintingDisabled();

    constructor(
        string memory name,
        string memory symbol,
        address _delegate
    ) ERC20(name, symbol) Ownable(_delegate) {}

    // ─── 6 decimals like real USDC ───────────────────────────────────
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    // ─── Mint (owner only, before disable) ───────────────────────────
    function mint(address to, uint256 amount) external onlyOwner {
        require(!mintingDisabled, "Minting disabled");
        _mint(to, amount);
    }

    // ─── Lock supply permanently ─────────────────────────────────────
    function disableMinting() external onlyOwner {
        mintingDisabled = true;
        emit MintingDisabled();
    }
}
