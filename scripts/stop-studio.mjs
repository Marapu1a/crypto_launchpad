import fs from 'node:fs';
import path from 'node:path';
const pointer=JSON.parse(fs.readFileSync('.local/studio/current.json'));
const root=path.resolve(pointer.root),base=path.resolve('.local/studio')+path.sep;
if(!root.startsWith(base)||!fs.existsSync(path.join(root,'runtime.json')))throw Error('Unknown studio instance');
fs.writeFileSync(path.join(root,'stop-request'),new Date().toISOString(),{flag:'wx'});
console.log('Graceful stop requested; journals retained.');
