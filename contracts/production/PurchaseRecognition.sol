// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Append-only purchase evidence, not ticket issuance. Readers independently verify
/// buys and credit at the finalized confirmation block, never in an old snapshot.
contract PurchaseRecognition {
    bytes32 public immutable instanceId;
    address public immutable publisher;
    uint256 public immutable availableAt;
    mapping(bytes32 => bool) public confirmed;
    event PurchasesRecognized(bytes32 indexed instanceId, bytes32 indexed bundleHash, uint256 count);
    constructor(bytes32 instance, address author) {
        require(block.chainid == 4663, "chain 4663");
        require(instance != bytes32(0) && author != address(0), "binding");
        instanceId = instance; publisher = author;
        availableAt = block.timestamp + 1 days; // Same notice as QIANQI.
    }
    function confirm(bytes32 bundleHash, uint256 count) external {
        require(msg.sender == publisher, "publisher");
        require(block.timestamp >= availableAt && bundleHash != bytes32(0) && count > 0 && count <= 50 && !confirmed[bundleHash], "batch/notice");
        confirmed[bundleHash] = true;
        emit PurchasesRecognized(instanceId, bundleHash, count);
    }
}
