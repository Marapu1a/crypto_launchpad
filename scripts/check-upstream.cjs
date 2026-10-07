const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../vendor/qianqi');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'UPSTREAM.json')));
for (const file of manifest.files) {
  const content = fs.readFileSync(path.join(root, file.path), 'utf8').replace(/\r\n/g, '\n');
  const hash = createHash('sha256').update(content).digest('hex');
  if (hash !== file.sha256_lf) throw new Error('Changed upstream file: ' + file.path);
}
if (manifest.unresolved_relative_imports.length) throw new Error('Unresolved source dependencies');
console.log(`${manifest.files.length} upstream files verified at ${manifest.commit}`);
