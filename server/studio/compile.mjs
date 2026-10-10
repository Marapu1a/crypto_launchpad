import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import solc from 'solc';
const root=fileURLToPath(new URL('../../',import.meta.url));
let cached;
export function compileTemplate(){
 if(cached)return cached;
 const files=['LocalDrandShortProgram','LocalPonsFeeCollector','LocalFeeSplitter','LocalPurchaseRecognition'].map(n=>'contracts/draws/'+n+'.sol');
 const result=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:Object.fromEntries(files.map(f=>[f,{content:fs.readFileSync(path.join(root,f),'utf8')}])),settings:{optimizer:{enabled:true,runs:200},evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}),{import:p=>{try{return {contents:fs.readFileSync(path.join(root,p.startsWith('@')?'node_modules':'',p),'utf8')};}catch{return {error:'Missing template source'};}}}));
 if((result.errors||[]).some(e=>e.severity==='error'))throw Error('Template compilation failed');
 cached=Object.fromEntries(Object.values(result.contracts).flatMap(file=>Object.entries(file)));return cached;
}
