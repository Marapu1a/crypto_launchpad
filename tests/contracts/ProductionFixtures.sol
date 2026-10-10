// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {TestUSDG, TestEscrow} from "./Fixtures.sol";
import {IPonsFactory} from "../../contracts/production/PonsFeeCollector.sol";

contract TestPonsFactory {
    mapping(address => IPonsFactory.Launch) private launches;
    function setLaunch(IPonsFactory.Launch calldata launch) external { launches[launch.token] = launch; }
    function getLaunchedToken(address token) external view returns(IPonsFactory.Launch memory) { return launches[token]; }
}
contract TestPonsCurve {
    address public immutable token;
    address public immutable factory;
    address public immutable pairToken;
    address public immutable deployer;
    address public immutable feeEscrow;
    constructor(address token_, address factory_, address quote_, address collector_, address escrow_) {
        token = token_; factory = factory_; pairToken = quote_; deployer = collector_; feeEscrow = escrow_;
    }
    function sweepFees(uint256) external {
        TestUSDG q = TestUSDG(pairToken);
        uint256 amount = q.balanceOf(address(this));
        q.approve(feeEscrow, amount); TestEscrow(feeEscrow).deposit(deployer, amount);
    }
}
