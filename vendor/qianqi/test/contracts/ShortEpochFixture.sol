// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ShortRulesEpochs} from "../../contracts/ShortRulesEpochs.sol";
import {ShortOutcome} from "../../contracts/ShortOutcome.sol";
/// TEST ONLY: no authenticated randomness, no production readiness/roles.
contract ShortEpochFixture is ShortRulesEpochs {
    address private immutable publisher = msg.sender;
    constructor(address v,address r,bytes32 i,uint256 notice,ShortOutcome.Rules memory rules,uint256[] memory weights)
        ShortRulesEpochs(v,r,i,notice,rules,weights,1) {}
    modifier onlyPublisher(){require(msg.sender==publisher,"publisher");_;}
    function announce(ShortOutcome.Rules calldata r,uint256[] calldata w,uint256 m) external onlyPublisher {_announceShortRules(r,w,m);}
    function activate() external {_activateShortRules();}
    function begin(bytes32 id,Request calldata r) external onlyPublisher {_beginEpochDataset(id,r);}
    function publish(bytes32 id,ShortOutcome.Participant[] calldata data) external onlyPublisher {_publishDataset(id,data);}
    function supersede(bytes32 id) external onlyPublisher {_supersedeDataset(id);}
    function seal(bytes32 id) external {_sealEpochDataset(id);}
    function closeEmpty(uint256 c,bytes32 h,bytes32 s) external onlyPublisher {_closeEmptyShortEpoch(c,h,s);}
    function finish(bytes32 id,address[] calldata w,uint256[] calldata a) external onlyPublisher nonReentrant {
        datasetVault.finalize(id,w,a);_completeEpochDraw(id,w.length==0?0:1,keccak256(abi.encode(w,a)));
    }
}
