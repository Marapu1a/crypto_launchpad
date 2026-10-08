// Isolated development chain; never a mainnet signer configuration.
module.exports = {
  networks: {
    hardhat: {
      chainId: 31337,
      hardfork: 'cancun',
      chains: { 4663: { hardforkHistory: { cancun: 0 } } },
      ...(process.env.PONS_FORK_BLOCK ? { forking: {
        url: require('./scripts/rpc-config.cjs').resolveRpc().url,
        blockNumber: Number(process.env.PONS_FORK_BLOCK),
      }} : {}),
    },
  },
  paths: { cache: '.local/hardhat-cache', artifacts: '.local/hardhat-artifacts' },
};
