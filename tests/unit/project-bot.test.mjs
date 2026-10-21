import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadCatalog,validateCatalog,hubCards} from '../../server/project-bot/catalog.mjs';
import {menu,card,contract,actions,search} from '../../server/project-bot/replies.mjs';
import {pollOnce} from '../../server/project-bot/poll.mjs';
import {telegram,TelegramError} from '../../server/project-bot/telegram.mjs';
const liveCatalog=await loadCatalog(),c=structuredClone(liveCatalog),username='QianqiTestBot';
c.projects[1].status='prelaunch';c.projects[1].contract=null;c.projects[1].buy=null;
test('Live IGW catalog exposes the deployed contract and purchase link',()=>{const igw=card(liveCatalog,'igw');assert.ok(igw.text.includes('0x341849f168833f7578c6E03a7B3Ee9eBC471082f'));assert.ok(JSON.stringify(igw).includes('Buy on Pons'));});
const update=(id,text,extra={})=>({update_id:id,message:{chat:{id:123,type:'private'},from:{id:123},text,...extra}});

test('Catalog rejects prelaunch trading links, duplicate IDs and unsafe URLs',()=>{
 for(const change of [x=>x.projects[1].contract=c.projects[0].contract,x=>x.projects[1].buy=c.projects[0].buy,x=>x.projects[1].id='qianqi',x=>x.authorX='javascript:alert(1)',x=>x.projects[0].buy='https://example.com/wrong-token']){
  const bad=structuredClone(c);change(bad);assert.throws(()=>validateCatalog(bad));
 }
 const injection=structuredClone(c);injection.projects[0].description='<script>alert(1)</script>';assert.ok(!hubCards(injection).includes('<script>'));assert.ok(card(injection,'qianqi').text.includes('&lt;script&gt;'));
});
test('Cards share hub data; IGW never advertises a contract or purchase before launch',()=>{
 const igw=card(c,'igw'),q=card(c,'qianqi'),address=contract(c,'qianqi');
 assert.match(igw.text,/not deployed/);assert.ok(!JSON.stringify(igw).includes('Buy on Pons'));assert.ok(!JSON.stringify(contract(c,'igw')).includes('copy_text'));
 assert.ok(JSON.stringify(q).includes(c.authorX));assert.ok(JSON.stringify(q).includes(c.projects[0].buy));assert.ok(address.text.includes('<code>'+c.projects[0].contract+'</code>'));
 assert.equal(address.reply_markup.inline_keyboard[0][0].copy_text.text,c.projects[0].contract);assert.ok(hubCards(c).includes(c.projects[1].description));
});
test('Private commands and project deep links work; groups, foreign commands and forged callbacks are ignored',()=>{
 assert.match(actions(c,update(1,'/start igw'),username)[0].body.text,/It Gets Worse/);
 assert.match(actions(c,update(2,'/qianqi'),username)[0].body.text,/QIANQI/);
 assert.equal(actions(c,update(3,'/start@OtherBot'),username).length,0);
 assert.equal(actions(c,update(4,'/start',{chat:{id:-1,type:'group'}}),username).length,0);
 assert.equal(actions(c,update(5,'/start',{from:{id:123,is_bot:true}}),username).length,0);
 const cb={callback_query:{id:'click',from:{id:123},message:{chat:{id:123,type:'private'},from:{is_bot:true}},data:'contract:qianqi'}};
 assert.deepEqual(actions(c,cb,username).map(a=>a.method),['answerCallbackQuery','sendMessage']);
 cb.callback_query.from.id=124;assert.deepEqual(actions(c,cb,username),[]);
 assert.match(actions(c,update(6,'hello'),username)[0].body.text,/No match/);
});
test('Search accepts ticker, full name and exact case-insensitive contract; never guesses an address',()=>{
 for(const query of ['IGW','  $igw  ','IT   GETS WORSE','worse'])assert.equal(search(c,query).text,card(c,'igw').text);
 assert.equal(search(c,c.projects[0].contract.toLowerCase()).text,card(c,'qianqi').text);
 for(const query of [c.projects[0].contract.slice(0,-1),'0x'+'1'.repeat(40),'<script>','unlisted token'])assert.match(search(c,query).text,/No match/);
 assert.match(menu(c).text,/Choose a project/);
 assert.ok(menu(c).reply_markup.inline_keyboard.flat().some(b=>b.callback_data?.startsWith('project:')));
 assert.equal(actions(c,update(7,'It Gets Worse'),username)[0].body.text,card(c,'igw').text);
});
test('Ambiguous names show bounded choices and each card uses its own creator and extra links',()=>{
 const many=structuredClone(c);many.projects.push({...many.projects[1],id:'another',creatorTelegram:'https://t.me/other_creator'});
 const r=search(many,'igw');assert.match(r.text,/Several projects/);assert.equal(r.reply_markup.inline_keyboard.length,3);
 assert.ok(JSON.stringify(card(many,'another')).includes('other_creator'));assert.ok(!JSON.stringify(card(many,'another')).includes('valentin_marapulets'));
 const q=card(c,'qianqi');assert.ok(JSON.stringify(q).includes(c.projects[0].creatorTelegram));assert.ok(JSON.stringify(q).includes(c.projects[0].links[0].url));
});
test('Offset advances only after successful response and durable save, survives restart',async()=>{
 let stored={offset:0},state={offset:0},fail=true,sent=0;
 const api=async(m,b)=>{if(m==='getUpdates')return [update(9,'/igw')].filter(u=>u.update_id>=b.offset);if(fail)throw new TelegramError(429,1);sent++;};
 const save=async s=>{stored=structuredClone(s);};
 await assert.rejects(pollOnce({catalog:c,username,api,state,save}));assert.equal(state.offset,0);assert.equal(stored.offset,0);
 fail=false;await pollOnce({catalog:c,username,api,state,save});assert.equal(stored.offset,10);
 state=structuredClone(stored);await pollOnce({catalog:c,username,api,state,save});assert.equal(sent,1);
 state={offset:0};await assert.rejects(pollOnce({catalog:c,username,api,state,save:async()=>{throw Error('Disk unavailable');}}));assert.equal(state.offset,0);
});
test('Blocked user does not block later users; expired callback still receives its card',async()=>{
 let sends=0,state={offset:0};const updates=[update(1,'/start'),{update_id:2,callback_query:{id:'old',from:{id:123},message:{chat:{id:123,type:'private'}},data:'project:igw'}}];
 const api=async m=>{if(m==='getUpdates')return updates;if(m==='answerCallbackQuery')throw new TelegramError(400);if(++sends===1)throw new TelegramError(403);};
 await pollOnce({catalog:c,username,api,state,save:async()=>{}});assert.equal(state.offset,3);assert.equal(sends,2);
});
test('Telegram client restricts methods, honours retry_after and never exposes token in errors',async()=>{
 const token='123456:'+ 'x'.repeat(30);
 const a=telegram(token,{fetcher:async()=>{throw Error('https://api.telegram.org/bot'+token+'/sendMessage');}});
 await assert.rejects(a('sendMessage'),e=>e.code===0&&!e.message.includes(token));
 await assert.rejects(a('deleteWebhook'),/Unsupported/);
 const b=telegram(token,{fetcher:async()=>({ok:false,status:429,json:async()=>({ok:false,error_code:429,parameters:{retry_after:17}})})});
 await assert.rejects(b('getUpdates'),e=>e.code===429&&e.retryAfter===17);
});

