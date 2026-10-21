import test from 'node:test';
import assert from 'node:assert/strict';
import {alertBridge} from '../../server/project-bot/alerts.mjs';
test('existing bot forwards private language lookups, watcher links and stop; outages preserve catalog handling',async()=>{
 let forwarded=0;const replies=[];const update=text=>({message:{chat:{id:12,type:'private'},from:{id:12},text}});
 const api=async(method,body)=>replies.push({method,body});
 const bridge=alertBridge({url:'https://pw.qianqi.site/api/alerts/telegram-update',secret:'x'.repeat(32)},{fetcher:async(url,options)=>{forwarded++;assert.equal(options.redirect,'error');return {ok:true,json:async()=>({language:'ru',status:'linked'})}}});
 assert.deepEqual(await bridge(update('/start igw'),api),{handled:false,language:'ru'});
 assert.equal((await bridge(update('/start pw_'+'a'.repeat(32)),api)).handled,true);
 assert.equal((await bridge(update('/stop'),api)).handled,true);assert.equal(forwarded,3);assert.equal(replies.length,2);
 assert.equal(await bridge({message:{...update('/stop').message,chat:{id:12,type:'group'}}},api),false);
 const offline=alertBridge({url:'https://pw.qianqi.site/api/alerts/telegram-update',secret:'x'.repeat(32)},{fetcher:async()=>{throw Error('offline')}});
 assert.equal((await offline(update('/stop'),api)).handled,true);assert.match(replies.at(-1).body.text,/unavailable/);
 assert.throws(()=>alertBridge({url:'http://remote.test',secret:'x'.repeat(32)}));
});
