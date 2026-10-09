import { keccak256 } from 'ethers';
import { inProject } from './store.mjs';
import { sourceFor,hashAt,bindings,canonical,bundleFrom } from './ticket-shadow.mjs';
import { verifyProfile } from '../../src/tickets/scanner.mjs';
import { recognize } from '../../src/tickets/recognition.mjs';
import { digest } from '../../src/tickets/digest.mjs';
import { participantsHash } from '../../src/draws/short-outcome.mjs';
import { RECOGNITION,confirmationLogs,deferDecision,creditedEvents } from '../../src/tickets/late-recognition.mjs';

const check=(ok,message)=>{if(!ok)throw Error(message);};
const parse=(text,checksum)=>{const value=JSON.parse(text);check(digest(value)===checksum,'Ledger checksum mismatch');return value;};
const hex=n=>'0x'+BigInt(n).toString(16);
function totals(spent,threshold){
  const value=BigInt(spent),unit=BigInt(threshold),tickets=value/unit;
  check(value>=0n&&tickets<(1n<<128n),'Ticket uint128 overflow');
  return {spent:String(value),tickets:String(tickets),remainder:String(value%unit)};
}
async function locked(c,p,m){
  const {rows:[row]}=await c.query('SELECT * FROM launchpad.ticket_ledgers WHERE project_id=$1 AND module_id=$2 FOR UPDATE',[p,m]);
  check(row,'Ticket ledger missing');const profile=parse(row.profile_text,row.profile_hash),source=await sourceFor(c,row.source_id);
  await bindings(c,p,m,source,profile);
  check(await hashAt(c,source,Number(row.cursor_number))===row.cursor_hash,'Ledger cursor branch mismatch');
  return {row,profile,source};
}
export async function registerTicketLedger(pool,provider,p,m,sourceId,profile){
  return inProject(pool,p,async c=>{
    const source=await sourceFor(c,sourceId);await bindings(c,p,m,source,profile);
    await verifyProfile(provider,profile,Number(source.head_number));await canonical(provider,Number(source.head_number),source.head_hash);
    await c.query('INSERT INTO launchpad.ticket_ledgers VALUES($1,$2,$3,$4,$5,$6,$7)',[p,m,sourceId,JSON.stringify(profile),digest(profile),profile.anchor.number,profile.anchor.hash]);
  },{readOnly:false});
}

async function credit(c,p,m,profile,event){
  const text=JSON.stringify(event),number=event.creditedAt?.blockNumber??event.blockNumber;
  const {rowCount}=await c.query(`INSERT INTO launchpad.ticket_credits VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT(project_id,module_id,candidate_id) DO NOTHING`,[p,m,event.candidateId,event.recipient.toLowerCase(),event.netQuoteDebitRaw,number,text,digest(event)]);
  if(!rowCount)return 0; // Existing credit is verified against its original proof before this call.
  const {rows:[wallet]}=await c.query(`INSERT INTO launchpad.ticket_wallets VALUES($1,$2,$3,$4)
    ON CONFLICT(project_id,module_id,wallet) DO UPDATE SET spent=launchpad.ticket_wallets.spent+EXCLUDED.spent RETURNING spent::text`,[p,m,event.recipient.toLowerCase(),event.netQuoteDebitRaw]);
  totals(wallet.spent,profile.thresholdRaw);return 1;
}

