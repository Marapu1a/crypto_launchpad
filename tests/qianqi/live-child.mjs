import assert from 'node:assert/strict';
import {createPool} from '../../server/shared/store.mjs';
import {readQianqiLive,observeQianqiLive} from '../../server/shared/qianqi-live.mjs';
import {capturedReads} from './live-fixture.mjs';
const {url,p,m,digest}=JSON.parse(process.env.QIANQI_LIVE_TEST),pool=createPool(url);
try{assert.equal((await readQianqiLive(pool,p,m)).digest,digest);const r=await observeQianqiLive(pool,p,m,capturedReads());assert.equal(r.inserted,false);assert.equal(r.digest,digest);}finally{await pool.end();}
