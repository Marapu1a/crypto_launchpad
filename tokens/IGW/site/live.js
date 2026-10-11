// Same-origin, read-only project data. Never accept another token's hostname mapping.
const root = document.querySelector('#network-state');
let busy = false;
const decimal = value => {
  if (!/^(0|[1-9]\d*)$/.test(String(value))) throw Error('Invalid amount');
  const n = BigInt(value);
  return (n / 1000000n).toLocaleString('en-US') + ((n % 1000000n) ? '.' + (n % 1000000n).toString().padStart(6, '0').replace(/0+$/, '') : '');
};
async function refresh() {
  if (busy) return;
  busy = true;
  try {
    const response = await fetch('/api/project', {cache:'no-store', signal:AbortSignal.timeout(10000)});
    if (response.status === 421) {
      const body = await response.json();
      if (body.error !== 'unknown_project_host') throw Error();
      root.textContent = 'Launch is in preparation. The verified contract will appear here after deployment.';
      return;
    }
    if (!response.ok) throw Error();
    const {project} = await response.json();
    if (project?.slug !== 'igw' || String(project.chain_id) !== '4663' || !/^0x[0-9a-f]{40}$/i.test(project.token_address) || /^0x0{40}$/i.test(project.token_address)) throw Error();
    const responseDraws = await fetch('/api/draws', {cache:'no-store', signal:AbortSignal.timeout(10000)});
    if (!responseDraws.ok) throw Error();
    const data = await responseDraws.json();
    if (!Array.isArray(data.modules)) throw Error();
    root.replaceChildren();
    const label = document.createElement('p'); label.textContent = 'Deployed contract · Robinhood Chain';
    const link = document.createElement('a'); link.href = 'https://robinhoodchain.blockscout.com/address/' + project.token_address;
    link.textContent = project.token_address; link.target = '_blank'; link.rel = 'noopener noreferrer';
    root.append(label, link);
    for (const m of data.modules) {
      const s = m.snapshot;
      if (!s || !['short','monthly'].includes(s.kind)) continue;
      const seen = Date.parse(m.observedAt), age = Date.now() - seen;
      const stale = m.stale || m.service?.stale || m.service?.projectionFailed || !Number.isFinite(age) || age > 120000 || age < -30000;
      if (s.settings?.asset !== 'USDG' || s.settings?.decimals !== 6) throw Error();
      const line = document.createElement('p');
      line.textContent = (s.kind === 'short' ? 'Short' : 'Monthly') + ' prize fund: ' + decimal(s.fundRaw) + ' USDG' + (stale ? ' · Delayed snapshot. Not a live balance.' : ' · Confirmed snapshot.');
      root.append(line);
    }
    if (!data.modules.some(m => m.snapshot)) {
      const note = document.createElement('p'); note.textContent = 'Draw service is being prepared. No confirmed prize snapshot yet.'; root.append(note);
    }
    // Contract deployment alone does not enable trading or financial automation.
    document.querySelector('.launch-section h2').textContent = 'Deployed. Getting ready.';
    document.querySelector('.launch-section > div > p:not(.eyebrow)').textContent = 'The contract is deployed. Trading and the draw service are being checked.';
    const rows = document.querySelectorAll('.launch-row');
    rows[3].querySelector('strong').textContent = 'Deployed · see below';
    rows[4].querySelector('strong').textContent = 'Service preparation';
  } catch {
    root.textContent = 'Current launch data is temporarily unavailable. Please check again shortly.';
  } finally { busy = false; }
}
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 30000);
