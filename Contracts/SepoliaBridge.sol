// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { OApp, MessagingFee, Origin } from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";
import { MessagingReceipt } from "@layerzerolabs/oapp-evm/contracts/oapp/OAppSender.sol";
import { OptionsBuilder } from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OptionsBuilder.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

interface ISepoliaLendingPool {
    function repay(address user, uint256 amount) external; // pass user explicitly
    function getDebt(address user) external view returns (uint256);
    function loans(address user) external view returns (uint256 principal, uint256 interestSnapshot, uint256 lastSnapshotTime);
}

/**
 * @title SepoliaChainLendBridge
 * @notice Sends ONE-WAY LayerZero messages from Sepolia → Amoy.
 * @dev MSG_BORROW_REQUEST: signals Amoy to lock user collateral.
 *      MSG_REPAY_UNLOCK: signals Amoy to unlock user collateral after repay.
 *      No messages are received (Amoy never sends back in simplified arch).
 */
contract ChainLendBridge is OApp {
    using OptionsBuilder for bytes;

    // ─── Message Types ───────────────────────────────────────────────
    uint8 public constant MSG_BORROW_REQUEST = 1; // → Amoy: lock collateral
    uint8 public constant MSG_REPAY_UNLOCK   = 3; // → Amoy: unlock collateral

    // ─── State ───────────────────────────────────────────────────────
    ISepoliaLendingPool public lendingPool;
    uint32 public amoyEid;               // Amoy endpoint ID = 40267
    uint128 public lzGasLimit = 300_000; // gas for Amoy _lzReceive

    // ─── Events ──────────────────────────────────────────────────────
    event BorrowRequested(address indexed user, uint256 amount, bytes32 guid);
    event RepayUnlockSent(address indexed user, uint256 amount, bytes32 guid);
    event LendingPoolSet(address indexed pool);
    event AmoyEidSet(uint32 eid);

    // ─── Constructor ─────────────────────────────────────────────────
    constructor(
        address _endpoint,
        address _delegate
    ) OApp(_endpoint, _delegate) Ownable(_delegate) {}

    // ─── Admin ───────────────────────────────────────────────────────
    function setLendingPool(address _pool) external onlyOwner {
        require(_pool != address(0), "Zero address");
        lendingPool = ISepoliaLendingPool(_pool);
        emit LendingPoolSet(_pool);
    }

    function setAmoyEid(uint32 _eid) external onlyOwner {
        amoyEid = _eid;
        emit AmoyEidSet(_eid);
    }

    function setGasLimit(uint128 _gas) external onlyOwner {
        require(_gas >= 200_000, "Gas too low");
        lzGasLimit = _gas;
    }

    // ─── Quote Fee ───────────────────────────────────────────────────
    /**
     * @notice Get the LayerZero fee for sending a message to Amoy.
     * @dev Frontend calls this FIRST before calling borrow() or repayAndUnlock().
     */
    function quote(
        uint8 msgType,
        address user,
        uint256 amount
    ) external view returns (uint256 nativeFee) {
        bytes memory payload = abi.encode(msgType, user, amount);
        bytes memory options = OptionsBuilder
            .newOptions()
            .addExecutorLzReceiveOption(lzGasLimit, 0);

        MessagingFee memory fee = _quote(amoyEid, payload, options, false);
        return fee.nativeFee;
    }

    // ─── Borrow: Send MSG_BORROW_REQUEST to Amoy ─────────────────────
    /**
     * @notice Sends a borrow request to Amoy via LayerZero.
     * @dev msg.value must equal quote(MSG_BORROW_REQUEST, user, amount).
     *      After sending, frontend polls Amoy locked[user] every 10 seconds.
     *      When lock detected, frontend calls SepoliaLendingPool.adminReleaseLoan().
     * @param amount Amount of collateral to lock on Amoy (in mUSDC, 6 decimals).
     */
    function requestBorrow(uint256 amount) external payable returns (bytes32 guid) {
        require(amoyEid != 0, "Amoy EID not set");
        require(address(lendingPool) != address(0), "LendingPool not set");
        require(amount > 0, "Zero amount");
        require(msg.value > 0, "Must pay LayerZero fee");

        bytes memory payload = abi.encode(MSG_BORROW_REQUEST, msg.sender, amount);
        bytes memory options = OptionsBuilder
            .newOptions()
            .addExecutorLzReceiveOption(lzGasLimit, 0);

        MessagingReceipt memory receipt = _lzSend(
            amoyEid,
            payload,
            options,
            MessagingFee(msg.value, 0),
            payable(msg.sender)    // refund excess fee to user
        );

        emit BorrowRequested(msg.sender, amount, receipt.guid);
        return receipt.guid;
    }

    // ─── Repay: Collect tokens + Send MSG_REPAY_UNLOCK to Amoy ──────
    /**
     * @notice User repays loan on Sepolia, triggers Amoy collateral unlock.
     * @dev msg.value must equal quote(MSG_REPAY_UNLOCK, user, amount).
     *      LendingPool.repay() handles token collection.
     *      This function sends the LZ unlock signal to Amoy.
     * @param amount The principal amount to unlock on Amoy.
     */
    function repayAndUnlock(uint256 amount) external payable {
        require(amoyEid != 0, "Amoy EID not set");
        require(address(lendingPool) != address(0), "LendingPool not set");
        require(amount > 0, "Zero amount");
        require(msg.value > 0, "Must pay LayerZero fee");

        // Step 1: Collect repayment on Sepolia (pass msg.sender — bridge is caller, not user)
        lendingPool.repay(msg.sender, amount);

        // Step 2: Send unlock signal to Amoy via LayerZero
        bytes memory payload = abi.encode(MSG_REPAY_UNLOCK, msg.sender, amount);
        bytes memory options = OptionsBuilder
            .newOptions()
            .addExecutorLzReceiveOption(lzGasLimit, 0);

        MessagingReceipt memory receipt = _lzSend(
            amoyEid,
            payload,
            options,
            MessagingFee(msg.value, 0),
            payable(msg.sender)
        );

        emit RepayUnlockSent(msg.sender, amount, receipt.guid);
    }

    // ─── Receive (not used in one-way arch — but required by OApp) ───
    /**
     * @dev Amoy never sends messages back in simplified architecture.
     *      This is a safety stub — reverts if somehow called.
     */
    function _lzReceive(
        Origin calldata /*_origin*/,
        bytes32 /*_guid*/,
        bytes calldata /*_message*/,
        address /*_executor*/,
        bytes calldata /*_extraData*/
    ) internal pure override {
        revert("Sepolia bridge does not receive messages");
    }

    // ─── Required by OApp ────────────────────────────────────────────
    receive() external payable {}
}
