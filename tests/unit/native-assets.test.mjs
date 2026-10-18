import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ZeroAddress} from 'ethers';
import {amount,qianqiPreset,validateConfig,previewBasket} from '../../src/draws/config.mjs';
import {validateProgramConfig,igwMonthlyDraft} from '../../src/draws/program-config.mjs';
import {advancePonsAccounting,ponsWallets} from '../../src/tickets/pons-accounting.mjs';
import {initialDraft} from '../../src/pons/plan.mjs';
import {validateDrawLaunch} from '../../src/launch/draw-template.mjs';
import {createFundingPreview,previewFundingReceipt} from '../../src/draws/funding-preview.mjs';
import {drawAsset} from '../../src/draws/assets.mjs';
export const nativeConfig=()=>({...qianqiPreset(),version:4,asset:'ETH',ticketPurchase:'0.001',allocation:{shortBps:10000},short:{enabled:true,intervalSeconds:3600,minimumFund:'0.005',basket:{weights:[1],minimumUnit:'0.005'}},monthly:{enabled:false,intervalSeconds:2592000,minimumFund:'0.005',nextReserve:'0.005',winnerCount:1}});
test('Explicit native v4 uses wei precision and cannot silently upgrade legacy configs',()=>{
 const c=nativeConfig();assert.equal(validateProgramConfig(c).asset,'ETH');assert.throws(()=>validateConfig({...c,version:1}));
 for(const version of [2,3])assert.throws(()=>validateProgramConfig({...c,version}));
 assert.equal(amount('0.000000000000000001',undefined,'ETH'),1n);assert.throws(()=>amount('0.0000001'));
 assert.throws(()=>amount('0.0000000000000000001',undefined,'ETH'));
 for(const asset of ['WETH','__proto__','constructor',null])assert.throws(()=>drawAsset(asset));
 assert.equal(previewBasket(5000000000000000n,c.short.basket,'ETH').ready,true);
 assert.equal(igwMonthlyDraft(c).short.intervalSeconds,2592000);assert.equal(igwMonthlyDraft(c).version,4);
});
test('Launch asset and Pons pair must match; zero-address ETH is intentional',()=>{
 const input={id:'a5897d1a-def5-4c9f-a7bb-a76f2b16519e',slug:'native-test',draft:{...initialDraft(),name:'Native',symbol:'NATIVE',logo:'ipfs://bafkreigh2akiscaildcobgdzvv2a6sjkgmsnj4qpxqshgjp4l5te2qv3ee',pair:ZeroAddress,creatorFee:'3',openingBuy:'0'},team:'0x'+'1'.repeat(40),operations:'0x'+'2'.repeat(40),draws:nativeConfig()};
 assert.equal(validateDrawLaunch(input).draft.pair,ZeroAddress);assert.throws(()=>validateDrawLaunch({...input,draft:{...input.draft,pair:input.team}}));
});
test('Pons ETH amounts produce tickets in wei, reject wrong quote/decimals, preserve sub-ticket carry',()=>{
 const token='0x'+'1'.repeat(40),trader='0x'+'2'.repeat(40),tx='0x'+'a'.repeat(64),policy={template:{config:nativeConfig()},contracts:{token:{address:token}}};
 const report={schema:'pons-purchase-accounting-v1',source:'Pons API',status:'current',checkedAt:100,reviewCount:0,tradeCount:1,profile:{token,quote:ZeroAddress,decimals:18,threshold:'0.001',excludedWallets:[],venues:['curve']},activity:[{id:tx+':0',txHash:tx,trader,quoteRaw:'1500000000000000',timestamp:99,side:'buy',venue:'curve',decision:'purchase'}]};
 const args={policy,report,head:{number:2,hash:'0x'+'b'.repeat(64),timestamp:100},now:100};
 const state=advancePonsAccounting(args),wallets=ponsWallets(state,'1000000000000000');assert.equal(wallets[trader].tickets,'1');
 assert.equal(wallets[trader].remainder,'500000000000000');
 for(const profile of [{...report.profile,decimals:6},{...report.profile,quote:token}])assert.throws(()=>advancePonsAccounting({...args,report:{...report,profile}}));
});
test('Native funding preview caps Next in wei and conserves every receipt',()=>{
 const config=nativeConfig();config.monthly.enabled=true;config.allocation.shortBps=5000;
 const r=previewFundingReceipt(createFundingPreview(config),1000000000000000000n);
 assert.equal(r.state.next,5000000000000000n);assert.equal(r.state.current,495000000000000000n);
 assert.equal(r.state.short+r.state.current+r.state.next,r.state.received);
});
