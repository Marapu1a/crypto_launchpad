import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{backup,restore}=require('../../ops/qianqi/native-backup.cjs');
test('native backup keeps pending intent and stages restore without replacing live state',()=>{
 fs.mkdirSync('.local/test-results',{recursive:true});
 const root=fs.mkdtempSync(path.resolve('.local/test-results/native-backup-')),source=path.join(root,'live'),copy=path.join(root,'backup');
 fs.mkdirSync(source);const file=path.join(source,'automation.json');
 fs.writeFileSync(file,'{"pending":{"transactionHash":null}}');
 fs.writeFileSync(file+'.lock','owner');assert.throws(()=>backup(source,copy),/Stop writers/);fs.unlinkSync(file+'.lock');
 fs.writeFileSync(path.join(source,'__proto__'),'must be hashed');assert(Object.hasOwn(backup(source,copy).files,'__proto__'));
 fs.writeFileSync(file,'newer state');assert.throws(()=>restore(copy,source),/New destination/);
 const result=restore(copy,path.join(root,'staged'));assert.equal(result.activation,false);
 assert.equal(fs.readFileSync(file,'utf8'),'newer state');assert.match(fs.readFileSync(path.join(root,'staged/automation.json'),'utf8'),/pending/);
 fs.appendFileSync(path.join(copy,'state/automation.json'),'x');assert.throws(()=>restore(copy,path.join(root,'bad')),/integrity/);
});
