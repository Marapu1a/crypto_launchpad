import { mkdirSync, writeFileSync } from 'node:fs';
import { compileProduction } from '../src/worker/production-build.mjs';
const result = compileProduction();
const root = '.local/builds/production-' + new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync(root, { recursive: true });
writeFileSync(root + '/manifest.json', JSON.stringify(result.manifest, null, 2));
writeFileSync(root + '/artifacts.json', JSON.stringify(result.artifacts));
console.log(JSON.stringify({ root, buildHash: result.manifest.buildHash, sizes: Object.fromEntries(Object.entries(result.manifest.contracts).map(([n, c]) => [n, c.runtimeBytes])), deploymentAuthorized: false }, null, 2));
