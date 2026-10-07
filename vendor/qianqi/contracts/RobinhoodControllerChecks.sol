// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface IDrandDeployment {
    function PROFILE() external view returns(bytes32);
    function CHAIN_HASH() external view returns(bytes32);
    function shortConsumer() external view returns(address);
    function monthlyConsumer() external view returns(address);
    function fee() external view returns(uint256);
}
/// Constructor binding checks, not bytecode authentication or a finality oracle.
/// Deployment manifest must independently pin the exact compiled adapter runtime.
library RobinhoodControllerChecks {
    function verify(address provider,bool isShort) internal view {
        require(block.chainid==4663,"robinhood chain");
        IDrandDeployment r=IDrandDeployment(provider);
        require(r.PROFILE()==keccak256("drand-evmnet-operational-v1")
            && r.CHAIN_HASH()==0x04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3
            && r.fee()==0,"drand profile");
        address own=isShort?r.shortConsumer():r.monthlyConsumer();
        address peer=isShort?r.monthlyConsumer():r.shortConsumer();
        require(own==address(this)&&peer!=address(0)&&peer!=own,"drand binding");
    }
}
