// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ShortOutcome} from "../draws/ShortOutcome.sol";
/// QIANQI11a050d Monthly V2 gate and weighted selection; no randomness authentication.
library MonthlyOutcome {
    function weight(uint256 x) internal pure returns(uint256) {
        require(x > 0 && x <= type(uint128).max,"entries");
        return (uint256(1)<<128)*x/(x+1);
    }
    function compute(bytes32 context,bytes32 seed,ShortOutcome.Participant[] memory people) internal pure returns(address winner,uint256 admitted) {
        ShortOutcome.participantsHash(people);
        require(context!=bytes32(0) && people.length>0 && people.length<=1000,"input");
        bool pays=uint256(keccak256(abi.encode(keccak256("MONTHLY_PAYOUT_V2"),context,seed)))>>254<3;
        uint256 total;
        for(uint256 i;i<people.length;i++) total+=weight(uint256(people[i].lastAttempt)-people[i].firstAttempt+1);
        uint256 random=uint256(keccak256(abi.encode(keccak256("MONTHLY_WINNER_V2"),context,seed)));
        uint256 max=type(uint256).max;
        uint256 point=Math.mulDiv(random,total,max);
        if(mulmod(random,total,max)<point)--point;
        uint256 offset;
        for(uint256 i;i<people.length;i++) {
            offset+=weight(uint256(people[i].lastAttempt)-people[i].firstAttempt+1);
            if(pays && winner==address(0) && point<offset)winner=people[i].wallet;
        }
        admitted=pays?people.length:0;
    }
}
