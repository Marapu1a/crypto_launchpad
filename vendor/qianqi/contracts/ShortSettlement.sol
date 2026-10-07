// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ShortRulesEpochs} from "./ShortRulesEpochs.sol";
import {ShortOutcome} from "./ShortOutcome.sol";

/// Internal integration component, NOT a deployable production controller.
/// The controller must authenticate a single RNG delivery bound to drawId and
/// enforce publisher, budget and pre-freeze execution readiness policies.
abstract contract ShortSettlement is ShortRulesEpochs {
    enum SettlementPhase { None, WaitingSeed, Processing, Terminal }
    struct Settlement {
        bytes32 proposalId;
        SettlementPhase phase;
        bytes32 seed;
        uint256 nextChunk;
        uint256 processed;
        uint256 admitted;
    }
    mapping(bytes32 => Settlement) public settlements;
    mapping(bytes32 => ShortOutcome.Candidate[]) private best;
    event ShortSeedAccepted(bytes32 indexed drawId, bytes32 seed);
    event ShortProgress(bytes32 indexed drawId, uint256 nextChunk, uint256 processed, uint256 admitted);

    constructor(address vault, address registry, bytes32 instance, uint256 notice,
        ShortOutcome.Rules memory rules, uint256[] memory weights, uint256 minimumUnit)
        ShortRulesEpochs(vault, registry, instance, notice, rules, weights, minimumUnit) {}

    function _sealShortDraw(bytes32 proposalId) internal {
        Proposal memory p = datasetProposal(proposalId);
        _sealEpochDataset(proposalId);
        // No external calls after the guarded atomic reserve and epoch binding.
        settlements[p.request.drawId] = Settlement(proposalId, SettlementPhase.WaitingSeed, bytes32(0), 0, 0, 0);
    }

    /// Only an authenticated RNG adapter may expose this hook. Zero is a valid seed.
    function _acceptShortSeed(bytes32 drawId, bytes32 seed) internal nonReentrant {
        Settlement storage s = settlements[drawId];
        require(pendingDatasetDraw == drawId && s.phase == SettlementPhase.WaitingSeed, "seed phase");
        s.seed = seed; s.phase = SettlementPhase.Processing;
        emit ShortSeedAccepted(drawId, seed);
    }

    function processShort(bytes32 drawId, uint256 index, ShortOutcome.Participant[] calldata chunk) external nonReentrant {
        Settlement storage s = settlements[drawId];
        require(s.phase == SettlementPhase.Processing && pendingDatasetDraw == drawId
            && index == s.nextChunk && index < datasetChunkCount(s.proposalId), "progress");
        require(chunk.length > 0 && chunk.length <= MAX_DATASET_CHUNK
            && keccak256(abi.encode(chunk)) == datasetChunkHash(s.proposalId, index), "chunk");
        Proposal memory p = datasetProposal(s.proposalId);
        uint256 k = datasetBasket(s.proposalId).length;
        (ShortOutcome.Candidate[] memory candidates, uint256 admitted) = ShortOutcome.selectTopK(
            p.context, s.seed, chunk, shortEpochPolicy(p.request.rulesEpoch).outcome, k);
        _merge(drawId, candidates, admitted < k ? admitted : k, k);
        s.admitted += admitted; s.processed += chunk.length; ++s.nextChunk;
        emit ShortProgress(drawId, s.nextChunk, s.processed, s.admitted);
    }

    // A participant outside its chunk's top K cannot belong to the global top K.
    function _merge(bytes32 drawId, ShortOutcome.Candidate[] memory fresh, uint256 freshCount, uint256 k) private {
        ShortOutcome.Candidate[] storage previous = best[drawId];
        uint256 length = previous.length + freshCount;
        if (length > k) length = k;
        ShortOutcome.Candidate[] memory merged = new ShortOutcome.Candidate[](length);
        uint256 a; uint256 b;
        for (uint256 i; i < length; ++i) {
            if (a < previous.length && (b == freshCount || previous[a].rank < fresh[b].rank
                || (previous[a].rank == fresh[b].rank && previous[a].wallet < fresh[b].wallet))) merged[i] = previous[a++];
            else merged[i] = fresh[b++];
        }
        for (uint256 i; i < length; ++i) {
            if (i < previous.length) previous[i] = merged[i]; else previous.push(merged[i]);
        }
    }

    function shortResult(bytes32 drawId) public view returns (ShortOutcome.Result memory out) {
        Settlement storage s = settlements[drawId];
        Proposal memory p = datasetProposal(s.proposalId);
        require((s.phase == SettlementPhase.Processing || s.phase == SettlementPhase.Terminal)
            && s.nextChunk == datasetChunkCount(s.proposalId) && s.processed == p.count, "unfinished");
        uint256[] memory prizes = datasetBasket(s.proposalId);
        uint256[] memory slots = new uint256[](prizes.length);
        uint256[] memory ranks = new uint256[](prizes.length);
        for (uint256 i; i < prizes.length; ++i) {
            uint256 rank = uint256(keccak256(abi.encode(keccak256("SHORT_PRIZE_ORDER_V1"), p.context, s.seed, i)));
            uint256 j = i;
            while (j > 0 && rank < ranks[j - 1]) { ranks[j] = ranks[j - 1]; slots[j] = slots[j - 1]; --j; }
            ranks[j] = rank; slots[j] = i;
        }
        ShortOutcome.Candidate[] storage winners = best[drawId];
        out.winners = new address[](winners.length);
        out.amounts = new uint256[](winners.length);
        out.prizeIndices = new uint256[](winners.length);
        for (uint256 i; i < winners.length; ++i) {
            out.winners[i] = winners[i].wallet; out.prizeIndices[i] = slots[i]; out.amounts[i] = prizes[slots[i]];
        }
        out.admittedCount = s.admitted;
        // Canonical dataset root, NOT legacy flat ABI hash or study-only domains.
        out.resultHash = keccak256(abi.encode(keccak256("SHORT_DATASET_RESULT_V1"), p.context, s.seed,
            p.root, ShortOutcome.rulesHash(shortEpochPolicy(p.request.rulesEpoch).outcome), p.basketHash, out));
    }

    function finishShort(bytes32 drawId) external nonReentrant {
        require(settlements[drawId].phase == SettlementPhase.Processing, "phase");
        ShortOutcome.Result memory out = shortResult(drawId);
        datasetVault.finalize(drawId, out.winners, out.amounts);
        _completeEpochDraw(drawId, out.winners.length == 0 ? 0 : 1, out.resultHash);
        settlements[drawId].phase = SettlementPhase.Terminal;
    }
}
