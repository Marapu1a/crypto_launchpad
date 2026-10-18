import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {validatePwRuntimeEntry,configuredPonsBootstrap} from '../../server/shared/pons-bootstrap.mjs';
test('PW public output cannot overwrite source or credentials; policy must be pinned',()=>{
 const entry={policyHash:'a'.repeat(64),...Object.fromEntries(['rpcFile','databaseFile','jobsDatabaseFile','keyFile','passwordFile','reportFile','publicFile'].map(k=>[k,resolve('.local/test-'+k)]))};
 assert.equal(validatePwRuntimeEntry(entry),entry);
 for(const k of ['rpcFile','databaseFile','jobsDatabaseFile','keyFile','passwordFile','reportFile'])assert.throws(()=>validatePwRuntimeEntry({...entry,publicFile:entry[k]}),/isolated/);
 assert.throws(()=>validatePwRuntimeEntry({...entry,reportFile:'relative.json'}),/Absolute/);
 assert.throws(()=>validatePwRuntimeEntry({...entry,policyHash:'unknown'}),/hash/);
});
test('PW production bootstrap stays disabled until explicit activation',()=>{
 assert.throws(()=>configuredPonsBootstrap({schema:'pons-runtime-config-v1',mode:'production',allowPublicTransactions:false,projects:[{adapter:'pw'}]}),/configuration/);
});
