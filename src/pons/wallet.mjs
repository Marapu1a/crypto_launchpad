import { getAddress, toQuantity } from 'ethers';

// The wallet owns its keys. Read RPC remains separate from the signing provider.
export async function walletAccount(wallet, chainId, { connect = false, account } = {}) {
  if (!wallet?.request) throw Error('Кошелёк не найден');
  if (BigInt(await wallet.request({ method: 'eth_chainId' })) !== BigInt(chainId)) throw Error(`Выберите в кошельке сеть ${chainId}`);
  const accounts = await wallet.request({ method: connect ? 'eth_requestAccounts' : 'eth_accounts' });
  if (!accounts.length) throw Error('Подключите кошелёк');
  const selected = getAddress(accounts[0]);
  if (account && selected !== getAddress(account)) throw Error('Кошелёк изменился');
  return selected;
}

export async function localWalletSigner(wallet, provider, account, instanceId) {
  async function check() {
    await walletAccount(wallet, 31337, { account });
    // Same chain ID alone does not identify the same fork.
    const metadata = await wallet.request({ method: 'hardhat_metadata', params: [] });
    if (metadata.instanceId !== instanceId) throw Error('Кошелёк подключён к другому fork');
  }
  await check();
  return {
    getAddress: async () => { await check(); return getAddress(account); },
    sendTransaction: async request => {
      await check();
      const hash = await wallet.request({ method: 'eth_sendTransaction', params: [{
        from: getAddress(account), to: getAddress(request.to), data: request.data,
        value: toQuantity(request.value ?? 0), nonce: toQuantity(request.nonce), chainId: toQuantity(31337),
      }] });
      if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw Error('Кошелёк не вернул hash транзакции');
      return { hash, wait: () => provider.waitForTransaction(hash, 1, 60000) };
    },
  };
}
