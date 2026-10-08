// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract TestUSDG is ERC20 {
    mapping(address => bool) public blocked;
    constructor() ERC20("Test USDG", "TUSDG") {}
    function decimals() public pure override returns(uint8) { return 6; }
    function mint(address to, uint256 value) external { _mint(to,value); }
    function blockRecipient(address to, bool value) external { blocked[to] = value; }
    function _update(address from,address to,uint256 value) internal override { require(!blocked[to],"blocked recipient"); super._update(from,to,value); }
}
contract TestEscrow {
    TestUSDG public immutable token;
    mapping(address => uint256) public credit;
    constructor(address asset) { token = TestUSDG(asset); }
    function deposit(address recipient,uint256 value) external { token.transferFrom(msg.sender,address(this),value); credit[recipient]+=value; }
    function claimToken(address asset) external { require(asset==address(token)); uint256 value=credit[msg.sender]; credit[msg.sender]=0; token.transfer(msg.sender,value); }
}

import {ShortOutcome} from "../../contracts/draws/ShortOutcome.sol";
contract OutcomeHarness {
    function compute(bytes32 context,bytes32 seed,ShortOutcome.Participant[] calldata participants,uint256[] calldata prizes) external pure returns(ShortOutcome.Result memory) {
        return ShortOutcome.compute(context,seed,participants,ShortOutcome.Rules(1,4,5,1,1),prizes);
    }
}
