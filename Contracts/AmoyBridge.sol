// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { OApp, MessagingFee, Origin } from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";
import { MessagingReceipt } from "@layerzerolabs/oapp-evm/contracts/oapp/OAppSender.sol";
import { OptionsBuilder } from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OptionsBuilder.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

interface IAmoyLendingPool {
    function lock(address user, uint256 amount) external;
    function unlock(address user, uint256 amount) external;
}

contract ChainLendBridge is OApp {
    using OptionsBuilder for bytes;

    // ─── Message Types ───────────────────────────────────────────────
    uint8 public constant MSG_BORROW_REQUEST = 1; // Sepolia → Amoy
    uint8 public constant MSG_REPAY_UNLOCK   = 3; // Sepolia → Amoy

    // ─── State ───────────────────────────────────────────────────────
    IAmoyLendingPool public lendingPool;

    // ─── Events ──────────────────────────────────────────────────────
    event BorrowRequestReceived(address indexed user, uint256 amount);
    event RepayUnlockReceived(address indexed user, uint256 amount);
    event LockFailed(address indexed user, uint256 amount);
    event UnlockFailed(address indexed user, uint256 amount);
    event LendingPoolSet(address indexed lendingPool);

    // ─── Constructor ─────────────────────────────────────────────────
    constructor(
        address _endpoint,
        address _delegate
    ) OApp(_endpoint, _delegate) Ownable(_delegate) {}

    // ─── Admin ───────────────────────────────────────────────────────
    function setLendingPool(address _lendingPool) external onlyOwner {
        require(_lendingPool != address(0), "Zero address");
        lendingPool = IAmoyLendingPool(_lendingPool);
        emit LendingPoolSet(_lendingPool);
    }

    // ─── Receive (LayerZero calls this) ──────────────────────────────
    /**
     * @notice Called by LayerZero endpoint when a message arrives from Sepolia.
     * @dev ONE-WAY ONLY. No _lzSend back. Just lock or unlock.
     */
    function _lzReceive(
        Origin calldata _origin,
        bytes32 /*_guid*/,
        bytes calldata _message,
        address /*_executor*/,
        bytes calldata /*_extraData*/
    ) internal override {
        require(address(lendingPool) != address(0), "LendingPool not set");

        // Decode the payload
        (uint8 msgType, address user, uint256 amount) = abi.decode(
            _message,
            (uint8, address, uint256)
        );

        if (msgType == MSG_BORROW_REQUEST) {
            // Lock 2x amount on Amoy to enforce 50% LTV.
            // User borrows 500 sUSDC → lock 1000 mUSDC collateral.
            // try/catch: if lock() fails, DO NOT revert.
            // A revert here permanently blocks the LZ channel.
            try lendingPool.lock(user, amount * 2) {
                emit BorrowRequestReceived(user, amount);
            } catch {
                // Lock failed (e.g. insufficient deposit).
                // Channel stays open. Frontend will see locked[user] unchanged
                // and can show an error to the user.
                emit LockFailed(user, amount);
            }

            // ─────────────────────────────────────────────────────────
            // NO _lzSend back to Sepolia.
            // Frontend polls locked[user] on Amoy to detect delivery.
            // adminReleaseLoan() on Sepolia is called by frontend owner.
            // ─────────────────────────────────────────────────────────

        } else if (msgType == MSG_REPAY_UNLOCK) {
            // Unlock 2x amount to match what was locked (50% LTV).
            try lendingPool.unlock(user, amount * 2) {
                emit RepayUnlockReceived(user, amount);
            } catch {
                // Unlock failed. Channel stays open.
                emit UnlockFailed(user, amount);
            }

        }
        // Unknown message types are silently ignored — never revert.
    }

    // ─── Fee Estimation (useful for frontend) ────────────────────────
    /**
     * @notice Estimate fee for a message coming FROM Sepolia.
     * @dev Sepolia bridge uses this pattern — kept here for symmetry.
     */
    function estimateFee(
        uint32 _dstEid,
        bytes calldata _message
    ) external view returns (uint256 nativeFee) {
        bytes memory options = OptionsBuilder
            .newOptions()
            .addExecutorLzReceiveOption(300_000, 0);

        MessagingFee memory fee = _quote(_dstEid, _message, options, false);
        return fee.nativeFee;
    }

    // ─── Required by OApp ────────────────────────────────────────────
    receive() external payable {}
}
