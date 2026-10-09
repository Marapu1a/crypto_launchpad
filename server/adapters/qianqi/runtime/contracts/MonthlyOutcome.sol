// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ShortOutcome} from "./ShortOutcome.sol";

/// V1 is retained for historical/local consumers. V2 has one global 75/25 gate,
/// followed by selection proportional to floor(2^128 * entries/(entries+1)).
library MonthlyOutcome {
    function rulesHash(ShortOutcome.Rules memory r) internal pure returns(bytes32) {
        if(r.version==1)return ShortOutcome.rulesHash(r);
        require(r.version==2 && r.pNumerator==3 && r.pDenominator==4
            && r.hNumerator==1 && r.hDenominator==1,"monthly rules");
        return keccak256(abi.encode(keccak256("MONTHLY_OUTCOME_RULES_V2"),r));
    }
    function weight(uint256 entries) internal pure returns(uint256) {
        require(entries>0 && entries<=type(uint128).max,"monthly entries");
        return (uint256(1)<<128)*entries/(entries+1);
    }
    function pays(bytes32 context,bytes32 seed) internal pure returns(bool) {
        return uint256(keccak256(abi.encode(keccak256("MONTHLY_PAYOUT_V2"),context,seed)))>>254<3;
    }
    /// High 256 bits of hash*total, i.e. floor(hash*total/2^256).
    function ticket(uint256 hash,uint256 total) internal pure returns(uint256 q) {
        require(total>0,"monthly weight");
        uint256 max=type(uint256).max;
        q=Math.mulDiv(hash,total,max);
        if(mulmod(hash,total,max)<q)--q;
    }
    function selection(bytes32 context,bytes32 seed,uint256 total) internal pure returns(uint256) {
        return ticket(uint256(keccak256(abi.encode(keccak256("MONTHLY_WINNER_V2"),context,seed))),total);
    }
}
