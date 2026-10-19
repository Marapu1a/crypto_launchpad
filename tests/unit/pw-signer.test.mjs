import test from 'node:test';
import assert from 'node:assert/strict';
import {Wallet,Transaction} from 'ethers';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadPwOwnerSigner} from '../../server/owner-launch/pw-signer.mjs';
test('disabled console never opens credentials; encrypted owner signs offline and wrong owner is rejected',async()=>{
 assert.equal(await loadPwOwnerSigner({allowPublicTransactions:false,ownerKeystore:{file:'missing'}}),undefined);
 const dir=await mkdtemp(join(tmpdir(),'pw-signer-')),file=join(dir,'owner.json'),passwordFile=join(dir,'password.txt'),wallet=Wallet.createRandom(),password='temporary test password only';
 try{
  await writeFile(file,await wallet.encrypt(password),{mode:0o600});await writeFile(passwordFile,password,{mode:0o600});
  const c={allowPublicTransactions:true,ownerKeystore:{file,passwordFile},profile:{owner:wallet.address}};
  const signer=await loadPwOwnerSigner(c);assert.equal(signer.provider,null);
  const raw=await signer.signTransaction({chainId:4663,to:wallet.address,value:0,nonce:0,gasLimit:21000,gasPrice:1,type:0});assert.equal(Transaction.from(raw).from,wallet.address);
  await assert.rejects(loadPwOwnerSigner({...c,profile:{owner:Wallet.createRandom().address}}),/another project/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
