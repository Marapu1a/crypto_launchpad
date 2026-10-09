import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const root=new URL('../server/adapters/qianqi/runtime/',import.meta.url);
// Rebuild from reviewed sources; do not silently reuse an old runtime manifest.
if(fs.existsSync(new URL('artifacts/runtime-manifest.json',root)))throw Error('Runtime artifact already pinned; explicitly review before rebuilding');
require('../server/adapters/qianqi/runtime/scripts/compile.cjs').compile();
const bytes=fs.readFileSync(new URL('artifacts/compiled.json',root));
const result={schema:'qianqi-runtime-artifact-v1',sha256:createHash('sha256').update(bytes).digest('hex')};
fs.writeFileSync(new URL('artifacts/runtime-manifest.json',root),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
