// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {MonthlyControllerBase} from "./MonthlyControllerBase.sol";
import {ShortOutcome} from "./ShortOutcome.sol";

/// Local rehearsal only. Public wrappers have separate network/RNG admission.
contract LocalMonthlyController is MonthlyControllerBase {
    constructor(Setup memory s, ShortOutcome.Rules memory r) MonthlyControllerBase(s,r) {
        require(block.chainid == 31337, "local only");
    }
}
