// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// TEST ONLY. Unrestricted forwarding intentionally models the controller trust boundary.
/// Must never serve as a production draw controller.
contract DrawControllerFixture {
    function execute(address target, bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory result) = target.call(data);
        if (!ok) assembly { revert(add(result,32), mload(result)) }
        return result;
    }
}
