// Historical, isolated chain only. Same timestamp lets two independent draws use one BLS vector.
module.exports = { networks: { hardhat: { chainId:4663, hardfork:'cancun', initialDate:process.env.PRODUCTION_TEST_START, allowBlocksWithSameTimestamp:true } } };
