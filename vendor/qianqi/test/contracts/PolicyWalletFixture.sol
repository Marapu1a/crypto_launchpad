// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
/// Test contract wallet, not a Safe implementation.
contract PolicyWalletFixture {
    address public immutable owner=msg.sender;
    function execute(address target, bytes calldata data) external {
        require(msg.sender==owner,"owner");
        (bool ok,bytes memory result)=target.call(data);
        if(!ok) assembly { revert(add(result,32),mload(result)) }
    }
}
