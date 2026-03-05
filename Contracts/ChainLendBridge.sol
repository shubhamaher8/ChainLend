// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "https://raw.githubusercontent.com/LayerZero-Labs/devtools/main/packages/oapp-evm/contracts/oapp/OApp.sol";
import "https://raw.githubusercontent.com/LayerZero-Labs/devtools/main/packages/oapp-evm/contracts/oapp/libs/OptionsBuilder.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface ILendingPool {
    function lockCollateral(address user, uint256 amount) external;
    function unlockCollateral(address user, uint256 amount) external;
    function borrow(address user, uint256 amount) external;
    function repay() external;
}

contract ChainLendBridge is OApp {
    using OptionsBuilder for bytes;

    uint8 public constant MSG_LOCK_COLLATERAL   = 1;
    uint8 public constant MSG_COLLATERAL_LOCKED = 2;
    uint8 public constant MSG_UNLOCK_COLLATERAL = 3;

    ILendingPool public lendingPool;
    uint32 public remoteEid;
    uint128 public constant DESTINATION_GAS_LIMIT = 200_000;

    event BorrowRequested(address indexed user, uint256 amount, uint256 collateralRequired);
    event CollateralLockConfirmed(address indexed user, uint256 amount);
    event RepayAndUnlockInitiated(address indexed user, uint256 collateralAmount);
    event CollateralUnlocked(address indexed user, uint256 amount);

    error LendingPoolNotSet();
    error RemoteEidNotSet();
    error UnknownMessageType(uint8 msgType);
    error InsufficientFee(uint256 required, uint256 provided);

    constructor(address _endpoint, address _delegate)
        OApp(_endpoint, _delegate)
        Ownable(_delegate)
    {}

    function setLendingPool(address _pool) external onlyOwner {
        require(_pool != address(0), "Zero address");
        lendingPool = ILendingPool(_pool);
    }

    function setRemoteEid(uint32 _eid) external onlyOwner {
        remoteEid = _eid;
    }

    function requestBorrow(uint256 borrowAmount) external payable {
        if (address(lendingPool) == address(0)) revert LendingPoolNotSet();
        if (remoteEid == 0) revert RemoteEidNotSet();

        uint256 collateralRequired = borrowAmount * 2;

        bytes memory payload = abi.encode(
            MSG_LOCK_COLLATERAL,
            msg.sender,
            collateralRequired,
            borrowAmount
        );

        bytes memory options = OptionsBuilder
            .newOptions()
            .addExecutorLzReceiveOption(DESTINATION_GAS_LIMIT, 0);

        MessagingFee memory fee = _quote(remoteEid, payload, options, false);
        if (msg.value < fee.nativeFee) revert InsufficientFee(fee.nativeFee, msg.value);

        _lzSend(remoteEid, payload, options, fee, payable(msg.sender));

        emit BorrowRequested(msg.sender, borrowAmount, collateralRequired);
    }

    function quoteBorrow(uint256 borrowAmount) external view returns (uint256 nativeFee) {
        uint256 collateralRequired = borrowAmount * 2;
        bytes memory payload = abi.encode(
            MSG_LOCK_COLLATERAL,
            msg.sender,
            collateralRequired,
            borrowAmount
        );
        bytes memory options = OptionsBuilder
            .newOptions()
            .addExecutorLzReceiveOption(DESTINATION_GAS_LIMIT, 0);

        MessagingFee memory fee = _quote(remoteEid, payload, options, false);
        return fee.nativeFee;
    }

    function repayAndUnlock(uint256 collateralAmount) external payable {
        if (address(lendingPool) == address(0)) revert LendingPoolNotSet();
        if (remoteEid == 0) revert RemoteEidNotSet();

        lendingPool.repay();

        bytes memory payload = abi.encode(
            MSG_UNLOCK_COLLATERAL,
            msg.sender,
            collateralAmount
        );

        bytes memory options = OptionsBuilder
            .newOptions()
            .addExecutorLzReceiveOption(DESTINATION_GAS_LIMIT, 0);

        MessagingFee memory fee = _quote(remoteEid, payload, options, false);
        if (msg.value < fee.nativeFee) revert InsufficientFee(fee.nativeFee, msg.value);

        _lzSend(remoteEid, payload, options, fee, payable(msg.sender));

        emit RepayAndUnlockInitiated(msg.sender, collateralAmount);
    }

    function _lzReceive(
        Origin calldata _origin,
        bytes32,
        bytes calldata payload,
        address,
        bytes calldata
    ) internal override {
        uint8 msgType = uint8(payload[0]);

        if (msgType == MSG_LOCK_COLLATERAL) {
            (, address user, uint256 collateralAmount, uint256 borrowAmount) =
                abi.decode(payload, (uint8, address, uint256, uint256));

            lendingPool.lockCollateral(user, collateralAmount);

            bytes memory confirmPayload = abi.encode(
                MSG_COLLATERAL_LOCKED,
                user,
                collateralAmount,
                borrowAmount
            );
            bytes memory options = OptionsBuilder
                .newOptions()
                .addExecutorLzReceiveOption(DESTINATION_GAS_LIMIT, 0);

            MessagingFee memory fee = _quote(_origin.srcEid, confirmPayload, options, false);
            _lzSend(_origin.srcEid, confirmPayload, options, fee, payable(address(this)));

            emit CollateralLockConfirmed(user, collateralAmount);

        } else if (msgType == MSG_COLLATERAL_LOCKED) {
            (, address user, , uint256 borrowAmount) =
                abi.decode(payload, (uint8, address, uint256, uint256));

            lendingPool.borrow(user, borrowAmount);

        } else if (msgType == MSG_UNLOCK_COLLATERAL) {
            (, address user, uint256 collateralAmount) =
                abi.decode(payload, (uint8, address, uint256));

            lendingPool.unlockCollateral(user, collateralAmount);

            emit CollateralUnlocked(user, collateralAmount);

        } else {
            revert UnknownMessageType(msgType);
        }
    }

    receive() external payable {}

    function withdrawNative(address payable to, uint256 amount) external onlyOwner {
        (bool ok,) = to.call{value: amount}("");
        require(ok, "Transfer failed");
    }
}