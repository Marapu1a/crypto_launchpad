// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// TEST ONLY: unrestricted event publisher, deliberately capable of invalid histories.
/// Never use as a production controller, randomness verifier or prize authority.
contract AttemptLifecycleFixture {
    event AttemptsFrozen(bytes32 indexed drawId, uint8 indexed kind, uint256 cutoffBlockNumber,
        bytes32 cutoffBlockHash, bytes32 rulesHash, bytes32 snapshotHash);
    event AttemptsConsumed(bytes32 indexed drawId, uint8 indexed kind, bytes32 snapshotHash,
        uint8 outcome, bytes32 resultHash);

    function freeze(bytes32 drawId, uint8 kind, uint256 cutoffBlockNumber,
        bytes32 cutoffBlockHash, bytes32 rulesHash, bytes32 snapshotHash) external {
        emit AttemptsFrozen(drawId, kind, cutoffBlockNumber, cutoffBlockHash, rulesHash, snapshotHash);
    }

    function terminal(bytes32 drawId, uint8 kind, bytes32 snapshotHash, uint8 outcome, bytes32 resultHash) external {
        emit AttemptsConsumed(drawId, kind, snapshotHash, outcome, resultHash);
    }
}
