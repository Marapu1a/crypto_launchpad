import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import { keccak256, toUtf8Bytes } from 'ethers';

const root = fileURLToPath(new URL('../../', import.meta.url));
export function compileProduction(extraSources = {}) {
  const names = ['ShortProgram', 'ShortDrandAdapter', 'FeeCollector', 'FeeSplitter', 'PonsFeeCollector', 'PurchaseRecognition'];
  const sources = Object.fromEntries(Object.entries(extraSources).map(([name, source]) => [name, { content: source.content.replaceAll('\r\n', '\n') }]));
  for (const name of names) {
    const file = 'contracts/production/' + name + '.sol';
    sources[file] = { content: fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n') };
  }
  const settings = { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] } } };
  const seen = { ...sources };
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings }), { import: file => {
    try { const contents = fs.readFileSync(path.join(root, file.startsWith('@') ? 'node_modules' : '', file), 'utf8').replaceAll('\r\n', '\n'); seen[file] = { content: contents }; return { contents }; }
    catch { return { error: 'Missing source ' + file }; }
  } }));
  const errors = (output.errors ?? []).filter(e => e.severity === 'error');
  if (errors.length) throw Error(errors.map(e => e.formattedMessage).join('\n'));
  const artifacts = Object.fromEntries(names.map(name => [name, output.contracts['contracts/production/' + name + '.sol'][name]]));
  const sourceHashes = Object.fromEntries(Object.keys(seen).sort().map(file => [file, keccak256(toUtf8Bytes(seen[file].content))]));
  const identity = { compiler: solc.version(), settings, sourceHashes };
  const buildHash = keccak256(toUtf8Bytes(JSON.stringify(identity)));
  for (const [name, a] of Object.entries(artifacts)) {
    if (a.evm.deployedBytecode.object.length / 2 > 24576 || a.evm.bytecode.object.length / 2 > 49152) throw Error('Contract size exceeded: ' + name);
  }
  return { artifacts, contracts: output.contracts, manifest: { schema: 'short-production-build-v1', buildHash, ...identity, contracts: Object.fromEntries(Object.entries(artifacts).map(([name, a]) => [name, { creationHash: keccak256('0x' + a.evm.bytecode.object), runtimeTemplateHash: keccak256('0x' + a.evm.deployedBytecode.object), runtimeBytes: a.evm.deployedBytecode.object.length / 2, immutableReferences: a.evm.deployedBytecode.immutableReferences }])) } };
}
