// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ShortOutcome} from "./ShortOutcome.sol";
import {ShortPrizeBasket} from "./ShortPrizeBasket.sol";

/// Local-only lifecycle rehearsal. Operator supplies participants and TEST seed.
/// Not an authenticated indexer or random oracle. No production deployment allowed.
contract LocalShortProgram is ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable quote;
    address public immutable operator;
    uint256 public immutable interval;
    uint256 public immutable minimumFund;
    uint256 public immutable minimumUnit;
    uint256[] public weights;
    uint256 public freeFund;
    uint256 public reserved;
    uint256 public liabilities;
    uint256 public cycle;
    uint256 public lastTerminal;
    bool public pending;
    mapping(address => uint128) public consumedThrough;
    struct Draw { bytes32 participantsHash; bytes32 context; bytes32 resultHash; uint256 budget; uint256 awarded; bool settled; }
    mapping(uint256 => Draw) public draws;
    mapping(uint256 => mapping(address => uint256)) public rewards;
    event Funded(address indexed payer, uint256 received);
    event Frozen(uint256 indexed cycle, bytes32 participantsHash, bytes32 context, uint256 budget);
    event Settled(uint256 indexed cycle, bytes32 seed, bytes32 resultHash, uint256 awarded, uint256 returnedToFund);
    event Award(uint256 indexed cycle, address indexed winner, uint256 amount);
    event Paid(uint256 indexed cycle, address indexed winner, uint256 amount);
    constructor(address asset, address operator_, uint256 interval_, uint256 minimumFund_, uint256 minimumUnit_, uint256[] memory weights_) {
        require(block.chainid == 31337, "local only");
        require(asset.code.length > 0 && operator_ != address(0) && interval_ > 0 && minimumFund_ > 0, "config");
        require(weights_.length > 0 && weights_.length <= 64, "places");
        ShortPrizeBasket.build(type(uint256).max, weights_, minimumUnit_);
        quote = IERC20(asset); operator = operator_; interval = interval_;
        minimumFund = minimumFund_; minimumUnit = minimumUnit_; weights = weights_;
        lastTerminal = block.timestamp;
    }
    modifier onlyOperator() { require(msg.sender == operator, "operator"); _; }
    function solvent() public view returns(bool) { return quote.balanceOf(address(this)) >= freeFund + reserved + liabilities; }
    function fund(uint256 amount) external nonReentrant returns(uint256 received) {
        require(amount > 0 && solvent(), "funding");
        uint256 beforeBalance = quote.balanceOf(address(this));
        quote.safeTransferFrom(msg.sender, address(this), amount);
        received = quote.balanceOf(address(this)) - beforeBalance;
        require(received > 0, "empty receipt"); freeFund += received;
        emit Funded(msg.sender, received);
    }
    function freeze(ShortOutcome.Participant[] calldata participants) external onlyOperator nonReentrant {
        require(!pending && block.timestamp >= lastTerminal + interval, "schedule");
        require(participants.length > 0 && participants.length <= 1000 && freeFund >= minimumFund && solvent(), "not ready");
        bytes32 ph = ShortOutcome.participantsHash(participants);
        for(uint256 i; i < participants.length; i++) {
            require(participants[i].wallet != address(this), "program participant");
            require(participants[i].firstAttempt == uint256(consumedThrough[participants[i].wallet]) + 1, "attempt replay/gap");
        }
        ShortPrizeBasket.build(freeFund, weights, minimumUnit);
        cycle++; pending = true;
        bytes32 context = keccak256(abi.encode("launchpad-local-short-v1", block.chainid, address(this), cycle));
        draws[cycle] = Draw(ph, context, bytes32(0), freeFund, 0, false);
        reserved = freeFund; freeFund = 0;
        emit Frozen(cycle, ph, context, reserved);
        _onFrozen(context);
    }
    function _onFrozen(bytes32) internal virtual {}
    function _authorizeSeed(bytes32) internal view virtual { require(msg.sender==operator,"operator"); }
    function settle(ShortOutcome.Participant[] calldata participants, bytes32 testSeed) external nonReentrant {
        _authorizeSeed(testSeed);
        require(pending && solvent(), "not pending");
        Draw storage d = draws[cycle];
        require(ShortOutcome.participantsHash(participants) == d.participantsHash, "snapshot mismatch");
        for(uint256 i; i < participants.length; i++) consumedThrough[participants[i].wallet] = participants[i].lastAttempt;
        (uint256[] memory prizes,,) = ShortPrizeBasket.build(d.budget, weights, minimumUnit);
        ShortOutcome.Rules memory rules = ShortOutcome.Rules(1,4,5,1,1);
        ShortOutcome.Result memory result = ShortOutcome.compute(d.context, testSeed, participants, rules, prizes);
        uint256 total;
        for(uint256 i; i < result.winners.length; i++) {
            rewards[cycle][result.winners[i]] = result.amounts[i]; total += result.amounts[i];
            emit Award(cycle, result.winners[i], result.amounts[i]);
        }
        d.resultHash = result.resultHash; d.awarded = total; d.settled = true;
        reserved = 0; liabilities += total; freeFund += d.budget - total;
        pending = false; lastTerminal = block.timestamp;
        emit Settled(cycle, testSeed, result.resultHash, total, d.budget-total);
    }
    // Permissionless delivery, always to the recorded winner. Failure rolls back only this claim.
    function claim(uint256 drawId, address winner) external nonReentrant {
        uint256 amount = rewards[drawId][winner];
        require(draws[drawId].settled && amount > 0 && solvent(), "claim");
        rewards[drawId][winner] = 0; liabilities -= amount;
        quote.safeTransfer(winner, amount); emit Paid(drawId, winner, amount);
    }
}
