import fs from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../server/adapters/qianqi/runtime/',import.meta.url);
const upstream=JSON.parse(fs.readFileSync(new URL('UPSTREAM.json',root)));
const changes=JSON.parse(fs.readFileSync(new URL('ADAPTATIONS.json',root)));
for(const entry of upstream.files){
 const body=fs.readFileSync(new URL(entry.file,root),'utf8').replaceAll('\r\n','\n');
 const expected=changes[entry.file]?.sha256??entry.sha256;
 if(createHash('sha256').update(body).digest('hex')!==expected)throw Error('Unreviewed QIANQI runtime change: '+entry.file);
}
for(const file of Object.keys(changes))if(!upstream.files.some(x=>x.file===file))throw Error('Unknown adapted source');
console.log(`${upstream.files.length} QIANQI sources verified; ${Object.keys(changes).length} explicit adaptations`);
