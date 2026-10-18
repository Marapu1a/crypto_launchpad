// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {INativeFund} from "./NativeFeeCollector.sol";

/// Chain-4663 immutable fee policy. Carry fractional entitlements across receipts.
contract NativeFeeSplitter is ReentrancyGuard {
    address public constant quote = address(0);
    INativeFund public immutable prizeFund;
    address public immutable team;
    address public immutable operations;
    uint16[3] public bps;
    uint256 public totalReceived;
    uint256[3] public allocated;
    uint256[3] public credit;
    event Revenue(uint256 received, uint256 totalReceived);
    event Allocated(uint256 indexed lane, uint256 amount);
    event Delivered(uint256 indexed lane, address indexed recipient, uint256 amount);
    constructor(address asset, address fund_, address team_, address operations_, uint16[3] memory shares) {
        require(block.chainid==4663,"chain 4663");
        require(asset==address(0) && fund_.code.length>0 && INativeFund(fund_).quote()==asset,"asset/fund");
        require(team_!=address(0) && operations_!=address(0) && team_!=address(this) && operations_!=address(this),"recipient");
        require(shares[0]>0 && uint256(shares[0])+shares[1]+shares[2]==10000,"shares");
        prizeFund=INativeFund(fund_);team=team_;operations=operations_;bps=shares;
    }
    function roundingReserve() public view returns(uint256) {
        return totalReceived-allocated[0]-allocated[1]-allocated[2];
    }
    function solvent() public view returns(bool) {
        return address(this).balance >= credit[0]+credit[1]+credit[2]+roundingReserve();
    }
    function fund(uint256 amount) external payable nonReentrant returns(uint256 received) {
        require(amount>0 && msg.value==amount && address(this).balance-msg.value>=credit[0]+credit[1]+credit[2]+roundingReserve(),"funding");
        received=amount;totalReceived+=received;
        for(uint256 i;i<3;i++) {
            uint256 target=Math.mulDiv(totalReceived,bps[i],10000);
            uint256 delta=target-allocated[i];allocated[i]=target;credit[i]+=delta;
            emit Allocated(i,delta);
        }
        emit Revenue(received,totalReceived);
    }
    /// Anyone may deliver accrued credit, but cannot change its destination.
    function deliver(uint256 lane) external nonReentrant {
        require(lane<3 && solvent(),"lane/solvency");
        uint256 amount=credit[lane];require(amount>0,"empty");credit[lane]=0;
        address recipient;
        if(lane==0) {
            recipient=address(prizeFund);
            require(prizeFund.fund{value:amount}(amount)==amount,"unsupported transfer fee");
        } else {
            recipient=lane==1?team:operations;(bool ok,)=payable(recipient).call{value:amount}("");require(ok,"native payout");
        }
        emit Delivered(lane,recipient,amount);
    }
}
