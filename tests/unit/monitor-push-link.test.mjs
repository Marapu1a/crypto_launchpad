import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('Push opens only a same-origin saved interval or wallet; preserves exact query',async()=>{
 const handlers={},opened=[];
 const self={location:{origin:'https://pw.qianqi.site'},addEventListener:(k,f)=>handlers[k]=f,
  clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)}};
 vm.runInNewContext(readFileSync('apps/monitor/sw.js','utf8'),{self,URL});
 for(const url of ['/?interval=1792389900','https://evil.test/?interval=300','/api/private']){
  let work;handlers.notificationclick({notification:{close(){},data:{url}},waitUntil:p=>work=p});await work;
 }
 assert.deepEqual(opened,['https://pw.qianqi.site/?interval=1792389900','https://pw.qianqi.site/','https://pw.qianqi.site/']);
});
