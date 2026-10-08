const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const PUBLIC_RPC = 'https://rpc.mainnet.chain.robinhood.com';
const LOCAL_RPC_FILE = resolve(__dirname, '../.local/config/pons-rpc.txt');

function resolveRpc({ env = process.env, file = LOCAL_RPC_FILE } = {}) {
  let url = env.PONS_ARCHIVE_RPC?.trim(), source = 'environment';
  if (!url) {
    source = 'file';
    try { url = readFileSync(file, 'utf8').trim(); }
    catch (error) { if (error.code !== 'ENOENT') throw Error('Cannot read local RPC configuration file'); }
  }
  if (!url) { url = PUBLIC_RPC; source = 'public'; }
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol) || /\s/.test(url)) throw Error();
  } catch { throw Error('RPC configuration must contain one HTTP(S) URL, without quotes or comments'); }
  return { url, source };
}

module.exports = { resolveRpc, LOCAL_RPC_FILE, PUBLIC_RPC };
