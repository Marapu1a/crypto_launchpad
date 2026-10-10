import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {deliverGasNotifications,telegramSender,gasMessage} from '../../server/short-runtime/gas-notifications.mjs';
const root=path.resolve('.local/test-results/gas-notifications-'+Date.now());await fs.mkdir(root,{recursive:true});
const event={projectId:'alpha',moduleId:'short',projectName:'Alpha',token:'0x'+'1'.repeat(40),role:'executor',wallet:'0x'+'2'.repeat(40),active:true,action:'runtime:1:program.freeze',balanceWei:'0',requiredWei:'1000000000000000',shortfallWei:'1000000000000000'};
test('Durable role/project dedup, reminder, failed delivery retry and recovery once',async()=>{
 const file=path.join(root,'state.json'),sent=[],send=async s=>sent.push(s);let now=100000;
 assert.equal((await deliverGasNotifications({file,events:[event],send,now})).sent,1);
 assert.equal((await deliverGasNotifications({file,events:[event],send,now:now+1000})).sent,0);
 assert.equal((await deliverGasNotifications({file,events:[event],send,now:now+21600000})).sent,1);
 const publisher={...event,role:'publisher',wallet:'0x'+'3'.repeat(40)};
 const failed=await deliverGasNotifications({file,events:[publisher],send:async()=>{throw Error('network');},now});assert.equal(failed.failed,1);
 assert.equal((await deliverGasNotifications({file,events:[publisher,{...event,projectId:'beta'}],send,now})).sent,2);
 assert.equal((await deliverGasNotifications({file,events:[{...event,active:false}],send,now})).sent,1);
 assert.equal((await deliverGasNotifications({file,events:[{...event,active:false}],send,now})).sent,0);
 assert.match(sent.at(-1),/возобновились/);assert.match(sent[0],/0.001 ETH/);assert.match(sent[0],/executor/);
});
test('Read failures and missing observations never fabricate recovery; lock excludes another observer',async()=>{
 const file=path.join(root,'exclusive.json');let unblock;const blocked=deliverGasNotifications({file,events:[event],send:()=>new Promise(r=>unblock=r)});
 while(!unblock)await new Promise(r=>setTimeout(r,5));assert.equal((await deliverGasNotifications({file,events:[event],send:async()=>{throw Error('must not send');}})).busy,true);unblock();await blocked;
 assert.equal((await deliverGasNotifications({file,events:[],send:async()=>{throw Error('must not send');}})).sent,0);
 await fs.writeFile(file,'broken');await assert.rejects(deliverGasNotifications({file,events:[event],send:async()=>{throw Error('must not send');}}));
});
test('Unknown estimate is explicit; Telegram plain text payload and errors redact credentials',async()=>{
 assert.match(gasMessage({...event,requiredWei:null,shortfallWei:null}),/оценка недоступна/);
 const args=[];const send=telegramSender({token:'123:SECRET',chat:'-1001',fetcher:async(...a)=>{args.push(a);return {ok:true,json:async()=>({ok:true})};}});await send('notice');assert.deepEqual(JSON.parse(args[0][1].body),{chat_id:'-1001',text:'notice'});
 await assert.rejects(telegramSender({token:'123:SECRET',chat:'1',fetcher:async()=>{throw Error('123:SECRET');}})('notice'),e=>e.message==='Telegram delivery failed');
});
