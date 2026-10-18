// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {INativeFund,INativeEscrow} from "../production/native/NativeFeeCollector.sol";
import {IPonsFactory,IPonsCurve} from "../production/PonsFeeCollector.sol";

/// New holder-only collector. Legacy deployed/native draw collectors are untouched.
contract NativeHolderCollector is ReentrancyGuard {
    bytes32 public constant accountingVersion=keccak256("holder-escrow-fees-v1");
    address public constant quote=address(0);
    address public immutable escrow;
    INativeFund public immutable destination;
    IPonsFactory public immutable factory;
    address public immutable binder;
    address public token;
    address public curve;
    uint256 public forwardableFees;
    bool private collecting;
    event Bound(address indexed token,address indexed curve);
    event Collected(uint256 received);
    event Forwarded(uint256 sent,uint256 received);
    constructor(address escrow_,address destination_,address factory_) {
        require(block.chainid==4663,"chain");
        require(escrow_.code.length>0 && destination_.code.length>0 && factory_.code.length>0,"contracts");
        require(INativeFund(destination_).quote()==address(0),"asset");
        escrow=escrow_;destination=INativeFund(destination_);factory=IPonsFactory(factory_);binder=msg.sender;
    }
    receive() external payable {
        // Unsolicited and forced ETH cannot increase the fee counter.
        if(collecting && msg.sender==escrow)forwardableFees+=msg.value;
    }
    function quarantined() external view returns(uint256) {return address(this).balance-forwardableFees;}
    function bind(address token_) external nonReentrant {
        require(msg.sender==binder && token==address(0),"binding");
        IPonsFactory.Launch memory launch=factory.getLaunchedToken(token_);
        require(launch.exists && launch.token==token_ && launch.creatorFeeRecipient==address(this)
            && launch.pairToken==address(0) && !launch.buybackEnabled,"launch binding");
        IPonsCurve venue=IPonsCurve(launch.curve);
        require(venue.token()==token_ && venue.factory()==address(factory) && venue.pairToken()==address(0)
            && venue.deployer()==address(this) && venue.feeEscrow()==escrow,"curve binding");
        token=token_;curve=launch.curve;emit Bound(token_,curve);
    }
    function sweepCurve() external nonReentrant {require(curve!=address(0),"unbound");IPonsCurve(curve).sweepFees(0);}
    function collect() external nonReentrant returns(uint256 received) {
        require(curve!=address(0),"unbound");uint256 beforeFees=forwardableFees;
        collecting=true;INativeEscrow(escrow).claim();collecting=false;
        received=forwardableFees-beforeFees;emit Collected(received);
    }
    function forward() external nonReentrant returns(uint256 received) {
        uint256 fees=forwardableFees;require(fees>0 && address(this).balance>=fees,"empty/solvency");
        forwardableFees=0;received=destination.fund{value:fees}(fees);require(received==fees,"receipt");
        emit Forwarded(fees,received);
    }
}
