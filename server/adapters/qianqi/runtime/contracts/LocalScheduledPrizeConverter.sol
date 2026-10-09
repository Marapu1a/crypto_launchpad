// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPrizeSwapAdapter} from "./IPrizeSwapAdapter.sol";
import {IPrizePriceSource} from "./IPrizePriceSource.sol";
import {IPrizeDestination} from "./LocalPrizeConverter.sol";

/// Local deployment only until a real independent price source and venue are validated.
/// Adapter publication is trusted authority, not permission to change price or destination.
contract LocalScheduledPrizeConverter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    struct Limits { uint256 maxInput; uint256 maxHorizon; uint256 maxPriceAge; uint16 slippageBps; uint256 notice; }
    struct Pending { uint256 id; address adapter; bytes32 codeHash; uint256 eligibleAt; }
    IERC20 public immutable projectToken;
    IERC20 public immutable quoteToken;
    IPrizeDestination public immutable vault;
    IPrizePriceSource public immutable priceSource;
    bytes32 public immutable priceSourceCodeHash;
    address public immutable publisher;
    uint256 public immutable maxInput;
    uint256 public immutable maxHorizon;
    uint256 public immutable maxPriceAge;
    uint16 public immutable slippageBps;
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
    error InvalidPrice();
    error InvalidSwap();
    error BalanceMismatch();
    event AdapterAnnounced(uint256 indexed id,address indexed adapter,bytes32 codeHash,uint256 eligibleAt);
    event AdapterCancelled(uint256 indexed id);
    event AdapterActivated(uint256 indexed id,uint256 indexed version,address indexed adapter,bytes32 codeHash);
    event InventoryObserved(uint256 tokenAmount,uint256 quoteAmount);
    event Converted(uint256 indexed version,uint256 amountIn,uint256 amountOut,uint256 minimumOut);
    event QuoteForwarded(uint256 amount);

    constructor(address token,address quote,address destination,address route,address source,address announcer,Limits memory limits) {
        if(block.chainid!=31337 || token==quote || token.code.length==0 || quote.code.length==0 ||
            destination.code.length==0 || source.code.length==0 || announcer==address(0) ||
            source==destination || source==route || limits.maxInput==0 || limits.maxHorizon==0 ||
            limits.maxPriceAge==0 || limits.slippageBps>=10000 || limits.notice==0) revert InvalidConfiguration();
        projectToken=IERC20(token);quoteToken=IERC20(quote);vault=IPrizeDestination(destination);
        priceSource=IPrizePriceSource(source);priceSourceCodeHash=source.codehash;publisher=announcer;
        maxInput=limits.maxInput;maxHorizon=limits.maxHorizon;maxPriceAge=limits.maxPriceAge;
        slippageBps=limits.slippageBps;adapterNotice=limits.notice;
        if(vault.projectToken()!=token || vault.quoteToken()!=quote || priceSource.tokenIn()!=token || priceSource.tokenOut()!=quote)
            revert InvalidConfiguration();
        _validateAdapter(route,route.codehash);adapter=route;adapterCodeHash=route.codehash;
    }
    function _validateAdapter(address route,bytes32 digest) private view {
        if(route.code.length==0 || route.codehash!=digest || route==address(this) || route==address(vault) ||
            route==address(priceSource) || route==address(projectToken) || route==address(quoteToken) ||
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
    function minimumOutput(uint256 amount) public view returns(uint256){
        if(address(priceSource).codehash!=priceSourceCodeHash)revert InvalidPrice();
        (uint256 n,uint256 d,uint256 observed)=priceSource.price();
        if(n==0 || d==0 || observed==0 || observed>block.timestamp || block.timestamp-observed>maxPriceAge)revert InvalidPrice();
        uint256 referenceOut=Math.mulDiv(amount,n,d,Math.Rounding.Ceil);
        return Math.mulDiv(referenceOut,10000-slippageBps,10000,Math.Rounding.Ceil);
    }
    function sync() external nonReentrant {_sync();}
    function _sync() private {
        uint256 t=projectToken.balanceOf(address(this));uint256 q=quoteToken.balanceOf(address(this));
        if(t<remainingToken() || q<heldQuote())revert BalanceMismatch();
        uint256 dt=t-remainingToken();uint256 dq=q-heldQuote();tokenObserved+=dt;quoteObserved+=dq;
        if(dt!=0 || dq!=0)emit InventoryObserved(dt,dq);
    }
    /// Expected version prevents a queued execution from silently switching to a different adapter.
    function convert(uint256 amount,uint256 deadline,uint256 expectedVersion) external nonReentrant {
        if(expectedVersion!=adapterVersion || amount==0 || amount>maxInput || deadline<block.timestamp ||
            deadline-block.timestamp>maxHorizon)revert InvalidSwap();
        _sync();if(amount>remainingToken())revert InvalidSwap();
        _validateAdapter(adapter,adapterCodeHash);
        uint256 minOut=minimumOutput(amount);if(minOut==0)revert InvalidPrice();
        uint256 beforeToken=projectToken.balanceOf(address(this));uint256 beforeQuote=quoteToken.balanceOf(address(this));
        projectToken.forceApprove(adapter,amount);IPrizeSwapAdapter(adapter).swapExactInput(amount,minOut,deadline);
        projectToken.forceApprove(adapter,0);
        uint256 afterToken=projectToken.balanceOf(address(this));uint256 afterQuote=quoteToken.balanceOf(address(this));
        if(afterToken!=beforeToken-amount || afterQuote<beforeQuote || afterQuote-beforeQuote<minOut)revert BalanceMismatch();
        tokenSold+=amount;quoteObserved+=afterQuote-beforeQuote;
        emit Converted(adapterVersion,amount,afterQuote-beforeQuote,minOut);
    }
    function forwardQuote() external nonReentrant {
        _sync();uint256 amount=heldQuote();if(amount==0)return;
        uint256 beforeVault=quoteToken.balanceOf(address(vault));quoteForwarded+=amount;
        quoteToken.safeTransfer(address(vault),amount);
        if(quoteToken.balanceOf(address(this))!=0 || quoteToken.balanceOf(address(vault))!=beforeVault+amount)revert BalanceMismatch();
        vault.syncUSDG();emit QuoteForwarded(amount);
    }
}
