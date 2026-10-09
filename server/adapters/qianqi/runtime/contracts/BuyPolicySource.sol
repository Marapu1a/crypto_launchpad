// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ChainBlocks} from "./ChainBlocks.sol";

/// @notice Append-only route activation commitments. No JSON, custody or reset.
/// @dev Adapter ids commit versioned specifications, not proof of decoder correctness.
contract BuyPolicySource {
    uint256 public constant SCHEMA_VERSION = 1;
    bytes32 public immutable instanceId;
    bytes32 public immutable genesisHash;
    bytes32 public immutable genesisAdaptersHash;
    address public immutable publisher;
    uint256 public immutable noticeBlocks;
    bytes32 public currentHash;
    uint256 public lastFromBlock;
    uint256 public publishedCount;
    mapping(bytes32 => bool) public announced;
    event BuyPolicyAnnounced(bytes32 indexed instanceId, bytes32 indexed previousHash,
        bytes32 indexed nextHash, bytes32 adapterId, uint256 fromBlock);
    error InvalidPolicy();
    error Unauthorized();
    constructor(bytes32 instance, bytes32 genesis, address author, uint256 notice, bytes32[] memory initialAdapters) {
        if(instance == bytes32(0) || genesis == bytes32(0) || author == address(0) || notice == 0 || initialAdapters.length == 0) revert InvalidPolicy();
        for(uint256 i; i < initialAdapters.length; ++i) {
            if(initialAdapters[i] == bytes32(0) || announced[initialAdapters[i]]) revert InvalidPolicy();
            announced[initialAdapters[i]] = true;
        }
        instanceId=instance; genesisHash=genesis; currentHash=genesis;
        genesisAdaptersHash=keccak256(abi.encode(initialAdapters));
        publisher=author; noticeBlocks=notice;
    }
    function announce(bytes32 previousHash, bytes32 adapterId, uint256 fromBlock) external {
        if(msg.sender != publisher) revert Unauthorized();
        if(previousHash != currentHash || adapterId == bytes32(0) || announced[adapterId] ||
            fromBlock > 9007199254740991 || fromBlock < ChainBlocks.number() + noticeBlocks ||
            fromBlock <= lastFromBlock || ChainBlocks.number() < lastFromBlock) revert InvalidPolicy();
        bytes32 nextHash=keccak256(abi.encode(previousHash, SCHEMA_VERSION, adapterId, fromBlock));
        announced[adapterId]=true;
        currentHash=nextHash; lastFromBlock=fromBlock; ++publishedCount;
        emit BuyPolicyAnnounced(instanceId,previousHash,nextHash,adapterId,fromBlock);
    }
}
