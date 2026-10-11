# It Gets Worse / IGW

Public host: `igw.qianqi.site`. Original PNG artwork stays here; `site/` contains
the independent static pre-launch site and optimized WebP assets.

No deployed token, wallet connection, API binding or live financial values are
claimed. Displayed draw parameters and fee split are proposals pending the final
launch configuration. This is not yet the reusable live token dashboard.

11 October 2026: Chromium checks passed at1440/768/390/320px, FAQ interaction,
no horizontal overflow or page errors. Desktop/mobile screenshots inspected.
Evidence: `.local/test-results/igw-site-20261011/`.

Deployment: separate `/var/www/igw/releases/<revision>` and `/var/www/igw/current`,
separate nginx `igw` virtual host and Let's Encrypt certificate. QIANQI's site,
API and financial services must remain untouched. HTTPS deployment and public
verification are recorded in `docs/IGW_SITE.md`.
