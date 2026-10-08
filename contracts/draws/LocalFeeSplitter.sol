// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFund} from "./LocalFeeCollector.sol";

/// Local-only immutable fee policy. Carry fractional entitlements across receipts.
contract LocalFeeSplitter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable quote;
    IFund public immutable prizeFund;
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
        require(block.chainid==31337,"local only");
        require(asset.code.length>0 && fund_.code.length>0 && IFund(fund_).quote()==asset,"asset/fund");
        require(team_!=address(0) && operations_!=address(0) && team_!=address(this) && operations_!=address(this),"recipient");
        require(shares[0]>0 && uint256(shares[0])+shares[1]+shares[2]==10000,"shares");
        quote=IERC20(asset);prizeFund=IFund(fund_);team=team_;operations=operations_;bps=shares;
    }
    function roundingReserve() public view returns(uint256) {
        return totalReceived-allocated[0]-allocated[1]-allocated[2];
    }
    function solvent() public view returns(bool) {
        return quote.balanceOf(address(this)) >= credit[0]+credit[1]+credit[2]+roundingReserve();
    }
    function fund(uint256 amount) external nonReentrant returns(uint256 received) {
        require(amount>0 && solvent(),"funding");
        uint256 beforeBalance=quote.balanceOf(address(this));
        quote.safeTransferFrom(msg.sender,address(this),amount);
        received=quote.balanceOf(address(this))-beforeBalance;
        require(received>0,"empty receipt");totalReceived+=received;
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
            recipient=address(prizeFund);quote.forceApprove(recipient,amount);
            require(prizeFund.fund(amount)==amount,"unsupported transfer fee");
            quote.forceApprove(recipient,0);
        } else {
            recipient=lane==1?team:operations;quote.safeTransfer(recipient,amount);
        }
        emit Delivered(lane,recipient,amount);
    }
}
