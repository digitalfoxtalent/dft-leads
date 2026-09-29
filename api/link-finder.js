// Nightly link finder. Runs on Vercel (cron in vercel.json), not on anyone's computer.
//
// For US Campaigns creator rows (subitems board 6162879732) with an empty LIVE VIDEO URLS and no
// LINK BACKFILL label, it reads that creator's YouTube uploads and matches rows to videos FLIGHT BY
// FLIGHT (see _reports/flight-match.js): every video in the row's window whose description carries a
// link naming the brand. That covers single integrations and weekly flights (TRR runs one read
// across a week of uploads) alike.
//
// WRITES only the matches flight-match.js calls writable (a brand link in the description, 1 to 15
// videos; or a distinctive title on a creator's one row for that brand), through the same
// checks as the hand backfill (_reports/apply-links.js): the row must still be empty, and a video
// already on another row for the same brand is dropped. Each write posts an update with the evidence.
// Title-only and weaker matches are listed in the plan for a person; nothing is labelled.
//
// Caps per night: 25 rows written, about 1,500 YouTube units, 45 seconds. Starting creator rotates
// daily; signed roster creators first. Runs at 07:20 UTC, after the YouTube allowance resets.
//
//   GET /api/link-finder?dry=1   (team cookie or CRON_SECRET) shows the plan, writes nothing.
//   GET /api/link-finder?pass=unmatched&dry=1   the second pass's classified list, writes nothing.

import { mondayToken } from "./_reports/monday.js";
import { cookieOk } from "./_reports/access.js";
import { missingRows, loadGtr } from "./_reports/backfill.js";
import { scanUploads } from "./_reports/scan.js";
import { matchRows, sinceFor, writable } from "./_reports/flight-match.js";
import { applyLinks } from "./_reports/apply-links.js";
import { runUnmatched } from "./_reports/unmatched.js";

export const config = { maxDuration: 60 };

// Set to false to make the nightly run plan only (same as ?dry=1), changing nothing on monday.
const WRITES_ENABLED = true; // on 27 Sep 2026 after the overnight dry runs (board 18432874155) checked out
// Second pass (?pass=unmatched, its own cron at 07:40 UTC): sponsor reads on roster channels that no row
// links. See _reports/unmatched.js. Review rows always go to board 18433205666; these two switches gate
// the rest. Both OFF until Tom has checked the first night's list (brief of 28 Sep 2026, tracker d39).
const MAKEGOOD_WRITES = false; // append make-goods to the deal's LIVE VIDEO URLS
const NOTIFY_TEAM = false;     // daily monday notification to Margot and Alex with the count
const MAX_ROWS = 25, UNIT_BUDGET = 1500, TIME_MS = 30000; // leaves time for the writes inside the 60 s limit

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const token = mondayToken();
  const secret = process.env.CRON_SECRET;
  const fromCron = req.headers["x-vercel-cron"] || (secret && req.headers.authorization === "Bearer " + secret);
  const dry = String(req.query && req.query.dry || "") === "1" || !WRITES_ENABLED;
  // A signed-in team member may also post the second pass's review rows by hand (?pass=unmatched&post=1).
  // That writes to the review board only: make-goods and notifications stay with the cron.
  const post = String(req.query && req.query.pass || "") === "unmatched" && String(req.query && req.query.post || "") === "1";
  if (!fromCron && !((String(req.query && req.query.dry || "") === "1" || post) && token && cookieOk(req, token))) return res.status(401).json({ error: "Unauthorized" });
  if (!token || !process.env.YOUTUBE_API_KEY) return res.status(500).json({ error: "Setup: monday or YouTube key missing" });
  if (String(req.query && req.query.pass || "") === "unmatched") {
    try { return res.status(200).json(await runUnmatched(token, { dry: String(req.query.dry || "") === "1", makegoodWrites: MAKEGOOD_WRITES && !!fromCron, notify: NOTIFY_TEAM && !!fromCron, unlink: req.query.unlink })); }
    catch (e) { return res.status(200).json({ pass: "unmatched", error: String(e.message || e).slice(0, 300) }); }
  }

  const t0 = Date.now();
  const summary = { dry, units: 0, creators: 0, counts: {}, errors: [], plan: [] };
  const toWrite = [];
  try {
    const [rows, gtr] = await Promise.all([missingRows(token), loadGtr(token)]);
    summary.open = rows.length;
    const by = {};
    for (const r of rows) if (r.h && r.h.startsWith("@")) (by[r.h] = by[r.h] || []).push(r);
    const order = Object.keys(by).sort((a, b) => (gtr.signed[b.toLowerCase()] ? 1 : 0) - (gtr.signed[a.toLowerCase()] ? 1 : 0) || by[b].length - by[a].length);
    const shift = order.length ? Math.floor(Date.now() / 864e5) % order.length : 0;
    const signedN = order.filter(h => gtr.signed[h.toLowerCase()]).length;
    const rot = a => a.length ? a.slice(shift % a.length).concat(a.slice(0, shift % a.length)) : a;
    const queue = rot(order.slice(0, signedN)).concat(rot(order.slice(signedN)));
    for (const h of queue) {
      if (Date.now() - t0 > TIME_MS || summary.units > UNIT_BUDGET || toWrite.length >= MAX_ROWS) break;
      const since = sinceFor(by[h]); if (!since) continue;
      let scan;
      try { scan = await scanUploads(token, h, since, "", 40, { gtr, rows }); }
      catch (e) { summary.errors.push(h + ": " + String(e.message || e).slice(0, 120)); if (/quota|403/i.test(String(e.message))) break; continue; }
      summary.units += scan.units || 0; summary.creators++;
      if (scan.notFound) { summary.errors.push(h + ": channel not found"); continue; }
      for (const d of matchRows(scan.vids || [], by[h])) {
        summary.counts[d.act] = (summary.counts[d.act] || 0) + 1;
        if (d.act === "future" || d.act === "skip") continue;
        summary.plan.push({ creator: h, id: d.r.id, deal: d.r.deal, row: d.r.row, act: d.act, why: d.why, videos: (d.vids || []).map(v => v.v + " " + v.at) });
        if (d.act !== "recent" && writable(d) && toWrite.length < MAX_ROWS) toWrite.push({ id: d.r.id, v: d.vids.map(v => [v.v, v.t, v.at + ", " + (v.ev || "")]) });
      }
    }
    if (toWrite.length) {
      const r = await applyLinks(token, { rows: toWrite, rule: "Nightly link finder: uploads from this row's date window whose description carries a link naming the brand (or whose title names it, when this is the creator's one row for the brand). Several videos means the read ran as a flight across them." }, dry);
      summary.apply = { linked: r.linked, videos: r.videos, skipped: r.out.filter(o => /skipped/.test(o.result)).length };
    }
  } catch (e) { summary.errors.push(String(e.message || e).slice(0, 200)); }
  summary.ms = Date.now() - t0;
  return res.status(200).json(summary);
}
