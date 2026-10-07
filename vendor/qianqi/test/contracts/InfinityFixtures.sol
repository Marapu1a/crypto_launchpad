// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IInfinityHook} from "../../contracts/InfinityCollector.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
contract InfinityHookFixture {
    IInfinityHook.Policy private p;
    uint64 public latest=1;
    uint64 public futureAt;
    function configure(address v,uint16 fee) external {p=IInfinityHook.Policy(1,fee,v,0);}
    function bump(bool future) external {++latest;if(future)futureAt=uint64(block.timestamp+1000);}
    function activePolicy(address) external view returns(IInfinityHook.Policy memory){return p;}
    function tokenStates(address) external view returns(uint64,bool,bool){return(latest,false,false);}
    function policies(address,uint64) external view returns(uint8,uint16,address,uint64){return(p.mode,p.feeBps,p.destination,futureAt);}
}
contract InfinityFactoryFixture {
    bool public valid=true;
    function setValid(bool v) external {valid=v;}
    function verifyVault(address,uint8,address) external view returns(bool){return valid;}
}
contract InfinityVaultFixture {
    address public projectToken;address public hook;address public admin;address public recipient;
    uint256 public epochCount=1;uint64 public epoch=1;uint16 public rate=300;
    mapping(address=>mapping(address=>uint256)) public claimable;
    uint256 public calls;uint8 public failure;
    address public callback;bytes public callbackData;bool public reentered;
    constructor(address t,address h,address a,address r){projectToken=t;hook=h;admin=a;recipient=r;}
    function currentPolicy() external view returns(uint64,address,uint16){return(epoch,recipient,rate);}
    function change(uint16 f,address r,bool future) external {++epochCount;if(!future){epoch=uint64(epochCount);rate=f;recipient=r;}}
    function fund(address asset,uint256 value) external {claimable[recipient][asset]+=value;}
    function setFailure(uint8 f) external {failure=f;}
    function setCallback(address c,bytes calldata d) external {callback=c;callbackData=d;}
    function claim(address[] calldata assets) external returns(uint256 amount){
        require(failure!=1,"claim failure");++calls;
        amount=claimable[msg.sender][assets[0]];require(amount!=0,"NoClaim");
        claimable[msg.sender][assets[0]]=0;
        if(callback!=address(0))(reentered,)=callback.call(callbackData);
        IERC20(assets[0]).transfer(msg.sender,failure==2?amount-1:amount);
        if(failure==3)++amount;
    }
}
