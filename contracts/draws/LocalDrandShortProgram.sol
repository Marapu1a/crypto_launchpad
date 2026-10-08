// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {LocalShortProgram} from "./LocalShortProgram.sol";
import {LocalDrandAdapter} from "./LocalDrandAdapter.sol";

/// Local execution with real drand proof verification. Not production admitted.
contract LocalDrandShortProgram is LocalShortProgram {
    LocalDrandAdapter public immutable randomness;
    mapping(uint256=>uint256) public requestForCycle;
    mapping(uint256=>uint256) public cycleForRequest;
    mapping(uint256=>bytes32) public verifiedSeed;
    mapping(uint256=>bool) public fulfilled;
    event RandomnessBound(uint256 indexed cycle,uint256 indexed requestId);
    event RandomnessReady(uint256 indexed cycle,bytes32 seed);
    constructor(address asset,address operator_,uint256 interval_,uint256 minimumFund_,uint256 minimumUnit_,uint256[] memory weights_,LocalDrandAdapter.Timing memory timing)
        LocalShortProgram(asset,operator_,interval_,minimumFund_,minimumUnit_,weights_) {
        randomness=new LocalDrandAdapter(address(this),timing);
    }
    function _onFrozen(bytes32 context) internal override {
        uint256 requestId=randomness.request(context);
        require(requestId!=0 && cycleForRequest[requestId]==0,"request reuse");
        requestForCycle[cycle]=requestId;cycleForRequest[requestId]=cycle;
        emit RandomnessBound(cycle,requestId);
    }
    function fulfill(uint256 requestId,bytes32 seed) external nonReentrant {
        require(msg.sender==address(randomness),"randomness only");
        uint256 target=cycleForRequest[requestId];
        require(pending && target==cycle && target!=0 && !fulfilled[target],"request mismatch");
        verifiedSeed[target]=seed;fulfilled[target]=true;
        emit RandomnessReady(target,seed);
    }
    function _authorizeSeed(bytes32 seed) internal view override {
        require(fulfilled[cycle] && verifiedSeed[cycle]==seed,"verified seed required");
    }
}
