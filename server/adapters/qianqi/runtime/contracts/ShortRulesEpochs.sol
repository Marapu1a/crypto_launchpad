// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ChainBlocks} from "./ChainBlocks.sol";
import {ShortDatasetPreparation} from "./ShortDatasetPreparation.sol";
import {ShortOutcome} from "./ShortOutcome.sol";
import {ShortPrizeBasket} from "./ShortPrizeBasket.sol";
import {PromoVault} from "./PromoVault.sol";

/// Internal policy component. Full controller must authenticate settlement and
/// enforce funding/finality/publisher policy. Empty assertions need public replay.
abstract contract ShortRulesEpochs is ShortDatasetPreparation {
    uint256 public constant SHORT_INTERVAL = 6 hours;
    uint256 public immutable shortRulesNotice;
    uint256 public immutable shortRulesStartedAt;
    uint64 public currentShortEpoch = 1;
    uint64 public drainingShortEpoch;
    uint64 public announcedShortEpoch;
    uint256 public rulesEligibleAt;
    uint256 public lastShortTerminalAt;
    uint256 public lastShortTerminalBlock;
    struct Policy { ShortOutcome.Rules outcome; uint256[] weights; uint256 minimumUnit; bytes32 hash; uint256 firstBlock; }
    mapping(uint64 => Policy) private policies;
    mapping(bytes32 => uint64) public drawShortEpoch;
    mapping(bytes32 => bytes32) private drawSnapshots;
    event ShortRulesAnnounced(uint64 indexed epoch, bytes32 rulesHash, uint256 eligibleAt);
    event ShortRulesPayload(uint64 indexed epoch, ShortOutcome.Rules outcome, uint256[] weights, uint256 minimumUnit);
    event ShortRulesActivated(uint64 indexed oldEpoch, uint64 indexed newEpoch, uint256 firstNewBlock);
    event ShortEpochEmpty(uint64 indexed epoch, uint256 cutoffBlockNumber, bytes32 cutoffBlockHash, bytes32 snapshotHash);
    event AttemptsConsumed(bytes32 indexed drawId, uint8 indexed kind, bytes32 snapshotHash, uint8 outcome, bytes32 resultHash);

    constructor(address vault, address registry, bytes32 instance, uint256 notice,
        ShortOutcome.Rules memory genesis, uint256[] memory weights, uint256 minimumUnit)
        ShortDatasetPreparation(vault, registry, instance) {
        require(notice > 0, "notice");
        shortRulesNotice = notice; shortRulesStartedAt = block.timestamp;
        lastShortTerminalAt = block.timestamp;
        _storePolicy(1, genesis, weights, minimumUnit); policies[1].firstBlock = ChainBlocks.number();
    }
    function shortEpochPolicy(uint64 epoch) public view returns (Policy memory) { return policies[epoch]; }
    function _storePolicy(uint64 epoch, ShortOutcome.Rules memory rules, uint256[] memory weights, uint256 minimumUnit) private {
        require(weights.length <= 64, "places");
        ShortPrizeBasket.build(type(uint256).max, weights, minimumUnit);
        bytes32 digest = keccak256(abi.encode(keccak256("SHORT_DATASET_RULES_V1"), ShortOutcome.rulesHash(rules), weights, minimumUnit));
        policies[epoch] = Policy(rules, weights, minimumUnit, digest, 0);
        emit ShortRulesPayload(epoch, rules, weights, minimumUnit);
    }
    function _announceShortRules(ShortOutcome.Rules memory rules, uint256[] memory weights, uint256 minimumUnit) internal nonReentrant {
        require(announcedShortEpoch == 0 && drainingShortEpoch == 0, "transition");
        uint64 next = currentShortEpoch + 1;
        _storePolicy(next, rules, weights, minimumUnit);
        announcedShortEpoch = next; rulesEligibleAt = block.timestamp + shortRulesNotice;
        emit ShortRulesAnnounced(next, policies[next].hash, rulesEligibleAt);
    }
    function _activateShortRules() internal nonReentrant {
        require(announcedShortEpoch != 0 && block.timestamp >= rulesEligibleAt, "notice");
        require(activeProposal == bytes32(0) && pendingDatasetDraw == bytes32(0)
            && block.timestamp >= lastShortTerminalAt + SHORT_INTERVAL, "busy/schedule");
        drainingShortEpoch = currentShortEpoch; currentShortEpoch = announcedShortEpoch;
        announcedShortEpoch = 0; rulesEligibleAt = 0;
        policies[currentShortEpoch].firstBlock = ChainBlocks.number() + 1;
        emit ShortRulesActivated(drainingShortEpoch, currentShortEpoch, ChainBlocks.number() + 1);
    }
    function _beginEpochDataset(bytes32 id, Request calldata r) internal {
        uint64 target = drainingShortEpoch != 0 ? drainingShortEpoch : currentShortEpoch;
        require(r.rulesEpoch == target && block.timestamp >= lastShortTerminalAt + SHORT_INTERVAL, "epoch/schedule");
        require(r.cutoffBlockNumber >= lastShortTerminalBlock && r.cutoffBlockNumber >= policies[target].firstBlock, "cutoff");
        if(drainingShortEpoch != 0) require(r.cutoffBlockNumber >= policies[currentShortEpoch].firstBlock, "boundary incomplete");
        Policy storage p = policies[target];
        _beginDataset(id, r, p.outcome, p.weights, p.minimumUnit);
    }
    function _sealEpochDataset(bytes32 id) internal {
        Proposal memory p = datasetProposal(id);
        _sealDataset(id);
        drawShortEpoch[p.request.drawId] = p.request.rulesEpoch;
        drawSnapshots[p.request.drawId] = p.request.snapshotHash;
    }
    /// Caller must be the authorized snapshot publisher, NOT arbitrary public user.
    /// A false empty assertion is detected by replay, not proven impossible on-chain.
    function _closeEmptyShortEpoch(uint256 cutoff, bytes32 cutoffHash, bytes32 snapshotHash) internal nonReentrant {
        require(drainingShortEpoch != 0 && activeProposal == bytes32(0) && pendingDatasetDraw == bytes32(0), "phase");
        require(cutoff >= policies[currentShortEpoch].firstBlock && validCutoff(cutoff, cutoffHash)
            && snapshotHash != bytes32(0), "cutoff");
        emit ShortEpochEmpty(drainingShortEpoch, cutoff, cutoffHash, snapshotHash); drainingShortEpoch = 0;
    }
    /// Called only after authenticated result and successful vault.finalize, in the
    /// SAME transaction. Never expose this hook as an unverified terminal endpoint.
    function _completeEpochDraw(bytes32 drawId, uint8 outcome, bytes32 resultHash) internal {
        require(drawId != bytes32(0) && pendingDatasetDraw == drawId && outcome <= 1 && resultHash != bytes32(0), "terminal");
        (,,PromoVault.Status status,,uint256 awarded,) = datasetVault.draws(drawId);
        require(status == PromoVault.Status.Finalized && (outcome == 0) == (awarded == 0), "unfinalized");
        pendingDatasetDraw = bytes32(0); lastShortTerminalAt = block.timestamp; lastShortTerminalBlock = ChainBlocks.number();
        if(drainingShortEpoch == drawShortEpoch[drawId]) drainingShortEpoch = 0;
        emit AttemptsConsumed(drawId, 0, drawSnapshots[drawId], outcome, resultHash);
    }
}
