# QIANQI static presentation overrides

Source: public static release `/var/www/qianqi/releases/init-20261011-161417`,
read from the server on 2026-10-11. These two files are an overlay, not a complete
website. Original project and frozen vendor remain unchanged.

- `concepts/hk/style.css`: center button labels after removal of decorative icons.
- `notices/late-purchases-2026-10-04.html`: remove the decorative return-link arrow.

The current main page already has no decorative arrows. A direction arrow in
transaction-review text denotes the recipient and is not decorative; preserved.
No wallet, translation, financial or API code changed. Not published yet.

Local full-release preview: http://127.0.0.1:4194/ (static only; API is not proxied).
Baseline archive, before/after hashes and verification live in
`.local/qianqi-front-review/`. Chromium checks passed at 390/1440px in English,
Russian and Traditional Chinese: no horizontal overflow or script errors,
wallet-selection dialog opens, notice link preserved without an arrow.

Before publication compare target file hashes with `changes.json` to prevent
replacing newer server edits; apply the overlay to a copy of the live release
and preserve the previous release for rollback.

Footer update, 2026-10-11: overlay now also includes `index.html` and `footer.js`.
The compact signature replaces the large contact section; separate native dialog
contains Telegram/email/X, EN/RU/zh-HK labels, Escape/backdrop close and focus return.
Rules, funding and transparency links remain. No transaction-dialog code changed.
Convention: `docs/TOKEN_SITE_FOOTER.md`. Publication is still pending.

Footer mascot: owner-provided `tokens/QIANQI/footer_qianqi.png` (1254x1254 RGBA), copied unchanged to `assets/footer_qianqi.png`. Decorative image beside the QIANQI signature: 104px desktop, 80px mobile. Local Chromium checks at 320/390/768/1440px passed: image loaded, no horizontal overflow, contact dialog and Escape/focus return work. Screenshots: `.local/qianqi-front-review/mascot-*.png`. Local only; publication pending.
