// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Deterministic Short basket arithmetic; does not choose budgets or winners.
/// A controller must freeze the template and budget before requesting randomness.
library ShortPrizeBasket {
    error InvalidTemplate();
    error BudgetNotReady();

    /// All values use quote-token base units. No external calls or token decimals lookup.
    /// Reverts for malformed templates; a valid but unaffordable template is not ready.
    function build(uint256 budget, uint256[] memory weights, uint256 minimumUnit)
        internal pure returns (uint256[] memory prizes, uint256 total, uint256 remainder)
    {
        if (weights.length == 0 || minimumUnit == 0) revert InvalidTemplate();
        uint256 sum;
        for (uint256 i; i < weights.length; ++i) {
            uint256 weight = weights[i];
            if (weight == 0 || weight > type(uint256).max - sum) revert InvalidTemplate();
            sum += weight;
        }
        // Division first avoids overflowing minimumUnit * sum for unreachable budgets.
        uint256 unit = budget / sum;
        if (unit < minimumUnit) revert BudgetNotReady();
        prizes = new uint256[](weights.length);
        for (uint256 i; i < weights.length; ++i) {
            // weight <= sum, so every product and their total are bounded by budget.
            prizes[i] = unit * weights[i];
        }
        total = unit * sum;
        remainder = budget - total;
    }
}
