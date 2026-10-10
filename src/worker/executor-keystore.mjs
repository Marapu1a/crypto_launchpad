import { mkdir, open, readFile, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Wallet, isAddress } from 'ethers';

const check = (v, m) => { if (!v) throw Error(m); };
// Operator-only utility, never a browser/API endpoint. Caller supplies a private
// directory and an independently stored password; no plaintext private key is saved.
export async function createExecutorKeystore({ directory, projectId, password }) {
  check(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(projectId), 'Invalid key project identity');
  check(typeof password === 'string' && password.length >= 16, 'Executor password too short');
  const root = resolve(directory); await mkdir(root, { recursive: true, mode: 0o700 });
  check(!(await lstat(root)).isSymbolicLink(), 'Key directory cannot be a symlink');
  const file = join(root, projectId + '.json'), wallet = Wallet.createRandom();
  // A bare Wallet excludes the optional mnemonic from the encrypted keystore.
  const encrypted = await new Wallet(wallet.privateKey).encrypt(password);
  const handle = await open(file, 'wx', 0o600);
  try { await handle.writeFile(encrypted); await handle.sync(); } finally { await handle.close(); }
  return { file, address: wallet.address };
}

export async function loadExecutorKeystore({ file, password, expectedAddress, provider }) {
  check(isAddress(expectedAddress), 'Expected executor address required');
  const info = await lstat(file); check(info.isFile() && !info.isSymbolicLink() && info.size <= 65536, 'Invalid keystore file');
  let wallet;
  try { wallet = await Wallet.fromEncryptedJson(await readFile(file, 'utf8'), password); }
  catch { throw Error('Executor keystore could not be unlocked'); }
  check(wallet.address.toLowerCase() === expectedAddress.toLowerCase(), 'Executor keystore belongs to another project');
  return provider ? wallet.connect(provider) : wallet;
}
