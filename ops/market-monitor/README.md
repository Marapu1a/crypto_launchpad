> Live on pw.qianqi.site since 2026-10-19. See [deployment report](../../docs/PW_PRELAUNCH_20261019.md). Production uses a dedicated static pons-market-monitor user instead of DynamicUser to preserve explicit SQLite ownership. No RPC or financial execution.

# Market monitor service

This collector is separate from the financial `pons-collector.service` and
`pons-runtime.service`. It calls Pons HTTP only; it needs no RPC URL or wallet keys.

For an explicitly authorized deployment:

1. Install reviewed `apps/monitor` sources in a dedicated versioned release beneath
   `/opt/pons-monitor/releases`, with `/opt/pons-monitor/current` pointing to it.
   Python 3 standard library is sufficient; no npm install or financial config needed.
2. Preserve the existing SQLite database with SQLite's backup API, then stop the
   local collector before switching collection ownership. Move the consistent copy
   to the service StateDirectory using the system's DynamicUser ownership procedure.
   A cache copy is optional; without one the first scan refetches bounded history.
3. Install this unit and activate it only after confirming port 4196 is unused.
   It binds loopback; a public reverse proxy and access policy are a separate release.
4. Confirm `/api/status`: fresh windowEnd, complete/partial explicitly reported,
   collection coverage and recentAttempts advancing. Review `journalctl` for errors.
5. On rollback stop this collector before starting the previous one. New SQLite
   tables are additive; the older collector ignores attempts and metadata. Preserve
   the database; never restore an older file over newly collected observations.

`collector.lock` is OS-owned and released on exit; do not delete it to bypass a live
collector. On Windows the default directory remains `.local/pons-monitor`.
The old pre-lock collector must be stopped explicitly before switching versions.
No scheduler invokes collection per visitor: GET status and legacy POST refresh
read/acknowledge snapshots without triggering Pons work.
