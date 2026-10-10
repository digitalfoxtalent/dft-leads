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
// Near the flight (added 9 Oct 2026, see NEAR_DAYS): videos up to 7 days either side (60 after, on a row marked
// make good) are added when read out, same ad copy and nearest flight; reads 8 to 45 days out are flagged to Tom.
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
import { spokenRead as spokenRaw, adGrams, COPY_MIN } from "./spoken.js";
// Transcripts are long and the same video is checked against many rows: remember each answer for the run.
const readMemo = new Map(), gramMemo = new Map();
const spokenRead = (t, brand) => { if (!t) return null; let m = readMemo.get(t); if (!m) readMemo.set(t, m = new Map()); if (!m.has(brand)) m.set(brand, spokenRaw(t, brand)); return m.get(brand); };
const grams = (t, brand) => { let m = gramMemo.get(t); if (!m) gramMemo.set(t, m = new Map()); if (!m.has(brand)) m.set(brand, adGrams(t, brand)); return m.get(brand); };
const copyMatch = (cand, own, brand) => { const c = grams(cand, brand); if (!c.size) return null; let any = false, hit = 0; const sets = own.map(t => grams(t, brand)).filter(g => g.size); if (!sets.length) return null; for (const x of c) if (sets.some(g => g.has(x))) hit++; return hit / c.size; };
import { transcripts } from "./timestamps.js";

