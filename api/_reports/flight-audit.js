// Flight audit (cron /api/link-finder?pass=audit, Mondays 08:30 UTC). Runs on Vercel.
//
// Why (Rhapsody, 9 Oct 2026): Shopify x The Reel Rejects April 2026 showed under-delivery on the partner
// report. The row had been filled by hand with 3 of the flight's 6 videos. The link finders only fill
// EMPTY rows, and the In-flight rule only looks at the last 14 days of uploads, so nothing ever went back
// to a filled row to check it was complete. A hand check of every Rhapsody row the same day found 25 more
// videos on 8 rows that had been missed the same way.
//
// What it does, for every creator row on US Campaigns (subitems 6162879732) with a flight date (LIVE DATE,
// or DATE PUBLISHED taken as that day plus 6) and a flight that ended in the last 120 days: it reads the
// creator's uploads and ADDS any video that is
//   - published inside the row's own flight dates (not the 3 days before or 10 after: those overlap the
//     next flight of a weekly sponsor),
//   - EITHER carrying the same tracking link as a video already on the row (same domain and path), and
//     inside no other row's window for that brand,
//   - OR with the brand read out as a sponsor in the video itself (transcript, see spoken.js), and inside
//     no other row's flight for that brand. Added 9 Oct 2026: the full transcript audit found reads whose
//     description had no brand link, and rows that were still empty because the read was never linked.
//   - on no row for the same brand,
//   - never named in an earlier update on the row (a link a person took out stays out).
// Transcripts cost about $0.0007 a video (Apify); at most 80 are fetched a run, only for uploads inside a
// finished flight that are on no row for the brand.
// Nothing is removed. Each addition posts an update with the evidence. Rows whose additions would be more
// than 8 videos, or rows with no tracking link of their own, are listed for a person instead.
// Caps: 25 rows written a run, about 2,000 YouTube units (uploads are read once per creator).
//
//   GET /api/link-finder?pass=audit&dry=1   (team cookie or CRON_SECRET) the plan, writes nothing.
//   GET /api/link-finder?pass=audit&dry=1&days=400   look further back (a one-off sweep).

import { monday } from "./monday.js";
import { scanUploads } from "./scan.js";
import { loadGtr } from "./backfill.js";
import { brandKey } from "./apply-links.js";
import { spokenRead } from "./spoken.js";
import { transcripts } from "./timestamps.js";

const SUB_BOARD = 6162879732, D = 864e5;
const LOOKBACK_DAYS = 120, MAX_ROWS = 25, MAX_ADD = 8, UNIT_BUDGET = 2000, TIME_MS = 130000, MAX_TRANSCRIPTS = 80;
const ID_RE = /(?:v=|youtu\.be\/|shorts\/|live\/|embed\/)([A-Za-z0-9_-]{11})/g;
const ids = t => [...String(t || "").matchAll(ID_RE)].map(m => m[1]);
const day = s => Date.parse(String(s).slice(0, 10) + "T00:00:00Z");
const iso = t => new Date(t).toISOString().slice(0, 10);
const sq = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const esc = s => String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const normLink = u => String(u || "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");

// The row's own flight: LIVE DATE start to end, or DATE PUBLISHED to plus 6 days. Window adds 3 before and 10 after.
// A week runs Monday to Sunday (Tom, 9 Oct 2026), so a LIVE DATE that ends before a Sunday runs to that Sunday.
const toSunday = t => t + ((7 - new Date(t).getUTCDay()) % 7) * D;
export function flight(r) {
  if (r.live) { const a = day(r.live), b = toSunday(r.liveEnd ? day(r.liveEnd) : a + 6 * D); return { core: [a, b], a: a - 3 * D, b: b + 10 * D }; }
  if (r.pub) { const a = day(r.pub); return { core: [a, a + 6 * D], a: a - 3 * D, b: a + 16 * D }; }
  return null;
}
// Late or early flights (Tom, 9 Oct 2026: "sometimes content does go live later than the planned live week").
// When a finished row has nothing at all inside its own dates, the audit looks from 7 days before to 21 days
// after them for videos with the brand READ OUT (a link alone is not enough here), stopping at any other row's
// dates for the same brand. LIVE DATE is not changed; the update on the row says how far the flight moved.
const EARLY_DAYS = 7, LATE_DAYS = 21;

