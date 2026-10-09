import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { keccak256 } from 'ethers';
import { inProject } from './store.mjs';
import { verifyProfile } from '../../src/tickets/scanner.mjs';
import { NETWORK } from '../../src/pons/client.mjs';
import { recognize } from '../../src/tickets/recognition.mjs';
import { digest,replayTickets,snapshotTickets } from '../../src/tickets/ledger.mjs';
import { RECOGNITION,MAX_BUNDLE_BYTES,bundleHash,confirmationLogs,deferDecision,creditedEvents } from '../../src/tickets/late-recognition.mjs';

const hex=n=>'0x'+BigInt(n).toString(16);
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const check=(ok,message)=>{if(!ok)throw Error(message);};

export async function sourceFor(c,id){
  await c.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,49173))',[id]);
  const {rows:[source]}=await c.query('SELECT * FROM launchpad.chain_sources WHERE id=$1',[id]);
  check(source&&!source.halted,'Ticket source missing or halted');return source;
}
export async function hashAt(c,source,number){
  if(number===Number(source.anchor_number))return source.anchor_hash;
  return (await c.query('SELECT hash FROM launchpad.chain_blocks WHERE source_id=$1 AND number=$2',[source.id,number])).rows[0]?.hash;
}
export async function bindings(c,projectId,moduleId,source,profile){
  const {rows:[m]}=await c.query(`SELECT p.chain_id,p.token_address,m.program_address,m.adapter_version FROM launchpad.projects p
    JOIN launchpad.module_instances m ON m.project_id=p.id WHERE p.id=$1 AND m.id=$2`,[projectId,moduleId]);
  check(m&&m.chain_id===source.chain_id&&profile.chainId===m.chain_id&&same(profile.token,m.token_address)
    &&same(profile.registry,m.program_address),'Ticket project/module binding mismatch');
  check(profile.schema==='launchpad-local-ticket-profile-v1'&&profile.chainId==='31337','Only local ticket profiles supported');
  check(m.adapter_version==='local-ticket-shadow-v1','Ticket shadow adapter version mismatch');
  check(same(profile.factory,NETWORK.factory)&&same(profile.router,NETWORK.router)
    &&profile.codeHashes?.factory===NETWORK.factoryHash&&same(profile.quote,'0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'),'Unsupported ticket deployment');
  check(/^[1-9]\d*$/.test(profile.thresholdRaw)&&BigInt(profile.thresholdRaw)<(1n<<256n),'Invalid ticket threshold');
  check(Number.isSafeInteger(profile.anchor?.number)&&profile.anchor.number>=Number(source.anchor_number)
    &&profile.anchor.number<=Number(source.head_number),'Ticket anchor outside source');
  check(await hashAt(c,source,profile.anchor.number)===profile.anchor.hash,'Ticket anchor branch mismatch');
}
export async function canonical(provider,number,hash){
  check((await provider.send('eth_getBlockByNumber',[hex(number),false]))?.hash===hash,'Ticket branch changed');
}
function unpack(row){
  const profile=JSON.parse(row.profile_text),state=JSON.parse(row.state_text);
  check(digest(profile)===row.profile_hash&&digest(state)===row.state_hash&&digest(state.profile)===row.profile_hash,'Ticket state/profile checksum mismatch');
  check(String(state.head.number)===row.cursor_number&&state.head.hash===row.cursor_hash,'Ticket cursor mismatch');
  return state;
}
async function save(c,projectId,moduleId,state){
  await c.query(`UPDATE launchpad.ticket_shadows SET state_text=$3,state_hash=$4,cursor_number=$5,cursor_hash=$6
    WHERE project_id=$1 AND module_id=$2`,[projectId,moduleId,JSON.stringify(state),digest(state),state.head.number,state.head.hash]);
}
export async function bundleFrom(directory,key){
  check(directory,'Recognition bundle directory required');
  check(/^0x[0-9a-f]{64}$/.test(key),'Invalid bundle key');
  const file=await open(join(directory,key+'.json'),'r');
  try{
    check((await file.stat()).size<=MAX_BUNDLE_BYTES,'Recognition bundle too large');
    const bundle=JSON.parse(await file.readFile('utf8'));
    check(bundleHash(bundle)===key,'Recognition bundle hash mismatch');return bundle;
  }finally{await file.close();}
}

