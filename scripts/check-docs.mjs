import {readdir,readFile,access} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';

// Local Markdown file links only; remote URLs and heading anchors are not fetched.
const root=resolve('.'),files=['README.md','AGENTS.md','PLATFORM_START.md'];
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
 const path=dir+'/'+entry.name;if(entry.isDirectory())await walk(path);else if(entry.name.endsWith('.md'))files.push(path);
}}
await walk('docs');await walk('ops');await walk('tokens');
const failures=[];let checked=0;
for(const file of files){
 const text=(await readFile(file,'utf8')).replace(/```[\s\S]*?```/g,'');
 for(const match of text.matchAll(/!?\[[^\]\n]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)){
  const url=match[1].replace(/^<|>$/g,'');if(/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(url))continue;
  const path=decodeURIComponent(url.split('#')[0]);if(!path)continue;
  const target=resolve(dirname(file),path);checked++;
  try{await access(target);}catch{failures.push(`${file}: missing ${relative(root,target).replaceAll('\\','/')}`);}
 }
}
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}
console.log(`Checked ${checked} local file links in ${files.length} documents; ${failures.length} missing. Heading anchors and remote URLs excluded.`);
