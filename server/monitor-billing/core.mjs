import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {getAddress,verifyMessage,hexlify,toUtf8Bytes,parseUnits,formatEther} from 'ethers';

export const PLANS=Object.freeze({day:{usdCents:100,seconds:86400},week:{usdCents:400,seconds:604800},month:{usdCents:1000,seconds:2592000}});
export const CHAIN=4663;
export const hash=s=>createHash('sha256').update(s).digest('hex');
export function fail(code,status=400){throw Object.assign(Error(code),{code,status})}
export const wallet=s=>{try{return getAddress(s).toLowerCase()}catch{fail('INVALID_WALLET')}};
export const paymentData=id=>hexlify(toUtf8Bytes('PatternWatcher subscription:'+id));
export function quoteWei(cents,price){
 if(!/^\d{1,8}(\.\d{1,8})?$/.test(price))fail('PRICE_UNAVAILABLE',503);
 const rate=parseUnits(price,8);if(rate<=0n)fail('PRICE_UNAVAILABLE',503);
 // Ceil to wei; never pass an onchain amount through floating point.
 const numerator=BigInt(cents)*10n**24n;
 return ((numerator+rate-1n)/rate).toString();
}
export function invoiceView(r){return {id:r.id,plan:r.plan,usdCents:r.usd_cents,rateUsd:r.rate_usd,amountWei:String(r.amount_wei),amountETH:formatEther(r.amount_wei),recipient:r.recipient,chainId:r.chain_id,createdAt:Number(r.created_at),expiresAt:Number(r.expires_at),state:r.state,txHash:r.tx_hash,reason:r.reason,accessUntil:r.access_until?Number(r.access_until):null,data:paymentData(r.id)}};
async function transaction(pool,fn){const c=await pool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
export function createBilling({pool,provider,price,origin,recipient,enabled=false,now=()=>Math.floor(Date.now()/1000)}){
 recipient=wallet(recipient);const domain=new URL(origin).host;
 const find=async(w,id)=>{if(!/^[0-9a-f-]{36}$/i.test(id))fail('INVALID_INVOICE');const {rows:[r]}=await pool.query('SELECT * FROM monitor_billing.invoices WHERE wallet=$1 AND id=$2',[w,id]);if(!r)fail('INVOICE_NOT_FOUND',404);return r};
 return {
  enabled,
  async challenge(address){const w=wallet(address),id=randomBytes(24).toString('hex'),at=now();
   const message=`${domain} wants you to sign in with your Ethereum account:\n${getAddress(w)}\n\nSign in to Pattern Watcher. This does not authorize a payment.\n\nURI: ${origin}\nVersion: 1\nChain ID: ${CHAIN}\nNonce: ${id}\nIssued At: ${new Date(at*1000).toISOString()}\nExpiration Time: ${new Date((at+300)*1000).toISOString()}`;
   await pool.query('DELETE FROM monitor_billing.challenges WHERE expires_at<$1',[at]);
   await pool.query('INSERT INTO monitor_billing.challenges VALUES($1,$2,$3,$4)',[id,w,message,at+300]);return {id,message};
  },
  async login(id,signature){if(typeof id!=='string'||typeof signature!=='string'||signature.length>300)fail('INVALID_SIGNATURE');
   return transaction(pool,async c=>{const {rows:[r]}=await c.query('SELECT * FROM monitor_billing.challenges WHERE id=$1 FOR UPDATE',[id]);if(!r||Number(r.expires_at)<now())fail('CHALLENGE_EXPIRED');let signer;try{signer=wallet(verifyMessage(r.message,signature))}catch{fail('INVALID_SIGNATURE')}if(signer!==r.wallet)fail('INVALID_SIGNATURE');
    await c.query('DELETE FROM monitor_billing.challenges WHERE id=$1',[id]);const token=randomBytes(32).toString('hex');await c.query('INSERT INTO monitor_billing.sessions VALUES($1,$2,$3)',[hash(token),signer,now()+604800]);return {token,wallet:signer};});
  },
  async session(token){if(!/^[0-9a-f]{64}$/.test(token??''))return null;const {rows:[r]}=await pool.query('SELECT wallet FROM monitor_billing.sessions WHERE digest=$1 AND expires_at>$2',[hash(token),now()]);return r?.wallet??null},
  async logout(token){await pool.query('DELETE FROM monitor_billing.sessions WHERE digest=$1',[hash(token??'')])},
  async access(w){const {rows:[r]}=await pool.query('SELECT expires_at FROM monitor_billing.entitlements WHERE wallet=$1',[w]);return {wallet:w,expiresAt:Number(r?.expires_at??0),active:Number(r?.expires_at??0)>now()}},
  async invoices(w){const {rows}=await pool.query('SELECT * FROM monitor_billing.invoices WHERE wallet=$1 ORDER BY created_at DESC LIMIT 20',[w]);return rows.map(invoiceView)},
  async quote(w,plan){if(!enabled)fail('PAYMENTS_NOT_OPEN',503);if(!Object.hasOwn(PLANS,plan))fail('INVALID_PLAN');
   return transaction(pool,async c=>{await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['pw-invoice:'+w]);const at=now();const {rows:[old]}=await c.query("SELECT * FROM monitor_billing.invoices WHERE wallet=$1 AND plan=$2 AND expires_at>$3 AND state='quoted' ORDER BY created_at DESC LIMIT 1",[w,plan,at]);if(old)return invoiceView(old);
    const rate=await price(),id=randomUUID(),p=PLANS[plan],amount=quoteWei(p.usdCents,rate);const {rows:[r]}=await c.query('INSERT INTO monitor_billing.invoices(id,wallet,plan,usd_cents,rate_usd,amount_wei,recipient,chain_id,created_at,expires_at,duration_seconds) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[id,w,plan,p.usdCents,rate,amount,recipient,CHAIN,at,at+600,p.seconds]);return invoiceView(r);});
  },
  async confirm(w,id,txHash){
   if(!/^0x[0-9a-f]{64}$/i.test(txHash??''))fail('INVALID_TRANSACTION');txHash=txHash.toLowerCase();const invoice=await find(w,id);if(invoice.state==='paid'&&invoice.tx_hash===txHash)return invoiceView(invoice);
   if(Number((await provider.getNetwork()).chainId)!==CHAIN)fail('WRONG_RPC_CHAIN',503);
   const tx=await provider.getTransaction(txHash);if(!tx)return {...invoiceView(invoice),check:'pending'};
   if(Number(tx.chainId)!==CHAIN||wallet(tx.from)!==w||!tx.to||wallet(tx.to)!==invoice.recipient||tx.data.toLowerCase()!==paymentData(id).toLowerCase())fail('PAYMENT_MISMATCH');
   await pool.query('INSERT INTO monitor_billing.payment_attempts VALUES($1,$2,$3,$4) ON CONFLICT(tx_hash) DO NOTHING',[txHash,id,now(),invoice.tx_hash&&invoice.tx_hash!==txHash?'DUPLICATE_PAYMENT':null]);
   if(invoice.tx_hash&&invoice.tx_hash!==txHash)return {...invoiceView(invoice),state:'review',reason:'DUPLICATE_PAYMENT',txHash};
   // Save a submitted transaction before waiting for finality. It remains recoverable after a tab closes.
   try{await pool.query("UPDATE monitor_billing.invoices SET tx_hash=$3,state='pending' WHERE wallet=$1 AND id=$2 AND state IN ('quoted','pending') AND (tx_hash IS NULL OR tx_hash=$3)",[w,id,txHash])}catch(e){if(e.code==='23505')fail('TRANSACTION_ALREADY_USED');throw e}
   const current=await find(w,id);if(current.tx_hash&&current.tx_hash!==txHash)fail('INVOICE_HAS_TRANSACTION');
   const receipt=await provider.getTransactionReceipt(txHash);if(!receipt)return {...invoiceView(current),check:'pending'};
   const finalized=await provider.getBlock('finalized');if(!finalized||receipt.blockNumber>finalized.number)return {...invoiceView(current),check:'pending'};
   const block=await provider.getBlock(receipt.blockNumber);if(!block||block.hash!==receipt.blockHash||tx.blockHash!==receipt.blockHash)fail('PAYMENT_NOT_CANONICAL',409);
   let reason=null;
   if(receipt.status!==1)reason='TRANSACTION_REVERTED';
   else if(tx.value!==BigInt(invoice.amount_wei))reason='AMOUNT_MISMATCH';
   else if(block.timestamp<Number(invoice.created_at)-30)reason='PAYMENT_PREDATES_INVOICE';
   else if(block.timestamp>Number(invoice.expires_at))reason='LATE_PAYMENT';
   return transaction(pool,async c=>{await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['pw-invoice:'+w]);const {rows:[r]}=await c.query('SELECT * FROM monitor_billing.invoices WHERE id=$1 FOR UPDATE',[id]);if(r.state==='paid')return invoiceView(r);if(r.tx_hash!==txHash)fail('INVOICE_HAS_TRANSACTION');
    if(reason){const {rows:[review]}=await c.query("UPDATE monitor_billing.invoices SET state='review',reason=$2 WHERE id=$1 RETURNING *",[id,reason]);return invoiceView(review)}
    const {rows:[access]}=await c.query('INSERT INTO monitor_billing.entitlements(wallet,expires_at) VALUES($1,$2) ON CONFLICT(wallet) DO UPDATE SET expires_at=GREATEST(monitor_billing.entitlements.expires_at,$3)+$4 RETURNING expires_at',[w,now()+r.duration_seconds,now(),r.duration_seconds]);
    const {rows:[paid]}=await c.query("UPDATE monitor_billing.invoices SET state='paid',reason=NULL,settled_at=$2,access_until=$3 WHERE id=$1 RETURNING *",[id,now(),access.expires_at]);return invoiceView(paid);
   });
  }
 };
}
