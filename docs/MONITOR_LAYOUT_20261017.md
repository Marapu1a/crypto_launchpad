# Pattern Watcher local layout

Implemented 2026-10-17 on top of `57f7569`, using option A from
[GPT design response](GPT_DESIGN_RESPONSE.md) with a shorter header and chart.

- Tokens: four metric selectors, one interval chart, quote-specific volumes,
  token table. Selecting a window scopes the cards and table together.
- Wallets: separate navigation, manual address lookup, saved addresses,
  positions and saved activity. No additional polling or source integrations.
- English, Simplified Chinese and Russian share one layout. Language changes preserve
  interval, sort and activity filters and do not request data.
- Mobile tables become records; amounts keep units and labels. Long source
  text is rendered as text, never HTML. Extra explanations use disclosures.
- Device-local timestamps; historical calendar comparisons explicitly use MSK.
  Source gaps, cache dates and partial-wallet limits remain visible.
- Dark neutral palette and warm accent; PW is a placeholder, not a final emblem.

Validation: 32 Python monitor tests; token and wallet Playwright tests at
1440/390/320 px, including all three languages, filters, manual refresh and unsafe
source strings. Local recorded-data preview on port 4227; no collector or
production deployment changed. Screenshots are private under `.local/`.

Shared assets are served through an explicit allowlist in the existing server.
No billing, token, notification or financial-runtime behavior changed.

Follow-up: gaps are separate list rows; external-link arrows removed. Wallet activity is visible without expanding a disclosure: first 10 of up to 30 addresses, then increments of 10. Ranking remains different tokens, then buys in the latest five-minute snapshot. Old recorded previews may lack walletActivity; an explicit empty state is shown instead of fabricated addresses. Browser tests cover 10/20/23 expansion.

Approved artwork integrated locally: eye in navigation and browser/touch icon; mascot in the wallet welcome state. Originals preserved in apps/monitor/imgs. Draft token preparation: [Pattern Watcher](../tokens/PatternWatcher/README.md). No launch profile activated.
