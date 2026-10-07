// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPrizeSwapAdapter} from "./IPrizeSwapAdapter.sol";
import {IPrizeDestination} from "./LocalPrizeConverter.sol";

/// Local-only bounded market execution. Executor chooses price; publisher chooses routes.
/// Neither authority can withdraw prize assets; neither guarantees a fair market price.
contract LocalMarketPrizeConverter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    struct Limits { uint256 maxInput; uint256 maxHorizon; uint256 capacity; uint256 refillSeconds; uint256 notice; }
    struct Pending { uint256 id; address adapter; bytes32 codeHash; uint256 eligibleAt; }
    IERC20 public immutable projectToken;
    IERC20 public immutable quoteToken;
    IPrizeDestination public immutable vault;
    address public immutable executor;
    uint256 public immutable capacity;
    uint256 public immutable refillSeconds;
    uint256 public saleAllowance;
    uint256 public allowanceUpdatedAt;
    address public immutable publisher;
    uint256 public immutable maxInput;
    uint256 public immutable maxHorizon;
    uint256 public immutable adapterNotice;
    address public adapter;
    bytes32 public adapterCodeHash;
    uint256 public adapterVersion = 1;
    uint256 public announcementId;
    Pending public pending;
    uint256 public tokenObserved;
    uint256 public tokenSold;
    uint256 public quoteObserved;
    uint256 public quoteForwarded;
    error InvalidConfiguration();
    error Unauthorized();
    error InvalidTransition();
    error RateLimited();
    error InvalidSwap();
    error BalanceMismatch();
    event AdapterAnnounced(uint256 indexed id,address indexed adapter,bytes32 codeHash,uint256 eligibleAt);
    event AdapterCancelled(uint256 indexed id);
    event AdapterActivated(uint256 indexed id,uint256 indexed version,address indexed adapter,bytes32 codeHash);
    event InventoryObserved(uint256 tokenAmount,uint256 quoteAmount);
    event Converted(uint256 indexed version,uint256 amountIn,uint256 amountOut,uint256 minimumOut);
    event QuoteForwarded(uint256 amount);

    constructor(address token,address quote,address destination,address route,address operator,address announcer,Limits memory limits) {
        if(block.chainid!=31337 || token==quote || token.code.length==0 || quote.code.length==0 ||
            destination.code.length==0 || operator==address(0) || announcer==address(0) ||
            limits.maxInput==0 || limits.maxHorizon==0 || limits.capacity<limits.maxInput ||
            limits.refillSeconds==0 || limits.notice==0) revert InvalidConfiguration();
        projectToken=IERC20(token);quoteToken=IERC20(quote);vault=IPrizeDestination(destination);
        executor=operator;publisher=announcer;capacity=limits.capacity;refillSeconds=limits.refillSeconds;
        saleAllowance=limits.capacity;allowanceUpdatedAt=block.timestamp;
        maxInput=limits.maxInput;maxHorizon=limits.maxHorizon;adapterNotice=limits.notice;
        if(vault.projectToken()!=token || vault.quoteToken()!=quote)
            revert InvalidConfiguration();
        _validateAdapter(route,route.codehash);adapter=route;adapterCodeHash=route.codehash;
    }
    function _validateAdapter(address route,bytes32 digest) private view {
        if(route.code.length==0 || route.codehash!=digest || route==address(this) || route==address(vault) ||
            route==address(projectToken) || route==address(quoteToken) ||
            IPrizeSwapAdapter(route).tokenIn()!=address(projectToken) || IPrizeSwapAdapter(route).tokenOut()!=address(quoteToken))
            revert InvalidConfiguration();
    }
    function announceAdapter(address next,bytes32 digest) external nonReentrant {
        if(msg.sender!=publisher)revert Unauthorized();
        if(pending.id!=0 || next==adapter)revert InvalidTransition();
        _validateAdapter(next,digest);
        uint256 id=++announcementId;
        pending=Pending(id,next,digest,block.timestamp+adapterNotice);
        emit AdapterAnnounced(id,next,digest,pending.eligibleAt);
    }
    function cancelAdapter(uint256 expectedId) external nonReentrant {
        if(msg.sender!=publisher)revert Unauthorized();
        if(expectedId==0 || pending.id!=expectedId)revert InvalidTransition();
        delete pending;emit AdapterCancelled(expectedId);
    }
    /// Does not call the old adapter or require a usable oracle: a broken route must be replaceable.
    function activateAdapter(uint256 expectedId) external nonReentrant {
        Pending memory p=pending;
        if(expectedId==0 || p.id!=expectedId || block.timestamp<p.eligibleAt)revert InvalidTransition();
        _validateAdapter(p.adapter,p.codeHash);
        delete pending;adapter=p.adapter;adapterCodeHash=p.codeHash;++adapterVersion;
        emit AdapterActivated(p.id,adapterVersion,p.adapter,p.codeHash);
    }
    function remainingToken() public view returns(uint256){return tokenObserved-tokenSold;}
    function heldQuote() public view returns(uint256){return quoteObserved-quoteForwarded;}
    /// Token bucket: capacity burst plus linear refill. Rounding discards fractional refill.
    function availableToSell() public view returns(uint256) {
        uint256 elapsed=block.timestamp-allowanceUpdatedAt;
        if(elapsed>=refillSeconds)return capacity;
        uint256 refill=Math.mulDiv(elapsed,capacity,refillSeconds);
        return refill>=capacity-saleAllowance?capacity:saleAllowance+refill;
    }
    function sync() external nonReentrant {_sync();}
    function _sync() private {
        uint256 t=projectToken.balanceOf(address(this));uint256 q=quoteToken.balanceOf(address(this));
        if(t<remainingToken() || q<heldQuote())revert BalanceMismatch();
        uint256 dt=t-remainingToken();uint256 dq=q-heldQuote();tokenObserved+=dt;quoteObserved+=dq;
        if(dt!=0 || dq!=0)emit InventoryObserved(dt,dq);
    }
    /// Expected version prevents a queued execution from silently switching to a different adapter.
    function convert(uint256 amount,uint256 minOut,uint256 deadline,uint256 expectedVersion) external nonReentrant returns(uint256 amountOut) {
        if(msg.sender!=executor)revert Unauthorized();
        if(minOut==0 || expectedVersion!=adapterVersion || amount==0 || amount>maxInput || deadline<block.timestamp ||
            deadline-block.timestamp>maxHorizon)revert InvalidSwap();
        _sync();if(amount>remainingToken())revert InvalidSwap();
        _validateAdapter(adapter,adapterCodeHash);
        uint256 permitted=availableToSell();if(amount>permitted)revert RateLimited();
        saleAllowance=permitted-amount;allowanceUpdatedAt=block.timestamp;
        uint256 beforeToken=projectToken.balanceOf(address(this));uint256 beforeQuote=quoteToken.balanceOf(address(this));
        projectToken.forceApprove(adapter,amount);IPrizeSwapAdapter(adapter).swapExactInput(amount,minOut,deadline);
        projectToken.forceApprove(adapter,0);
        uint256 afterToken=projectToken.balanceOf(address(this));uint256 afterQuote=quoteToken.balanceOf(address(this));
        if(afterToken!=beforeToken-amount || afterQuote<beforeQuote || afterQuote-beforeQuote<minOut)revert BalanceMismatch();
        tokenSold+=amount;quoteObserved+=afterQuote-beforeQuote;
        emit Converted(adapterVersion,amount,afterQuote-beforeQuote,minOut);
        return afterQuote-beforeQuote;
    }
    function forwardQuote() external nonReentrant {
        _sync();uint256 amount=heldQuote();if(amount==0)return;
        uint256 beforeVault=quoteToken.balanceOf(address(vault));quoteForwarded+=amount;
        quoteToken.safeTransfer(address(vault),amount);
        if(quoteToken.balanceOf(address(this))!=0 || quoteToken.balanceOf(address(vault))!=beforeVault+amount)revert BalanceMismatch();
        vault.syncUSDG();emit QuoteForwarded(amount);
    }
}
