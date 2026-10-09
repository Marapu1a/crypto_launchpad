// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPrizeSwapAdapter} from "../../contracts/IPrizeSwapAdapter.sol";
interface IReenterConverter { function sync() external; }
/// Test-only funded exchange; NOT a DEX or a trusted price source.
contract PrizeSwapFixture is IPrizeSwapAdapter {
    address public immutable tokenIn;
    address public immutable tokenOut;
    uint256 public immutable numerator;
    uint256 public immutable denominator;
    uint8 public failureMode;
    constructor(address token,address quote,uint256 n,uint256 d) {
        tokenIn=token;tokenOut=quote;numerator=n;denominator=d;
    }
    function setFailure(uint8 mode) external { failureMode=mode; }
    function swapExactInput(uint256 amount,uint256,uint256 deadline) external {
        require(block.timestamp<=deadline && failureMode!=1,"unavailable");
        if(failureMode==3)IReenterConverter(msg.sender).sync();
        uint256 spend=failureMode==4?amount-1:amount;
        require(IERC20(tokenIn).transferFrom(msg.sender,address(this),spend));
        uint256 output=failureMode==2?amount:amount*numerator/denominator;
        if(failureMode==6)output=amount*numerator*100/(denominator*(100+amount)); // Synthetic depth for quote selection tests.
        require(IERC20(tokenOut).transfer(failureMode==5?address(1):msg.sender,output));
    }
}
