> Технический документ с результатами отдельных пакетов. Датированные статусы и «следующие шаги» ниже — история; актуальная готовность — в [CURRENT_CONTEXT](CURRENT_CONTEXT.md), очередь работ — в [ROADMAP](ROADMAP.md).

# IGW: publication and backend connection

11.10.2026, release `2abb23d`. Owner authorized publication and connection after
reviewing the local design. Source and static files pushed before deployment.

## Deployed

- https://igw.qianqi.site/ now serves the approved copy, looping fridge joke and
  contact dialog. Previous static release `5e3e2f3` is retained.
- `/api/` proxies to the new read-only service on loopback4191, preserving Host.
  `crypto-launchpad-draw-api.service` uses existing `lp_api` peer authentication,
  without new credentials or publicly opening PostgreSQL.
- Separate `/opt/crypto-launchpad/draw-current` points at release2abb23d.
  Existing QIANQI API/release/financial workers were not restarted or changed.
- Shared database migrated10→15 after pg_dump, restore to isolated
  `launchpad_igw_restore_20261011` and successful migration there. Migrator checks
  all existing checksums; lock timeout3s. Existing project identity checksum
  preserved. No rows fabricated for an undeployed IGW token.

Backup and remote evidence:
`/var/backups/crypto-launchpad/igw-before-schema15-20261011/` contains database.dump,
SHA256SUMS, rehearsal.json, deployment.json and previous IGW nginx configuration.
The restore copy has public CONNECT revoked and no worker pointed at it.

## What the connection means

Frontend reads `/api/project`, rejects another slug/chain or invalid token address,
then reads `/api/draws`. Exact USDG amounts and freshness are handled independently
of successful HTTP delivery. Missing registration yields421 unknown_project_host
and the pre-launch message; network/server failures show temporary unavailability.
This is transport/read-model readiness, not an active token or complete wallet UI.

Current database:1 existing QIANQI project,0 new production senders,0 owner launches.
IGW has no deployed contract or registered hostname mapping yet. Contract
deployment alone only changes the page to service preparation; it does not expose
a buy action or activate a financial worker. Existing pre-launch text/rules require
the final activation pass before trading is presented as live.

Remaining: owner launch UI and real wallet signatures, verified deployment,
register `igw.qianqi.site` for that project, configure isolated runtime/notifications,
then bind the full wallet/ticket/purchase/reward UI and final launch text. Team/gas
recipient and Telegram destination were requested from the owner; do not infer
financial recipients or reuse QIANQI secrets pending that answer.

## Validation

`node tests/studio/igw-live.mjs` PASS: unregistered/prelaunch, foreign token rejected,
unavailable, exact amounts, stale snapshots,320px. Local controlled API fixtures;
not evidence of real deployment or real token transactions.

Public HTTPS hashes match all10 site files. Live browser checked contacts, fridge
animation, mobile width, no page errors. Real API responds421 on both endpoints
because IGW is not registered. QIANQI nginx hash/current release and running PIDs
unchanged. Evidence `.local/igw-connect-20261011/public-check.json`; operator scripts
and archive manifest in the same local directory. No blockchain sends.

Rollback static release independently via `/var/www/igw/current`; restore previous
IGW nginx configuration, nginx -t and reload. New API can be stopped independently.
Do not restore old shared database over ongoing QIANQI writes as a code rollback.
