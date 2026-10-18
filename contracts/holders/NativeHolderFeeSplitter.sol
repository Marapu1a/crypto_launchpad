// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {INativeFund} from "../production/native/NativeFeeCollector.sol";
interface ICollectorDestination {
    function destination() external view returns(address);
    function quote() external view returns(address);
}
interface IHolderIdentity { function instance() external view returns(bytes32); }

/// Separate immutable policy for new launches; legacy draw splitters are unchanged.
contract NativeHolderFeeSplitter is ReentrancyGuard {
    address public constant quote=address(0);
    bytes32 public immutable instance;
    address public immutable registrar;
    address public source;
    INativeFund public immutable holderFund;
    INativeFund public immutable drawFund;
    address public immutable project;
    uint16[3] public bps;
    uint256 public totalReceived;
    uint256[3] public allocated;
    uint256[3] public credit;
    event SourceBound(address indexed source);
    event Revenue(bytes32 indexed instance,address indexed source,uint256 amount,uint256 totalReceived);
    event Delivered(uint256 indexed lane,address indexed recipient,uint256 amount);
    constructor(bytes32 instance_,address holders_,address draw_,address project_,uint16[3] memory shares) {
        require(block.chainid==4663 && instance_!=bytes32(0),"chain/instance");
        require(holders_.code.length>0 && draw_.code.length>0 && holders_!=draw_,"funds");
        require(INativeFund(holders_).quote()==address(0) && INativeFund(draw_).quote()==address(0)
            && IHolderIdentity(holders_).instance()==instance_,"asset/instance");
        require(project_!=address(0) && project_!=holders_ && project_!=draw_ && project_!=address(this),"project");
        require(shares[0]>0 && shares[1]>0 && shares[2]>0 && uint256(shares[0])+shares[1]+shares[2]==10000,"shares");
        instance=instance_;registrar=msg.sender;holderFund=INativeFund(holders_);drawFund=INativeFund(draw_);project=project_;bps=shares;
    }
    function bindSource(address source_) external {
        require(msg.sender==registrar && source==address(0),"binding");
        require(source_.code.length>0 && ICollectorDestination(source_).destination()==address(this)
            && ICollectorDestination(source_).quote()==address(0),"source");
        source=source_;emit SourceBound(source_);
    }
    function roundingReserve() public view returns(uint256) {return totalReceived-allocated[0]-allocated[1]-allocated[2];}
    function solvent() public view returns(bool) {return address(this).balance>=credit[0]+credit[1]+credit[2]+roundingReserve();}
    function fund(uint256 amount) external payable nonReentrant returns(uint256) {
        require(msg.sender==source && source!=address(0),"source");
        require(amount>0 && amount==msg.value,"amount");
        require(address(this).balance-msg.value>=credit[0]+credit[1]+credit[2]+roundingReserve(),"solvency");
        totalReceived+=amount;
        for(uint256 i;i<3;i++){
            uint256 target=Math.mulDiv(totalReceived,bps[i],10000);
            credit[i]+=target-allocated[i];allocated[i]=target;
        }
        emit Revenue(instance,msg.sender,amount,totalReceived);return amount;
    }
    function deliver(uint256 lane) external nonReentrant {
        require(lane<3 && solvent(),"lane/solvency");uint256 amount=credit[lane];require(amount>0,"empty");
        credit[lane]=0;address recipient;
        if(lane<2){
            INativeFund destination=lane==0?holderFund:drawFund;recipient=address(destination);
            require(destination.fund{value:amount}(amount)==amount,"receipt");
        }else{recipient=project;(bool ok,)=payable(recipient).call{value:amount}("");require(ok,"native payout");}
        emit Delivered(lane,recipient,amount);
    }
}
