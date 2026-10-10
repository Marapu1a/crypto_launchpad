// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
interface IFeeEscrow { function claimToken(address asset) external; }
interface IFund { function quote() external view returns(address); function fund(uint256 amount) external returns(uint256); }

/// Chain-4663 escrow adapter. Fixed destination; no discretionary withdrawals.
/// Destination owns allocation policy. This adapter performs no fee splitting.
contract FeeCollector is ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable quote;
    address public immutable escrow;
    IFund public immutable destination;
    event Collected(uint256 received);
    event Forwarded(uint256 sent, uint256 received);
    constructor(address asset,address escrow_,address destination_) {
        require(block.chainid == 4663,"chain 4663");
        require(asset.code.length>0 && escrow_.code.length>0 && destination_.code.length>0,"config");
        require(IFund(destination_).quote()==asset,"asset mismatch");
        quote=IERC20(asset);escrow=escrow_;destination=IFund(destination_);
    }
    // Separate operations: failure of a new escrow claim cannot block forwarding an old receipt.
    function collect() external nonReentrant returns(uint256 received) {
        uint256 beforeBalance=quote.balanceOf(address(this));
        IFeeEscrow(escrow).claimToken(address(quote));
        received=quote.balanceOf(address(this))-beforeBalance;
        emit Collected(received);
    }
    function forward() external nonReentrant returns(uint256 received) {
        uint256 balance=quote.balanceOf(address(this)); require(balance>0,"empty");
        quote.forceApprove(address(destination),balance);
        received=destination.fund(balance);
        quote.forceApprove(address(destination),0);
        emit Forwarded(balance,received);
    }
}
