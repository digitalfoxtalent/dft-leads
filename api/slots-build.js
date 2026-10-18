// Nightly build of the Slot board (ecosystem.digitalfoxtalent.com/partnerships/slot-board).
// Runs on Vercel (cron in vercel.json, 05:40 UTC daily): reads the rates board, the campaign rows, the
// release list and each channel's uploads from YouTube, works out the next eight weeks of expected uploads,
// sold slots and open slots, and saves one JSON copy (_reports/slots/store.js). The page only reads that copy.
// See _reports/slots/build.js for the rules. Nothing on monday is written.
//
//   GET /api/slots-build?dry=1   (team cookie or CRON_SECRET) builds and returns the summary, saves nothing.

import { mondayToken } from "./_reports/monday.js";
import { cookieOk } from "./_reports/access.js";
import { isCron } from "./_reports/cron.js";
import { buildSnapshot } from "./_reports/slots/build.js";
import { writeSnapshot } from "./_reports/slots/store.js";

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const token = mondayToken();
  const fromCron = isCron(req);
  const dryAsked = String(req.query && req.query.dry || "") === "1";
  if (!fromCron && !(dryAsked && token && cookieOk(req, token))) return res.status(401).json({ error: "Unauthorized" });
  if (!token) return res.status(500).json({ error: "Setup: monday key missing" });
  const ytKey = process.env.YOUTUBE_API_KEY;
  if (!ytKey) return res.status(500).json({ error: "Setup: YOUTUBE_API_KEY missing" });
  const dry = dryAsked || !fromCron;
  const t0 = Date.now();
  const out = { pass: "slots-build", dry };
  try {
    const snap = await buildSnapshot(token, ytKey);
    if (!dry) await writeSnapshot(token, snap);
    Object.assign(out, { seconds: Math.round((Date.now() - t0) / 1000), builtAt: snap.builtAt, totals: snap.totals, youtubeUnits: snap.youtubeUnits,
      unread: snap.creators.filter(c => c.uploadsError).map(c => c.name + ": " + c.uploadsError), skipped: snap.skippedCount,
      sample: dry ? snap.creators.slice(0, 5).map(c => ({ name: c.name, rate: c.cadence.rate, paused: c.cadence.paused, open: c.openSlots, booked: c.bookedSlots })) : undefined });
  } catch (e) { out.error = String(e.message || e).slice(0, 300); }
  return res.status(out.error ? 500 : 200).json(out);
}