// Reuse the audited late-recognition rules on ONLY the bounded set named by this
// commitment (at most 50 candidates). Prior credits supply first creditedAt.
async function confirm(c,p,m,profile,block,transaction,receipt,log,bundle,codeHash,stats){
  check(Array.isArray(bundle.candidates)&&bundle.candidates.length>0&&bundle.candidates.length<=50,'Invalid bundle candidates');
  const key=RECOGNITION.parseLog(log).args.bundleHash;
  await c.query('INSERT INTO launchpad.ticket_commitments VALUES($1,$2,$3,$4,$5)',[p,m,key,Number(BigInt(block.number)),JSON.stringify({transaction,receipt,log,bundle,recognitionCodeHash:codeHash})]);
  const {rows}=await c.query(`SELECT e.*,c.event_text AS credit_text,c.event_hash AS credit_hash FROM launchpad.ticket_events e
    LEFT JOIN launchpad.ticket_credits c USING(project_id,module_id,candidate_id)
    WHERE e.project_id=$1 AND e.module_id=$2 AND e.candidate_id=ANY($3::text[])`,[p,m,bundle.candidates]);
  stats.proofRowsRead+=rows.length;
  const blocks=new Map();
  for(const row of rows){
    const stored=parse(row.payload_text,row.payload_hash);
    const event=row.credit_text?parse(row.credit_text,row.credit_hash):stored.event;
    const n=stored.event.blockNumber;
    if(!blocks.has(n))blocks.set(n,{number:n,hash:stored.event.blockHash,events:[],evidence:[]});
    const source=blocks.get(n);check(source.hash===stored.event.blockHash,'Conflicting purchase branch');
    source.events.push(event);
    if(!source.evidence.some(e=>e.transaction.hash===stored.evidence.transaction.hash))source.evidence.push(stored.evidence);
  }
  const current={number:Number(BigInt(block.number)),hash:block.hash,events:[],evidence:[],recognitionCodeHash:codeHash,confirmations:[{transaction,receipt,log,bundle}]};
  const state={profile,blocks:[...blocks.values()].sort((a,b)=>a.number-b.number).concat(current)};
  const events=creditedEvents(state); // Includes domain, source, authority, canonical proof and repeat checks.
  for(const event of events){check(event.status==='ELIGIBLE','Unverified credit');stats.creditsAdded+=await credit(c,p,m,profile,event);}
}

export async function applyTicketLedger(pool,provider,p,m,cutoff,{bundleDirectory}={}){
  return inProject(pool,p,async c=>{
    const {row,profile,source}=await locked(c,p,m),start=Number(row.cursor_number);
    check(Number.isSafeInteger(cutoff)&&cutoff>=start&&cutoff-start<=500&&cutoff<=Number(source.head_number),'Invalid ledger cutoff');
    await verifyProfile(provider,profile,cutoff);await canonical(provider,Number(source.head_number),source.head_hash);
    const {rows}=await c.query('SELECT * FROM launchpad.chain_blocks WHERE source_id=$1 AND number>$2 AND number<=$3 ORDER BY number',[source.id,start,cutoff]);
    check(rows.length===cutoff-start,'Missing ledger blocks');
    const stats={blocksRead:rows.length,eventsAdded:0,proofRowsRead:0,creditsAdded:0};let previous=row.cursor_hash;
    for(const raw of rows){
      const {block,receipts}=raw.evidence,number=Number(raw.number);
      check(block.hash===raw.hash&&block.parentHash===previous&&Number(BigInt(block.number))===number,'Discontinuous ledger history');
      check(receipts.length===block.transactions.length,'Incomplete ledger receipts');
      for(const [i,transaction] of block.transactions.entries()){
        const receipt=receipts[i];
        check(receipt?.blockHash===block.hash&&receipt.transactionHash===transaction.hash
          &&receipt.logs.every(l=>!l.removed&&l.blockHash===block.hash&&l.transactionHash===transaction.hash),'Ledger receipt branch mismatch');
        for(const decision of recognize(profile,transaction,receipt)){
          const event=deferDecision(profile,decision),payload={event,evidence:{transaction,receipt}};
          await c.query('INSERT INTO launchpad.ticket_events VALUES($1,$2,$3,$4,$5,$6)',[p,m,event.candidateId,number,JSON.stringify(payload),digest(payload)]);
          stats.eventsAdded++;
          if(event.status==='ELIGIBLE')stats.creditsAdded+=await credit(c,p,m,profile,event);
        }
        for(const log of confirmationLogs(profile,receipt)){
          const bundle=await bundleFrom(bundleDirectory,RECOGNITION.parseLog(log).args.bundleHash);
          const codeHash=keccak256(await provider.send('eth_getCode',[profile.recognition.source,hex(number)]));
          await confirm(c,p,m,profile,block,transaction,receipt,log,bundle,codeHash,stats);
        }
      }
      previous=block.hash;
    }
    await canonical(provider,cutoff,previous);await canonical(provider,Number(source.head_number),source.head_hash);
    await c.query('UPDATE launchpad.ticket_ledgers SET cursor_number=$3,cursor_hash=$4 WHERE project_id=$1 AND module_id=$2',[p,m,cutoff,previous]);
    return {head:{number:cutoff,hash:previous},...stats};
  },{readOnly:false});
}

