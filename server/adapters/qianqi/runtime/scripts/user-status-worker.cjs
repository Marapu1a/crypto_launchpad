// Internal worker: no RPC/signing and no external endpoint.
const {parentPort,workerData}=require('node:worker_threads');
const {createReader}=require('./user-status-api.cjs');
const reader=createReader(workerData);
parentPort.on('message',({id,query})=>{
 const result=reader.read(query);
 parentPort.postMessage({id,result,key:reader.generation()});
});
