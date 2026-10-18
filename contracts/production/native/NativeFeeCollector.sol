// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
interface INativeEscrow { function claim() external; }
interface INativeFund {
    function quote() external view returns(address);
    function fund(uint256 amount) external payable returns(uint256);
}
contract NativeFeeCollector is ReentrancyGuard {
    address public constant quote = address(0);
    address public immutable escrow;
    INativeFund public immutable destination;
    event Collected(uint256 received);
    event Forwarded(uint256 sent,uint256 received);
    constructor(address asset,address escrow_,address destination_){
        require(block.chainid==4663 && asset==address(0),"chain/asset");
        require(escrow_.code.length>0 && destination_.code.length>0 && INativeFund(destination_).quote()==address(0),"config");
        escrow=escrow_;destination=INativeFund(destination_);
    }
    receive() external payable {}
    function collect() external nonReentrant returns(uint256 received){
        uint256 beforeBalance=address(this).balance;
        INativeEscrow(escrow).claim();received=address(this).balance-beforeBalance;
        emit Collected(received);
    }
    function forward() external nonReentrant returns(uint256 received){
        uint256 balance=address(this).balance;require(balance>0,"empty");
        received=destination.fund{value:balance}(balance);require(received==balance,"receipt");
        emit Forwarded(balance,received);
    }
}
