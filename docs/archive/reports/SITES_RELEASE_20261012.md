> Исторический отчёт: результаты и ограничения относятся к дате проверки в тексте. Текущее состояние — в [CURRENT_CONTEXT](../../CURRENT_CONTEXT.md).

# Sites release d758821

Owner authorized publication and preparation of the IGW launch in the current
conversation (local date 2026-10-12). Source commit d758821 was pushed first.
Server recorded publication at 2026-10-11T21:37:04Z.

- qianqi.site: concise personal directory, author X link, collaboration invitation.
- init.qianqi.site: compact footer, separate contacts dialog, bounded mascot.
- igw.qianqi.site: removal of decorative arrows; stays in prelaunch state.

Static releases only. No nginx changes, database writes or financial activation.
QIANQI overlay baseline hashes matched before applying changes to a copy.
All 26 published file hashes match Git archives; Chromium at 390/1440px passed,
including footer image size, contact dialog and old #account redirect.
Evidence: `.local/site-release-20261012/public-check.json`, manifest and screenshots.

Previous releases preserved:
- hub: /var/www/qianqi-hub/releases/0f1d4d4
- IGW: /var/www/igw/releases/020e695
- QIANQI: /var/www/qianqi/releases/init-20261011-161417

Current links respectively point to releases/d758821, releases/d758821 and
releases/init-d758821. Server deployment record:
`/var/backups/crypto-launchpad/sites-20261012-d758821/deployment.json`.
Rollback individual static symlinks to the recorded previous targets; no DB restore.

## IGW launch checkpoint

Read-only verification: shared schema15, zero owner launches and zero new senders.
Production profile environment check PASS at latest86153904/finalized86145196;
pinned contracts, chain and owner EOA verified. This snapshot is not ongoing readiness.
Owner balance0.008932081096654011 ETH; executor/publisher each0.
Draft funding0.01+0.001 ETH exceeds owner balance before deployment costs.
Team/operations recipients are blank; token Telegram destination pending.
No transaction was signed or sent. Runtime installation, final profile, owner wallet
signatures and complete IGW participation interface remain before an active launch.
