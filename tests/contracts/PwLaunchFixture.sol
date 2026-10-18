// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IPonsFactory} from "../../contracts/production/PonsFeeCollector.sol";
interface IEscrowPW {function deposit(address) external payable;}
contract PwTokenFixture is ERC20 {
 address public minter;
 constructor(string memory name_,string memory symbol_) ERC20(name_,symbol_) {minter=msg.sender;}
 function setMinter(address next) external {require(msg.sender==minter);minter=next;}
 function mint(address to,uint256 amount) external {require(msg.sender==minter);_mint(to,amount);}
}
contract PwCurveFixture {
 address public immutable token;address public immutable factory;address public immutable deployer;address public immutable feeEscrow;
 address public constant pairToken=address(0);uint256 public immutable launchedAt;uint256 public creatorTaxBalance;uint256 public quoteFeeBalance;bool public graduated;
 event CurveBuy(address indexed buyer,address indexed recipient,uint256 quoteIn,uint256 tokensOut,uint256 fee,uint256 tax);
 constructor(address t,address f,address d,address e){token=t;factory=f;deployer=d;feeEscrow=e;launchedAt=block.timestamp;}
 function buy(address recipient) external payable {
  require(msg.value>0);uint256 tax=msg.value*300/10000;creatorTaxBalance+=tax;
  PwTokenFixture(token).mint(recipient,1);emit CurveBuy(msg.sender,recipient,msg.value,1,0,tax);
 }
 function sweepFees(uint256) external {require(msg.sender==deployer);uint256 amount=creatorTaxBalance;creatorTaxBalance=0;IEscrowPW(feeEscrow).deposit{value:amount}(deployer);}
}
// Economic/pricing model intentionally minimal. Implements collector's registry surface.
contract PwLaunchFixture {
 address public immutable escrow;mapping(address=>IPonsFactory.Launch) private launches;
 constructor(address e){escrow=e;}
 function launch(string calldata name,string calldata symbol,address collector) external returns(address token,address curve){
  PwTokenFixture t=new PwTokenFixture(name,symbol);token=address(t);
  curve=address(new PwCurveFixture(token,address(this),collector,escrow));t.setMinter(curve);
  launches[token]=IPonsFactory.Launch(token,curve,msg.sender,collector,address(0),4200000,3000,60,300,false,0,0,0,0,true);
 }
 function getLaunchedToken(address token) external view returns(IPonsFactory.Launch memory){return launches[token];}
}
