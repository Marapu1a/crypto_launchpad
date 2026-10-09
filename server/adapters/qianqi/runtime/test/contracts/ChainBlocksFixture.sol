// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ChainBlocks} from "../../contracts/ChainBlocks.sol";

contract ChainBlocksFixture {
    function read(uint256 n) external view returns (uint256 nativeNumber, uint256 rpcNumber, bytes32 nativeHash, bytes32 rpcHash) {
        return (block.number, ChainBlocks.number(), blockhash(n), ChainBlocks.recentHash(n));
    }
}

/// Test-only stand-in at 0x64. Synthetic L2 numbers differ from local EVM numbers.
contract OffsetArbSysFixture {
    uint256 public constant OFFSET = 1000000;
    function arbBlockNumber() external view returns (uint256) { return block.number + OFFSET; }
    function arbBlockHash(uint256 n) external view returns (bytes32) {
        uint256 current = block.number + OFFSET;
        require(n < current && current - n <= 256 && n >= OFFSET, "arb range");
        return blockhash(n - OFFSET);
    }
}
