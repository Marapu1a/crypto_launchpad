// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ShortPrizeBasket} from "../../contracts/ShortPrizeBasket.sol";

/// TEST ONLY: exposes the internal library; has no authority over a vault.
contract ShortPrizeBasketFixture {
    function build(uint256 budget, uint256[] calldata weights, uint256 minimumUnit)
        external pure returns (uint256[] memory prizes, uint256 total, uint256 remainder)
    {
        return ShortPrizeBasket.build(budget, weights, minimumUnit);
    }
}
