// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Append-only evidence commitments; no funds, ticket amounts or backdating.
/// @dev Readers must independently validate every purchase in the committed bundle.
contract PurchaseRecognitionSource {
    bytes32 public immutable instanceId;
    address public immutable publisher;
    uint256 public immutable availableAt;
    mapping(bytes32 => bool) public published;
    event PurchasesRecognized(bytes32 indexed instanceId, bytes32 indexed bundleHash, uint256 count);
    error InvalidBatch();
    error Unauthorized();
    constructor(bytes32 instance, address author) {
        if (instance == bytes32(0) || author == address(0)) revert InvalidBatch();
        instanceId = instance;
        publisher = author;
        availableAt = block.timestamp + 1 days;
    }
    function confirm(bytes32 bundleHash, uint256 count) external {
        if (msg.sender != publisher) revert Unauthorized();
        if (block.timestamp < availableAt || bundleHash == bytes32(0) || count == 0 || count > 50 || published[bundleHash]) revert InvalidBatch();
        published[bundleHash] = true;
        emit PurchasesRecognized(instanceId, bundleHash, count);
    }
}
