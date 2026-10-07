const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const solc = require('solc');
const root = path.join(__dirname, '../research/drand-feasibility');
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
function compile() {
  for (const s of JSON.parse(fs.readFileSync(path.join(root, 'sources.json')))) {
    if (sha(fs.readFileSync(path.join(__dirname, '..', s.file))) !== s.sha256) throw Error('Vendor hash mismatch: '+s.file);
  }
  const names = ['EvmnetFixture.sol', 'vendor/BLS.sol', 'vendor/ModExp.sol'];
  const sources = Object.fromEntries(names.map(n => [n, {content:fs.readFileSync(path.join(root,n),'utf8')}]));
  const settings = {optimizer:{enabled:true,runs:200},evmVersion:'cancun',viaIR:false,
    outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}};
  const output = JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings})));
  const errors = (output.errors||[]).filter(e=>e.severity==='error');
  if(errors.length) throw Error(errors.map(e=>e.formattedMessage).join('\n'));
  const artifact = output.contracts['EvmnetFixture.sol'].EvmnetFixture;
  return {artifact,meta:{compiler:solc.version(),optimizerRuns:200,evmVersion:'cancun',viaIR:false,
    runtimeBytes:artifact.evm.deployedBytecode.object.length/2,initcodeBytes:artifact.evm.bytecode.object.length/2,
    sourceHashes:Object.fromEntries(names.map(n=>[n,sha(sources[n].content)]))}};
}
function roundAtOrAfter(deadline, genesis=1727521075n, period=3n) {
  deadline=BigInt(deadline); if(period<=0n)throw Error('period');
  if(deadline<=genesis)return 1n;
  return 1n+(deadline-genesis+period-1n)/period;
}
module.exports={root,compile,roundAtOrAfter};