test('Three languages, project menu and launched PW are available without typing a ticker',async()=>{
 for(const [lang,heading] of [['ru','Выбери проект'],['en','Choose a project'],['zh','请选择项目']]){
  const m=actions(liveCatalog,update(1,'/start',{from:{id:123,language_code:lang}}),username)[0].body;
  assert.ok(m.text.includes(heading));assert.equal(m.reply_markup.inline_keyboard.flat().filter(b=>b.callback_data?.startsWith('project:')).length,3);
  const pw=card(liveCatalog,'pw',lang);assert.ok(JSON.stringify(pw).includes('https://pw.qianqi.site/'));assert.ok(JSON.stringify(pw).includes('ponsfamily.com'));assert.ok(pw.text.includes('<code>0xe0c6b2040624dde42c3ce55cfbf818d8b79035b7</code>'));assert.ok(pw.text.includes('60%'));
 }
 let state={offset:0},stored;const sent=[];
 let updates=[{update_id:1,callback_query:{id:'l',from:{id:123,language_code:'en'},message:{chat:{id:123,type:'private'}},data:'lang:zh'}}];
 const api=async(method,body)=>method==='getUpdates'?updates:sent.push(body);
 await pollOnce({catalog:liveCatalog,username,api,state,save:async s=>{stored=structuredClone(s)}});
 state=stored;updates=[update(2,'/projects',{from:{id:123,language_code:'en'}})];
 await pollOnce({catalog:liveCatalog,username,api,state,save:async()=>{}});assert.match(sent.at(-1).text,/请选择项目/);
 assert.match(actions(liveCatalog,update(3,'/start',{from:{id:123,language_code:'de'}}),username)[0].body.text,/Choose a project/);
});
test('Hub gives PW monitor links instead of an unrelated USDG draw iframe',()=>{
 const html=hubCards(liveCatalog),pw=html.slice(html.indexOf('<article class="project project-monitor"'));
 assert.ok(pw.includes('PW on Pons'));assert.ok(pw.includes('qianqi_hub_bot'));assert.ok(!pw.includes('<iframe'));assert.ok(!pw.includes('USDG draws'));
});