// Internal shadow setup, no public endpoint. Immutable profile; a changed profile
// requires a new module identity, never a silent replacement of accumulated tickets.
export async function registerTicketShadow(pool,provider,projectId,moduleId,sourceId,profile){
  return inProject(pool,projectId,async c=>{
    const source=await sourceFor(c,sourceId);
    await bindings(c,projectId,moduleId,source,profile);
    await verifyProfile(provider,profile,Number(source.head_number));
    await canonical(provider,Number(source.head_number),source.head_hash);
    const state={profile,head:profile.anchor,blocks:[],snapshots:{}};
    await c.query('INSERT INTO launchpad.ticket_shadows VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [projectId,moduleId,sourceId,JSON.stringify(profile),digest(profile),JSON.stringify(state),digest(state),state.head.number,state.head.hash]);
    return state;
  },{readOnly:false});
}

// The source contains ALL receipts, including registry confirmations without token
// transfers. Do not read project_evidence (its token-only filter is insufficient).
export async function applyTicketShadow(pool,provider,projectId,moduleId,cutoff,{bundleDirectory}={}){
  return inProject(pool,projectId,async c=>{
    const {rows:[row]}=await c.query('SELECT * FROM launchpad.ticket_shadows WHERE project_id=$1 AND module_id=$2 FOR UPDATE',[projectId,moduleId]);
    check(row,'Ticket shadow missing');
    const state=unpack(row),profile=state.profile,source=await sourceFor(c,row.source_id);
    await bindings(c,projectId,moduleId,source,profile);
    check(Number.isSafeInteger(cutoff)&&cutoff>=state.head.number&&cutoff-state.head.number<=500&&cutoff<=Number(source.head_number),'Invalid ticket cutoff (max 500 blocks)');
    check(await hashAt(c,source,state.head.number)===state.head.hash,'Ticket stored branch mismatch');
    await verifyProfile(provider,profile,cutoff);
    await canonical(provider,Number(source.head_number),source.head_hash);
    const target=await hashAt(c,source,cutoff);check(target,'Missing ticket cutoff');
    const {rows}=await c.query('SELECT * FROM launchpad.chain_blocks WHERE source_id=$1 AND number>$2 AND number<=$3 ORDER BY number',[source.id,state.head.number,cutoff]);
    check(rows.length===cutoff-state.head.number,'Missing ticket blocks');
    for(const raw of rows){
      const {block,receipts}=raw.evidence,number=Number(raw.number);
      check(number===state.head.number+1&&Number(BigInt(block.number))===number&&block.hash===raw.hash&&block.parentHash===state.head.hash,'Discontinuous ticket history');
      check(receipts.length===block.transactions.length,'Incomplete ticket receipts');
      const events=[],evidence=[],confirmations=[];let recognitionCodeHash;
      for(const [i,transaction] of block.transactions.entries()){
        const receipt=receipts[i];
        check(receipt&&receipt.blockHash===block.hash&&receipt.transactionHash===transaction.hash
          &&receipt.logs.every(l=>!l.removed&&l.blockHash===block.hash&&l.transactionHash===transaction.hash),'Ticket receipt branch mismatch');
        const recognized=recognize(profile,transaction,receipt);
        if(recognized.length)evidence.push({transaction,receipt});
        events.push(...recognized.map(event=>deferDecision(profile,event)));
        for(const log of confirmationLogs(profile,receipt)){
          const key=RECOGNITION.parseLog(log).args.bundleHash,bundle=await bundleFrom(bundleDirectory,key);
          recognitionCodeHash??=keccak256(await provider.send('eth_getCode',[profile.recognition.source,hex(number)]));
          confirmations.push({transaction,receipt,log,bundle});
        }
      }
      const saved={number,hash:block.hash,events,evidence};
      if(confirmations.length)Object.assign(saved,{confirmations,recognitionCodeHash});
      state.blocks.push(saved);state.head={number,hash:block.hash};
    }
    state.wallets=replayTickets(creditedEvents(state),profile.thresholdRaw);
    await canonical(provider,cutoff,target);
    await canonical(provider,Number(source.head_number),source.head_hash);
    await save(c,projectId,moduleId,state);return state;
  },{readOnly:false});
}

// Shadow comparison artifact only: no chain cycle, no authoritative consumed reads,
// no signing/financial worker integration. Frozen input includes consumed ranges.
export async function freezeShadowSnapshot(pool,provider,projectId,moduleId,label,cutoff,consumed={}){
  check(/^[A-Za-z0-9_-]{1,80}$/.test(label),'Invalid shadow snapshot label');
  check(consumed&&typeof consumed==='object'&&!Array.isArray(consumed),'Invalid shadow consumption');
  for(const [wallet,value] of Object.entries(consumed))check(/^0x[0-9a-f]{40}$/.test(wallet)
    &&typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value),'Invalid shadow consumption');
  return inProject(pool,projectId,async c=>{
    const {rows:[row]}=await c.query('SELECT * FROM launchpad.ticket_shadows WHERE project_id=$1 AND module_id=$2 FOR UPDATE',[projectId,moduleId]);
    check(row,'Ticket shadow missing');const state=unpack(row),source=await sourceFor(c,row.source_id);
    await bindings(c,projectId,moduleId,source,state.profile);
    await verifyProfile(provider,state.profile,state.head.number);
    await canonical(provider,Number(source.head_number),source.head_hash);
    check(await hashAt(c,source,state.head.number)===state.head.hash,'Ticket stored branch mismatch');
    const normalized=Object.fromEntries(Object.entries(consumed).sort(([a],[b])=>a.localeCompare(b)));
    const inputHash=digest({cutoff,consumed:normalized}),existing=state.snapshots[label];
    if(existing){check(existing.inputHash===inputHash,'Shadow snapshot already frozen');return existing.snapshot;}
    const snapshot=snapshotTickets(state,cutoff,normalized);
    state.snapshots[label]={inputHash,snapshot};await save(c,projectId,moduleId,state);return snapshot;
  },{readOnly:false});
}

export async function readTicketShadow(pool,projectId,moduleId){
  return inProject(pool,projectId,async c=>{
    const {rows:[row]}=await c.query('SELECT * FROM launchpad.ticket_shadows WHERE project_id=$1 AND module_id=$2',[projectId,moduleId]);
    return row?unpack(row):null;
  });
}
