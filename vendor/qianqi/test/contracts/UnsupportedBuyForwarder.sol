// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
/// Test-only alternate route. Never deploy as a supported public BUY router.
contract UnsupportedBuyForwarder {
    function run(address quote,address adapter,uint256 allowance,bytes calldata data) external returns(bytes memory) {
        (bool ok,bytes memory result)=quote.call(abi.encodeWithSignature("approve(address,uint256)",adapter,allowance));
        require(ok&&(result.length==0||abi.decode(result,(bool))),"approve");
        (ok,result)=adapter.call(data);
        if(!ok) assembly { revert(add(result,32),mload(result)) }
        return result;
    }
}
