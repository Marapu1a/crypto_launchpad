import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialDraft} from '../../src/pons/plan.mjs';
import {USDG} from '../../src/launch/template.mjs';
import {qianqiPreset} from '../../src/draws/config.mjs';
import {upgradeProgramDraft} from '../../src/draws/program-config.mjs';
import {readOwnerForm} from '../../src/launch/owner-form.mjs';
const fixture=()=>{
 const input={id:'a5897d1a-def5-4c9f-a7bb-a76f2b16519e',slug:'form-test',draft:{...initialDraft(),name:'Form',symbol:'FORM',logo:'ipfs://bafkreigh2akiscaildcobgdzvv2a6sjkgmsnj4qpxqshgjp4l5te2qv3ee',pair:USDG,creatorFee:'2',openingBuy:'0'},team:'0x'+'1'.repeat(40),operations:'0x'+'2'.repeat(40),draws:upgradeProgramDraft({...qianqiPreset(),monthly:{...qianqiPreset().monthly,enabled:false}},10000)};
 const data=new Map(Object.entries({...input.draft,slug:input.slug,team:input.team,operations:input.operations,mode:'both',ticketPurchase:'10',minimumFund:'50',hours:'168',count:'64',weights:'7:4:2',minimumUnit:'1',prizes:'80',teamShare:'15',operationsShare:'5',monthlyMinimum:'50',monthlyNext:'20',shortShare:'7000'}));return {input,data};
};
test('All three form modes preserve explicit allocation and ignore hidden settings',()=>{
 for(const mode of ['short','monthly','both']){const {input,data}=fixture();data.set('mode',mode);if(mode==='monthly')data.set('hours','bad');if(mode==='short')data.set('monthlyNext','bad');
 const out=readOwnerForm(input,data);assert.equal(out.draws.allocation.shortBps,mode==='both'?7000:mode==='short'?10000:0);assert.equal(out.draws.monthly.intervalSeconds,2592000);if(mode!=='monthly'){assert.equal(out.draws.short.basket.weights.length,64);assert.equal(out.draws.short.basket.weights.at(-1),1);}}
});
test('Invalid fields fail without mutating the draft; old version is not upgraded',()=>{
 for(const [field,value] of [['hours','169'],['shortShare','0'],['creatorFee','1000'],['openingBuy','-1'],['monthlyNext','0'],['prizes','90'],['mode','bogus']]){const {input,data}=fixture(),before=structuredClone(input);data.set(field,value);assert.throws(()=>readOwnerForm(input,data));assert.deepEqual(input,before);}
 const {input,data}=fixture();input.draws.version=1;delete input.draws.allocation;assert.equal(readOwnerForm(input,data).draws.version,1);
});

test('Full website changes independently of internal slug and prepared logo',()=>{
 const {input,data}=fixture();data.delete('slug');data.delete('logo');data.set('website','https://another-token.example/');
 const out=readOwnerForm(input,data);
 assert.equal(out.draft.website,'https://another-token.example/');assert.equal(out.slug,input.slug);assert.equal(out.draft.logo,input.draft.logo);
 data.set('website','javascript:alert(1)');assert.throws(()=>readOwnerForm(input,data));assert.equal(input.draft.website,'');
});

test('Monthly IGW form explicitly creates v3 and survives reopening without hidden fields',()=>{
 const {input,data}=fixture(),before=structuredClone(input);data.set('schedule','igw-monthly');data.set('hours','bad');
 const out=readOwnerForm(input,data);assert.equal(out.draws.version,3);assert.equal(out.draws.short.intervalSeconds,2592000);
 assert.equal(out.draws.monthly.enabled,false);assert.equal(out.draws.allocation.shortBps,10000);assert.deepEqual(input,before);
 data.delete('schedule');data.delete('mode');assert.deepEqual(readOwnerForm(out,data),out);
 data.set('schedule','legacy');assert.throws(()=>readOwnerForm(out,data));
});
test('Explicit ETH conversion requires all amounts and leaves the USDG draft unchanged',()=>{
 const {input,data}=fixture(),before=structuredClone(input);data.set('asset','ETH');
 data.set('ticketPurchase','0.001');data.set('minimumFund','0.005');data.set('minimumUnit','0.000001');data.set('monthlyMinimum','0.005');data.set('monthlyNext','0.005');
 const out=readOwnerForm(input,data);assert.equal(out.draws.version,4);assert.equal(out.draws.asset,'ETH');assert.equal(out.draft.pair,'0x'+'0'.repeat(40));assert.deepEqual(input,before);
 data.delete('monthlyNext');assert.throws(()=>readOwnerForm(input,data),/explicit amounts/);
});
