// Daily podcast reach from the Megaphone Metrics Export. Runs on Vercel (cron in vercel.json, 13:10 UTC,
// an hour after Megaphone finalizes the previous day), not on anyone's computer. See
// _reports/podcast-export.js for what it reads, counts and writes.
//
// Each scheduled run is logged on board 18432874155 ("nightly podcast-export ...") and the morning
// watchdog (/api/link-finder?pass=watch) tells Tom if a day is missing or failed.
//
//   GET /api/podcast-sync?dry=1   (team cookie or CRON_SECRET) shows what it would write, writes nothing.

import { mondayToken } from "./_reports/monday.js";
import { cookieOk } from "./_reports/access.js";
import { isCron } from "./_reports/cron.js";
import { recordRun, JOBS } from "./_reports/runlog.js";
import { syncPodcastExport } from "./_reports/podcast-export.js";

export const config = { maxDuration: 300 };

// Set to false to make the scheduled run plan only (same as ?dry=1), changing nothing on monday.
const WRITES_ENABLED = true;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const token = mondayToken();
  const fromCron = isCron(req);
  const dryAsked = String(req.query && req.query.dry || "") === "1";
  if (!fromCron && !(dryAsked && token && cookieOk(req, token))) return res.status(401).json({ error: "Unauthorized" });
  if (!token) return res.status(500).json({ error: "Setup: monday key missing" });
  const dry = dryAsked || !fromCron || !WRITES_ENABLED;
  let out;
  try { out = await syncPodcastExport(token, { dry }); }
  catch (e) { out = { pass: "podcast-export", error: String(e.message || e).slice(0, 300) }; }
  if (fromCron && !dryAsked) await recordRun(token, JOBS.podcasts, out);
  return res.status(200).json(out);
}