// Pure: rows (all rows of one creator, with .vids = linked ids), vids (that creator's uploads, from scan),
// returns [{ r, add: [videos], why }] for rows with something to add, and [{ r, review }] for a person.
// heard (optional): Map of video id -> transcript, for uploads that are worth checking for a spoken read.
export function auditCreator(rows, vids, now, lookbackDays, heard) {
  const byId = new Map(vids.map(v => [v.v, v]));
  const today = now || Date.now(), from = today - (lookbackDays || LOOKBACK_DAYS) * D;
  const out = [];
  for (const r of rows) {
    const f = flight(r); if (!f || f.core[1] < from || f.core[1] > today - 2 * D) continue; // finished flights only
    const bk = sq(r.brandKey || r.brand); if (bk.length < 3) continue;
    const own = r.vids.map(id => byId.get(id)).filter(Boolean);
    const links = new Set(own.flatMap(v => (v.u || []).filter(u => sq(u).includes(bk)).map(normLink)));
    if (!links.size && !heard) continue; // nothing to compare against
    const same = rows.filter(x => x !== r && sq(x.brandKey || x.brand) === bk);
    const taken = new Set(same.flatMap(x => x.vids).concat(r.vids));
    const add = [];
    const others = same.map(flight).filter(Boolean);
    for (const v of vids) {
      const t = day(v.at);
      if (t < f.core[0] || t > f.core[1] || taken.has(v.v)) continue;
      const link = links.size && (v.u || []).some(u => links.has(normLink(u)));
      if (link && !others.some(g => t >= g.a && t <= g.b)) { add.push({ ...v, ev: "same tracking link (" + [...links].join(", ") + ") as the row's own videos" }); continue; }
      const read = heard && heard.get(v.v) ? spokenRead(heard.get(v.v), r.brand) : null;
      if (read && !others.some(g => t >= g.core[0] && t <= g.core[1])) add.push({ ...v, ev: "read out in the video: \"" + read.quote + "\"" + (read.at != null ? " at " + Math.floor(read.at / 60) + ":" + String(read.at % 60).padStart(2, "0") : "") });
    }
    // Nothing in the planned week at all: the flight may have moved.
    if (!add.length && !own.some(v => day(v.at) >= f.core[0] && day(v.at) <= f.core[1]) && heard) {
      const lo = f.core[0] - EARLY_DAYS * D, hi = f.core[1] + LATE_DAYS * D;
      for (const v of vids) {
        const t = day(v.at);
        if (t < lo || t > hi || (t >= f.core[0] && t <= f.core[1]) || taken.has(v.v)) continue;
        // never cross into another row's dates for the brand, nor past one
        if (others.some(g => (t >= g.core[0] && t <= g.core[1]) || (t > f.core[1] && g.core[0] > f.core[1] && g.core[0] <= t) || (t < f.core[0] && g.core[1] < f.core[0] && g.core[1] >= t))) continue;
        const read = heard.get(v.v) ? spokenRead(heard.get(v.v), r.brand) : null;
        if (!read) continue;
        const shift = t > f.core[1] ? Math.round((t - f.core[1]) / D) + " days after" : Math.round((f.core[0] - t) / D) + " days before";
        add.push({ ...v, ev: "nothing went up in the planned dates; this went up " + shift + " them and the brand is read out in it: \"" + read.quote + "\"" });
      }
    }
    if (!add.length) continue;
    if (add.length > MAX_ADD) { out.push({ r, review: add.length + " videos in the flight carry this row's link or read but are not on it: too many to add without a person", vids: add.slice(0, 6) }); continue; }
    out.push({ r, add, why: "inside the row's own flight (" + iso(f.core[0]) + " to " + iso(f.core[1]) + ")" });
  }
  return out;
}

