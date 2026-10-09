// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {MonthlyControllerBase} from "./MonthlyControllerBase.sol";
import {ShortOutcome} from "./ShortOutcome.sol";
import {RobinhoodControllerChecks} from "./RobinhoodControllerChecks.sol";

/// Immutable Robinhood/drand generation; finality and dataset truth remain operational.
contract RobinhoodMonthlyController is MonthlyControllerBase {
    bytes32 public constant CONTROLLER_PROFILE=keccak256("promo-robinhood-monthly-drand-v2");
    constructor(Setup memory s, ShortOutcome.Rules memory r) MonthlyControllerBase(s,r) {
        require(r.version==2,"monthly generation");
        require(s.interval==30 days,"monthly interval");
        RobinhoodControllerChecks.verify(s.provider,false);
    }
    function minimumMonthlyBudget() public pure override returns(uint256){return 100_000000;}
    function _checkCutoffHistory(uint256 number,bytes32 hash) internal view override {
        require(hash!=bytes32(0)&&cutoffHashes[number]==hash,"checkpoint required");
    }
}
