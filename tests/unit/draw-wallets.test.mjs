import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectWallets} from '../../server/short-runtime/draw-wallets.mjs';
import {publicSnapshot} from '../../server/shared/short-view.mjs';
import {participantsHash} from '../../src/draws/short-outcome.mjs';
const wallet='0x'+'1'.repeat(40),other='0x'+'2'.repeat(40);
test('Wallet projection separates frozen, spent and late tickets and exact remainder',async()=>{
 const input={wallets:{[wallet]:{spent:'425000000',tickets:'42',remainder:'5000000'}},program:{consumedThrough:async()=>0n,rewards:async()=>0n},cycle:1n,pending:true,frozen:{participants:[{wallet,firstAttempt:'1',lastAttempt:'40'}]}};
 input.frozen.participantsHash=participantsHash(input.frozen.participants);
 let r=await projectWallets(input);assert.equal(r[wallet].reserved,'40');assert.equal(r[wallet].available,'2');assert.equal(r[wallet].remainderRaw,'5000000');
 input.pending=false;input.program.consumedThrough=async()=>40n;input.program.rewards=async()=>1234567n;
 r=await projectWallets(input);assert.equal(r[wallet].used,'40');assert.equal(r[wallet].available,'2');assert.equal(r[wallet].latestUnpaidRewardRaw,'1234567');
 input.program.consumedThrough=async()=>43n;await assert.rejects(projectWallets(input),/counters/);
 input.pending=true;input.frozen.participants[0].lastAttempt='39';await assert.rejects(projectWallets(input),/snapshot/);
});
test('Public snapshots never leak wallet map and missing coverage is not a zero balance',()=>{
 const s={cycle:'1',kind:'short',walletSnapshot:{schema:'draw-wallets-v1',items:{[wallet]:{available:'42'},[other]:{available:'99'}}}};
 assert.equal(publicSnapshot(s).walletSnapshot,undefined);assert.equal(publicSnapshot(s,wallet).wallet.available,'42');assert.ok(!JSON.stringify(publicSnapshot(s,wallet)).includes(other));
 assert.equal(publicSnapshot(s,'0x'+'3'.repeat(40)).wallet.available,'0');assert.equal(publicSnapshot({cycle:'1'},wallet).wallet,null);
});
