// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {MonthlyOutcome} from "../../contracts/MonthlyOutcome.sol";
import {ShortOutcome} from "../../contracts/ShortOutcome.sol";
contract MonthlyOutcomeFixture {
    function weight(uint256 e) external pure returns(uint256){return MonthlyOutcome.weight(e);}
    function ticket(uint256 h,uint256 t) external pure returns(uint256){return MonthlyOutcome.ticket(h,t);}
    function pays(bytes32 c,bytes32 s) external pure returns(bool){return MonthlyOutcome.pays(c,s);}
    function rulesHash(ShortOutcome.Rules calldata r) external pure returns(bytes32){return MonthlyOutcome.rulesHash(r);}
}
