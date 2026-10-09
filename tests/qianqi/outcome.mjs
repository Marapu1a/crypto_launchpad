import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {id,ZeroHash} from 'ethers';
import {computeDatasetOutcome,buildBasket,admissionThreshold} from '../../src/qianqi/outcome-replay.mjs';
import {compute as legacy} from '../../src/draws/short-outcome.mjs';
import {abi} from '../../src/qianqi/finance-shadow.mjs';
const report=JSON.parse(readFileSync(process.argv[2]+'/report.json'));
assert.equal(report.status,'INDEPENDENT_SHORT_OUTCOMES_MATCH');
const history=JSON.parse(readFileSync(report.archive.history+'/report.json'));
const calls=readdirSync(report.archive.finance).filter(f=>/^\d+-rpc.json$/.test(f)).map(f=>JSON.parse(readFileSync(report.archive.finance+'/'+f))).filter(r=>r.method==='eth_call'&&r.params[0].data.startsWith(abi.getFunction('shortResult').selector));
const input=d=>({...d,participants:history.replay.draws.find(s=>s.snapshot.drawId===d.drawId).snapshot.participants});
test('both outcomes independently match captured controller result and five amounts',()=>{
 for(const d of report.draws){const result=computeDatasetOutcome(input(d)).result;
 const call=calls.find(r=>abi.decodeFunctionData('shortResult',r.params[0].data)[0]===d.drawId);assert.ok(call);const expected=abi.decodeFunctionResult('shortResult',call.result)[0];
 assert.deepEqual(result,{winners:expected.winners.map(x=>x.toLowerCase()),amounts:expected.amounts.map(String),prizeIndices:expected.prizeIndices.map(String),admittedCount:String(expected.admittedCount),resultHash:expected.resultHash});}
 assert.equal(report.draws.reduce((s,d)=>s+d.result.winners.length,0),5);
});
test('rational threshold uses exact 256-bit floor arithmetic',()=>{
 const r={version:1,pNumerator:1,pDenominator:2,hNumerator:1,hDenominator:1};assert.equal(admissionThreshold(0,r),0n);assert.equal(admissionThreshold(1,r),1n<<254n);assert.equal(admissionThreshold(2,r),(1n<<256n)/3n);assert.ok(admissionThreshold((1n<<128n)-1n,r)<1n<<255n);
 assert.throws(()=>admissionThreshold(1n<<128n,r));assert.throws(()=>admissionThreshold(Number.MAX_SAFE_INTEGER+1,r));
});
test('basket has explicit unallocated rounding and minimum boundary',()=>{
 assert.deepEqual(buildBasket(101,[4,3,2,1],10),{prizes:[40n,30n,20n,10n],remainder:1n});assert.throws(()=>buildBasket(99,[4,3,2,1],10));assert.throws(()=>buildBasket(100,[0],1));assert.throws(()=>buildBasket((1n<<256n)-1n,[(1n<<256n)-1n,1],1));
});
test('zero winner remains a valid deterministic outcome',()=>{
 const args=input(report.draws[0]);let found;
 for(let i=0;i<100;i++){const r=computeDatasetOutcome({...args,seed:id('no-winner-'+i)});if(!r.result.winners.length){found=r;break;}}
 assert.ok(found);assert.equal(found.result.admittedCount,'0');assert.deepEqual(found.result.amounts,[]);assert.notEqual(found.result.resultHash,ZeroHash);
});
test('one, ten and 64 prize places match established arithmetic across 24 vectors',()=>{
 for(const count of [0,1,10,80])for(const places of [1,10,64])for(const seed of [id('a'),id('b')]){
 const participants=Array.from({length:count},(_,i)=>({wallet:'0x'+(i+1).toString(16).padStart(40,'0'),firstAttempt:'1',lastAttempt:'20',count:'20'}));
 const args={context:id('vectors'),seed,participants,rules:report.draws[0].rules,weights:Array.from({length:places},(_,i)=>places-i),minimumUnit:1,budget:1000000};
 const actual=computeDatasetOutcome(args),expected=legacy(args.context,seed,participants,args.rules,actual.prizes);
 assert.deepEqual(actual.result.winners,expected.winners);assert.deepEqual(actual.result.amounts,expected.amounts.map(String));assert.deepEqual(actual.result.prizeIndices,expected.prizeIndices.map(String));assert.equal(actual.result.admittedCount,String(expected.admittedCount));
 assert.notEqual(actual.result.resultHash,expected.resultHash);assert.equal(new Set(actual.result.winners).size,actual.result.winners.length);
 }
});
test('seed, context, participants and policy changes cannot reproduce historical result hash',()=>{
 const args=input(report.draws[1]),original=computeDatasetOutcome(args).result.resultHash;
 for(const altered of [{...args,seed:id('wrong')},{...args,context:id('wrong')},{...args,participants:args.participants.slice(1)},{...args,weights:[...args.weights].reverse()},{...args,rules:{...args.rules,pNumerator:1,pDenominator:2}}])assert.notEqual(computeDatasetOutcome(altered).result.resultHash,original);
 assert.throws(()=>computeDatasetOutcome({...args,participants:[...args.participants].reverse()}));assert.throws(()=>computeDatasetOutcome({...args,rules:{...args.rules,version:2}}));
});
test('controller comparison values cannot influence independent calculation',()=>{
 const args=input(report.draws[0]),before=computeDatasetOutcome(args);assert.deepEqual(computeDatasetOutcome({...args,result:{winners:[],amounts:['999'],resultHash:id('fake')}}),before);
});
