import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {advanceShadow,applyRecognitionPurchase} from '../../src/qianqi/live-shadow.mjs';
import {fullReplay} from '../../src/qianqi/history-replay.mjs';
import {canonical} from '../../src/qianqi/ticket-shadow.mjs';
import {previous,liveReport,capturedReads} from './live-fixture.mjs';
const run=edit=>advanceShadow({previous,...capturedReads(edit)});
test('real new finalized range matches all wallet balances',async()=>{const r=await run();assert.deepEqual(r.payload,liveReport.payload);assert.deepEqual(r.delta,{buys:0,sells:0,recognitions:0,lifecycle:0});assert.ok(r.comparedWallets>=52);});
test('canonical branch mismatch is a durable halt signal',async()=>{await assert.rejects(run(r=>{if(r.method==='eth_getBlockByNumber'&&r.params[0]==='0x503cf5b')r.result.hash='0x'+'11'.repeat(32)}),e=>e.code==='QIANQI_REORG');});
test('mixed API generation cannot advance',async()=>{await assert.rejects(run(r=>{if(r.path?.startsWith('/v1/wallets/'))r.data.provenance.ledgerHash='0x'+'11'.repeat(32)}),/generation/);});
test('wrong wallet balance cannot advance',async()=>{await assert.rejects(run(r=>{if(r.path?.startsWith('/v1/wallets/'))r.data.balances.carryRaw='99999999'}),/balance mismatch/);});
test('new head must be finalized',async()=>{await assert.rejects(run(r=>{if(r.method==='eth_getBlockByNumber'&&r.params[0]==='finalized')r.result.number='0x1'}),/not finalized/);});
test('same checkpoint is an idempotent observation',async()=>{const r=await advanceShadow({previous:liveReport.payload,...capturedReads()});assert.equal(r.changed,false);assert.deepEqual(r.payload,liveReport.payload);});
test('one historical ordinary buy is applied from a shortened predecessor',async()=>{
 const dir='.local/test-results/qianqi-history-2026-10-09T13-19-20-045Z';
 const ordinary=JSON.parse(readFileSync(resolve(dir,'ordinary-evidence.json'))),e=ordinary.find(x=>Number(BigInt(x.tx.blockNumber))===83421709);assert.ok(e);
 const prior=structuredClone(previous);prior.purchases=prior.purchases.filter(p=>p.transactionHash!==e.tx.hash.toLowerCase());prior.provenance.head={number:83421708,hash:e.parent.hash};prior.counts.buys--;prior.counts.eligible--;
 prior.replay=fullReplay({purchases:prior.purchases,events:prior.events,domain:prior.publicProfile.domain,rulesHash:prior.publicProfile.lifecycle.shortRules.rulesHash,anchor:prior.provenance.anchor.number,head:83421708});prior.counts.wallets=prior.replay.wallets.length;
 const historical=new Map(readdirSync(dir).filter(f=>/^\d+-rpc.json$/.test(f)).map(f=>{const r=JSON.parse(readFileSync(resolve(dir,f)));return [canonical([r.method,r.params]),r.result]}));
 const selected=e.receipt.logs.find(l=>l.address.toLowerCase()===prior.publicProfile.profile.curve.toLowerCase()&&l.topics.length===3);assert.ok(selected);
 const reads=capturedReads();const rpc=async(method,params)=>{
  if(method==='eth_getBlockByNumber'&&params[0]==='0x'+(83421708).toString(16))return e.parent;
  if(method==='eth_getLogs'){const q=params[0];return q.address.toLowerCase()===selected.address.toLowerCase()&&q.topics[0]===selected.topics[0]&&BigInt(q.fromBlock)<=83421709n&&BigInt(q.toBlock)>=83421709n?[selected]:[];}
  if(method==='eth_getBlockByNumber'&&params[0]==='finalized')return reads.rpc(method,params);
  const key=canonical([method,params]);if(historical.has(key))return structuredClone(historical.get(key));return reads.rpc(method,params);
 };
 const result=await advanceShadow({previous:prior,rpc,getJson:reads.getJson});assert.equal(result.delta.buys,1);assert.deepEqual(result.payload.purchases,liveReport.payload.purchases);assert.deepEqual(result.payload.replay,liveReport.payload.replay);
});

test('late admission uses confirmation time and repeated confirmation preserves first credit',()=>{
 const prior=previous.purchases.find(p=>p.recognition),verified={...prior};delete verified.creditedAt;delete verified.recognition;
 const waiting={...prior,status:'WAITING_RECOGNITION'};delete waiting.creditedAt;delete waiting.recognition;
 const credited=applyRecognitionPurchase(waiting,verified,prior.creditedAt,prior.recognition.bundleHash);assert.deepEqual(credited,prior);
 const later={...prior.creditedAt,blockNumber:prior.creditedAt.blockNumber+100};assert.deepEqual(applyRecognitionPurchase(prior,verified,later,prior.recognition.bundleHash),prior);
 assert.throws(()=>applyRecognitionPurchase(prior,{...verified,grossQuoteRaw:'1'},later,prior.recognition.bundleHash),/conflicts/);
});
