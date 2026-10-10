import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Wallet } from 'ethers';
import { createExecutorKeystore, loadExecutorKeystore } from '../../src/worker/executor-keystore.mjs';

test('Encrypted per-project key: reopen same signer, refuse wrong password/address and overwrite', async () => {
  const directory = resolve('.local/test-results/keystore-' + Date.now()); await mkdir(directory, { recursive: true });
  const password = 'test-only-independent-password';
  const key = await createExecutorKeystore({ directory, projectId: 'a5897d1a-def5-4c9f-a7bb-a76f2b16519e', password });
  const signer = await loadExecutorKeystore({ file: key.file, password, expectedAddress: key.address });
  assert.equal(signer.address, key.address);
  const text = await readFile(key.file, 'utf8'); assert.equal(text.includes(signer.privateKey.slice(2)), false); assert.equal(text.includes(password), false);
  assert.equal(JSON.parse(text)['x-ethers'], undefined);
  await assert.rejects(loadExecutorKeystore({ file: key.file, password: 'incorrect-password', expectedAddress: key.address }), /could not be unlocked/);
  await assert.rejects(loadExecutorKeystore({ file: key.file, password, expectedAddress: Wallet.createRandom().address }), /another project/);
  await assert.rejects(createExecutorKeystore({ directory, projectId: 'a5897d1a-def5-4c9f-a7bb-a76f2b16519e', password }), /EEXIST/);
  await assert.rejects(createExecutorKeystore({ directory, projectId: '../outside', password }), /identity/);
});
