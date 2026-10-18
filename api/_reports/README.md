# DFT Reports

reports.digitalfoxtalent.com - the team's reporting home. Entry point: `api/reports.js`.

The same handler serves ecosystem.digitalfoxtalent.com, the team's home: the ecosystem map at `/` and `/<department>`, and every tool at `/<department>/<tool>` (these reports sit under `/reporting/...`). The address book, including every old address that redirects, is `routes.js`. The team report pages on reports.digitalfoxtalent.com redirect there too; partner pages stay. The map lives in `ecosystem/page.js`.

| File | Job |
|---|---|
| `access.js` | Team link and 90-day cookie, shared by every report |
| `monday.js` | Read-only monday helper |
| `megaphone.js` | Megaphone access. The token is read from the monday "API Keys (Private)" board at run time, never stored here |
| `home.js` | Front page, one card per report |
| `campaigns/` | Campaign reach: `load.js` data, `page.js` page, `podcast.js` Megaphone snapshot, `snapshot.js` saved copy |
| `platforms/` | Platform monetization: `load.js` data, `page.js` page |
| `distribution/` | Video distribution: `load.js` reads the `distribution-status` record from the Apify store `dft-msn-rejections` (key read from monday at run time), `page.js` page; `breaks.js` reads Megaphone live (key from monday) and maps MSN rows into one shared breaks shape, `breaks-section.js` draws it (Facebook planned) |
| `coverage/` | Creator distribution: `load.js` reads Megaphone live plus the platform register and back-catalogue status files on Bunny (`megaphone-backfill/status/`), `page.js` page |
| `slots/` | Slot board (`/partnerships/slot-board`): `build.js` works out each creator's expected uploads (YouTube), sold slots (US Campaigns) and open slots for eight weeks, `store.js` keeps the nightly copy in the Apify store `dft-slot-board` (written only by `api/slots-build.js`, 05:40 UTC), `load.js` + `page.js` render it |

Rules every report follows:

1. Read only. Collectors write to monday; reports only read.
2. It always renders. If a source fails, show the last good figures and say when they were updated.
3. A short or empty read is a fault, never the truth.
4. Every source shows its own "updated" time.

To add a report: a folder here, a line in `routes.js` (its `/<department>/<tool>` address), and a case in `api/reports.js`.
Routes arrive as `?r=<path>` from the reports.digitalfoxtalent.com rewrite in `vercel.json`.
Preview builds answer `/api/reports?r=status` without the cookie (codes and counts only) so a build can be checked before it goes live.
