import test from 'node:test';
import assert from 'node:assert/strict';
import {privateCredentialMode} from '../../server/shared/credential-access.mjs';
test('systemd read-only service credentials are accepted without weakening ordinary file permissions',()=>{
 const directory='/run/credentials/pons-runtime.service',args={file:directory+'/rpc-url',directory,realDirectory:directory,gid:1001,stat:{uid:0,gid:1001,mode:0o440}};
 assert.equal(privateCredentialMode(args),true);
 assert.equal(privateCredentialMode({...args,stat:{...args.stat,gid:0}}),true);
 for(const patch of [{directory:undefined},{realDirectory:'/tmp/fake'},{file:'/tmp/rpc-url'},{gid:999},{stat:{...args.stat,mode:0o640}},{stat:{...args.stat,uid:1001}},{stat:{...args.stat,mode:0o444}}])assert.equal(privateCredentialMode({...args,...patch}),false);
 assert.equal(privateCredentialMode({...args,directory:undefined,stat:{mode:0o600}}),true);
});
