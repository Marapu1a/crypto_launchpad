// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Independent raw-unit TOKEN/USDG reference. A conforming ABI is not proof of price quality.
/// Production deployment must audit provenance, freshness and manipulation resistance.
interface IPrizePriceSource {
    function tokenIn() external view returns(address);
    function tokenOut() external view returns(address);
    function price() external view returns(uint256 numerator,uint256 denominator,uint256 observedAt);
}
