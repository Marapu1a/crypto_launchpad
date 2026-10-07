const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ethers}=require('ethers');
const hre=require('hardhat');
const {compile}=require('../scripts/compile.cjs');
const {domainFor,snapshotFor,replayAttempts}=require('../scripts/attempt-lifecycle.cjs');
const {hash}=require('../scripts/direct-buy.cjs');
const compiled=compile();

test('actual local fixture emits freeze/terminal ABI accepted by raw receipt replay (empty attempts)',async()=>{
  await hre.network.provider.send('hardhat_reset');
  const rpc=(method,params=[])=>hre.network.provider.send(method,params);
  const anchor=await rpc('eth_getBlockByNumber',['latest',false]);
  const provider=new ethers.BrowserProvider(hre.network.provider,undefined,{cacheTimeout:-1}),admin=await provider.getSigner();
  async function deploy(name){const a=compiled[name],c=await new ethers.ContractFactory(a.abi,a.evm.bytecode.object,admin).deploy();await c.waitForDeployment();return c;}
  const registry=await deploy('ParticipantRegistry'),source=await deploy('AttemptLifecycleFixture');
  await(await registry.register()).wait();
  // No market is simulated here. This test proves emitted ABI/provenance integration.
  const manifest=structuredClone(require('../research/direct-buy/evidence.json').manifest);
  manifest.registry=registry.target;manifest.anchor={number:anchor.number,hash:anchor.hash};
  manifest.codeHashes.registry=ethers.keccak256(await provider.getCode(registry.target));
  const config={schema:'attempt-lifecycle-v1',instanceId:ethers.id('actual local fixture'),source:source.target,sourceCodeHash:ethers.keccak256(await provider.getCode(source.target))};
  const block=await rpc('eth_getBlockByNumber',['latest',false]);
  const cutoff={blockNumber:Number(BigInt(block.number)),blockHash:block.hash},drawId=ethers.id('empty integration'),rulesHash=ethers.id('fixture rules');
  const snapshotHash=hash(snapshotFor(domainFor(manifest,config),drawId,'SHORT',cutoff,rulesHash,[]));
  await(await source.freeze(drawId,0,cutoff.blockNumber,cutoff.blockHash,rulesHash,snapshotHash)).wait();
  await(await source.terminal(drawId,0,snapshotHash,0,ethers.id('fixture terminal assertion'))).wait();
  const blocks=[],latest=await rpc('eth_blockNumber');
  for(let n=BigInt(anchor.number)+1n;n<=BigInt(latest);n++){
    const b=await rpc('eth_getBlockByNumber',['0x'+n.toString(16),true]);
    const transactions=[];for(const tx of b.transactions)transactions.push({tx,receipt:await rpc('eth_getTransactionReceipt',[tx.hash])});
    blocks.push({number:b.number,hash:b.hash,parentHash:b.parentHash,timestamp:b.timestamp,transactions});
  }
  const result=replayAttempts(manifest,config,blocks);
  assert.equal(result.draws[0].status,'CONSUMED');
  assert.equal(result.draws[0].totalAttempts,'0');
  assert.equal(result.draws[0].terminal.outcome,'NO_WINNER');
  assert.equal(result.pending.SHORT,null);
  assert.deepEqual(result.wallets,[]);
  assert.equal(result.buyLedger.registrations.length,1);
});
