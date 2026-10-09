import assert from 'node:assert/strict';
import {createPool} from '../../server/shared/store.mjs';
import {readQianqiHistory,importQianqiHistory} from '../../server/shared/qianqi-history.mjs';
const {url,p,m,archive,digest}=JSON.parse(process.env.QIANQI_TEST),pool=createPool(url);
try{assert.equal((await readQianqiHistory(pool,p,m)).digest,digest);const r=await importQianqiHistory(pool,p,m,archive);assert.equal(r.inserted,false);assert.equal(r.digest,digest);}finally{await pool.end();}