export async function readTicketLedger(pool,p,m){
  return inProject(pool,p,async c=>{
    const {rows}=await c.query(`SELECT l.*,w.wallet,w.spent::text FROM launchpad.ticket_ledgers l
      LEFT JOIN launchpad.ticket_wallets w USING(project_id,module_id)
      WHERE l.project_id=$1 AND l.module_id=$2 ORDER BY w.wallet`,[p,m]);
    if(!rows.length)return null;const row=rows[0],profile=parse(row.profile_text,row.profile_hash);
    return {profile,head:{number:Number(row.cursor_number),hash:row.cursor_hash},wallets:Object.fromEntries(rows.filter(r=>r.wallet).map(r=>[r.wallet,totals(r.spent,profile.thresholdRaw)]))};
  });
}

// Comparison-only snapshot, same schema/hash as snapshotTickets. No financial admission.
export async function freezeLedgerSnapshot(pool,provider,p,m,label,cutoff,consumed={}){
  check(/^[A-Za-z0-9_-]{1,80}$/.test(label),'Invalid ledger snapshot label');
  check(consumed&&typeof consumed==='object'&&!Array.isArray(consumed),'Invalid consumption');
  for(const [wallet,value] of Object.entries(consumed))check(/^0x[0-9a-f]{40}$/.test(wallet)&&typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value),'Invalid consumption');
  return inProject(pool,p,async c=>{
    const {row,profile,source}=await locked(c,p,m);
    check(Number.isSafeInteger(cutoff)&&cutoff>=profile.anchor.number&&cutoff<=Number(row.cursor_number),'Invalid snapshot cutoff');
    await verifyProfile(provider,profile,Number(row.cursor_number));await canonical(provider,Number(source.head_number),source.head_hash);
    const inputHash=digest({cutoff,consumed:Object.fromEntries(Object.entries(consumed).sort(([a],[b])=>a.localeCompare(b)))});
    const {rows:[existing]}=await c.query('SELECT * FROM launchpad.ticket_snapshots WHERE project_id=$1 AND module_id=$2 AND label=$3',[p,m,label]);
    if(existing){check(existing.input_hash===inputHash,'Ledger snapshot already frozen');const snapshot=JSON.parse(existing.snapshot_text);const {snapshotHash,...body}=snapshot;check(digest(body)===snapshotHash,'Snapshot checksum mismatch');return snapshot;}
    const {rows}=await c.query(`SELECT wallet,sum(amount)::text AS spent FROM launchpad.ticket_credits
      WHERE project_id=$1 AND module_id=$2 AND credited_block<=$3 GROUP BY wallet`,[p,m,cutoff]);
    const wallets=Object.fromEntries(rows.map(r=>[r.wallet,totals(r.spent,profile.thresholdRaw)])),participants=[];
    for(const wallet of [...new Set([...Object.keys(wallets),...Object.keys(consumed)])].sort()){
      const end=BigInt(wallets[wallet]?.tickets??'0'),used=BigInt(consumed[wallet]??'0');
      check(used<=end,'Consumed attempts exceed indexed history');
      if(end>used)participants.push({wallet,firstAttempt:String(used+1n),lastAttempt:String(end)});
    }
    const blockHash=await hashAt(c,source,cutoff);check(blockHash,'Missing snapshot block');
    const body={schema:'launchpad-short-tickets-v1',profileHash:digest(profile),cutoff,blockHash,participants,participantsHash:participantsHash(participants)};
    const snapshot={...body,snapshotHash:digest(body)};
    await canonical(provider,cutoff,blockHash);await canonical(provider,Number(source.head_number),source.head_hash);
    await c.query('INSERT INTO launchpad.ticket_snapshots VALUES($1,$2,$3,$4,$5,$6)',[p,m,label,cutoff,inputHash,JSON.stringify(snapshot)]);return snapshot;
  },{readOnly:false});
}
