// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {MonthlyProgram} from "../../contracts/production/MonthlyProgram.sol";
import {MonthlyOutcome} from "../../contracts/production/MonthlyOutcome.sol";
import {ShortOutcome} from "../../contracts/draws/ShortOutcome.sol";
import {ShortDrandAdapter} from "../../contracts/production/ShortDrandAdapter.sol";
import "./Fixtures.sol";
// TEST ONLY: deterministic branch coverage, never part of production artifact set.
contract MonthlyHarness is MonthlyProgram {
 constructor(Setup memory s,ShortDrandAdapter.Timing memory t) MonthlyProgram(s,t) {}
 function testSeed(bytes32 seed) external {require(pending&&!fulfilled[cycle]);verifiedSeed[cycle]=seed;fulfilled[cycle]=true;}
 function outcome(bytes32 context,bytes32 seed,ShortOutcome.Participant[] calldata p) external pure returns(address,uint256){return MonthlyOutcome.compute(context,seed,p);}
}
