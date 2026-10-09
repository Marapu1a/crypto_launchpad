import {AbiCoder,keccak256} from 'ethers';
import {check,low,integer} from './ticket-shadow.mjs';
import {datasetAbi,participantType,verifyDataset} from './history-replay.mjs';
export async function verifyDrawDatasets({rpc,logQuery,verifyLog,replay,lifecycle}){
  const datasetLogs = {};
  for (const name of ['DatasetProposed', 'DatasetReady', 'DatasetSealed', 'DatasetChunk']) {
    datasetLogs[name] = await logQuery(lifecycle.source, [datasetAbi.getEvent(name).topicHash]); check(datasetLogs[name].length <= 100, 'Dataset history budget exceeded');
    for (const log of datasetLogs[name]) await verifyLog(log);
  }
  const datasets = [];
  for (const draw of replay.draws) {
    const seals = datasetLogs.DatasetSealed.map(l => datasetAbi.parseLog(l)).filter(p => low(p.args.drawId) === draw.snapshot.drawId); check(seals.length === 1, 'Missing/duplicate sealed draw');
    const proposalId = seals[0].args.proposalId;
    const proposals = datasetLogs.DatasetProposed.map(l => datasetAbi.parseLog(l)).filter(p => p.args.proposalId === proposalId), ready = datasetLogs.DatasetReady.map(l => datasetAbi.parseLog(l)).filter(p => p.args.proposalId === proposalId);
    check(proposals.length === 1 && ready.length === 1, 'Missing/duplicate proposed or ready dataset');
    const chunks = datasetLogs.DatasetChunk.filter(l => datasetAbi.parseLog(l).args.proposalId === proposalId).sort((a, b) => integer(datasetAbi.parseLog(a).args.index) - integer(datasetAbi.parseLog(b).args.index));
    const published = [];
    for (const [index, log] of chunks.entries()) {
      const parsed = datasetAbi.parseLog(log), tx = await rpc('eth_getTransactionByHash', [log.transactionHash]);
      check(low(tx.hash) === low(log.transactionHash) && low(tx.blockHash) === low(log.blockHash) && low(tx.to) === low(lifecycle.source), 'Wrong publish transaction');
      const call = datasetAbi.decodeFunctionData('publish', tx.input); check(low(datasetAbi.encodeFunctionData('publish', call)) === low(tx.input) && call.id === proposalId, 'Noncanonical publish calldata');
      check(integer(parsed.args.index) === index && integer(parsed.args.count) === call.data.length && keccak256(AbiCoder.defaultAbiCoder().encode([participantType], [call.data])) === parsed.args.chunkHash, 'Published chunk mismatch'); published.push(call.data);
    }
    datasets.push({ drawId: draw.snapshot.drawId, proposalId, verified: verifyDataset(draw, proposals[0], ready[0], published) });
  }
  return datasets;
}
