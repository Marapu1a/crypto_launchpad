import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
export async function exerciseImportCli({url,project,module,dir,archive}){
 const manifest=join(dir,'portable-archive.json');writeFileSync(manifest,JSON.stringify(archive));
 const {stdout}=await promisify(execFile)(process.execPath,[resolve('scripts/qianqi-import-shadow.mjs')],{cwd:tmpdir(),windowsHide:true,env:{...process.env,SHARED_JOBS_URL:url,SHARED_PROJECT_ID:project,SHARED_MODULE_ID:module,QIANQI_ARCHIVE_MANIFEST:manifest}});
 const result=JSON.parse(stdout);assert.equal(result.status,'VERIFIED_IMPORT');assert.equal(result.inserted,false);assert.equal(result.executionEligible,false);
}
