import { inProject } from './store.mjs';

const hash=/^0x[0-9a-f]{64}$/;
const quantity=value=>{
  if(typeof value!=='string'||!/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value))throw Error('Invalid RPC quantity');
  const n=Number(BigInt(value));if(!Number.isSafeInteger(n))throw Error('Unsafe RPC quantity');return n;
};
const hex=n=>'0x'+n.toString(16);
function header(block,number){
  if(!block||quantity(block.number)!==number||!hash.test(block.hash)||!hash.test(block.parentHash))throw Error('Missing or invalid block');
}

// One bounded step. Caller supplies an ethers-compatible send(method, params).
// The configured target is an admission bound, NOT a claim of chain finality.
export async function ingestNext(pool,rpc,sourceId,target){
  if(!Number.isSafeInteger(target)||target<0)throw Error('Invalid target');
  const upstream=rpc,deadline=Date.now()+30000;
  rpc={send:async(method,params)=>{
    const remaining=Math.min(5000,deadline-Date.now());
    if(remaining<=0)throw Error('RPC read budget exhausted');
    let timer;
    try{return await Promise.race([upstream.send(method,params),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('RPC read timeout')),remaining);})]);}
    finally{clearTimeout(timer);}
  }};
  const client=await pool.connect();
  let broken=false;
  try{
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='3s'");
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,49173))',[sourceId]);
    const {rows:[s]}=await client.query('SELECT * FROM launchpad.chain_sources WHERE id=$1 FOR UPDATE',[sourceId]);
    if(!s||s.halted)throw Error('Source missing or halted');
    const head=Number(s.head_number);
    if(!Number.isSafeInteger(head))throw Error('Unsafe stored head');
    const chain=quantity(await rpc.send('eth_chainId',[]));
    const genesis=await rpc.send('eth_getBlockByNumber',['0x0',false]);header(genesis,0);
    if(String(chain)!==s.chain_id||genesis.hash!==s.genesis_hash)throw Error('RPC network mismatch');
    const tip=await rpc.send('eth_getBlockByNumber',[hex(head),false]);header(tip,head);
    if(tip.hash!==s.head_hash){
      await client.query('UPDATE launchpad.chain_sources SET halted=true WHERE id=$1',[sourceId]);
      await client.query('COMMIT');return {status:'HALTED_REORG'};
    }
    if(target<=head){await client.query('COMMIT');return {status:'CAUGHT_UP'};}
    const block=await rpc.send('eth_getBlockByNumber',[hex(head+1),true]);header(block,head+1);
    if(block.parentHash!==s.head_hash)throw Error('Noncontiguous chain');
    if(!Array.isArray(block.transactions))throw Error('Missing transactions');
    const receipts=[],seen=new Set();
    for(const [index,tx] of block.transactions.entries()){
      if(!tx||!hash.test(tx.hash)||seen.has(tx.hash)||tx.blockHash!==block.hash||quantity(tx.blockNumber)!==head+1||quantity(tx.transactionIndex)!==index)throw Error('Invalid transaction');
      seen.add(tx.hash);
      const receipt=await rpc.send('eth_getTransactionReceipt',[tx.hash]);
      if(!receipt||receipt.transactionHash!==tx.hash||receipt.blockHash!==block.hash||quantity(receipt.blockNumber)!==head+1||quantity(receipt.transactionIndex)!==index||!Array.isArray(receipt.logs))throw Error('Missing or invalid receipt');
      for(const log of receipt.logs){
        if(log.removed||log.blockHash!==block.hash||log.transactionHash!==tx.hash||quantity(log.blockNumber)!==head+1||quantity(log.transactionIndex)!==index)throw Error('Invalid receipt log');
      }
      receipts.push(receipt);
    }
    // Detect a branch change while downloading receipts; no partial block commits.
    const check=await rpc.send('eth_getBlockByNumber',[hex(head+1),false]);header(check,head+1);
    if(check.hash!==block.hash)throw Error('Branch changed during read');
    await client.query('INSERT INTO launchpad.chain_blocks VALUES($1,$2,$3,$4)',[sourceId,head+1,block.hash,JSON.stringify({block,receipts})]);
    await client.query('UPDATE launchpad.chain_sources SET head_number=$2,head_hash=$3 WHERE id=$1',[sourceId,head+1,block.hash]);
    await client.query('COMMIT');return {status:'INGESTED',number:head+1};
  }catch(error){try{await client.query('ROLLBACK');}catch{broken=true;}throw error;}
  finally{client.release(broken);}
}

// Token-address evidence inbox, not eligibility/ticket accounting. Keep full receipts
// for matching transactions, including transfers, refunds and unknown router evidence.
export async function applyNext(pool,projectId,moduleId){
  return inProject(pool,projectId,async c=>{
    const {rows:[s]}=await c.query(`SELECT r.*,p.token_address,p.chain_id FROM launchpad.read_subscriptions r
      JOIN launchpad.projects p ON p.id=r.project_id WHERE r.project_id=$1 AND r.module_id=$2 FOR UPDATE OF r`,[projectId,moduleId]);
    if(!s)throw Error('Subscription missing');
    await c.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,49173))',[s.source_id]);
    const {rows:[source]}=await c.query('SELECT * FROM launchpad.chain_sources WHERE id=$1',[s.source_id]);
    if(source.halted||source.chain_id!==s.chain_id)throw Error('Source halted or wrong chain');
    const cursor=Number(s.cursor_number);
    if(!Number.isSafeInteger(cursor)||cursor<Number(source.anchor_number)||cursor>Number(source.head_number))throw Error('Invalid apply cursor');
    const previous=cursor===Number(source.anchor_number)?source.anchor_hash:(await c.query('SELECT hash FROM launchpad.chain_blocks WHERE source_id=$1 AND number=$2',[s.source_id,cursor])).rows[0]?.hash;
    if(previous!==s.cursor_hash)throw Error('Apply cursor branch mismatch');
    if(cursor===Number(source.head_number))return {status:'CAUGHT_UP'};
    const {rows:[next]}=await c.query('SELECT * FROM launchpad.chain_blocks WHERE source_id=$1 AND number=$2',[s.source_id,cursor+1]);
    if(!next||next.evidence.block.parentHash!==s.cursor_hash)throw Error('Missing contiguous evidence');
    const selected=next.evidence.receipts.filter(r=>r.logs.some(l=>l.address?.toLowerCase()===s.token_address));
    const txs=new Set(selected.map(r=>r.transactionHash));
    const evidence={transactions:next.evidence.block.transactions.filter(t=>txs.has(t.hash)),receipts:selected};
    await c.query('INSERT INTO launchpad.project_evidence VALUES($1,$2,$3,$4,$5,$6)',[projectId,moduleId,s.source_id,cursor+1,next.hash,JSON.stringify(evidence)]);
    await c.query('UPDATE launchpad.read_subscriptions SET cursor_number=$3,cursor_hash=$4 WHERE project_id=$1 AND module_id=$2',[projectId,moduleId,cursor+1,next.hash]);
    return {status:'APPLIED',number:cursor+1,transactions:evidence.transactions.length};
  },{readOnly:false});
}
