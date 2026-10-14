// Offline saved-state rehearsal. No keys, RPC or executor journals are loaded.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createMigration,advanceMigration} from '../server/adapters/qianqi/pons-migration.mjs';
const root='.local/pons-accounting',read=p=>JSON.parse(readFileSync(root+'/'+p,'utf8'));
const saved=read('migration/source-public-state.json').qianqi,life=read('migration/qianqi-lifecycle.json'),report=read('reports/qianqi.json');
const p=report.profile,policy={projectId:'qianqi-offline-migration',contracts:{token:{address:p.token},quote:{address:p.quote}},template:{config:{ticketPurchase:p.threshold}}};
const legacyCredits=saved.ledger.decisions.filter(e=>e.status==='ELIGIBLE').map(e=>({...e,recipient:e.payer,netQuoteDebitRaw:e.grossQuoteRaw}));
// Comparison-only timestamp, NOT an executable finalized chain checkpoint.
const head={number:life.head.number,hash:life.head.hash,timestamp:report.checkedAt};
const state=createMigration({policy,report,legacyCredits,lifecycle:life,domain:life.draws.at(-1).snapshot.domain,rewards:saved.rewards,head,now:report.checkedAt});
const restart=advanceMigration({state:JSON.parse(JSON.stringify(state)),report,head,now:report.checkedAt});
assert.deepEqual(state.ledger,restart.ledger);assert.deepEqual(state.admissions,restart.admissions);
assert.deepEqual(state.ledger.draws,life.draws);assert.deepEqual(state.ledger.pending,life.pending);assert.deepEqual(state.rewards,saved.rewards);
const lanes=Object.fromEntries(['SHORT','MONTHLY'].map(k=>[k,Object.fromEntries(['mintedTotal','open','consumedTotal'].map(field=>[field,String(state.ledger.wallets.reduce((n,w)=>n+BigInt(w[k][field]),0n))]))]));
const output=root+'/migration/rehearsal-'+new Date().toISOString().replace(/[:.]/g,'-');mkdirSync(output,{recursive:true});
writeFileSync(output+'/state.json',JSON.stringify(state,null,2));
const result={status:'PASS',executionEnabled:false,lanes,admissions:state.admissions.length,preservedDraws:state.ledger.draws.length,legacyDifferences:state.accounting.legacyDifferences.length,
 limits:['Offline source comparison, no finalized RPC verification','This comparison does not execute controller synchronization or scheduler sends','Checksum is not external authentication']};
writeFileSync(output+'/report.json',JSON.stringify(result,null,2));console.log(JSON.stringify({output,...result}));
