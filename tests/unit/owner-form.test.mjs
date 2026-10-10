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
