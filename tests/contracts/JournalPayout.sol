// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Local journal fault-injection fixture, not a launchpad financial module.
contract JournalPayout {
    IERC20 public immutable asset;
    address public immutable operator;
    address public immutable recipient;
    address public immutable owner;
    uint256 public calls;
    bool public fail;
    constructor(address token,address executor,address destination) {
        require(block.chainid==31337,"local only");
        asset=IERC20(token);operator=executor;recipient=destination;owner=msg.sender;
    }
    function setFailure(bool value) external {require(msg.sender==owner,"owner");fail=value;}
    function pay(uint256 amount) external {
        require(msg.sender==operator&&!fail,"blocked");calls++;
        require(asset.transfer(recipient,amount),"transfer");
    }
}
