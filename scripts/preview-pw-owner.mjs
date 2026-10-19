import {pwOwnerFixture} from '../tests/studio/pw-owner-fixture.mjs';
const fixture=await pwOwnerFixture({port:4215});
console.log('PW demonstration only; no RPC, funds or deployment: '+fixture.url);
process.once('SIGINT',()=>void fixture.close());process.once('SIGTERM',()=>void fixture.close());
