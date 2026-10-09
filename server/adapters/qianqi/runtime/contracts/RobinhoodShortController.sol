// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ShortControllerBase} from "./ShortControllerBase.sol";
import {ShortOutcome} from "./ShortOutcome.sol";
import {RobinhoodControllerChecks} from "./RobinhoodControllerChecks.sol";

/// Immutable Robinhood/drand generation; finality and dataset truth remain operational.
contract RobinhoodShortController is ShortControllerBase {
    bytes32 public constant CONTROLLER_PROFILE=keccak256("promo-robinhood-short-drand-v1");
    constructor(Setup memory s, ShortOutcome.Rules memory r, uint256[] memory w, uint256 minimumUnit) ShortControllerBase(s,r,w,minimumUnit) {
        RobinhoodControllerChecks.verify(s.provider,true);
    }
    function _checkCutoffHistory(uint256 number,bytes32 hash) internal view override {
        require(hash!=bytes32(0)&&cutoffHashes[number]==hash,"checkpoint required");
    }
}
