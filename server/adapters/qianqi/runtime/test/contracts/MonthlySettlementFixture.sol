// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {MonthlySettlement} from "../../contracts/MonthlySettlement.sol";
import {ShortOutcome} from "../../contracts/ShortOutcome.sol";
/// TEST ONLY. Publisher seed injection is not production randomness.
contract MonthlySettlementFixture is MonthlySettlement {
    address private immutable publisher=msg.sender;
    constructor(address v,address r,bytes32 i,uint256 interval,uint256 notice,ShortOutcome.Rules memory rules) MonthlySettlement(v,r,i,interval,notice,rules){}
    modifier onlyPublisher(){require(msg.sender==publisher,"publisher");_;}
    function beginMonth(Input calldata input) external onlyPublisher {_beginMonth(input);}
    function publishMonth(bytes32 id,ShortOutcome.Participant[] calldata data) external onlyPublisher {_publishMonth(id,data);}
    function supersedeMonth(bytes32 id) external onlyPublisher {_supersedeMonth(id);}
    function sealMonth(bytes32 id) external {_sealMonth(id);}
    function supplySeed(bytes32 id,bytes32 seed) external onlyPublisher {_acceptMonthlySeed(id,seed);}
    function announce(ShortOutcome.Rules calldata rules) external onlyPublisher {_announceMonthlyRules(rules);}
    function activate() external {_activateMonthlyRules();}
    function closeEmpty(uint256 c,bytes32 h,bytes32 s) external onlyPublisher {_closeEmptyMonthlyEpoch(c,h,s);}
}

/// Deliberately malicious caller for exhaustive vault authorization tests.
contract ScopedCallerFixture {
    address public immutable datasetVault;
    address public immutable monthlyVault;
    constructor(address v){datasetVault=v;monthlyVault=v;}
    function attack(bytes calldata data,bool failAfter) external returns(bytes memory){
        (bool ok,bytes memory result)=datasetVault.call(data);
        if(!ok)assembly("memory-safe"){revert(add(result,32),mload(result))}
        require(!failAfter,"post-vault failure");return result;
    }
}
