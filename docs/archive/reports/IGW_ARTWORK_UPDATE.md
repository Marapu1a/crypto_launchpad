> Исторический отчёт: результаты и ограничения относятся к дате проверки в тексте. Текущее состояние — в [CURRENT_CONTEXT](../../CURRENT_CONTEXT.md).

# IGW artwork publication

2026-10-11, source and static release `020e695`.

Owner approved the local preview before publication. Updated original artwork:
`igw2.png` is the standing character in the hero; `igw1.png` is the reclining
character in the outro. Both optimized images are 1916 x 821. Hero uses contain;
the mobile outro no longer enlarges the image to 150%. Asset query versions
invalidate the previous browser cache.

Committed and pushed before deployment. Published only the Git-archived static
site to `/var/www/igw/releases/020e695`, then atomically switched
`/var/www/igw/current`. Previous release `/var/www/igw/releases/2abb23d` retained.
Nginx configuration unchanged; no service restart or database/worker changes.

Verification: local Chromium at 320/390/768/1440/1920px; public HTTPS at 390/1440px.
All 10 public file SHA256 hashes match the Git archive. Both revised images load
at their expected dimensions; no horizontal overflow or page errors. Public
API continues to report launch preparation. This verifies artwork publication,
not token deployment or financial execution.

Evidence: `.local/igw-art-review/verification.json` and
`.local/igw-art-deploy-020e695/public-check.json`, with desktop/mobile screenshots.
Server record: `/var/www/igw/art-deployment-020e695.json`.
Rollback: atomically repoint the static `current` symlink to the retained
`2abb23d` directory; no database restore is needed.
