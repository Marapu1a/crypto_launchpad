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
