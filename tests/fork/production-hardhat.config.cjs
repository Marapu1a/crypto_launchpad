// In-process historical fork only. No public network/signing configuration.
module.exports = {
  networks:{hardhat:{chainId:4663,hardfork:'prague',allowBlocksWithSameTimestamp:true,
    chains:{4663:{hardforkHistory:{cancun:0}}},
    forking:{url:require('../../scripts/rpc-config.cjs').resolveRpc().url,blockNumber:82000000}}},
  paths:{cache:'.local/production-fork-cache',artifacts:'.local/production-fork-artifacts'},
};
