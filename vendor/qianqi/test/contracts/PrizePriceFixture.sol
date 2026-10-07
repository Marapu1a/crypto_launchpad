// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IPrizePriceSource} from "../../contracts/IPrizePriceSource.sol";
/// Test only. Permissionless manual values are NOT a deployable market-price oracle.
contract PrizePriceFixture is IPrizePriceSource {
    address public immutable tokenIn;
    address public immutable tokenOut;
    uint256 public numerator;
    uint256 public denominator;
    uint256 public observedAt;
    bool public unavailable;
    constructor(address token,address quote){tokenIn=token;tokenOut=quote;}
    function set(uint256 n,uint256 d,uint256 timestamp,bool failed) external {
        numerator=n;denominator=d;observedAt=timestamp;unavailable=failed;
    }
    function price() external view returns(uint256,uint256,uint256){
        require(!unavailable,"price unavailable");return(numerator,denominator,observedAt);
    }
}
