// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ShortControllerBase} from "./ShortControllerBase.sol";
import {ShortOutcome} from "./ShortOutcome.sol";

/// Local rehearsal only. Public wrappers have separate network/RNG admission.
contract LocalShortController is ShortControllerBase {
    constructor(Setup memory s, ShortOutcome.Rules memory r, uint256[] memory w) ShortControllerBase(s,r,w,1) {
        require(block.chainid == 31337, "local only");
    }
}
