// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {TestUSDG, TestEscrow} from "./Fixtures.sol";
import {TestPonsFactory} from "./ProductionFixtures.sol";

contract WorkerEscrow is TestEscrow {
    constructor(address q) TestEscrow(q) {}
    function balanceOfToken(address owner,address asset) external view returns(uint256) { require(asset==address(token)); return credit[owner]; }
}
contract WorkerHook {}
contract WorkerFactory is TestPonsFactory {
    address public immutable memeHook;
    constructor(address h) { memeHook=h; }
}
contract WorkerRouter {
    address public immutable factory;
    constructor(address f) {factory=f;}
}
contract WorkerCurve {
    address public immutable token;
    address public immutable factory;
    address public immutable pairToken;
    address public immutable deployer;
    address public immutable feeEscrow;
    uint256 public creatorTaxBalance;
    uint256 public quoteFeeBalance;
    bool public graduated;
    event CurveBuy(address indexed buyer,address indexed recipient,uint256 quoteIn,uint256 tokensOut,uint256 fee,uint256 tax);
    constructor(address t,address f,address q,address d,address e) {token=t;factory=f;pairToken=q;deployer=d;feeEscrow=e;}
    function buy(uint256 amount,uint256 minTokens,address recipient) external payable returns(uint256) {
        require(msg.value==0 && amount>=minTokens);
        TestUSDG(pairToken).transferFrom(msg.sender,address(this),amount);
        TestUSDG(token).transfer(recipient,amount);
        uint256 tax=amount*200/10000; creatorTaxBalance+=tax;
        emit CurveBuy(msg.sender,recipient,amount,amount,amount/100,tax);
        return amount;
    }
    function sweepFees(uint256) external {
        uint256 amount=creatorTaxBalance; creatorTaxBalance=0;
        TestUSDG(pairToken).approve(feeEscrow,amount); TestEscrow(feeEscrow).deposit(deployer,amount);
    }
}
