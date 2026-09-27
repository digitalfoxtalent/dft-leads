// One-off overnight link backfill for US Campaigns creator rows (27 Sep 2026). Runs on Vercel cron
// every 10 minutes and switches itself off at STOP_AFTER. Nothing runs on anyone's computer.
//
// Each run takes the next creators that have no log item yet for the current MODE on the board
// "Campaign link backfill log" (18432874155), reads their YouTube uploads (_reports/scan.js), matches
// rows to videos flight by flight (_reports/flight-match.js), and records the plan as an item named
// "<mode> @handle" with the detail in an update.
//
// MODE "dry"   plans only; nothing on US Campaigns changes.
// MODE "write" also writes, through _reports/apply-links.js (row must still be empty, a video already
//              on another row for the same brand is dropped, every write posts an update with the
//              evidence). Written: "link" matches (description carries a link naming the brand, 1-15
//              videos), and "title" matches only when the row has a tight window (publish, live or
//              month date) and the brand name is distinctive (6+ letters, not a common word), or on any
//              window when the name is long (9+ letters, e.g. a film title in a promo Short).
// MODE "off"   does nothing.

import { monday, mondayToken } from "./_reports/monday.js";
import { missingRows, loadGtr } from "./_reports/backfill.js";
import { scanUploads } from "./_reports/scan.js";
import { matchRows, sinceFor, writable } from "./_reports/flight-match.js";
import { applyLinks } from "./_reports/apply-links.js";

export const config = { maxDuration: 300 };

const MODE = "write1";
const STOP_AFTER = "2026-09-27T16:00:00Z";
const LOG_BOARD = 18432874155;
const TIME_MS = 200000, UNIT_BUDGET = 1200;

const esc = s => String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
async function mondayVars(token, query, variables) {
  const r = await fetch("https://api.monday.com/v2", { method: "POST", headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" }, body: JSON.stringify({ query, variables }) });
  const d = await r.json();
  if (!r.ok || (d && d.errors)) throw new Error("monday: " + JSON.stringify((d && d.errors) || r.status).slice(0, 300));
  return d.data;
}
const line = d => "<li><b>" + d.act + (d.write ? " (written)" : "") + "</b> " + esc(d.r.deal) + " / " + esc(d.r.row) + " [" + d.r.id + "] - " + esc(d.why || "") +
  ((d.vids || []).length ? "<br>" + d.vids.map(v => esc(v.v) + " " + v.at + " " + (v.s < 70 ? "(Short) " : "") + Number(v.n || 0).toLocaleString("en-US") + " views - " + esc(v.t) + (v.ev ? " [" + esc(v.ev) + "]" : "")).join("<br>") : "") + "</li>";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const secret = process.env.CRON_SECRET;
  const fromCron = req.headers["x-vercel-cron"] || /^vercel-cron\//.test(String(req.headers["user-agent"] || "")) || (secret && req.headers.authorization === "Bearer " + secret);
  if (!fromCron) return res.status(401).json({ error: "Unauthorized" });
  if (MODE === "off" || Date.now() > new Date(STOP_AFTER).getTime()) return res.status(200).json({ off: true });
  const token = mondayToken();
  const t0 = Date.now(), out = { mode: MODE, done: [], errors: [], units: 0 };
  try {
    const logs = await monday(token, "query { boards(ids:[" + LOG_BOARD + "]) { items_page(limit:500) { items { name } } } }");
    const seen = new Set(logs.boards[0].items_page.items.map(i => i.name));
    const [rows, gtr] = await Promise.all([missingRows(token), loadGtr(token)]);
    const by = {};
    for (const r of rows) if (r.h && r.h.startsWith("@")) (by[r.h] = by[r.h] || []).push(r);
    const queue = Object.keys(by).sort((a, b) => (gtr.signed[b.toLowerCase()] ? 1 : 0) - (gtr.signed[a.toLowerCase()] ? 1 : 0) || by[b].length - by[a].length).filter(h => !seen.has(MODE + " " + h));
    for (const h of queue) {
      if (Date.now() - t0 > TIME_MS || out.units > UNIT_BUDGET) break;
      const since = sinceFor(by[h]);
      let plan = [], note = "";
      if (!since) note = "No dated rows.";
      else {
        let scan;
        try { scan = await scanUploads(token, h, since, "", 60, { gtr, rows }); }
        catch (e) { out.errors.push(h + ": " + String(e.message || e).slice(0, 150)); if (/quota|403/i.test(String(e.message))) break; continue; }
        out.units += scan.units || 0;
        if (scan.notFound) note = "YouTube channel not found for " + esc(scan.ytHandle) + ".";
        else {
          note = scan.count + " uploads since " + scan.since + (scan.reachedBack ? "" : " (did NOT reach back that far)") + ", channel " + esc(scan.channel) + ".";
          plan = matchRows(scan.vids || [], by[h]);
        }
      }
      let applied = null;
      const toWrite = plan.filter(writable);
      for (const d of toWrite) d.write = MODE.startsWith("write");
      if (MODE.startsWith("write") && toWrite.length) {
        applied = await applyLinks(token, { rows: toWrite.map(d => ({ id: d.r.id, v: d.vids.map(v => [v.v, v.t, v.at + ", " + (v.ev || "")]) })),
          rule: "Overnight backfill (Claude, 27 Sep 2026): uploads from this row's date window whose description carries a link naming the brand (or, for a tight window, whose title names it). Several videos means the read ran as a flight across them." }, false);
      }
      const counts = plan.reduce((a, d) => (a[d.act] = (a[d.act] || 0) + 1, a), {});
      const order = { link: 0, title: 1, weak: 2, none: 3, review: 4, recent: 5, future: 6, skip: 7 };
      plan.sort((a, b) => order[a.act] - order[b.act]);
      const body = "<p><b>" + MODE + " " + esc(h) + "</b>: " + note + " " + Object.entries(counts).map(e => e.join(" ")).join(", ") + ". Would write: " + toWrite.length + " rows.</p>" +
        (applied ? "<p>Written: " + applied.linked + " rows, " + applied.videos + " videos. " + applied.out.filter(o => /skipped/.test(o.result)).map(o => o.id + " " + esc(o.result)).join("; ") + "</p>" : "") +
        "<ul>" + plan.filter(d => d.act !== "future" && d.act !== "skip").map(line).join("") + "</ul>";
      const it = await mondayVars(token, "mutation ($b: ID!, $n: String!) { create_item(board_id:$b, item_name:$n) { id } }", { b: String(LOG_BOARD), n: MODE + " " + h });
      await mondayVars(token, "mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t) { id } }", { i: it.create_item.id, t: body.slice(0, 60000) });
      out.done.push(h + " " + JSON.stringify(counts) + (applied ? " wrote " + applied.linked : ""));
    }
    out.left = queue.length - out.done.length;
  } catch (e) { out.errors.push(String(e.message || e).slice(0, 200)); }
  out.ms = Date.now() - t0;
  try { // one line per run on the log board, so a run that failed is visible
    const it = await mondayVars(token, "mutation ($b: ID!, $n: String!) { create_item(board_id:$b, item_name:$n) { id } }", { b: String(LOG_BOARD), n: "run " + new Date(t0).toISOString().slice(11, 16) + " " + MODE + " done " + out.done.length + (out.errors.length ? " ERR " + out.errors.length : "") });
    await mondayVars(token, "mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t) { id } }", { i: it.create_item.id, t: "<pre>" + esc(JSON.stringify(out, null, 1)).slice(0, 20000) + "</pre>" });
  } catch (e) {}
  return res.status(200).json(out);
}
