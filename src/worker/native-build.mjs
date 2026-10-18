import {readFileSync} from 'node:fs';
import {keccak256,toUtf8Bytes} from 'ethers';
import {compileProduction} from './production-build.mjs';
// Separate manifest: legacy USDG source hashes and deployments never change.
export function compileNativePrograms(){
 const names=['ShortProgram','MonthlyProgram','FeeSplitter','DrawFundingRouter','PonsFeeCollector'];
 const sources=Object.fromEntries(names.map(name=>{const file='contracts/production/native/Native'+name+'.sol';return [file,{content:readFileSync(new URL('../../'+file,import.meta.url),'utf8')}];}));
 const build=compileProduction(sources);
 const artifacts={...build.artifacts,...Object.fromEntries(names.map(name=>[name,build.contracts['contracts/production/native/Native'+name+'.sol']['Native'+name]]))};
 for(const [name,a] of Object.entries(artifacts))if(a.evm.deployedBytecode.object.length/2>24576||a.evm.bytecode.object.length/2>49152)throw Error('Contract size exceeded: '+name);
 const identity={schema:'draw-native-build-v1',compiler:build.manifest.compiler,settings:build.manifest.settings,sourceHashes:build.manifest.sourceHashes};
 return {artifacts,contracts:build.contracts,manifest:{...identity,buildHash:keccak256(toUtf8Bytes(JSON.stringify(identity)))}};
}
