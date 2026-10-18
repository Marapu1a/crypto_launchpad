// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {NativeFeeCollector} from "./NativeFeeCollector.sol";
import {IPonsFactory,IPonsCurve} from "../PonsFeeCollector.sol";
contract NativePonsFeeCollector is NativeFeeCollector {
    IPonsFactory public immutable factory;
    address public immutable binder;
    address public token;
    address public curve;
    event Bound(address indexed token,address indexed curve);
    constructor(address asset,address escrow_,address destination_,address factory_)
        NativeFeeCollector(asset,escrow_,destination_){
        require(factory_.code.length>0,"factory");factory=IPonsFactory(factory_);binder=msg.sender;
    }
    function bind(address token_) external nonReentrant {
        require(msg.sender==binder && token==address(0),"binding authority/state");
        IPonsFactory.Launch memory launch=factory.getLaunchedToken(token_);
        require(launch.exists && launch.token==token_ && launch.creatorFeeRecipient==address(this)
            && launch.pairToken==address(0) && !launch.buybackEnabled,"launch binding");
        IPonsCurve venue=IPonsCurve(launch.curve);
        require(venue.token()==token_ && venue.factory()==address(factory) && venue.pairToken()==address(0)
            && venue.deployer()==address(this) && venue.feeEscrow()==escrow,"curve binding");
        token=token_;curve=launch.curve;emit Bound(token_,curve);
    }
    function sweepCurve() external nonReentrant {
        require(curve!=address(0),"unbound");IPonsCurve(curve).sweepFees(0);
    }
}
