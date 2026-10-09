// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPrizeSwapAdapter} from "./IPrizeSwapAdapter.sol";

interface IPrizeDestination {
    function projectToken() external view returns(address);
    function quoteToken() external view returns(address);
    function syncUSDG() external;
}

/// LOCAL ONLY: immutable raw-unit price floor is a test assumption, NOT a market oracle.
/// No owner, destination changes, rescue, arbitrary calls or campaign-specific conversion P&L.
contract LocalPrizeConverter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable projectToken;
    IERC20 public immutable quoteToken;
    IPrizeDestination public immutable vault;
    IPrizeSwapAdapter public immutable adapter;
    uint256 public immutable floorNumerator;
    uint256 public immutable floorDenominator;
    uint256 public immutable maxInput;
    uint256 public immutable maxHorizon;
    uint256 public tokenObserved;
    uint256 public tokenSold;
    uint256 public quoteObserved;
    uint256 public quoteForwarded;
    error InvalidConfiguration();
    error InvalidSwap();
    error BalanceMismatch();
    event InventoryObserved(uint256 tokenAmount, uint256 quoteAmount);
    event Converted(uint256 amountIn, uint256 amountOut, uint256 minimumOut);
    event QuoteForwarded(uint256 amount);

    constructor(address token,address quote,address destination,address route,
        uint256 numerator,uint256 denominator,uint256 portion,uint256 horizon) {
        if(block.chainid!=31337 || token==quote || token.code.length==0 || quote.code.length==0 ||
            destination.code.length==0 || route.code.length==0 || destination==route ||
            numerator==0 || denominator==0 || portion==0 || horizon==0) revert InvalidConfiguration();
        if(IPrizeDestination(destination).projectToken()!=token || IPrizeDestination(destination).quoteToken()!=quote ||
            IPrizeSwapAdapter(route).tokenIn()!=token || IPrizeSwapAdapter(route).tokenOut()!=quote) revert InvalidConfiguration();
        projectToken=IERC20(token);quoteToken=IERC20(quote);vault=IPrizeDestination(destination);
        adapter=IPrizeSwapAdapter(route);floorNumerator=numerator;floorDenominator=denominator;
        maxInput=portion;maxHorizon=horizon;
    }
    function remainingToken() public view returns(uint256) { return tokenObserved-tokenSold; }
    function heldQuote() public view returns(uint256) { return quoteObserved-quoteForwarded; }
    function minimumOutput(uint256 amount) public view returns(uint256) {
        return Math.mulDiv(amount,floorNumerator,floorDenominator,Math.Rounding.Ceil);
    }
    /// Direct donations and router payouts are observed without asserting sender provenance.
    function sync() external nonReentrant { _sync(); }
    function _sync() private {
        uint256 t=projectToken.balanceOf(address(this));uint256 q=quoteToken.balanceOf(address(this));
        if(t<remainingToken() || q<heldQuote()) revert BalanceMismatch();
        uint256 dt=t-remainingToken();uint256 dq=q-heldQuote();
        tokenObserved+=dt;quoteObserved+=dq;
        if(dt!=0 || dq!=0)emit InventoryObserved(dt,dq);
    }
    /// Failure never consumes inventory. Executor cannot select route, output wallet or price floor.
    function convert(uint256 amount,uint256 deadline) external nonReentrant {
        _sync();
        if(amount==0 || amount>remainingToken() || amount>maxInput || deadline<block.timestamp ||
            deadline-block.timestamp>maxHorizon) revert InvalidSwap();
        uint256 minOut=minimumOutput(amount);
        uint256 beforeToken=projectToken.balanceOf(address(this));uint256 beforeQuote=quoteToken.balanceOf(address(this));
        projectToken.forceApprove(address(adapter),amount);
        adapter.swapExactInput(amount,minOut,deadline);
        projectToken.forceApprove(address(adapter),0);
        uint256 afterToken=projectToken.balanceOf(address(this));uint256 afterQuote=quoteToken.balanceOf(address(this));
        if(afterToken!=beforeToken-amount || afterQuote<beforeQuote || afterQuote-beforeQuote<minOut) revert BalanceMismatch();
        tokenSold+=amount;quoteObserved+=afterQuote-beforeQuote;
        emit Converted(amount,afterQuote-beforeQuote,minOut);
    }
    /// Quote forwarding is independent of swap availability; vault recognition is atomic with transfer.
    function forwardQuote() external nonReentrant {
        _sync();uint256 amount=heldQuote();if(amount==0)return;
        uint256 beforeVault=quoteToken.balanceOf(address(vault));
        quoteForwarded+=amount;
        quoteToken.safeTransfer(address(vault),amount);
        if(quoteToken.balanceOf(address(this))!=0 || quoteToken.balanceOf(address(vault))!=beforeVault+amount)
            revert BalanceMismatch();
        vault.syncUSDG();emit QuoteForwarded(amount);
    }
}
