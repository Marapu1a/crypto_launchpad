// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
// Local fork shim only: EDR does not execute the Nitro ArbSys precompile.
contract PublicArbSysFixture {
    function arbBlockNumber() external view returns(uint256){return block.number;}
    function arbBlockHash(uint256 n) external view returns(bytes32){return blockhash(n);}
}
