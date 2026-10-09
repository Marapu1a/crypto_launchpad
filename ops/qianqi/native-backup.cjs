// Offline backup only. Restore stages a NEW directory; it never replaces live state.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const hash=b=>createHash('sha256').update(b).digest('hex');
function inventory(root){
 const files=Object.create(null);function visit(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
  const file=path.join(dir,entry.name),stat=fs.lstatSync(file);
  if(stat.isSymbolicLink()||!stat.isFile()&&!stat.isDirectory())throw Error('Only regular state files allowed');
  if(/\.(lock|tmp)$/.test(entry.name))throw Error('Stop writers and resolve locks before backup');
  if(stat.isDirectory())visit(file);else files[path.relative(root,file).split(path.sep).join('/')]=hash(fs.readFileSync(file));
 }}visit(root);return files;
}
function destination(source,target){
 const out=path.resolve(target),real=fs.realpathSync(source),parent=fs.realpathSync(path.dirname(out)),resolved=path.join(parent,path.basename(out));
 if(fs.existsSync(out)||resolved===real||resolved.startsWith(real+path.sep))throw Error('New destination outside source required');
 return resolved;
}
function backup(source,target){
 const root=fs.realpathSync(source),out=destination(root,target),files=inventory(root);
 if(!Object.keys(files).length)throw Error('Empty backup refused');
 fs.mkdirSync(out,{mode:0o700});fs.cpSync(root,path.join(out,'state'),{recursive:true,errorOnExist:true,force:false});
 if(JSON.stringify(inventory(root))!==JSON.stringify(files)||JSON.stringify(inventory(path.join(out,'state')))!==JSON.stringify(files))throw Error('State changed during offline backup');
 const manifest={schema:'qianqi-offline-backup-v1',createdAt:new Date().toISOString(),files};
 fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});return manifest;
}
function restore(source,target){
 const root=fs.realpathSync(source),m=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
 if(m.schema!=='qianqi-offline-backup-v1'||JSON.stringify(inventory(path.join(root,'state')))!==JSON.stringify(m.files))throw Error('Backup integrity mismatch');
 const out=destination(root,target);fs.cpSync(path.join(root,'state'),out,{recursive:true,errorOnExist:true,force:false});
 if(JSON.stringify(inventory(out))!==JSON.stringify(m.files))throw Error('Restored copy mismatch');
 return {status:'staged',directory:out,activation:false,files:Object.keys(m.files).length};
}
if(require.main===module){try{const [mode,source,target]=process.argv.slice(2);if(!['backup','restore'].includes(mode)||!source||!target||process.argv.length!==5)throw Error('Usage');console.log(JSON.stringify((mode==='backup'?backup:restore)(source,target)));}catch{console.error('Offline backup/restore refused; inspect stopped writers, paths and integrity');process.exitCode=78;}}
module.exports={inventory,backup,restore};
