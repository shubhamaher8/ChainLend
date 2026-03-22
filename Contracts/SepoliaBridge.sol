// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { OApp, MessagingFee, Origin } from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";
import { MessagingReceipt } from "@layerzerolabs/oapp-evm/contracts/oapp/OAppSender.sol";
import { OptionsBuilder } from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OptionsBuilder.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

interface ISepoliaLendingPool {
    function repay(address user) external;
    function loans(address user) external view returns (uint256 principal, bool active);
    function getRepayAmount(address user) external view returns (uint256);
}

/**
 * @title SepoliaChainLendBridge
 * @notice Sends ONE-WAY LayerZero messages from Sepolia → Amoy.
 * @dev MSG_BORROW_REQUEST: signals Amoy to lock user collateral.
 *      MSG_REPAY_UNLOCK:   signals Amoy to unlock user collateral after repay.
 *      No messages are received (Amoy never sends back — one-way arch).
 */
contract ChainLendBridge is OApp {
    using OptionsBuilder for bytes;

    // ─── Message Types ───────────────────────────────────────────────
    uint8 public constant MSG_BORROW_REQUEST = 1; // → Amoy: lock collateral
    uint8 public constant MSG_REPAY_UNLOCK   = 3; // → Amoy: unlock collateral

    // ─── State ───────────────────────────────────────────────────────
    ISepoliaLendingPool public lendingPool;
    uint32  public amoyEid;               // Amoy endpoint ID = 40267
    uint128 public lzGasLimit = 300_000;  // gas for Amoy _lzReceive

    // ─── Events ──────────────────────────────────────────────────────
    event BorrowRequested(address indexed user, uint256 amount, bytes32 guid);
    event RepayUnlockSent(address indexed user, uint256 principal, bytes32 guid);
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
     * @dev Frontend calls this BEFORE borrow() or repayAndUnlock().
     *      Always add 20% buffer to returned value: fee * 120 / 100.
     */
    function quote(
        uint8   msgType,
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
     * @notice Sends borrow request to Amoy via LayerZero.
     * @dev msg.value must be >= quote(1, user, amount) + 20% buffer.
     *      Amoy will lock amount*2 as collateral (50% LTV).
     *      After sending, frontend polls Amoy locked[user] every 10 seconds.
     *      When lock detected, frontend calls SepoliaLendingPool.adminReleaseLoan().
     * @param amount Amount to borrow in sUSDC (6 decimals).
     *               Amoy will lock amount*2 mUSDC as collateral.
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
            payable(msg.sender) // refund excess fee to user
        );

        emit BorrowRequested(msg.sender, amount, receipt.guid);
        return receipt.guid;
    }

    // ─── Repay: Collect tokens + Send MSG_REPAY_UNLOCK to Amoy ───────
    /**
     * @notice User repays loan on Sepolia, triggers Amoy collateral unlock.
     * @dev msg.value must be >= quote(3, user, principal) + 20% buffer.
     *      Reads principal from LendingPool internally — user passes no amount.
     *      LendingPool.repay(user) pulls principal + 10 sUSDC flat fee from user.
     *      User must approve SepoliaLendingPool for (principal + 10e6) before calling.
     *      CRITICAL: msg.value forwarded explicitly to _lzSend.
     *                If omitted, bridge gets 0 ETH → NotEnoughNative error.
     */
    function repayAndUnlock() external payable {
        require(amoyEid != 0, "Amoy EID not set");
        require(address(lendingPool) != address(0), "LendingPool not set");
        require(msg.value > 0, "Must pay LayerZero fee");

        // Read principal from pool — no user input needed
        (uint256 principal, bool active) = lendingPool.loans(msg.sender);
        require(active, "No active loan");
        require(principal > 0, "Zero principal");

        // Step 1: Collect repayment on Sepolia
        // Bridge passes msg.sender as user — pool sees bridge as caller
        // so user address must be passed explicitly (not msg.sender inside pool)
        lendingPool.repay(msg.sender);

        // Step 2: Send unlock signal to Amoy via LayerZero
        // Pass principal so Amoy knows how much to unlock (amount*2)
        bytes memory payload = abi.encode(MSG_REPAY_UNLOCK, msg.sender, principal);
        bytes memory options = OptionsBuilder
            .newOptions()
            .addExecutorLzReceiveOption(lzGasLimit, 0);

        MessagingReceipt memory receipt = _lzSend(
            amoyEid,
            payload,
            options,
            MessagingFee(msg.value, 0), // msg.value forwarded explicitly
            payable(msg.sender)
        );

        emit RepayUnlockSent(msg.sender, principal, receipt.guid);
    }

    // ─── Receive (not used — required by OApp interface) ─────────────
    /**
     * @dev Amoy never sends messages back in one-way architecture.
     *      Safety revert if somehow called.
     */
    function _lzReceive(
        Origin calldata,
        bytes32,
        bytes calldata,
        address,
        bytes calldata
    ) internal pure override {
        revert("Sepolia bridge does not receive messages");
    }

    // ─── Required by OApp ────────────────────────────────────────────
    receive() external payable {}
}
