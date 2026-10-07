// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ChainBlocks} from "./ChainBlocks.sol";

/// Authentic historical hashes, NOT finality or dataset admission.
/// Checkpointing occupies no draw slot and gives the caller no rights.
abstract contract CutoffHistory {
    mapping(uint256 => bytes32) public cutoffHashes;
    event CutoffCheckpointed(uint256 indexed number, bytes32 hash);

    function checkpointCutoff(uint256 number) external returns (bytes32 hash) {
        hash = cutoffHashes[number];
        if (hash != bytes32(0)) return hash; // Idempotent, including after aging.
        hash = ChainBlocks.recentHash(number);
        require(hash != bytes32(0), "cutoff history");
        cutoffHashes[number] = hash;
        emit CutoffCheckpointed(number, hash);
    }

    function validCutoff(uint256 number, bytes32 hash) public view returns (bool) {
        return hash != bytes32(0) && number < ChainBlocks.number()
            && (cutoffHashes[number] == hash || ChainBlocks.recentHash(number) == hash);
    }
}
