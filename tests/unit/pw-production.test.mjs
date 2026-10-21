import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PW_EXTERNALS,validatePwProductionProfile,verifyPwProductionEnvironment} from '../../server/owner-launch/pw-profile.mjs';
import {createPwOwnerCoordinator} from '../../server/owner-launch/pw-coordinator.mjs';
import {compilePwLaunch} from '../../src/launch/pw-build.mjs';
import {validateExecutionPolicy,checkpointExecution} from '../../src/holders/execution.mjs';
import {holderFundingInstance} from '../../src/holders/funding-receipt.mjs';
import {identity} from '../../src/holders/values.mjs';
import {pwGasBudget} from '../../src/worker/service-gas-budget.mjs';
const build=compilePwLaunch().manifest.buildHash;
const p={schema:'pw-production-profile-v1',mode:'production',executionEnabled:false,id:'11111111-1111-4111-8111-111111111111',chainId:4663,buildHash:build,owner:'0x0000000000000000000000000000000000001001',executor:'0x0000000000000000000000000000000000001002',publisher:'0x0000000000000000000000000000000000001003',project:'0x0000000000000000000000000000000000001004',anchor:{number:100,hash:'0x'+'ab'.repeat(32)},externals:PW_EXTERNALS,timing:{lead:3600,clockLag:30,clockAhead:30,finalizedLag:1800,beaconLag:30},maxGasLimit:'15000000',maxFeePerGas:'3000000000',totalNativeLimit:'1000000000000000000',nativeFloor:'1'};
test('PW production configuration requires explicit reviewed identity, roles, artifacts and gas bounds',()=>{
 assert.equal(validatePwProductionProfile(p,build),p);
 for(const change of [{executionEnabled:true},{id:'bad'},{chainId:1},{buildHash:'0x'+'00'.repeat(32)},{publisher:p.owner},{owner:'0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'},{maxFeePerGas:'0'},{nativeFloor:undefined},{externals:{...PW_EXTERNALS,extra:PW_EXTERNALS.factory}},{timing:{...p.timing,lead:1}}])assert.throws(()=>validatePwProductionProfile({...p,...change},build));
});
test('PW rejects development nodes and changed anchor before deployment',async()=>{
 await assert.rejects(verifyPwProductionEnvironment({getNetwork:async()=>({chainId:4663n}),send:async()=>'HardhatNetwork'},p,build),/development node/);
 await assert.rejects(verifyPwProductionEnvironment({getNetwork:async()=>({chainId:1n})},p,build),/Wrong/);
});
test('PW public send switch is server-owned and disabled by default',async()=>{
 const preparation=JSON.parse(readFileSync('tokens/PatternWatcher/preparation.json','utf8'));
 const co=createPwOwnerCoordinator({profile:p,preparation});
 assert.equal(co.info().signingEnabled,false);
 await assert.rejects(co.broadcast(p.id),/disabled/);
 await assert.rejects(co.record(p.id,'0x'),/disabled/);
 assert.throws(()=>createPwOwnerCoordinator({profile:p,preparation,allowPublicTransactions:'true'}),/switch/);
});
test('Production holder policy keeps v2 authority checks and requires chain anchor and reserves',async()=>{
 const scope={projectId:p.id,chainId:4663,token:p.project,asset:'0x'+'0'.repeat(40)};
 const policy={schema:'holder-execution-production-v1',executionEnabled:false,scopeId:identity(scope),instance:holderFundingInstance(scope),vault:'0x0000000000000000000000000000000000001005',source:'0x0000000000000000000000000000000000001006',publisher:p.publisher,initialOwner:p.owner,codeHash:p.anchor.hash,minimumPayment:'500000000000000',maxGasLimit:p.maxGasLimit,maxFeePerGas:p.maxFeePerGas,nativeFloor:'1',anchor:p.anchor,timing:p.timing};
 assert.throws(()=>validateExecutionPolicy(policy,scope),/gas budget/);
 policy.gasBudget=pwGasBudget(p,1000,'1000000000000000');
 assert.equal(validateExecutionPolicy(policy,scope).schema,policy.schema);
 assert.throws(()=>validateExecutionPolicy({...policy,anchor:undefined},scope));
 assert.throws(()=>validateExecutionPolicy({...policy,nativeFloor:'0'},scope));
 await assert.rejects(checkpointExecution({getNetwork:async()=>({chainId:4663n}),send:async()=>'anvil'},policy,scope),/development node/);
});
