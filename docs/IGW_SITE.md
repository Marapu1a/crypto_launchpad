# IGW public site

11.10.2026. Owner approved public frontend and HTTPS at `igw.qianqi.site`.
DNS was verified at Timeweb and1.1.1.1: A201.51.22.244.
Naming convention: `{ticker}.qianqi.site`, unique stable slug, reserved service
names excluded. Source artwork: `tokens/IGW/`, static frontend: `tokens/IGW/site/`.

English first version: hero, proposed draw rules, fee split, launch status, FAQ
and footer. Optimized WebP copies preserve original PNGs. No signing or API calls;
fund unknown, token not deployed, economic settings explicitly provisional.
Real wallet dashboard and contract binding remain a subsequent launch package.

Local browser validation:1440/768/390/320px, FAQ, no overflow/errors or invented
trading links. Screenshots inspected; `.local/test-results/igw-site-20261011/`.
Publication uses its own nginx host and static release, preserving QIANQI.


Published11.10.2026: https://igw.qianqi.site/ — release5e3e2f3.
Let's Encrypt certificate installed with scheduled renewal; HTTP redirects to HTTPS.
Public file hashes match all8 static assets/documents; live Chromium mobile layout,
FAQ and image loads PASS. Lazy footer image explicitly scrolled into view for check.
Evidence `.local/test-results/igw-site-20261011/deployment.json`.
QIANQI nginx config hash and current release unchanged; no backend/DB/financial
service changes and no token deployment. Rollback: disable only the igw virtual
host, nginx -t then reload, or point igw/current at a prior verified IGW release.


Local revision11.10, not published: approved copy from owner attachment, with
"You might win. I might make a sandwich. Shit happens." and explicit accumulated
eligible buy volume per ticket. Fictional scrolling headlines, pause control,
reduced-motion behavior and an explicitly imaginary $100 sandwich joke button.
No wallet/network/storage actions. Browser checks1440/768/390/320, keyboard,
pause, reduced motion, FAQ and console PASS. Preview http://127.0.0.1:4195/.
Evidence `.local/test-results/igw-copy-ticker-20261011/report.json`.
Public release remains5e3e2f3. Future deployment must include site.js and verify
nginx CSP permits this same-origin script (current default-src self permits it).


Superseding local revision11.10: owner rejected the news ticker and bonus button.
Replaced with fictional FRIDGE CONNECTION progress: begins when visible,3 seconds
up to99%,1.5 seconds held, then UPLOAD FAILED. FRIDGE DISCONNECTED. No repeat on
scroll, no interactions/network/storage; reduced-motion shows final state directly.
Approved copy remains. Local4195 only; public site unchanged. Browser checks PASS
at1440/390/320 plus one-run/reduced-motion; evidence
`.local/test-results/igw-fridge-20261011/report.json`.


Latest owner correction11.10: fridge animation now loops every20 visible seconds:
connecting1.2s, progress8s,99% hold2.5s, failure5s, reconnect3.3s, repeat.
Pauses offscreen/hidden tab. Reduced-motion retains text/percentage stages without
moving fill; removed repeated live announcements. Script URL versioned to refresh
browser cache. Local4195 only, public deployment unchanged. Browser full-cycle
check: `.local/notes/check-igw-fridge-loop.mjs`.

Local11.10: footer CONTACT opens native dialog with owner-provided Telegram, email and X links. Desktop/mobile320/390/1440, exact hrefs, Escape/close and focus return PASS; .local/notes/check-igw-contacts.mjs. Public unchanged.


Full local frontend review11.10: PASS at1920/1440/1024/768/390/320; all anchors,
images, exact contact hrefs, FAQ, dialog keyboard/focus, metadata presence,
three failure variants and reduced-motion rendering. No page errors or HTTP4xx/5xx.
320px full-page screenshot inspected. Variant rendering checked with controlled
elapsed values; real-time looping previously checked separately. Evidence:
`.local/test-results/igw-front-review-20261011/report.json`.
Live HTTPS200 still has the initial pre-launch version, no fridge/contact modal.
Pending: publish approved local assets; before token activation connect real
contract/Pons link, live fund and draw state, wallet/ticket/purchase/reward views,
final economics and precise participation/late-ticket rules. Current site is EN-only.