async function loadRows(token) {
  const fields = "cursor items { id name parent_item { id name group { title } column_values(ids:[\"dropdown_mm1a3tqp\"]) { id text } } " +
    "column_values(ids:[\"connect_boards__1\",\"text_mm6aq9qp\",\"timerange_mm1m50vx\",\"date_mm1mb38m\"]) { id text ... on BoardRelationValue { display_value } } }";
  let d = await monday(token, "query { boards(ids:[" + SUB_BOARD + "]) { items_page(limit:500) { " + fields + " } } }");
  let page = d.boards[0].items_page, items = page.items.slice(), guard = 0;
  while (page.cursor && guard++ < 10) { d = await monday(token, "query { next_items_page(limit:500, cursor:\"" + page.cursor + "\") { " + fields + " } }"); page = d.next_items_page; items = items.concat(page.items); }
  const out = [];
  for (const it of items) {
    const p = it.parent_item; if (!p) continue;
    const cv = {}; for (const c of it.column_values) cv[c.id] = (c.display_value != null && c.display_value !== "") ? c.display_value : (c.text || "");
    const tr = String(cv.timerange_mm1m50vx || "").match(/(\d{4}-\d{2}-\d{2})(?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/);
    const adv = (p.column_values.find(c => c.id === "dropdown_mm1a3tqp") || {}).text || "";
    out.push({ id: it.id, row: it.name, deal: p.name, stage: p.group && p.group.title, h: cv.connect_boards__1 || "", brand: adv || String(p.name).split("_")[0], brandKey: brandKey(adv, p.name),
      links: cv.text_mm6aq9qp || "", vids: ids(cv.text_mm6aq9qp), live: tr ? tr[1] : "", liveEnd: tr ? (tr[2] || tr[1]) : "", pub: cv.date_mm1mb38m || "" });
  }
  return out;
}

async function mondayVars(token, query, variables) {
  const r = await fetch("https://api.monday.com/v2", { method: "POST", headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" }, body: JSON.stringify({ query, variables }) });
  const d = await r.json();
  if (!r.ok || (d && d.errors)) throw new Error("monday: " + JSON.stringify((d && d.errors) || r.status).slice(0, 300));
  return d.data;
}

export async function runAudit(token, opts) {
  opts = opts || {};
  const t0 = Date.now(), now = opts.now || Date.now(), days = Math.max(14, Math.min(500, Number(opts.days) || LOOKBACK_DAYS));
  const summary = { pass: "audit", dry: !!opts.dry, days, creators: 0, units: 0, rowsChecked: 0, added: 0, videos: 0, review: [], plan: [], errors: [] };
  const [rows, gtr] = await Promise.all([loadRows(token), loadGtr(token)]);
  const from = now - days * D;
  const due = rows.filter(r => r.h.startsWith("@") && (() => { const f = flight(r); return f && f.core[1] >= from && f.core[1] <= now - 2 * D; })());
  summary.rowsChecked = due.length;
  const hs = [...new Set(due.map(r => r.h))];
  const writes = [], scans = [];
  for (const h of hs) {
    if (Date.now() - t0 > TIME_MS || summary.units > UNIT_BUDGET) break;
    const mine = rows.filter(r => r.h === h);
    const starts = mine.filter(r => due.includes(r)).map(r => flight(r).a);
    const since = iso(Math.min(...starts) - 20 * D);
    const brands = [...new Set(mine.map(r => r.brand))].join(",");
    let scan;
    try { scan = await scanUploads(token, h, since, brands, 40, { gtr, rows: [] }); }
    catch (e) { summary.errors.push(h + ": " + String(e.message || e).slice(0, 120)); if (/quota|403/i.test(String(e.message))) break; continue; }
    summary.units += scan.units || 0; summary.creators++;
    if (scan.notFound) { summary.errors.push(h + ": channel not found"); continue; }
    scans.push({ h, mine, vids: scan.vids || [] });
  }
  // Transcripts for uploads inside a due flight that are on no row of that brand (newest flights first).
  const want = [];
  for (const sc of scans) for (const r of sc.mine.filter(x => due.includes(x))) {
    const f = flight(r), bk = sq(r.brandKey || r.brand), taken = new Set(sc.mine.filter(x => sq(x.brandKey || x.brand) === bk).flatMap(x => x.vids));
    const empty = !sc.vids.some(v => r.vids.includes(v.v) && day(v.at) >= f.core[0] && day(v.at) <= f.core[1]);
    const lo = empty ? f.core[0] - EARLY_DAYS * D : f.core[0], hi = empty ? f.core[1] + LATE_DAYS * D : f.core[1];
    for (const v of sc.vids) { const t = day(v.at); if (t >= lo && t <= hi && !taken.has(v.v)) want.push({ v: v.v, t }); }
  }
  const ids = [...new Map(want.sort((a, b) => b.t - a.t).map(x => [x.v, x])).keys()].slice(0, MAX_TRANSCRIPTS);
  let heard = new Map();
  if (ids.length && !opts.noTranscripts) {
    try { const tr = await transcripts(ids, { waitMs: 110000, memory: 2048 }); heard = new Map(Object.entries(tr)); }
    catch (e) { summary.errors.push("transcripts: " + String(e.message || e).slice(0, 160)); }
  }
  summary.transcripts = { asked: ids.length, got: heard.size, more: Math.max(0, new Set(want.map(x => x.v)).size - ids.length) };
  for (const { mine, vids } of scans) {
    for (const x of auditCreator(mine, vids, now, days, heard)) {
      if (x.review) { summary.review.push({ id: x.r.id, deal: x.r.deal, why: x.review, videos: x.vids.map(v => v.v + " " + v.at) }); continue; }
      if (!due.includes(x.r)) continue;
      summary.plan.push({ id: x.r.id, deal: x.r.deal, row: x.r.row, why: x.why, videos: x.add.map(v => v.v + " " + v.at + " " + v.n + " | " + v.ev) });
      if (writes.length < MAX_ROWS) writes.push(x);
    }
  }
  for (const x of writes) {
    // Read the row again just before writing: it may have changed, and a link named in an earlier update is never added back.
    const d = await monday(token, "query { items(ids:[" + x.r.id + "]) { column_values(ids:[\"text_mm6aq9qp\"]) { text } updates(limit:100) { text_body } } }");
    const it = d.items && d.items[0]; if (!it) continue;
    const cell = it.column_values[0].text || "", said = (it.updates || []).map(u => u.text_body || "").join(" ");
    const have = new Set(ids(cell));
    const keep = x.add.filter(v => !have.has(v.v) && !said.includes(v.v));
    if (!keep.length) continue;
    summary.added++; summary.videos += keep.length;
    if (opts.dry) continue;
    try {
      const next = cell.replace(/[,\s]+$/, "") + ", " + keep.map(v => "https://www.youtube.com/watch?v=" + v.v).join(", ");
      await mondayVars(token, "mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id:$b, item_id:$i, column_values:$v) { id } }", { b: String(SUB_BOARD), i: String(x.r.id), v: JSON.stringify({ text_mm6aq9qp: next }) });
      const body = "<p><b>Flight audit: added " + keep.length + (keep.length === 1 ? " video" : " videos") + " missing from this row</b></p><p>Each was published " + esc(x.why) + ", and is on no other row for this brand. Nothing was removed.</p><ul>" +
        keep.map(v => "<li>" + esc(v.at) + " youtube.com/watch?v=" + esc(v.v) + " " + esc(v.t) + ", " + Number(v.n || 0).toLocaleString("en-US") + " views today. Evidence: " + esc(v.ev) + "</li>").join("") +
        "</ul><p>The 09:00 view sync adds their views the next morning. If any is wrong, take it out of LIVE VIDEO URLS; it is never added back, because it is named in this update.</p>";
      await mondayVars(token, "mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t) { id } }", { i: String(x.r.id), t: body });
    } catch (e) { summary.errors.push(x.r.id + ": " + String(e.message || e).slice(0, 160)); }
  }
  summary.ms = Date.now() - t0;
  return summary;
}
