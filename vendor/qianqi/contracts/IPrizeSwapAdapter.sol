// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Adapter sends output only to msg.sender. Converter verifies actual balance deltas.
interface IPrizeSwapAdapter {
    function tokenIn() external view returns(address);
    function tokenOut() external view returns(address);
    function swapExactInput(uint256 amountIn, uint256 minOut, uint256 deadline) external;
}
