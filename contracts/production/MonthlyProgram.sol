// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ShortOutcome} from "../draws/ShortOutcome.sol";
import {MonthlyOutcome} from "./MonthlyOutcome.sol";
import {ShortDrandAdapter} from "./ShortDrandAdapter.sol";

/// Chain-4663 candidate. The operator attests finalized history and dataset truth;
/// neither an RPC finality oracle nor a permissionless purchase indexer lives here.
/// No seed override, reroll, cancellation or discretionary withdrawal.
contract MonthlyProgram is ReentrancyGuard {
    using SafeERC20 for IERC20;
    bytes32 public constant PROFILE = keccak256("launchpad-monthly-usdg-v2");
    IERC20 public immutable quote;
    bytes32 public immutable instanceId;
    address public immutable operator;
    ShortDrandAdapter public immutable randomness;
    uint256 public constant interval = 30 days;
    uint256 public immutable minimumFund;
    uint256 public immutable nextTarget;
    uint256 public freeNext;
    uint256 public fundingRemainder;
    uint256 public freeFund;
    uint256 public reserved;
    uint256 public liabilities;
    uint256 public cycle;
    uint256 public lastTerminal;
    bool public pending;
    struct Setup {
        address asset; address operator; bytes32 instance;
        uint256 minimumFund; uint256 nextTarget;
    }
    struct Checkpoint { uint256 number; bytes32 blockHash; uint256 timestamp; bytes32 ledgerHash; }
    struct Draw { bytes32 participantsHash; bytes32 context; bytes32 resultHash; uint256 budget; uint256 awarded; bool settled; }
    mapping(uint256 => Draw) public draws;
    mapping(uint256 => Checkpoint) public checkpoints;
    mapping(address => uint128) public consumedThrough;
    mapping(uint256 => mapping(address => uint256)) public rewards;
    mapping(uint256 => uint256) public requestForCycle;
    mapping(uint256 => uint256) public cycleForRequest;
    mapping(uint256 => bytes32) public verifiedSeed;
    mapping(uint256 => bool) public fulfilled;
    event Funded(address indexed payer, uint256 received);
    event Frozen(uint256 indexed cycle, bytes32 participantsHash, bytes32 context, uint256 budget);
    event CheckpointBound(uint256 indexed cycle, uint256 number, bytes32 blockHash, uint256 timestamp, bytes32 ledgerHash);
    event RandomnessBound(uint256 indexed cycle, uint256 indexed requestId);
    event RandomnessReady(uint256 indexed cycle, bytes32 seed);
    event Settled(uint256 indexed cycle, bytes32 seed, bytes32 resultHash, uint256 awarded, uint256 returnedToFund);
    event Award(uint256 indexed cycle, address indexed winner, uint256 amount);
    event Paid(uint256 indexed cycle, address indexed winner, uint256 amount);

    constructor(Setup memory s, ShortDrandAdapter.Timing memory timing) {
        require(block.chainid == 4663, "chain 4663");
        require(s.asset.code.length > 0 && s.operator != address(0) && s.instance != bytes32(0), "binding");
        require(s.minimumFund > 0 && s.nextTarget > 0, "rules");
        quote = IERC20(s.asset); operator = s.operator; instanceId = s.instance;
        minimumFund = s.minimumFund; nextTarget = s.nextTarget;
        lastTerminal = block.timestamp;
        randomness = new ShortDrandAdapter(address(this), timing);
    }
    function solvent() public view returns(bool) { return quote.balanceOf(address(this)) >= freeFund + freeNext + reserved + liabilities; }
    function fund(uint256 amount) external nonReentrant returns(uint256 received) {
        require(amount > 0 && solvent(), "funding");
        uint256 beforeBalance = quote.balanceOf(address(this));
        quote.safeTransferFrom(msg.sender, address(this), amount);
        received = quote.balanceOf(address(this)) - beforeBalance;
        require(received == amount, "unsupported transfer fee");
        // Monthly allocation C,C,N with carry; overflow of a full Next goes to Current.
        uint256 tail = received % 3 + fundingRemainder;
        uint256 next = received / 3 + tail / 3;
        fundingRemainder = tail % 3;
        uint256 room = nextTarget - freeNext;
        if(next > room) next = room;
        freeNext += next; freeFund += received - next;
        emit Funded(msg.sender, received);
    }
    function freeze(ShortOutcome.Participant[] calldata participants, Checkpoint calldata checkpoint) external nonReentrant {
        require(msg.sender == operator, "operator");
        require(!pending && block.timestamp >= lastTerminal + interval, "schedule");
        require(participants.length > 0 && participants.length <= 1000 && freeFund >= minimumFund && freeNext == nextTarget && solvent(), "not ready");
        // The number is the chain RPC block number, NOT Solidity block.number on Orbit.
        // Finality/canonical hash/complete ledger verification is mandatory in admission.
        require(checkpoint.number > 0 && checkpoint.blockHash != bytes32(0) && checkpoint.ledgerHash != bytes32(0)
            && checkpoint.timestamp > 0 && checkpoint.timestamp <= block.timestamp, "checkpoint");
        if(cycle > 0) require(checkpoint.number > checkpoints[cycle].number && checkpoint.timestamp >= checkpoints[cycle].timestamp, "checkpoint order");
        bytes32 ph = ShortOutcome.participantsHash(participants);
        for(uint256 i; i < participants.length; i++) {
            require(participants[i].wallet != address(this), "program participant");
            require(participants[i].firstAttempt == uint256(consumedThrough[participants[i].wallet]) + 1, "attempt replay/gap");
        }
        cycle++; pending = true; checkpoints[cycle] = checkpoint;
        bytes32 context = keccak256(abi.encode(PROFILE, block.chainid, address(this), instanceId, cycle, ph, checkpoint, freeFund));
        draws[cycle] = Draw(ph, context, bytes32(0), freeFund, 0, false);
        reserved = freeFund; freeFund = 0;
        emit CheckpointBound(cycle, checkpoint.number, checkpoint.blockHash, checkpoint.timestamp, checkpoint.ledgerHash);
        emit Frozen(cycle, ph, context, reserved);
        uint256 requestId = randomness.request(context);
        require(requestId != 0 && cycleForRequest[requestId] == 0, "request reuse");
        requestForCycle[cycle] = requestId; cycleForRequest[requestId] = cycle;
        emit RandomnessBound(cycle, requestId);
    }
    function fulfill(uint256 requestId, bytes32 seed) external nonReentrant {
        require(msg.sender == address(randomness), "randomness only");
        uint256 target = cycleForRequest[requestId];
        require(pending && target == cycle && target != 0 && !fulfilled[target], "request mismatch");
        verifiedSeed[target] = seed; fulfilled[target] = true;
        emit RandomnessReady(target, seed);
    }
    function settle(ShortOutcome.Participant[] calldata participants) external nonReentrant {
        require(pending && fulfilled[cycle] && solvent(), "not ready");
        Draw storage d = draws[cycle];
        require(ShortOutcome.participantsHash(participants) == d.participantsHash, "snapshot mismatch");
        for(uint256 i; i < participants.length; i++) consumedThrough[participants[i].wallet] = participants[i].lastAttempt;
        bytes32 seed = verifiedSeed[cycle];
        (address winner, uint256 admitted) = MonthlyOutcome.compute(d.context, seed, participants);
        uint256 total = winner == address(0) ? 0 : d.budget;
        if(winner != address(0)) {
            rewards[cycle][winner] = total;
            emit Award(cycle, winner, total);
            freeFund += freeNext; freeNext = 0;
        } else freeFund += d.budget;
        bytes32 resultHash = keccak256(abi.encode(keccak256("LAUNCHPAD_MONTHLY_RESULT_V2"),d.context,seed,d.participantsHash,winner,admitted,d.budget));
        d.resultHash = resultHash; d.awarded = total; d.settled = true;
        reserved = 0; liabilities += total;
        pending = false; lastTerminal = block.timestamp;
        emit Settled(cycle, seed, resultHash, total, d.budget-total);
    }
    function claim(uint256 drawId, address winner) external nonReentrant {
        uint256 amount = rewards[drawId][winner];
        require(draws[drawId].settled && amount > 0 && solvent(), "claim");
        rewards[drawId][winner] = 0; liabilities -= amount;
        quote.safeTransfer(winner, amount); emit Paid(drawId, winner, amount);
    }
}
