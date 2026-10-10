// Isolated in-process chain: no public RPC, fork or external accounts.
module.exports = { networks: { hardhat: { chainId: 4663, hardfork: 'cancun', initialDate: process.env.PRODUCTION_TEST_START } } };
