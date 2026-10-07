const fs = require('node:fs');
const path = require('node:path');
const {readArtifact,audit}=require('./test-artifact.cjs');
function compile({sourceOverrides = {}, writeArtifacts = true} = {}) {
  if(Object.keys(sourceOverrides).length===0){const artifact=readArtifact();if(artifact){audit('reuse');return artifact;}}
  const solc=require('solc');
  const sources = {};
  for (const dir of ['contracts', 'contracts/vendor/drand', 'test/contracts']) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith('.sol')) sources[`${dir}/${name}`] = {content: fs.readFileSync(`${dir}/${name}`, 'utf8')};
    }
  }
  // Research can compile an in-memory stress variant without editing contract files
  // or replacing normal artifacts. Ordinary compile() remains unchanged.
  for (const [file, content] of Object.entries(sourceOverrides)) {
    if (!sources[file] || typeof content !== 'string') throw new Error(`Invalid source override: ${file}`);
    sources[file] = {content};
  }
  audit(Object.keys(sourceOverrides).length?'override':'ordinary');
  const result = JSON.parse(solc.compile(JSON.stringify({language: 'Solidity', sources, settings: {
    optimizer: {enabled: true, runs: 200}, evmVersion: 'cancun',
    outputSelection: {'*': {'*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object']}}
  }}), {import: file => {
    try { return {contents: fs.readFileSync(path.join('node_modules', file), 'utf8')}; }
    catch { return {error: `Missing import ${file}`}; }
  }}));
  const errors = (result.errors || []).filter(e => e.severity === 'error');
  if (errors.length) throw new Error(errors.map(e => e.formattedMessage).join('\n'));
  if (writeArtifacts) fs.mkdirSync('artifacts', {recursive: true});
  const artifacts = {};
  for (const [file, contracts] of Object.entries(result.contracts)) {
    if (!sources[file]) continue;
    for (const [name, contract] of Object.entries(contracts)) artifacts[name] = contract;
  }
  if (writeArtifacts) fs.writeFileSync('artifacts/compiled.json', JSON.stringify(artifacts, null, 2));
  return artifacts;
}
module.exports = {compile};
if (require.main === module) { compile(); console.log('Solidity compilation passed'); }
