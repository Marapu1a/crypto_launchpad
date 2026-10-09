// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PromoVault} from "../../contracts/PromoVault.sol";
import {ShortOutcome} from "../../contracts/ShortOutcome.sol";
import {ShortPrizeBasket} from "../../contracts/ShortPrizeBasket.sol";

/// @dev RESEARCH ONLY, single draw. Publisher injects seed; NO production RNG/auth.
/// No changes to production contracts. Chunk bound is experimental, not a wallet cap.
contract ShortStreamingStudy is ReentrancyGuard {
    enum Phase { Empty, Preparing, WaitingSeed, Processing, Terminal }
    uint256 public constant MAX_CHUNK = 64;
    bytes32 public constant EMPTY_ROOT = keccak256("SHORT_ORDERED_LIST_STUDY_V1");
    address public immutable publisher;
    PromoVault public immutable vault;
    Phase public phase;
    struct Setup {
        bytes32 drawId;
        bytes32 snapshotHash;
        bytes32 expectedRoot;
        uint256 expectedCount;
        uint256 cutoff;
        bytes32 cutoffHash;
        uint256 budget;
    }
    Setup public setup;
    ShortOutcome.Rules public rules;
    uint256[] private prizes;
    bytes32 public root = EMPTY_ROOT;
    uint256 public count;
    uint256 public totalAttempts;
    address public lastWallet;
    bytes32[] public chunkHashes;
    uint256 public nextChunk;
    uint256 public processed;
    uint256 public admitted;
    bytes32 public context;
    bytes32 public seed;
    ShortOutcome.Candidate[] private best;
    event ChunkPublished(uint256 indexed index, bytes32 hash, uint256 count, bytes32 root);
    event Sealed(bytes32 context, bytes32 root, uint256 count);
    event Progress(uint256 indexed index, uint256 processed, uint256 admitted);
    event AttemptsConsumed(bytes32 indexed drawId, uint8 indexed kind, bytes32 snapshotHash, uint8 outcome, bytes32 resultHash);

    constructor(address targetVault) { publisher = msg.sender; vault = PromoVault(targetVault); }
    modifier onlyPublisher() { require(msg.sender == publisher, "publisher"); _; }
    function begin(Setup calldata input, ShortOutcome.Rules calldata policy,
        uint256[] calldata weights, uint256 minimumUnit) external onlyPublisher nonReentrant
    {
        require(phase == Phase.Empty, "phase");
        require(input.drawId != bytes32(0) && input.snapshotHash != bytes32(0)
            && input.expectedRoot != bytes32(0) && input.budget > 0, "setup");
        require(input.cutoff < block.number && block.number - input.cutoff <= 256
            && input.cutoffHash != bytes32(0) && blockhash(input.cutoff) == input.cutoffHash, "cutoff");
        require(weights.length <= 64 && address(vault).code.length > 0
            && vault.drawController() == address(this), "binding/template");
        ShortOutcome.rulesHash(policy);
        (uint256[] memory basket,,) = ShortPrizeBasket.build(input.budget, weights, minimumUnit);
        setup = input;
        rules = policy;
        prizes = basket;
        phase = Phase.Preparing;
    }

    // Canonical order checked across all chunks; data lives in publication calldata.
    // No draw budget is reserved during publication.
    function publish(ShortOutcome.Participant[] calldata chunk) external onlyPublisher nonReentrant {
        require(phase == Phase.Preparing && chunk.length > 0 && chunk.length <= MAX_CHUNK, "chunk/phase");
        require(count + chunk.length <= setup.expectedCount, "count");
        for (uint256 i; i < chunk.length; ++i) {
            ShortOutcome.Participant calldata p = chunk[i];
            require(p.wallet > lastWallet && p.wallet != address(vault)
                && p.firstAttempt > 0 && p.lastAttempt >= p.firstAttempt, "participant");
            root = keccak256(abi.encode(root, p.wallet, p.firstAttempt, p.lastAttempt));
            totalAttempts += uint256(p.lastAttempt) - p.firstAttempt + 1;
            lastWallet = p.wallet;
        }
        count += chunk.length;
        bytes32 digest = keccak256(abi.encode(chunk));
        chunkHashes.push(digest);
        emit ChunkPublished(chunkHashes.length - 1, digest, chunk.length, root);
    }

    // Any caller can seal only the FULL, already validated committed dataset.
    function seal() external nonReentrant {
        require(phase == Phase.Preparing && count == setup.expectedCount && root == setup.expectedRoot, "incomplete");
        vault.reserveUSDG(setup.drawId, 1, PromoVault.ReserveSource.SHORT, setup.budget);
        context = keccak256(abi.encode(keccak256("SHORT_STREAM_CONTEXT_STUDY_V1"), block.chainid,
            address(this), address(vault), setup, ShortOutcome.rulesHash(rules), keccak256(abi.encode(prizes))));
        phase = Phase.WaitingSeed;
        emit Sealed(context, root, count);
    }

    // Test-only replacement for an authenticated, single-delivery RNG callback.
    function supplySeed(bytes32 value) external onlyPublisher nonReentrant {
        require(phase == Phase.WaitingSeed, "phase"); seed = value; phase = Phase.Processing;
    }

    function process(uint256 index, ShortOutcome.Participant[] calldata chunk) external nonReentrant {
        require(phase == Phase.Processing && index == nextChunk && index < chunkHashes.length, "progress");
        require(chunk.length > 0 && chunk.length <= MAX_CHUNK
            && keccak256(abi.encode(chunk)) == chunkHashes[index], "chunk");
        // Reuses actual V1 outcome for local top-K. Repeated basket sorting and hash
        // are intentional prototype overhead; this is not an optimized gas claim.
        ShortOutcome.Result memory local = ShortOutcome.compute(context, seed, chunk, rules, prizes);
        _merge(local.winners);
        admitted += local.admittedCount;
        processed += chunk.length;
        ++nextChunk;
        emit Progress(index, processed, admitted);
    }

    function _merge(address[] memory candidates) private {
        uint256 length = best.length + candidates.length;
        if (length > prizes.length) length = prizes.length;
        ShortOutcome.Candidate[] memory fresh = new ShortOutcome.Candidate[](candidates.length);
        for (uint256 i; i < candidates.length; ++i) fresh[i] = ShortOutcome.Candidate(candidates[i],
            uint256(keccak256(abi.encode(keccak256("SHORT_ORDER_V1"), context, seed, candidates[i]))));
        ShortOutcome.Candidate[] memory merged = new ShortOutcome.Candidate[](length);
        uint256 a; uint256 b;
        for (uint256 i; i < length; ++i) {
            if (a < best.length && (b == fresh.length || best[a].rank < fresh[b].rank
                || (best[a].rank == fresh[b].rank && best[a].wallet < fresh[b].wallet))) merged[i] = best[a++];
            else merged[i] = fresh[b++];
        }
        for (uint256 i; i < length; ++i) {
            if (i < best.length) best[i] = merged[i]; else best.push(merged[i]);
        }
    }

    function result() public view returns (ShortOutcome.Result memory out) {
        require((phase == Phase.Processing || phase == Phase.Terminal)
            && nextChunk == chunkHashes.length && processed == count, "unfinished");
        uint256 k = prizes.length;
        uint256[] memory slots = new uint256[](k);
        uint256[] memory ranks = new uint256[](k);
        for (uint256 i; i < k; ++i) {
            uint256 rank = uint256(keccak256(abi.encode(keccak256("SHORT_PRIZE_ORDER_V1"), context, seed, i)));
            uint256 j = i;
            while (j > 0 && rank < ranks[j - 1]) { ranks[j] = ranks[j - 1]; slots[j] = slots[j - 1]; --j; }
            ranks[j] = rank; slots[j] = i;
        }
        out.winners = new address[](best.length);
        out.amounts = new uint256[](best.length);
        out.prizeIndices = new uint256[](best.length);
        for (uint256 i; i < best.length; ++i) {
            out.winners[i] = best[i].wallet; out.prizeIndices[i] = slots[i]; out.amounts[i] = prizes[slots[i]];
        }
        out.admittedCount = admitted;
        // New study encoding: verified ordered root replaces the flat ABI hash.
        out.resultHash = keccak256(abi.encode(keccak256("SHORT_STREAM_RESULT_STUDY_V1"), context, seed,
            root, ShortOutcome.rulesHash(rules), keccak256(abi.encode(prizes)), out));
    }

    function finish() external nonReentrant {
        require(phase == Phase.Processing, "phase");
        ShortOutcome.Result memory out = result();
        vault.finalize(setup.drawId, out.winners, out.amounts);
        phase = Phase.Terminal;
        emit AttemptsConsumed(setup.drawId, 0, setup.snapshotHash, out.winners.length == 0 ? 0 : 1, out.resultHash);
    }
    function basket() external view returns (uint256[] memory) { return prizes; }
}
