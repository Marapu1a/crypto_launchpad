// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Local rehearsal commitment only. The indexer must independently verify purchases.
contract LocalPurchaseRecognition {
    bytes32 public immutable instanceId;
    address public immutable publisher;
    mapping(bytes32 => bool) public confirmed;
    event PurchasesRecognized(bytes32 indexed instanceId, bytes32 indexed bundleHash, uint256 count);

    constructor(bytes32 instanceId_, address publisher_) {
        require(block.chainid == 31337, "local only");
        require(instanceId_ != bytes32(0) && publisher_ != address(0), "config");
        instanceId = instanceId_;
        publisher = publisher_;
    }

    function confirm(bytes32 bundleHash, uint256 count) external {
        require(msg.sender == publisher, "publisher");
        require(bundleHash != bytes32(0) && !confirmed[bundleHash] && count > 0 && count <= 50, "bundle");
        confirmed[bundleHash] = true;
        emit PurchasesRecognized(instanceId, bundleHash, count);
    }
}
