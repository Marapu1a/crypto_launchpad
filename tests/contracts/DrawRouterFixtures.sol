// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DrawFundingRouter} from "../../contracts/production/DrawFundingRouter.sol";
import "./MonthlyFixtures.sol";
contract ToggleFund {
 address public immutable quote;
 uint256 public mode;
 constructor(address asset){quote=asset;}
 function setMode(uint256 m) external {mode=m;}
 function fund(uint256 amount) external returns(uint256){
  require(mode!=1,"paused");if(mode==2)return amount;
  require(IERC20(quote).transferFrom(msg.sender,address(this),amount));return amount;
 }
}
