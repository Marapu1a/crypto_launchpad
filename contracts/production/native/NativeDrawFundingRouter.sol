// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {INativeFund} from "./NativeFeeCollector.sol";

/// Immutable per-project prize routing. Does not allocate team/operations revenue.
contract NativeDrawFundingRouter is ReentrancyGuard {
    bytes32 public constant PROFILE=keccak256("launchpad-draw-funding-native-v1");
    address public constant quote = address(0);
    address public immutable shortFund;
    address public immutable monthlyFund;
    uint16 public immutable shortBps;
    uint256 public totalReceived;
    uint256[2] public allocated;
    uint256[2] public credit;
    event Funded(address indexed payer,uint256 received);
    event Allocated(uint256 indexed lane,uint256 amount);
    event Delivered(uint256 indexed lane,address indexed recipient,uint256 amount);
    constructor(address asset,address short_,address monthly_,uint16 share){
        require(block.chainid==4663 && asset==address(0),"chain/asset");
        require(share<=10000,"share");
        require((share==0)==(short_==address(0)) && (share==10000)==(monthly_==address(0)),"mode");
        require(short_!=monthly_,"distinct funds");
        if(short_!=address(0))require(short_.code.length>0 && INativeFund(short_).quote()==asset,"short asset");
        if(monthly_!=address(0))require(monthly_.code.length>0 && INativeFund(monthly_).quote()==asset,"monthly asset");
        shortFund=short_;monthlyFund=monthly_;shortBps=share;
    }
    function solvent() public view returns(bool){return address(this).balance>=credit[0]+credit[1];}
    function fund(uint256 amount) external payable nonReentrant returns(uint256 received){
        require(amount>0 && msg.value==amount && address(this).balance-msg.value>=credit[0]+credit[1],"funding");
        received=amount;
        totalReceived+=received;
        uint256 shortTotal=Math.mulDiv(totalReceived,shortBps,10000,Math.Rounding.Ceil);
        uint256[2] memory targets=[shortTotal,totalReceived-shortTotal];
        for(uint256 i;i<2;i++){
            uint256 delta=targets[i]-allocated[i];allocated[i]=targets[i];credit[i]+=delta;
            emit Allocated(i,delta);
        }
        emit Funded(msg.sender,received);
    }
    /// Delivery is separate per lane. Reverting recipient cannot consume its credit
    /// or prevent delivery to the other lane. Caller cannot redirect funds.
    function deliver(uint256 lane) external nonReentrant {
        require(lane<2 && solvent(),"lane/solvency");
        uint256 value=credit[lane];require(value>0,"empty");credit[lane]=0;
        address destination=lane==0?shortFund:monthlyFund;
        uint256 beforeBalance=address(this).balance;
        require(INativeFund(destination).fund{value:value}(value)==value,"receipt");
        require(address(this).balance==beforeBalance-value,"transfer");
        emit Delivered(lane,destination,value);
    }
}
