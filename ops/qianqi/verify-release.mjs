import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
try{
 const [directory,expected]=process.argv.slice(2),root=fs.realpathSync(directory);
 if(!/^[0-9a-f]{64}$/.test(expected??''))throw Error();
 const bytes=fs.readFileSync(path.join(root,'platform-release.json'));
 if(sha(bytes)!==expected)throw Error();
 const manifest=JSON.parse(bytes);
 if(manifest.schema!=='launchpad-release-v1'||!Array.isArray(manifest.files)||!manifest.files.length)throw Error();
 for(const file of manifest.files){
  if(typeof file.path!=='string'||file.path.split('/').some(x=>!x||x==='.'||x==='..')||path.isAbsolute(file.path)||!/^[0-9a-f]{64}$/.test(file.sha256))throw Error();
  const target=fs.realpathSync(path.join(root,file.path));
  if(!target.startsWith(root+path.sep)||sha(fs.readFileSync(target))!==file.sha256)throw Error();
 }
 console.log(JSON.stringify({status:'verified',commit:manifest.commit,files:manifest.files.length}));
}catch{console.error('Platform release verification refused');process.exitCode=1;}
