import {readFileSync} from 'node:fs';
import {keccak256,toUtf8Bytes} from 'ethers';
import {compileProduction} from './production-build.mjs';
export function compileDrawPrograms(){
 const additions=['MonthlyProgram','MonthlyOutcome','DrawFundingRouter'];
 const extra=Object.fromEntries(additions.map(name=>{const file='contracts/production/'+name+'.sol';return [file,{content:readFileSync(new URL('../../'+file,import.meta.url),'utf8')}];}));
 const build=compileProduction(extra);
 const artifacts={...build.artifacts,...Object.fromEntries(additions.map(name=>[name,build.contracts['contracts/production/'+name+'.sol'][name]]))};
 const entries=Object.fromEntries(Object.entries(artifacts).map(([name,a])=>{
  const code=a.evm.deployedBytecode;
  if(code.object.length/2>24576||a.evm.bytecode.object.length/2>49152)throw Error('Contract size exceeded: '+name);
  return [name,{creationHash:keccak256('0x'+a.evm.bytecode.object),runtimeTemplateHash:keccak256('0x'+code.object),runtimeBytes:code.object.length/2,immutableReferences:code.immutableReferences}];
 }));
 const identity={schema:'draw-production-build-v2',compiler:build.manifest.compiler,settings:build.manifest.settings,sourceHashes:build.manifest.sourceHashes,contracts:entries};
 return {artifacts,manifest:{...identity,buildHash:keccak256(toUtf8Bytes(JSON.stringify(identity)))}};
}
export function matchesArtifact(code,artifact){
 if(!/^0x(?:[0-9a-f]{2})+$/i.test(code))return false;
 const expected=artifact.evm.deployedBytecode;if(code.length!==expected.object.length+2)return false;
 let actual=code.slice(2),template=expected.object;
 for(const refs of Object.values(expected.immutableReferences))for(const {start,length} of refs){const zeros='0'.repeat(length*2);actual=actual.slice(0,start*2)+zeros+actual.slice((start+length)*2);template=template.slice(0,start*2)+zeros+template.slice((start+length)*2);}
 return actual.toLowerCase()===template.toLowerCase();
}
