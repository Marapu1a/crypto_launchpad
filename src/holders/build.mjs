import {readFileSync} from 'node:fs';
import {keccak256,toUtf8Bytes} from 'ethers';
import {compileProduction} from '../worker/production-build.mjs';
export function compileHolderFunding(){
 const names=['NativeHolderVault','NativeHolderFeeSplitter'];
 const sources=Object.fromEntries(names.map(n=>{const file='contracts/holders/'+n+'.sol';return [file,{content:readFileSync(new URL('../../'+file,import.meta.url),'utf8')}];}));
 const build=compileProduction(sources);
 const artifacts=Object.fromEntries(names.map(n=>[n,build.contracts['contracts/holders/'+n+'.sol'][n]]));
 for(const [n,a] of Object.entries(artifacts))if(a.evm.deployedBytecode.object.length/2>24576||a.evm.bytecode.object.length/2>49152)throw Error('Contract size exceeded: '+n);
 const identity={schema:'holder-funding-prototype-v1',compiler:build.manifest.compiler,settings:build.manifest.settings,sourceHashes:build.manifest.sourceHashes};
 return {artifacts,manifest:{...identity,buildHash:keccak256(toUtf8Bytes(JSON.stringify(identity)))}};
}
