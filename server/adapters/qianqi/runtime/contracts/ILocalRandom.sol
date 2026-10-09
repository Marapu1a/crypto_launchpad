// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Asynchronous transport retained for local controllers and DrandRandomAdapter.
/// ready() is structural readiness, never a proof of network freshness/finality.
/// request must return a unique nonzero key and must not deliver synchronously.
/// The controller permanently binds the returned key to one draw/context.
interface ILocalRandom {
    function ready() external view returns (bool);
    function fee() external view returns (uint256);
    function request(bytes32 context) external payable returns (uint256);
}
