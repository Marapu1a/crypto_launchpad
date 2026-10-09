// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockToken} from "./Fixtures.sol";

contract LocalUSDGFixture is MockToken {
    function decimals() public pure override returns(uint8) { return 6; }
}

/// Local integration venue, NOT PAIR/Universal Router or an AMM implementation.
/// Executes the decoder's narrow calldata shape with real ERC20 transfers.
/// Fixed 2:1 output has no economic meaning. Router/manager/hook share this address.
contract LocalBuyFixture {
    struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }
    struct SwapInput { PoolKey key; bool zeroForOne; uint128 amount; uint128 minimum; uint256 price; bytes hookData; }
    IERC20 public immutable token;
    IERC20 public immutable quote;
    event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee);
    constructor(address t,address q) { require(block.chainid==31337,"local only");token=IERC20(t);quote=IERC20(q); }
    function execute(bytes calldata commands,bytes[] calldata inputs,uint256 deadline) external payable {
        require(msg.value==0 && block.timestamp<=deadline && keccak256(commands)==keccak256(hex"10") && inputs.length==1,"route");
        (bytes memory actions,bytes[] memory parameters)=abi.decode(inputs[0],(bytes,bytes[]));
        bool all=keccak256(actions)==keccak256(hex"060c0f");
        require((all || keccak256(actions)==keccak256(hex"060b0e")) && parameters.length==3,"actions");
        SwapInput memory s=abi.decode(parameters[0],(SwapInput));
        if(all){
            (address currency,uint256 maximum)=abi.decode(parameters[1],(address,uint256));
            (address take,uint256 minimum)=abi.decode(parameters[2],(address,uint256));
            require(currency==address(quote) && maximum>=s.amount && take==address(token) && minimum<=uint256(s.amount)*2,"all settlement");
        } else {
            (address currency,uint256 amount,bool user)=abi.decode(parameters[1],(address,uint256,bool));
            require(currency==address(quote) && amount==0 && user,"payment route");
        }
        if(!all){
            (address take,address recipient,uint256 takeAmount)=abi.decode(parameters[2],(address,address,uint256));
            require(take==address(token) && recipient==msg.sender && takeAmount==0,"delivery route");
        }
        bool quote0=s.key.currency0==address(quote);
        require(s.key.currency0<s.key.currency1 && (quote0?s.key.currency1:s.key.currency0)==address(token)
            && (quote0?s.key.currency0:s.key.currency1)==address(quote) && s.key.hooks==address(this),"pool");
        require(s.zeroForOne==quote0 && s.price==0 && s.hookData.length==0 && s.amount>0
            && uint256(s.amount)*2<=uint256(uint128(type(int128).max)),"swap");
        require(uint256(s.amount)*2>=s.minimum,"minimum");
        int128 paid=int128(s.amount);int128 received=paid*2;
        emit Swap(keccak256(abi.encode(s.key)),address(this),quote0?-paid:received,quote0?received:-paid,1,1,0,s.key.fee);
        require(quote.transferFrom(msg.sender,address(this),s.amount),"payment");
        require(token.transfer(msg.sender,uint128(received)),"delivery");
    }
}
