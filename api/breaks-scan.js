// Nightly ad-break and history check for the breaks dashboard (reports.digitalfoxtalent.com/distribution).
// Runs on Vercel (crons in vercel.json, 22:00, 22:06 and 22:12 UTC), one part of the shows each time;
// the last part also saves tonight's list of open breaks so the page can show what was fixed this week.
// See _reports/distribution/breaks-scan.js for what it checks. Megaphone is only read, never changed.
//
//   GET /api/breaks-scan?part=0&dry=1   (team cookie or CRON_SECRET) runs the check and returns it, writes nothing.

import { mondayToken } from "./_reports/monday.js";
import { cookieOk } from "./_reports/access.js";
import { isCron } from "./_reports/cron.js";
import { scanPart, writeHistory } from "./_reports/distribution/breaks-scan.js";
import { PARTS, writeRecord } from "./_reports/distribution/breaks-store.js";

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const token = mondayToken();
  const fromCron = isCron(req);
  const dryAsked = String(req.query && req.query.dry || "") === "1";
  if (!fromCron && !(dryAsked && token && cookieOk(req, token))) return res.status(401).json({ error: "Unauthorized" });
  if (!token) return res.status(500).json({ error: "Setup: monday key missing" });
  const part = Math.max(0, Math.min(PARTS - 1, parseInt(String(req.query && req.query.part || "0"), 10) || 0));
  const dry = dryAsked || !fromCron;
  const out = { pass: "breaks-scan", part, dry };
  try {
    const scan = await scanPart(token, part);
    if (!dry) await writeRecord(token, "adgaps-" + part, scan);
    Object.assign(out, { seconds: scan.seconds, shows: scan.shows.length, unread: scan.shows.filter(s => s.error).map(s => s.title + ": " + s.error), gaps: scan.rows.length,
      sample: dry ? scan.rows.slice(0, 20) : undefined });
  } catch (e) { out.error = String(e.message || e).slice(0, 300); }
  if (part === PARTS - 1) {
    try { out.history = await writeHistory(token, dry); }
    catch (e) { out.historyError = String(e.message || e).slice(0, 300); }
  }
  return res.status(200).json(out);
}
