import {mkdirSync,writeFileSync} from 'node:fs';
import {compileNativePrograms} from '../src/worker/native-build.mjs';
const result=compileNativePrograms();
const root='.local/builds/draw-native-v1-'+new Date().toISOString().replace(/[:.]/g,'-');
mkdirSync(root,{recursive:true});
writeFileSync(root+'/manifest.json',JSON.stringify(result.manifest,null,2));
writeFileSync(root+'/artifacts.json',JSON.stringify(result.artifacts));
console.log(JSON.stringify({root,buildHash:result.manifest.buildHash,sizes:Object.fromEntries(Object.entries(result.artifacts).map(([name,a])=>[name,a.evm.deployedBytecode.object.length/2])),deploymentAuthorized:false},null,2));
