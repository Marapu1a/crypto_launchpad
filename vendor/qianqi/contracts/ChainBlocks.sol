// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IChainArbSys {
    function arbBlockNumber() external view returns (uint256);
    function arbBlockHash(uint256 number) external view returns (bytes32);
}

/// @notice Block identities in the same coordinate system as RPC receipts/logs.
/// @dev Robinhood uses Nitro L2 identities. Other chains retain standard EVM
/// semantics; another Nitro deployment needs explicit support and verification.
/// No fallback on ArbSys failure. This is NOT a finality oracle.
library ChainBlocks {
    function number() internal view returns (uint256) {
        if (block.chainid == 4663 || block.chainid == 46630)
            return IChainArbSys(address(100)).arbBlockNumber();
        return block.number;
    }

    /// @dev Like BLOCKHASH, returns zero outside the completed 256-block window.
    /// An in-window ArbSys failure reverts instead of using a different identity.
    function recentHash(uint256 n) internal view returns (bytes32) {
        uint256 current = number();
        if (n >= current || current - n > 256) return bytes32(0);
        if (block.chainid == 4663 || block.chainid == 46630)
            return IChainArbSys(address(100)).arbBlockHash(n);
        return blockhash(n);
    }
}
