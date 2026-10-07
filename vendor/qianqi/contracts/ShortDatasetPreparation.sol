// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {CutoffHistory} from "./CutoffHistory.sol";
import {ChainBlocks} from "./ChainBlocks.sol";

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PromoVault} from "./PromoVault.sol";
import {ShortOutcome} from "./ShortOutcome.sol";
import {ShortPrizeBasket} from "./ShortPrizeBasket.sol";

/// @notice Internal component, NOT a production controller. The integrating controller
/// must enforce publisher authorization, cutoff eligibility/finality, schedule, rules
/// epoch and budget policy. Structural readiness is not proof of eligible BUY history.
abstract contract ShortDatasetPreparation is ReentrancyGuard, CutoffHistory {
    enum Status { None, Publishing, Ready, Superseded, Sealed }
    uint256 public constant MAX_DATASET_CHUNK = 64;
    bytes32 public constant EMPTY_DATASET_ROOT = keccak256("SHORT_DATASET_V1");
    PromoVault public immutable datasetVault;
    address public immutable datasetRegistry;
    bytes32 public immutable datasetInstance;
    bytes32 public activeProposal;
    bytes32 public pendingDatasetDraw;

    struct Request {
        bytes32 drawId;
        uint64 campaignId;
        uint64 rulesEpoch;
        uint256 cutoffBlockNumber;
        bytes32 cutoffBlockHash;
        bytes32 snapshotHash;
        bytes32 expectedRoot;
        uint256 expectedCount;
        uint256 expectedAttempts;
        uint256 budget;
    }
    struct Proposal {
        Request request;
        Status status;
        bytes32 root;
        uint256 count;
        uint256 totalAttempts;
        address lastWallet;
        bytes32 rulesHash;
        bytes32 basketHash;
        bytes32 context;
    }
    mapping(bytes32 => Proposal) private proposals;
    mapping(bytes32 => bytes32[]) private chunks;
    mapping(bytes32 => uint256[]) private baskets;
    mapping(bytes32 => bool) private sealedDraws;

    event DatasetProposed(bytes32 indexed proposalId, bytes32 indexed drawId, Request request,
        ShortOutcome.Rules rules, uint256[] weights, uint256 minimumUnit);
    event DatasetChunk(bytes32 indexed proposalId, uint256 indexed index, bytes32 chunkHash, uint256 count);
    event DatasetReady(bytes32 indexed proposalId, bytes32 root, uint256 count, uint256 totalAttempts);
    event DatasetSuperseded(bytes32 indexed proposalId);
    event DatasetSealed(bytes32 indexed proposalId, bytes32 indexed drawId, bytes32 context);
    event AttemptsFrozen(bytes32 indexed drawId, uint8 indexed kind, uint256 cutoffBlockNumber,
        bytes32 cutoffBlockHash, bytes32 rulesHash, bytes32 snapshotHash);

    constructor(address vault, address registry, bytes32 instance) {
        require(vault != address(0) && registry.code.length > 0 && instance != bytes32(0), "binding");
        datasetVault = PromoVault(vault); datasetRegistry = registry; datasetInstance = instance;
    }
    function datasetProposal(bytes32 id) public view returns (Proposal memory) { return proposals[id]; }
    function datasetChunkCount(bytes32 id) public view returns (uint256) { return chunks[id].length; }
    function datasetChunkHash(bytes32 id, uint256 index) public view returns (bytes32) { return chunks[id][index]; }
    function datasetBasket(bytes32 id) public view returns (uint256[] memory) { return baskets[id]; }

    function _beginDataset(bytes32 id, Request calldata r, ShortOutcome.Rules memory rules,
        uint256[] memory weights, uint256 minimumUnit) internal nonReentrant {
        require(activeProposal == bytes32(0) && pendingDatasetDraw == bytes32(0), "active");
        require(id != bytes32(0) && proposals[id].status == Status.None && r.drawId != bytes32(0)
            && !sealedDraws[r.drawId] && r.campaignId > 0 && r.rulesEpoch > 0, "identity");
        require(r.snapshotHash != bytes32(0) && r.expectedRoot != bytes32(0)
            && r.expectedCount > 0 && r.expectedAttempts >= r.expectedCount && r.budget > 0, "request");
        require(validCutoff(r.cutoffBlockNumber, r.cutoffBlockHash), "cutoff");
        require(address(datasetVault).code.length > 0 && datasetVault.drawController() == address(this), "vault");
        datasetVault.validateDrawId(r.drawId, 0);
        require(weights.length <= 64, "places");
        (uint256[] memory prizes,,) = ShortPrizeBasket.build(r.budget, weights, minimumUnit);
        Proposal storage p = proposals[id]; p.request = r; p.status = Status.Publishing;
        p.root = EMPTY_DATASET_ROOT;
        p.rulesHash = keccak256(abi.encode(keccak256("SHORT_DATASET_RULES_V1"),
            ShortOutcome.rulesHash(rules), weights, minimumUnit));
        p.basketHash = keccak256(abi.encode(prizes)); baskets[id] = prizes; activeProposal = id;
        emit DatasetProposed(id, r.drawId, r, rules, weights, minimumUnit);
    }
    function _publishDataset(bytes32 id, ShortOutcome.Participant[] calldata data) internal nonReentrant {
        Proposal storage p = proposals[id];
        require(activeProposal == id && p.status == Status.Publishing, "phase");
        require(data.length > 0 && data.length <= MAX_DATASET_CHUNK
            && p.count + data.length <= p.request.expectedCount, "chunk");
        for (uint256 i; i < data.length; ++i) {
            ShortOutcome.Participant calldata item = data[i];
            require(item.wallet > p.lastWallet && item.wallet != address(datasetVault)
                && item.firstAttempt > 0 && item.lastAttempt >= item.firstAttempt, "participant");
            p.root = keccak256(abi.encode(p.root, item.wallet, item.firstAttempt, item.lastAttempt));
            p.totalAttempts += uint256(item.lastAttempt) - item.firstAttempt + 1;
            p.lastWallet = item.wallet;
        }
        p.count += data.length;
        require(p.totalAttempts <= p.request.expectedAttempts, "attempts");
        bytes32 digest = keccak256(abi.encode(data));
        emit DatasetChunk(id, chunks[id].length, digest, data.length); chunks[id].push(digest);
        if (p.count == p.request.expectedCount) {
            require(p.root == p.request.expectedRoot && p.totalAttempts == p.request.expectedAttempts, "commitment");
            p.status = Status.Ready;
            emit DatasetReady(id, p.root, p.count, p.totalAttempts);
        }
    }
    function _supersedeDataset(bytes32 id) internal nonReentrant {
        Proposal storage p = proposals[id];
        require(activeProposal == id && (p.status == Status.Publishing || p.status == Status.Ready), "phase");
        p.status = Status.Superseded; activeProposal = bytes32(0); emit DatasetSuperseded(id);
    }
    function _sealDataset(bytes32 id) internal nonReentrant returns (bytes32 context) {
        Proposal storage p = proposals[id];
        require(activeProposal == id && p.status == Status.Ready && pendingDatasetDraw == bytes32(0), "phase");
        // No proposal id, chunk partition, executor or seal block in random context.
        context = keccak256(abi.encode(keccak256("SHORT_DATASET_CONTEXT_V1"), block.chainid,
            address(this), datasetInstance, datasetRegistry, address(datasetVault), datasetVault.quoteToken(),
            p.request, p.rulesHash, p.basketHash));
        datasetVault.reserveUSDG(p.request.drawId, p.request.campaignId, PromoVault.ReserveSource.SHORT, p.request.budget);
        p.context = context; p.status = Status.Sealed; sealedDraws[p.request.drawId] = true;
        pendingDatasetDraw = p.request.drawId; activeProposal = bytes32(0);
        emit AttemptsFrozen(p.request.drawId, 0, p.request.cutoffBlockNumber,
            p.request.cutoffBlockHash, p.rulesHash, p.request.snapshotHash);
        emit DatasetSealed(id, p.request.drawId, context);
    }
    // Terminal integration lives in ShortRulesEpochs/ShortSettlement. Never expose
    // a method that clears a frozen draw without vault finalization.
}
