// Nightly copy for Engaged views, All creators (ecosystem.digitalfoxtalent.com/reporting/engaged-views).
// Runs on Vercel (cron in vercel.json, 12:40 UTC daily, after kit-sync at 12:15 has updated who is connected):
// reads every connected creator from Channel Connect and saves one JSON copy (_reports/engaged/summary.js).
// The page only reads that copy. Each run is logged on the run log board so the morning watchdog sees it.
//
//   GET /api/engaged-build?dry=1   (team cookie or CRON_SECRET) builds and returns the copy, saves nothing.

import { mondayToken } from "./_reports/monday.js";
import { cookieOk } from "./_reports/access.js";
import { isCron } from "./_reports/cron.js";
import { buildSummary, writeSummary } from "./_reports/engaged/summary.js";
import { recordRun, JOBS } from "./_reports/runlog.js";

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const token = mondayToken();
  const fromCron = isCron(req);
  const dryAsked = String(req.query && req.query.dry || "") === "1";
  if (!fromCron && !(dryAsked && token && cookieOk(req, token))) return res.status(401).json({ error: "Unauthorized" });
  if (!token) return res.status(500).json({ error: "Setup: monday key missing" });
  const dry = dryAsked || !fromCron;
  const t0 = Date.now();
  const out = { pass: "engaged-build", dry };
  try {
    const s = await buildSummary(token);
    if (!dry) await writeSummary(token, s);
    const missing = s.creators.filter(c => c.unavailable);
    Object.assign(out, { seconds: Math.round((Date.now() - t0) / 1000), builtAt: s.builtAt, roster: s.roster,
      // A creator who has no long-form video old enough is normal, not an error.
      errors: missing.filter(c => !/No long-form videos/.test(c.unavailable)).map(c => c.name + ": " + c.unavailable),
      quiet: missing.filter(c => /No long-form videos/.test(c.unavailable)).map(c => c.name) });
    if (dry) out.sample = s.creators.slice(0, 5);
  } catch (e) { out.error = String(e.message || e).slice(0, 300); }
  if (!dry) await recordRun(token, JOBS.engaged, out);
  return res.status(out.error ? 500 : 200).json(out);
}
