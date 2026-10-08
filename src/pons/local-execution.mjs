import { getAddress } from 'ethers';
import { NETWORK, HOLDERS, FACTORY, readAt, launchRecord, receiptLaunch } from './client.mjs';
import { preparePlan, simulatePlan } from './plan.mjs';

export async function assertLocalFork(provider) {
  const url = new URL(provider._getConnection().url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw Error('Отправка разрешена только на локальный fork');
  if ((await provider.getNetwork()).chainId !== 31337n) throw Error('Для тестового запуска нужна сеть 31337');
  const metadata = await provider.send('hardhat_metadata', []);
  if (Number(metadata.forkedNetwork?.chainId) !== 4663) throw Error('Нужен локальный fork Robinhood Chain');
  return metadata;
}

// Durable intent is saved BEFORE the wallet/RPC request. Unknown outcome never auto-retries.
export async function sendLocal(provider, account, request, journal, persist, kind) {
  const metadata = await assertLocalFork(provider);
  if (journal.some(x => x.instanceId !== metadata.instanceId)) throw Error('Журнал относится к другому экземпляру локальной сети');
  if (journal.some(x => ['requesting', 'pending', 'unknown'].includes(x.state))) throw Error('Сначала проверьте результат предыдущей отправки');
  const signer = await provider.getSigner(account);
  if (getAddress(await signer.getAddress()) !== getAddress(account)) throw Error('Кошелёк изменился');
  await provider.call({ ...request, from: account });
  const nonce = await provider.getTransactionCount(account, 'pending');
  const entry = { kind, account, nonce, request, instanceId: metadata.instanceId, state: 'requesting', at: new Date().toISOString() };
  journal.push(entry);
  await persist(journal);
  try {
    const tx = await signer.sendTransaction({ ...request, nonce });
    entry.hash = tx.hash; entry.state = 'pending'; await persist(journal);
    const receipt = await tx.wait();
    entry.state = receipt.status === 1 ? 'confirmed' : 'reverted';
    entry.block = receipt.blockNumber; await persist(journal);
    if (receipt.status !== 1) throw Error('Транзакция отклонена контрактом');
    return receipt;
  } catch (error) {
    // Even a transport error before receiving a hash can follow a successful broadcast.
    if (!['confirmed', 'reverted'].includes(entry.state)) entry.state = error.code === 'ACTION_REJECTED' ? 'rejected' : 'unknown';
    entry.error = error.shortMessage || error.message; await persist(journal);
    throw error;
  }
}

export async function reconcileJournal(provider, journal, persist) {
  const metadata = await assertLocalFork(provider);
  if (journal.some(x => x.instanceId !== metadata.instanceId)) throw Error('Журнал относится к другому экземпляру локальной сети');
  for (const entry of journal) {
    if (!['pending', 'unknown', 'requesting'].includes(entry.state) || !entry.hash) continue;
    const receipt = await provider.getTransactionReceipt(entry.hash);
    if (!receipt) continue;
    const tx = await provider.getTransaction(entry.hash);
    if (!tx || tx.from.toLowerCase() !== entry.account.toLowerCase() || tx.nonce !== entry.nonce ||
        tx.to?.toLowerCase() !== entry.request.to.toLowerCase() || tx.data !== entry.request.data || tx.value !== BigInt(entry.request.value)) {
      throw Error('Транзакция не соответствует сохранённому шагу');
    }
    entry.state = receipt.status === 1 ? 'confirmed' : 'reverted'; entry.block = receipt.blockNumber;
  }
  await persist(journal);
  return journal;
}

export async function executeLocalLaunch(provider, reviewed, journal, persist) {
  await assertLocalFork(provider);
  if (journal.some(x => x.kind === 'launch' && !['reverted', 'rejected'].includes(x.state))) throw Error('Запуск уже отправлен; используйте восстановление');
  const fresh = await preparePlan(provider, reviewed.draft, reviewed.account);
  if (fresh.id !== reviewed.id) throw Error('Условия изменились. Сначала просмотрите новый план');
  if (fresh.steps.length) throw Error('Требуется approve');
  const ready = await simulatePlan(provider, fresh);
  if (reviewed.state !== 'ready' || ready.token !== reviewed.token || ready.curve !== reviewed.curve || ready.minOut < reviewed.minOut) throw Error('Результат симуляции изменился. Обновите обзор');
  const receipt = await sendLocal(provider, ready.account, ready.tx, journal, persist, 'launch');
  return verifyLaunch(provider, receipt, ready);
}

export async function verifyLaunch(provider, receipt, plan) {
  const launch = receiptLaunch(receipt, plan.account);
  if (launch.token !== plan.token || launch.curve !== plan.curve || launch.pair.toLowerCase() !== plan.input.pair.toLowerCase() || Number(launch.configId) !== plan.input.configId) throw Error('Результат запуска отличается от плана');
  const record = await launchRecord(provider, launch.token);
  if (!record.exists || record.creatorFeeRecipient !== plan.input.params.creatorFeeRecipient || Number(record.creatorTaxBps) !== plan.input.params.creatorTaxBps || record.buybackEnabled !== plan.input.params.buybackEnabled) throw Error('Настройки созданного токена отличаются от плана');
  return { ...launch, hash: receipt.hash, block: receipt.blockNumber };
}

export async function continueLocalHolders(provider, token, account, journal, persist) {
  await assertLocalFork(provider);
  let [distributor] = await readAt(provider, NETWORK.holders, HOLDERS, 'distributorOf', [token], 'latest');
  let record = await launchRecord(provider, token);
  if (!record.exists) throw Error('Токен не зарегистрирован в Pons');
  if (!/^0x0{40}$/i.test(distributor) && record.creatorFeeRecipient === distributor) return distributor;
  if (record.creatorFeeRecipient !== getAddress(account)) throw Error('Этот кошелёк больше не получатель комиссий');
  if (/^0x0{40}$/i.test(distributor)) {
    await sendLocal(provider, account, { to: NETWORK.holders, data: HOLDERS.encodeFunctionData('createFor', [token]), value: 0n }, journal, persist, 'holders-create');
    [distributor] = await readAt(provider, NETWORK.holders, HOLDERS, 'distributorOf', [token], 'latest');
    if (/^0x0{40}$/i.test(distributor)) throw Error('Distributor не создан');
  }
  await sendLocal(provider, account, { to: NETWORK.factory, data: FACTORY.encodeFunctionData('transferCreatorFeeRecipient', [token, distributor]), value: 0n }, journal, persist, 'holders-route');
  record = await launchRecord(provider, token);
  if (record.creatorFeeRecipient !== distributor) throw Error('Перенаправление комиссий не подтверждено');
  return distributor;
}
