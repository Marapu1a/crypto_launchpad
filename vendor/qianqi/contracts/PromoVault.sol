// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Funded prize custody only. The immutable controller must enforce draw rules
/// and authenticate winners; this vault neither selects nor verifies random outcomes.
contract PromoVault is ReentrancyGuard {
    using SafeERC20 for IERC20;
    enum Status { None, Reserved, Finalized }
    enum FundingDestination { GENERAL, SHORT, CURRENT, NEXT }
    enum ReserveSource { SHORT, CURRENT }
    enum DrawKind { GENERIC, MONTHLY }
    struct Draw {
        address asset;
        uint64 campaignId;
        Status status;
        uint256 budget;
        uint256 awarded;
        uint256 paid;
    }

    address public immutable projectToken;
    address public immutable quoteToken;
    address public immutable drawController;
    uint256 public immutable nextStartTarget;
    uint256 public freeShort;
    uint256 public freeCurrent;
    uint256 public freeNext;
    // Next position in SHORT, CURRENT, SHORT, CURRENT, SHORT, NEXT.
    uint8 public generalFundingPhase;
    mapping(bytes32 => ReserveSource) public usdgDrawSource;
    mapping(bytes32 => DrawKind) public drawKind;
    mapping(bytes32 => uint256) public monthlyDrawCycle;
    bytes32 public pendingMonthlyDrawId;
    uint256 public cycleId = 1;
    mapping(bytes32 => Draw) public draws;
    mapping(address => uint256) public reserved;
    mapping(address => uint256) public claimable;
    mapping(bytes32 => mapping(address => uint256)) public reward;

    error InvalidConfiguration();
    error OnlyController();
    error UnsupportedAsset();
    error InvalidDraw();
    error InvalidAwards();
    error InsufficientAvailable();
    error BalanceDeficit();
    error NothingToClaim();
    error InvalidFunding();
    error UnexpectedReceivedAmount();
    error UseUSDGReserve();
    error MonthlyPending();
    error NextStartNotReady();
    error UseMonthlySettlement();
    event DrawReserved(bytes32 indexed drawId, uint64 indexed campaignId, address indexed asset, uint256 budget);
    event RewardAssigned(bytes32 indexed drawId, address indexed winner, uint256 amount);
    event DrawFinalized(bytes32 indexed drawId, uint256 awarded, uint256 released);
    event RewardPaid(bytes32 indexed drawId, address indexed asset, address indexed winner, uint256 amount);
    // payer=zero for unrecognized direct transfers: the sender cannot be inferred.
    event USDGAllocated(address indexed payer, FundingDestination indexed destination, uint256 received,
        uint256 shortAmount, uint256 currentAmount, uint256 nextAmount);
    event USDGReserveDebited(bytes32 indexed drawId, ReserveSource indexed source, uint256 amount);
    event MonthlyStarted(bytes32 indexed drawId, uint256 indexed cycle, uint256 budget);
    event MonthlySettled(bytes32 indexed drawId, uint256 indexed cycle, address indexed winner,
        uint256 awarded, uint256 nextMovedToCurrent);

    constructor(address token, address quote, address controller, uint256 target) {
        // TOKEN may be a predicted PAIR address before launch; code is required when used.
        if (token == address(0) || quote == address(0) || token == quote || controller.code.length == 0 || target == 0)
            revert InvalidConfiguration();
        projectToken = token;
        quoteToken = quote;
        drawController = controller;
        nextStartTarget = target;
    }

    modifier onlyController() {
        if (msg.sender != drawController) revert OnlyController();
        _;
    }

    // Extension points preserve the legacy single-controller behavior by default.
    // The dual-controller vault narrows reserve capabilities and monthly authority.
    modifier onlyMonthlyController() { _authorizeMonthly(); _; }
    function _authorizeMonthly() internal view virtual {
        if (msg.sender != drawController) revert OnlyController();
    }
    function _validateTokenReserve() internal pure virtual {}
    function _validateUSDGSource(ReserveSource) internal pure virtual {}
    /// Legacy vault has no kind namespace. Dual deployments override this policy.
    function validateDrawId(bytes32, uint8) public pure virtual {}

    /// Total uncommitted balance, NOT the amount available from an individual USDG reserve.
    /// USDG includes unrecognized direct funding; reserveUSDG synchronizes it as GENERAL.
    function available(address asset) public view returns (uint256) {
        _asset(asset);
        uint256 balance = IERC20(asset).balanceOf(address(this));
        uint256 liabilities = reserved[asset] + claimable[asset];
        if (balance < liabilities) revert BalanceDeficit();
        if (asset == quoteToken && balance - liabilities < freeShort + freeCurrent + freeNext)
            revert BalanceDeficit();
        return balance - liabilities;
    }

    function unrecognizedUSDG() public view returns (uint256) {
        return available(quoteToken) - freeShort - freeCurrent - freeNext;
    }

    /// Explicit destination applies only to this transferFrom, never to earlier donations.
    function fundUSDG(uint256 amount, FundingDestination destination) external nonReentrant {
        if (amount == 0) revert InvalidFunding();
        _syncUSDG();
        IERC20 quote = IERC20(quoteToken);
        uint256 beforeBalance = quote.balanceOf(address(this));
        quote.safeTransferFrom(msg.sender, address(this), amount);
        uint256 afterBalance = quote.balanceOf(address(this));
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != amount)
            revert UnexpectedReceivedAmount();
        _allocateUSDG(afterBalance - beforeBalance, destination, msg.sender);
    }

    /// Permissionless recognition under the published GENERAL default; zero is a no-op.
    function syncUSDG() external nonReentrant { _syncUSDG(); }

    function _syncUSDG() private {
        uint256 amount = unrecognizedUSDG();
        if (amount != 0) _allocateUSDG(amount, FundingDestination.GENERAL, address(0));
    }

    function _allocateUSDG(uint256 amount, FundingDestination destination, address payer) private {
        uint256 shortAmount;
        uint256 nextAmount;
        if (destination == FundingDestination.GENERAL) {
            // Whole six-unit groups have the same allocation from every phase.
            // Only the tail is walked: at most five iterations, regardless of amount.
            shortAmount = (amount / 6) * 3;
            nextAmount = amount / 6;
            uint8 phase = generalFundingPhase;
            uint256 tail = amount % 6;
            for (uint256 i; i < tail; ++i) {
                if (phase % 2 == 0) ++shortAmount;
                else if (phase == 5) ++nextAmount;
                phase = (phase + 1) % 6;
            }
            generalFundingPhase = phase;
        } else if (destination == FundingDestination.SHORT) {
            shortAmount = amount;
        } else if (destination == FundingDestination.NEXT) {
            nextAmount = amount;
        }
        uint256 room = nextStartTarget - freeNext;
        if (nextAmount > room) nextAmount = room;
        uint256 currentAmount = amount - shortAmount - nextAmount;
        freeShort += shortAmount;
        freeCurrent += currentAmount;
        freeNext += nextAmount;
        emit USDGAllocated(payer, destination, amount, shortAmount, currentAmount, nextAmount);
    }

    function reserve(bytes32 drawId, uint64 campaignId, address asset, uint256 budget)
        external onlyController nonReentrant
    {
        _validateTokenReserve();
        if (asset == quoteToken) revert UseUSDGReserve();
        _reserve(drawId, campaignId, asset, budget);
    }

    function reserveUSDG(bytes32 drawId, uint64 campaignId, ReserveSource source, uint256 budget)
        external onlyController nonReentrant
    {
        _validateUSDGSource(source);
        validateDrawId(drawId, 0);
        // While monthly is pending, new Current belongs to the following accounting outcome.
        if (source == ReserveSource.CURRENT && pendingMonthlyDrawId != bytes32(0)) revert MonthlyPending();
        _syncUSDG();
        if (source == ReserveSource.SHORT) {
            if (budget > freeShort) revert InsufficientAvailable();
            freeShort -= budget;
        } else {
            if (budget > freeCurrent) revert InsufficientAvailable();
            freeCurrent -= budget;
        }
        _reserve(drawId, campaignId, quoteToken, budget);
        usdgDrawSource[drawId] = source;
        emit USDGReserveDebited(drawId, source, budget);
    }

    /// Accounting only. Eligibility, checkpoints and random authentication belong to controller.
    function startMonthly(bytes32 drawId, uint64 campaignId) external onlyMonthlyController nonReentrant {
        validateDrawId(drawId, 1);
        _syncUSDG();
        if (pendingMonthlyDrawId != bytes32(0)) revert MonthlyPending();
        if (freeNext != nextStartTarget) revert NextStartNotReady();
        uint256 budget = freeCurrent;
        freeCurrent = 0;
        _reserve(drawId, campaignId, quoteToken, budget);
        usdgDrawSource[drawId] = ReserveSource.CURRENT;
        drawKind[drawId] = DrawKind.MONTHLY;
        monthlyDrawCycle[drawId] = cycleId;
        pendingMonthlyDrawId = drawId;
        emit USDGReserveDebited(drawId, ReserveSource.CURRENT, budget);
        emit MonthlyStarted(drawId, cycleId, budget);
    }

    /// Zero winner means a terminal no-win, never a timeout or a request for another random.
    function settleMonthly(bytes32 drawId, address winner) external onlyMonthlyController nonReentrant {
        Draw storage d = draws[drawId];
        if (drawId == bytes32(0) || pendingMonthlyDrawId != drawId ||
            drawKind[drawId] != DrawKind.MONTHLY || d.status != Status.Reserved ||
            monthlyDrawCycle[drawId] != cycleId) revert InvalidDraw();
        if (winner == address(this)) revert InvalidAwards();
        // Recognize direct funds while OLD Next is still full, before moving it on a win.
        _syncUSDG();
        uint256 finishedCycle = cycleId;
        uint256 moved;
        reserved[quoteToken] -= d.budget;
        if (winner == address(0)) {
            freeCurrent += d.budget;
        } else {
            reward[drawId][winner] = d.budget;
            claimable[quoteToken] += d.budget;
            d.awarded = d.budget;
            moved = freeNext;
            freeCurrent += moved;
            freeNext = 0;
            ++cycleId;
            emit RewardAssigned(drawId, winner, d.budget);
        }
        d.status = Status.Finalized;
        pendingMonthlyDrawId = bytes32(0);
        emit DrawFinalized(drawId, d.awarded, d.budget - d.awarded);
        emit MonthlySettled(drawId, finishedCycle, winner, d.awarded, moved);
    }

    /// Recognized jackpot reference for a future short policy, not a second spendable balance.
    function currentJackpotReference() external view returns (uint256) {
        bytes32 pending = pendingMonthlyDrawId;
        return pending == bytes32(0) ? freeCurrent : draws[pending].budget;
    }

    function _reserve(bytes32 drawId, uint64 campaignId, address asset, uint256 budget) private {
        if (drawId == bytes32(0) || campaignId == 0 || budget == 0 || draws[drawId].status != Status.None)
            revert InvalidDraw();
        if (budget > available(asset)) revert InsufficientAvailable();
        reserved[asset] += budget;
        draws[drawId] = Draw(asset, campaignId, Status.Reserved, budget, 0, 0);
        emit DrawReserved(drawId, campaignId, asset, budget);
    }

    /// Atomically record a complete winner list. Controller aggregates duplicate wallets.
    /// Empty awards release the full budget; only the future controller's rules may permit this.
    function finalize(bytes32 drawId, address[] calldata winners, uint256[] calldata amounts)
        external onlyController nonReentrant
    {
        Draw storage d = draws[drawId];
        if (drawKind[drawId] == DrawKind.MONTHLY) revert UseMonthlySettlement();
        if (d.status != Status.Reserved) revert InvalidDraw();
        if (winners.length != amounts.length) revert InvalidAwards();
        available(d.asset); // fail closed on an unsupported balance reduction
        uint256 total;
        for (uint256 i; i < winners.length; ++i) {
            address winner = winners[i];
            uint256 amount = amounts[i];
            if (winner == address(0) || winner == address(this) || amount == 0 || reward[drawId][winner] != 0)
                revert InvalidAwards();
            total += amount;
            if (total > d.budget) revert InvalidAwards();
            reward[drawId][winner] = amount;
            emit RewardAssigned(drawId, winner, amount);
        }
        reserved[d.asset] -= d.budget;
        claimable[d.asset] += total;
        if (d.asset == quoteToken) {
            uint256 released = d.budget - total;
            if (usdgDrawSource[drawId] == ReserveSource.SHORT) freeShort += released;
            else freeCurrent += released;
        }
        d.status = Status.Finalized;
        d.awarded = total;
        emit DrawFinalized(drawId, total, d.budget - total);
    }

    /// Anyone can pay an existing reward to its fixed winner, never to a caller-supplied substitute.
    function claim(bytes32 drawId, address winner) external nonReentrant {
        Draw storage d = draws[drawId];
        if (d.status != Status.Finalized) revert InvalidDraw();
        uint256 amount = reward[drawId][winner];
        if (amount == 0) revert NothingToClaim();
        available(d.asset);
        reward[drawId][winner] = 0;
        claimable[d.asset] -= amount;
        d.paid += amount;
        IERC20(d.asset).safeTransfer(winner, amount);
        emit RewardPaid(drawId, d.asset, winner, amount);
    }

    function _asset(address asset) private view {
        if (asset != projectToken && asset != quoteToken) revert UnsupportedAsset();
    }
}
