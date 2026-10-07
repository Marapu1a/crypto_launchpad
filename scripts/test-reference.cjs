// Run the imported offline regression subset in a disposable local copy.
// Upstream tests write artifacts and reports relative to cwd.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const base = path.join(root, '.local', 'reference-tests');
fs.mkdirSync(base, { recursive: true });
const cwd = fs.mkdtempSync(path.join(base, 'run-'));
fs.cpSync(path.join(root, 'vendor/qianqi'), cwd, { recursive: true });
// The upstream solc callback reads OpenZeppelin relative to cwd, unlike Node resolution.
fs.cpSync(path.join(root, 'node_modules/@openzeppelin/contracts'),
  path.join(cwd, 'node_modules/@openzeppelin/contracts'), { recursive: true });
const tests = [
  'direct-buy', 'persistent-buy-indexer', 'shared-index-config',
  'attempt-lifecycle', 'attempt-lifecycle-events', 'purchase-recognition',
  'drand-binding-model', 'drand-delivery-worker', 'local-transaction', 'local-state-lock'
].map(name => `test/${name}.test.cjs`);
console.log('Offline legacy regression subset. Artifacts: ' + cwd);
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...tests], {
  cwd, stdio: 'inherit', env: { ...process.env, NODE_PATH: path.join(root, 'node_modules') }
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
