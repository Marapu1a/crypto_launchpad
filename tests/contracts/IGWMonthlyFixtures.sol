// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ShortProgram} from "../../contracts/production/ShortProgram.sol";
import {ShortDrandAdapter} from "../../contracts/production/ShortDrandAdapter.sol";
import "./Fixtures.sol";
// TEST ONLY: deterministic outcome branches, not production randomness verification.
contract IGWMonthlyHarness is ShortProgram {
 constructor(Setup memory s,uint256[] memory w,ShortDrandAdapter.Timing memory t) ShortProgram(s,w,t) {}
 function testSeed(bytes32 seed) external {require(pending&&!fulfilled[cycle]);verifiedSeed[cycle]=seed;fulfilled[cycle]=true;}
}
