// Explicit source-only extraction. Never imports deployment/config/state directories.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const source=path.resolve(process.argv.slice(2).find(x=>!x.startsWith('--'))||'D:/sites/rh_project');
const destination=path.resolve('server/adapters/qianqi/runtime');
const commit=execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(commit!=='11a050d995f17c2c810db1fe5c4e7a3ec1190ff3')throw Error('Review upstream revision before importing');
const seeds=['scripts/run-pons-public.cjs','scripts/run-indexer-service.cjs',
 'scripts/indexer-service-child.cjs','scripts/user-status-worker.cjs',
 'test/purchase-recognition.test.cjs','test/local-transaction.test.cjs',
 'test/local-state-lock.test.cjs','test/pons-public-profile.test.cjs',
 'test/pons-public-execution.test.cjs','test/public-status.test.cjs',
 'test/fixtures/pons-router-research/usdg.json','test/fixtures/pons-router-research/eth.json',
 'contracts/vendor/drand/LICENSE','research/direct-buy/evidence.json','scripts/inspect-pons-public.cjs',
 'test/pons-public-runtime.test.cjs'];
const files=new Map();
// Reviewed production finality fix is present in the source checkout, not in HEAD.
const reviewedOverrides={
 'scripts/prepare-purchase-recognition.cjs':'2bfdb151f3f0540f01f1f527153ccf9c8b0bb7fc3a8e08590fe7572da15f549f',
 'scripts/pons-delay-status.cjs':'55a3856a2ff843366177a824748a2207258de87d6ed204d94a98022bcec95b05',
 'test/purchase-recognition.test.cjs':'902db37a5a7ec290a34b55c0438c937a430cd3f0556c6358ac6540a087112d8a',
};
function visit(relative){
 relative=relative.replaceAll('\\','/');
 if(files.has(relative))return;
 if(!/^(scripts|contracts|test|research)\//.test(relative)||relative.includes('..')||(!/\.(cjs|json|sol)$/.test(relative)&&relative!=='contracts/vendor/drand/LICENSE'))throw Error('Unapproved source dependency: '+relative);
 const original=execFileSync('git',['-C',source,'show',`${commit}:${relative}`],{encoding:'utf8',maxBuffer:20*1024*1024}).replaceAll('\r\n','\n');
 const working=fs.readFileSync(path.join(source,relative),'utf8').replaceAll('\r\n','\n');
 if(working!==original&&reviewedOverrides[relative]!==createHash('sha256').update(working).digest('hex'))throw Error('Modified source: '+relative);
 files.set(relative,working);
 if(relative.endsWith('.cjs'))for(const match of working.matchAll(/require(?:\.resolve)?\(['"](\.[^'"]+)['"]\)/g)){
  let dependency=path.posix.normalize(path.posix.join(path.posix.dirname(relative),match[1]));
  if(!fs.existsSync(path.join(source,dependency))&&relative.startsWith('test/')&&match[1].startsWith('./scripts/'))dependency=match[1].slice(2);
  // The public-controller fixture is adapted to test-only numeric rules below;
  // never import the old launch configuration or its operator addresses.
  if(dependency==='config/robinhood-launch-plan.json'&&relative==='test/fixtures/public-controllers.cjs')continue;
  if(dependency==='scripts/promo-automation.cjs'&&relative==='test/fixtures/robinhood-runtime.cjs')continue;
  visit(dependency);
 }
}
for(const seed of seeds)visit(seed);
// compile() selects contracts by name; include tracked Solidity sources, never artifacts.
for(const relative of execFileSync('git',['-C',source,'ls-files','contracts','test/contracts'],{encoding:'utf8'}).trim().split('\n'))if(relative.endsWith('.sol'))visit(relative);
if(!process.argv.includes('--write')){console.log(JSON.stringify({commit,count:files.size,files:[...files.keys()].sort()},null,2));process.exit(0);}
if(fs.existsSync(destination)&&!process.argv.includes('--add-missing'))throw Error('Runtime already exists; do not overwrite adaptations');
for(const [relative,body]of files){const file=path.join(destination,relative);if(fs.existsSync(file))continue;fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body);}
fs.writeFileSync(path.join(destination,'UPSTREAM.json'),JSON.stringify({commit,reviewedOverrides,seeds,files:[...files].map(([file,body])=>({file,sha256:createHash('sha256').update(body).digest('hex')}))},null,2)+'\n');
console.log(`Extracted ${files.size} source files from ${commit}`);
