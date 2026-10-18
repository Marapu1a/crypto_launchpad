import {readFileSync} from 'node:fs';
import {compileProduction} from '../worker/production-build.mjs';
export function compilePwLaunch(){
 const names=['ManagedNativeHolderPayoutVault','NativeHolderFeeSplitter','NativeHolderCollector','PwNativeShortProgram'];
 const files=names.map(n=>'contracts/holders/'+n+'.sol');
 const build=compileProduction(Object.fromEntries(files.map(f=>[f,{content:readFileSync(new URL('../../'+f,import.meta.url),'utf8')}])));
 const artifacts=Object.fromEntries(names.map((n,i)=>[n,build.contracts[files[i]][n]]));
 for(const a of Object.values(artifacts))if(a.evm.bytecode.object.length/2>49152||a.evm.deployedBytecode.object.length/2>24576)throw Error('PW artifact too large');
 return {artifacts,manifest:build.manifest};
}
