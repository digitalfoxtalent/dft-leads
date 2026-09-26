# DFT Reports

reports.digitalfoxtalent.com - the team's reporting home. Entry point: `api/reports.js`.

| File | Job |
|---|---|
| `access.js` | Team link and 90-day cookie, shared by every report |
| `monday.js` | Read-only monday helper |
| `megaphone.js` | Megaphone access. The token is read from the monday "API Keys (Private)" board at run time, never stored here |
| `home.js` | Front page, one card per report |
| `campaigns/` | Campaign reach: `load.js` data, `page.js` page, `podcast.js` Megaphone snapshot, `snapshot.js` saved copy |

Rules every report follows:

1. Read only. Collectors write to monday; reports only read.
2. It always renders. If a source fails, show the last good figures and say when they were updated.
3. A short or empty read is a fault, never the truth.
4. Every source shows its own "updated" time.

To add a report: a folder here, a card in `home.js`, a case in `api/reports.js`.
Routes arrive as `?r=<path>` from the reports.digitalfoxtalent.com rewrite in `vercel.json`.
Preview builds answer `/api/reports?r=status` without the cookie (codes and counts only) so a build can be checked before it goes live.
