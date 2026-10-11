# QIANQI hub and first-token domain

Owner-approved migration, 2026-10-11:
- `https://qianqi.site/`: platform directory, source `tokens/hub/site/`.
- `https://init.qianqi.site/`: existing QIANQI token frontend.
- `https://igw.qianqi.site/`: IGW prelaunch site; no new deployment of a token.

Hub uses owner's `tokens/hub/hub1.png` and `hub2.png` as optimized WebP,
dark geometric design, QIANQI/IGW cards, explanatory copy and existing owner
contacts. No wallet connection or financial execution on the hub. QIANQI is
marked launched; IGW is explicitly in preparation. Directory is static for this
first publication; shared token registry and Telegram bot remain future work.

## Migration

The live QIANQI static release was copied on the server to an independent
`/var/www/qianqi/releases/init-20261011-161417`, exposed through
`/var/www/qianqi/init-current`. Only absolute domain references in HTML/XML/TXT
were changed. Wallet and API JS were preserved. The original release and
`/var/www/qianqi/current` remain available for rollback.

New nginx virtual host `qianqi-init`, its own Let's Encrypt certificate with
automatic renewal, same CSP and same read-only `/v1/` backend on4180.
That virtual host fixes upstream Host to `qianqi.site`, an explicit alias for
the existing QIANQI project; it does not forward arbitrary caller-chosen project
headers. No DB hostname, worker, contract, ticket or financial settings changed.
Origin-scoped wallet grants/localStorage are not transferred: users may need
to connect their wallet again on the new domain.

The original host retains `/v1/` compatibility. Old token-specific paths redirect
to `init` if absent from the hub. Known old root anchors (account, results, draws,
market, how, money, rules, buy, wallet, tickets) redirect in `hub.js`; new directory
anchors are `projects` and `approach`. Root `/` becomes the hub, with an obvious
QIANQI token card. No redirect of the whole root domain.

## Verification and rollback

Evidence: `.local/hub-migration-20261011/`. Local hub checked at1440/768/390/320,
images, two cards, no overflow or JS errors. New init host checked with a simulated
read-only EIP-1193 wallet and real overview/wallet API responses (HTTP200).
This is not a real wallet signing or transaction test.

Pre-change nginx backup and release mapping:
`/var/backups/crypto-launchpad/hub-move-20261011-161417/`.
To roll back the root: restore `qianqi.nginx` from that backup to its original
nginx site file, run `nginx -t`, reload nginx. The old QIANQI release symlink was
not moved. Keep `init` working for any already-shared links.

Published hub release `655dfa1` at `/var/www/qianqi-hub/releases/655dfa1`;
source commit pushed to origin/main. Public desktop/mobile browser checks passed;
old `/#account` bookmark resolves to `https://init.qianqi.site/#account`.
Content hashes, TLS, API responses and old-path redirects are recorded in
`.local/hub-migration-20261011/public-check.json`; browser evidence is alongside.

## Local copy revision — 2026-10-12

Owner approved a concise personal project directory: first-person introduction,
Valentin linked to https://x.com/ui_uallas, two project cards, updates and contacts.
Removed repeated slogans, the three-principle section and public-launchpad disclaimer.
Each card has one description, status and website link; IGW remains in preparation.
Existing artwork retained. This supersedes the earlier copy proposals in
HUB_GPT_REVIEW_BRIEF.md. Changes are local, not published.

Preview: http://127.0.0.1:4193/. Chromium checks at 320/390/768/1440px:
no horizontal overflow, two cards, images loaded, valid internal anchors, author X
link and fresh-load legacy #account redirect verified. Screenshots and check record:
`.local/hub-copy-review/`. Redirect destination mocked; no live token/API check.
