// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
contract PonsEscrowFixture {
    mapping(address => mapping(address => uint256)) public balanceOfToken;
    bool public blocked;
    bool public partialClaim;
    function configure(bool b, bool p) external { blocked=b; partialClaim=p; }
    function fund(address recipient,address token,uint256 amount) external {
        balanceOfToken[recipient][token]+=amount;
    }
    function claimToken(address token) external {
        require(!blocked,"blocked");
        uint256 amount=balanceOfToken[msg.sender][token];
        balanceOfToken[msg.sender][token]=0;
        require(IERC20(token).transfer(msg.sender,partialClaim?amount/2:amount));
    }
}
