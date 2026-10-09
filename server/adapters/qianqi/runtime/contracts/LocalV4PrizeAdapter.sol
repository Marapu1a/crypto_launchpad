// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPrizeSwapAdapter} from "./IPrizeSwapAdapter.sol";
interface IPrizePermit2 { function approve(address token,address spender,uint160 amount,uint48 expiration) external; }
interface IPrizeUniversalRouter {
    function execute(bytes calldata commands,bytes[] calldata inputs,uint256 deadline) external payable;
    function poolManager() external view returns(address);
}
/// One ERC20/ERC20 pool, exact input, no arbitrary calldata, recipient is the invoking converter.
/// Local-only until deployment bindings are established. Runtime hashes do not pin proxy dependencies.
contract LocalV4PrizeAdapter is IPrizeSwapAdapter, ReentrancyGuard {
    using SafeERC20 for IERC20;
    struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }
    struct Swap { PoolKey poolKey; bool zeroForOne; uint128 amountIn; uint128 minimum; uint256 minHopPriceX36; bytes hookData; }
    address public immutable tokenIn;
    address public immutable tokenOut;
    address public immutable router;
    address public immutable permit2;
    address public immutable manager;
    bytes32 public immutable routerHash;
    bytes32 public immutable permitHash;
    bytes32 public immutable managerHash;
    bytes32 public immutable hookHash;
    PoolKey public poolKey;
    error InvalidRoute();
    error InvalidSwap();
    constructor(address token,address quote,address route,address permit,address poolManager,PoolKey memory key) {
        if(block.chainid!=31337 || token==quote || token.code.length==0 || quote.code.length==0 ||
            route.code.length==0 || permit.code.length==0 || poolManager.code.length==0 || key.hooks.code.length==0 ||
            key.currency0>=key.currency1 || key.tickSpacing<=0 ||
            !((key.currency0==token&&key.currency1==quote)||(key.currency0==quote&&key.currency1==token)))revert InvalidRoute();
        // This router release does not expose its internal Permit2 immutable via a getter.
        // Permit2 binding is deployment evidence; a mismatch cannot complete a normal swap.
        if(IPrizeUniversalRouter(route).poolManager()!=poolManager)revert InvalidRoute();
        tokenIn=token;tokenOut=quote;router=route;permit2=permit;manager=poolManager;poolKey=key;
        routerHash=route.codehash;permitHash=permit.codehash;managerHash=poolManager.codehash;hookHash=key.hooks.codehash;
    }
    function swapExactInput(uint256 amount,uint256 minimum,uint256 deadline) external nonReentrant {
        if(amount==0||amount>type(uint128).max||minimum==0||minimum>type(uint128).max||deadline<block.timestamp||deadline>type(uint48).max)revert InvalidSwap();
        if(router.codehash!=routerHash||permit2.codehash!=permitHash||manager.codehash!=managerHash||poolKey.hooks.codehash!=hookHash)revert InvalidRoute();
        IERC20 token=IERC20(tokenIn);uint256 beforeBalance=token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender,address(this),amount);
        if(token.balanceOf(address(this))!=beforeBalance+amount)revert InvalidSwap();
        token.forceApprove(permit2,amount);
        IPrizePermit2(permit2).approve(tokenIn,router,uint160(amount),uint48(deadline));
        bytes[] memory actions=new bytes[](3);
        actions[0]=abi.encode(Swap(poolKey,tokenIn==poolKey.currency0,uint128(amount),uint128(minimum),0,bytes("")));
        actions[1]=abi.encode(tokenIn,uint256(0),true);
        actions[2]=abi.encode(tokenOut,msg.sender,uint256(0));
        bytes[] memory inputs=new bytes[](1);inputs[0]=abi.encode(hex"060b0e",actions);
        IPrizeUniversalRouter(router).execute(hex"10",inputs,deadline);
        IPrizePermit2(permit2).approve(tokenIn,router,0,0);
        token.forceApprove(permit2,0);
        if(token.balanceOf(address(this))!=beforeBalance)revert InvalidSwap();
    }
}