const SUB_BOARD = 6162879732, D = 864e5;
const LOOKBACK_DAYS = 120, MAX_ROWS = 25, MAX_ADD = 8, UNIT_BUDGET = 2000, TIME_MS = 130000, MAX_TRANSCRIPTS = 100, TOM = 40241658, FLAG_LIST = 12;
const ACCEPT_URL = "https://reports.digitalfoxtalent.com/api/link-finder?pass=audit&accept=";
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
// Near the flight (Tom, 9 Oct 2026: "wide enough to catch all the videos as sometimes they could go live early,
// or even much later as make goods", but without false links or mixing up a new campaign for the same brand).
// A video up to 7 days before or after a finished flight (60 days after, if the row or deal name says
// "make good") is ADDED only when all of these hold:
//   - the brand is read out in it (a link alone is never enough),
//   - its ad copy matches the row's own videos (copyMatch >= COPY_MIN; a new brief usually means new copy),
//   - this row is the nearest flight for the brand, strictly (no other row of the brand is as close, and
//     the video is not inside another row's dates).
// A read that fails only the copy test, or sits equally close to two rows, goes to a person instead.
// A read 8 to 45 days from the nearest flight is never added: it is flagged to Tom as a possible make-good,
// with a one-click link that adds it (?pass=audit&accept=row:video).
const NEAR_DAYS = 7, MAKEGOOD_DAYS = 60, FLAG_DAYS = 45;
export const isMakegood = r => /make.?good/i.test(String(r.row || "") + " " + String(r.deal || ""));
const gap = (t, f) => t < f.core[0] ? f.core[0] - t : t > f.core[1] ? t - f.core[1] : 0;

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
    const add = [], linkOnly = [];
    const others = same.map(flight).filter(Boolean);
    for (const v of vids) {
      const t = day(v.at);
      if (t < f.core[0] || t > f.core[1] || taken.has(v.v)) continue;
      const link = links.size && (v.u || []).some(u => links.has(normLink(u)));
      // A link alone is not proof when the transcript can be checked (9 Oct 2026: descriptions get copied
      // from week to week with the old sponsor link still in them). Heard, no read: a person decides.
      if (link && heard && heard.get(v.v) && !spokenRead(heard.get(v.v), r.brand)) { linkOnly.push({ ...v, kind: "link but no read", why: "carries this row's tracking link and went up inside the flight, but the brand is not read out in it" }); continue; }
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
        // and only when this flight is strictly the nearest one of the brand (9 Oct 2026)
        if (others.some(g => gap(t, g) <= gap(t, f))) continue;
        const read = heard.get(v.v) ? spokenRead(heard.get(v.v), r.brand) : null;
        if (!read) continue;
        const shift = t > f.core[1] ? Math.round((t - f.core[1]) / D) + " days after" : Math.round((f.core[0] - t) / D) + " days before";
        add.push({ ...v, ev: "nothing went up in the planned dates; this went up " + shift + " them and the brand is read out in it: \"" + read.quote + "\"" });
      }
    }
    // Near the flight: early starts, Monday spill-overs, marked make-goods (see NEAR_DAYS above).
    const review = linkOnly.slice();
    if (heard) {
      const ownT = r.vids.map(id => heard.get(id)).filter(Boolean);
      if (ownT.length) {
      const lo = f.core[0] - NEAR_DAYS * D, hi = f.core[1] + (isMakegood(r) ? MAKEGOOD_DAYS : NEAR_DAYS) * D;
      for (const v of vids) {
        const t = day(v.at);
        if (t < lo || t > hi || (t >= f.core[0] && t <= f.core[1]) || taken.has(v.v) || add.some(a => a.v === v.v)) continue;
        if (others.some(g => t >= g.core[0] && t <= g.core[1])) continue; // another flight owns it
        const read = heard.get(v.v) ? spokenRead(heard.get(v.v), r.brand) : null; if (!read) continue;
        const mine = gap(t, f), closest = Math.min(...others.map(g => gap(t, g)).concat([Infinity]));
        if (closest < mine) continue; // a nearer flight of the brand will judge it
        const when = t > f.core[1] ? Math.round((t - f.core[1]) / D) + " days after" : Math.round((f.core[0] - t) / D) + " days before";
        if (closest === mine) { review.push({ ...v, kind: "two rows", why: "went up " + when + " this flight, and as close to another flight of the brand" }); continue; }
        const m = copyMatch(heard.get(v.v), ownT, r.brand);
        if (m == null || m < COPY_MIN) { review.push({ ...v, kind: "copy differs", why: "went up " + when + " this flight with the brand read out, but its ad copy " + (m == null ? "could not be compared" : "matches only " + Math.round(m * 100) + "%") + " of this row's videos (a new campaign?)" }); continue; }
        add.push({ ...v, ev: "went up " + when + " the flight" + (isMakegood(r) ? " (make-good row)" : "") + ", the brand is read out (\"" + read.quote + "\") and " + Math.round(m * 100) + "% of its ad copy matches this row's videos" });
      }
      }
    }
    if (review.length) out.push({ r, flag: review });
    if (!add.length) continue;
    if (add.length > MAX_ADD) { out.push({ r, review: add.length + " videos in the flight carry this row's link or read but are not on it: too many to add without a person", vids: add.slice(0, 6) }); continue; }
    out.push({ r, add, why: "inside the row's own flight (" + iso(f.core[0]) + " to " + iso(f.core[1]) + ")" });
  }
  return out;
}

