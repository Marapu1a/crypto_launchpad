import { assertDraft, fieldError } from './validation.mjs';
import { getAddress, hexlify, randomBytes, keccak256, toUtf8Bytes, ZeroAddress } from 'ethers';
import { FACTORY, ROUTER, ERC20, NETWORK, DIRECT, readAt, readTerms, stringify } from './client.mjs';

export const initialDraft = () => ({
  name: '', symbol: '', description: '', logo: '', twitter: '', telegram: '', website: '',
  discord: '', farcaster: '', pair: ZeroAddress, configId: '0', feeWallet: '',
  creatorFee: '0', destination: 'wallet', openingBuy: '', slippage: '2', exemptions: '',
  salt: hexlify(randomBytes(32)),
});

export { percentBps } from './validation.mjs';
export function normalizeDraft(draft, terms, account) {
  return assertDraft(draft, { terms, account, requireAccount: true, requireTerms: true }).input;
}

export function encodeLaunch(input, terms, account, minOut = 0n) {
  if (input.amount > 0n) return { to: NETWORK.router,
    data: ROUTER.encodeFunctionData('launchAndBuy', [input.params, input.configId, input.pair, input.amount, minOut, account, input.exemptions]),
    value: terms.fee + (input.pair === ZeroAddress ? input.amount : 0n),
  };
  return { to: NETWORK.factory, data: FACTORY.encodeFunctionData(DIRECT, [input.params, input.configId, input.pair, input.exemptions]), value: terms.fee };
}

export function minimumOutput(quoted, slippageBps) {
  const result = quoted * BigInt(10000 - slippageBps) / 10000n;
  if (quoted <= 0n || result <= 0n) throw Error('Покупка не даёт положительного защищённого результата');
  return result;
}

export async function preparePlan(provider, draft, account) {
  assertDraft(draft, { account, requireAccount: true });
  account = getAddress(account);
  if (account === ZeroAddress) throw Error('Укажите кошелёк запуска');
  const terms = await readTerms(provider, { account, pair: getAddress(draft.pair), configId: Number(draft.configId) });
  if (!terms.canLaunch) throw fieldError('account', 'Этот кошелёк сейчас не может запускать токены');
  const input = normalizeDraft(draft, terms, account);
  const steps = [];
  if (input.amount > 0n) {
    if (terms.router.toLowerCase() !== NETWORK.router.toLowerCase()) throw Error('Launch router изменился');
    const [routerFactory] = await readAt(provider, NETWORK.router, ROUTER, 'factory', [], terms.block);
    if (routerFactory.toLowerCase() !== NETWORK.factory.toLowerCase()) throw Error('Неверная фабрика router');
    if (input.pair !== ZeroAddress) {
      const [balance] = await readAt(provider, input.pair, ERC20, 'balanceOf', [account], terms.block);
      if (balance < input.amount) throw fieldError('openingBuy', 'Недостаточно токенов для стартовой покупки');
      const [allowance] = await readAt(provider, input.pair, ERC20, 'allowance', [account, NETWORK.router], terms.block);
      if (allowance < input.amount) {
        if (allowance > 0n) steps.push({ kind: 'approve-reset', to: input.pair, data: ERC20.encodeFunctionData('approve', [NETWORK.router, 0n]), value: 0n });
        steps.push({ kind: 'approve', to: input.pair, data: ERC20.encodeFunctionData('approve', [NETWORK.router, input.amount]), value: 0n });
      }
    }
  }
  const launch = encodeLaunch(input, terms, account);
  const balance = await provider.getBalance(account, terms.block);
  if (balance <= launch.value) throw fieldError('account', 'Недостаточно ETH на запуск, покупку и gas');
  const id = keccak256(toUtf8Bytes(stringify({ account, chainId: terms.chainId, localInstanceId: terms.localInstanceId, draft, economics: terms.economics, fee: terms.fee })));
  return { version: 1, id, account, draft: structuredClone(draft), terms, input, steps, destination: draft.destination,
    state: steps.length ? 'needs-approval' : 'needs-simulation', journal: [] };
}

// First eth_call obtains output; second proves the final, protected calldata.
export async function simulatePlan(provider, plan) {
  if (plan.steps.length) throw Error('Сначала подтвердите approve, затем подготовьте план повторно');
  const request = encodeLaunch(plan.input, plan.terms, plan.account);
  const raw = await provider.call({ ...request, from: plan.account, blockTag: plan.terms.block });
  const result = plan.input.amount > 0n ? ROUTER.decodeFunctionResult('launchAndBuy', raw) : FACTORY.decodeFunctionResult(DIRECT, raw);
  const minOut = plan.input.amount > 0n ? minimumOutput(result[2], plan.input.slippageBps) : 0n;
  const protectedRequest = encodeLaunch(plan.input, plan.terms, plan.account, minOut);
  await provider.call({ ...protectedRequest, from: plan.account, blockTag: plan.terms.block });
  const gas = await provider.estimateGas({ ...protectedRequest, from: plan.account });
  const fees = await provider.getFeeData();
  const gasPrice = fees.maxFeePerGas ?? fees.gasPrice;
  if (gasPrice == null) throw Error('Не удалось оценить стоимость gas');
  const budget = protectedRequest.value + gas * gasPrice;
  if (await provider.getBalance(plan.account) < budget) throw fieldError('account', 'Недостаточно ETH с учётом оценки gas');
  return { ...plan, state: 'ready', tx: protectedRequest, token: result[0], curve: result[1],
    tokensOut: plan.input.amount > 0n ? result[2] : 0n, minOut, gas, gasCost: gas * gasPrice };
}
