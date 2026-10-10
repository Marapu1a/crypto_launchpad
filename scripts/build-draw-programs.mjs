import { mkdirSync, writeFileSync } from 'node:fs';
import { compileDrawPrograms } from '../src/worker/draw-build.mjs';
const result = compileDrawPrograms();
const root = '.local/builds/draw-v2-' + new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync(root, { recursive: true });
writeFileSync(root + '/manifest.json', JSON.stringify(result.manifest, null, 2));
writeFileSync(root + '/artifacts.json', JSON.stringify(result.artifacts));
console.log(JSON.stringify({ root, buildHash: result.manifest.buildHash, sizes: Object.fromEntries(Object.entries(result.manifest.contracts).map(([n, c]) => [n, c.runtimeBytes])), deploymentAuthorized: false }, null, 2));