// Pure: reads 8 to 45 days from the nearest finished flight of their brand, on no row of the brand.
// Never added; returned for Tom as possible make-goods, each against its nearest row.
export function makegoodFlags(rows, vids, now, heard) {
  const out = []; if (!heard) return out;
  const brands = new Map(); for (const r of rows) { const bk = sq(r.brandKey || r.brand); if (bk.length >= 3) (brands.get(bk) || brands.set(bk, []).get(bk)).push(r); }
  for (const [bk, rs] of brands) {
    const fl = rs.map(r => ({ r, f: flight(r) })).filter(x => x.f && x.f.core[1] <= (now || Date.now()) - 2 * D);
    if (!fl.length) continue;
    const taken = new Set(rs.flatMap(r => r.vids));
    for (const v of vids) {
      if (taken.has(v.v) || !heard.get(v.v)) continue;
      const t = day(v.at); let best = null;
      for (const x of fl) { const g = gap(t, x.f); if (!best || g < best.g) best = { ...x, g }; }
      if (!best || t <= best.f.core[1]) continue; // make-goods run after a flight, never before it
      const limit = (isMakegood(best.r) ? MAKEGOOD_DAYS : NEAR_DAYS) * D;
      if (best.g <= limit || best.g > FLAG_DAYS * D) continue;
      const read = spokenRead(heard.get(v.v), best.r.brand); if (!read) continue;
      out.push({ r: best.r, v, days: Math.round(best.g / D), quote: read.quote });
    }
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
  // Priority: 1 inside the flight (and the moved-flight window of an empty row), 2 near the flight, 3 the row's
  // own videos (to compare ad copy, at most 3 a row), 4 possible make-goods (8 to 45 days out, brand in the description).
  const want = [];
  for (const sc of scans) for (const r of sc.mine.filter(x => due.includes(x))) {
    const f = flight(r), bk = sq(r.brandKey || r.brand), taken = new Set(sc.mine.filter(x => sq(x.brandKey || x.brand) === bk).flatMap(x => x.vids));
    const empty = !sc.vids.some(v => r.vids.includes(v.v) && day(v.at) >= f.core[0] && day(v.at) <= f.core[1]);
    const lo = empty ? f.core[0] - EARLY_DAYS * D : f.core[0], hi = empty ? f.core[1] + LATE_DAYS * D : f.core[1];
    const nlo = f.core[0] - NEAR_DAYS * D, nhi = f.core[1] + (isMakegood(r) ? MAKEGOOD_DAYS : NEAR_DAYS) * D;
    const named = v => (v.m || []).concat(v.u || []).some(x => sq(x).includes(bk));
    for (const v of sc.vids) {
      const t = day(v.at);
      if (taken.has(v.v)) continue;
      if (t >= lo && t <= hi) want.push({ v: v.v, t, p: 1 });
      else if (t >= nlo && t <= nhi) want.push({ v: v.v, t, p: 2 });
      else if (named(v) && t > f.core[1] && t <= f.core[1] + FLAG_DAYS * D) want.push({ v: v.v, t, p: 4 });
    }
    if (!empty) for (const id of r.vids.slice(-3)) want.push({ v: id, t: f.core[1], p: 3 });
  }
  const ids = [...new Map(want.sort((a, b) => a.p - b.p || b.t - a.t).map(x => [x.v, x])).keys()].slice(0, MAX_TRANSCRIPTS);
  let heard = new Map();
  if (ids.length && !opts.noTranscripts) {
    try { const tr = await transcripts(ids, { waitMs: 110000, memory: 2048 }); heard = new Map(Object.entries(tr)); }
    catch (e) { summary.errors.push("transcripts: " + String(e.message || e).slice(0, 160)); }
  }
  summary.transcripts = { asked: ids.length, got: heard.size, more: Math.max(0, new Set(want.map(x => x.v)).size - ids.length) };
  const flags = [];
  for (const { mine, vids } of scans) {
    for (const m of makegoodFlags(mine, vids, now, heard)) if (due.includes(m.r)) flags.push({ r: m.r, v: m.v, kind: "possible make-good", why: "brand read out " + m.days + " days after this flight (\"" + m.quote + "\"), on no row" });
    for (const x of auditCreator(mine, vids, now, days, heard)) {
      if (x.flag) { for (const v of x.flag) flags.push({ r: x.r, v, kind: v.kind, why: v.why }); continue; }
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
  // Flags for a person: one update on the row per video (so it is never flagged twice) and one notification to Tom.
  { const seen = new Set(); for (let i = flags.length - 1; i >= 0; i--) { const k = flags[i].v.v + "|" + flags[i].kind; if (seen.has(k)) flags.splice(i, 1); else seen.add(k); } }
  summary.flags = flags.map(x => ({ id: x.r.id, deal: x.r.deal, kind: x.kind, video: x.v.v + " " + x.v.at, why: x.why, accept: ACCEPT_URL + x.r.id + ":" + x.v.v }));
  if (!opts.dry && flags.length) {
    const fresh = [];
    for (const x of flags.slice(0, 40)) {
      if (Date.now() - t0 > 280000) break;
      try {
        const d = await monday(token, "query { items(ids:[" + x.r.id + "]) { column_values(ids:[\"text_mm6aq9qp\"]) { text } updates(limit:100) { text_body } } }");
        const it = d.items && d.items[0]; if (!it) continue;
        if ((it.column_values[0].text || "").includes(x.v.v) || (it.updates || []).some(u => String(u.text_body || "").includes(x.v.v))) continue;
        const body = "<p><b>Flight audit: " + esc(x.kind) + ", not added</b></p><p>" + esc(x.v.at) + " youtube.com/watch?v=" + esc(x.v.v) + " " + esc(x.v.t) + ": " + esc(x.why) +
          ".</p><p>If it belongs here, open " + esc(ACCEPT_URL + x.r.id + ":" + x.v.v) + " and press Add (team sign-in). Otherwise ignore this; it is not flagged again.</p>";
        await mondayVars(token, "mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t) { id } }", { i: String(x.r.id), t: body });
        fresh.push(x);
      } catch (e) { summary.errors.push("flag " + x.r.id + ": " + String(e.message || e).slice(0, 120)); }
    }
    if (fresh.length) {
      const lines = fresh.slice(0, FLAG_LIST).map(x => "- " + x.r.deal + ": " + x.kind + ", " + x.v.at + " " + x.v.v + ". Add: " + ACCEPT_URL + x.r.id + ":" + x.v.v);
      const text = "Flight audit: " + fresh.length + " video" + (fresh.length === 1 ? "" : "s") + " with a sponsor read near a flight, not added automatically:\n" + lines.join("\n") + (fresh.length > FLAG_LIST ? "\n...and " + (fresh.length - FLAG_LIST) + " more (see each row's updates)." : "");
      try { await mondayVars(token, "mutation ($u: ID!, $t: ID!, $x: String!) { create_notification(user_id:$u, target_id:$t, target_type:Project, text:$x) { text } }", { u: String(TOM), t: String(fresh[0].r.id), x: text.slice(0, 1900) }); summary.notified = fresh.length; }
      catch (e) { summary.errors.push("notify: " + String(e.message || e).slice(0, 120)); }
    }
  }
  summary.ms = Date.now() - t0;
  return summary;
}

// One click from a flag (?pass=audit&accept=row:video, team sign-in): adds that video to that row, once.
export async function acceptFlag(token, rowId, vid, opts) {
  if (!/^\d{6,}$/.test(String(rowId)) || !/^[A-Za-z0-9_-]{11}$/.test(String(vid))) return { ok: false, error: "bad link" };
  const d = await monday(token, "query { items(ids:[" + rowId + "]) { name parent_item { name } column_values(ids:[\"text_mm6aq9qp\"]) { text } } }");
  const it = d.items && d.items[0]; if (!it) return { ok: false, error: "row not found" };
  const cell = it.column_values[0].text || "", deal = it.parent_item ? it.parent_item.name : it.name;
  if (ids(cell).includes(vid)) return { ok: true, deal, already: true };
  if (opts && opts.dry) return { ok: true, deal, wouldAdd: vid };
  const next = (cell.replace(/[,\s]+$/, "") ? cell.replace(/[,\s]+$/, "") + ", " : "") + "https://www.youtube.com/watch?v=" + vid;
  await mondayVars(token, "mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id:$b, item_id:$i, column_values:$v) { id } }", { b: String(SUB_BOARD), i: String(rowId), v: JSON.stringify({ text_mm6aq9qp: next }) });
  await mondayVars(token, "mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t) { id } }", { i: String(rowId), t: "<p><b>Added from a flight audit flag</b></p><p>youtube.com/watch?v=" + esc(vid) + " was added by a team member from the flag link. Its views count from the next 09:00 sync.</p>" });
  return { ok: true, deal, added: vid };
}
