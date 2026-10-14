// Nightly checks behind the breaks dashboard. READ ONLY on Megaphone; writes only to the dashboard's
// own Apify store (breaks-store.js).
//
// 1. AD-BREAK GAPS (scanPart). Reads every LIVE episode on every show and flags any with:
//      no pre-roll, no post-roll, or 8 minutes or longer with no mid-roll.
//    That is the house standard (pre at 0, post at the end, mid-rolls from 8 min). Megaphone lists a
//    page of 100 episodes in about 15 seconds, and the network has about 10,000 live episodes, so the
//    shows are split into PARTS runs a few minutes apart, each well inside the 300 second limit.
//    Each part records exactly which shows it read, so the page can tell a clean show from an unread one.
//
// 2. HISTORY (writeHistory). After the last part, saves tonight's full list of open breaks (every
//    channel, ad gaps included) keyed channel:item. The page compares what is open now with the
//    last 7 nights: anything that was open then and is not open now was fixed or cleared.
//
// Not covered: silent stretches inside live episodes. Finding those means downloading and decoding
// every file, which is a different job.

import { megaphoneToken } from "../megaphone.js";
import { NET, mget, pool, ytOf, breaksData } from "./breaks.js";
import { distributionData } from "./load.js";
import { PARTS, readRecord, writeRecord } from "./breaks-store.js";

const MID_FROM = 480;     // seconds: episodes this long or longer should carry a mid-roll
const BUDGET_MS = 250e3;  // stop starting new pages after this, so the run always finishes and records itself
const KEEP_NIGHTS = 14;
const day = d => new Date(d).toISOString().slice(0, 10);

// Same shows always land in the same part on a given day: biggest first, each to the lightest part.
export function splitShows(pods, parts) {
  const bins = Array.from({ length: parts }, () => ({ n: 0, pods: [] }));
  [...pods].sort((a, b) => (b.episodesCount || 0) - (a.episodesCount || 0) || String(a.id).localeCompare(String(b.id)))
    .forEach(p => { const b = bins.reduce((x, y) => (y.n < x.n ? y : x)); b.pods.push(p); b.n += p.episodesCount || 0; });
  return bins.map(b => b.pods);
}

export function adGap(e) {
  const cues = Array.isArray(e.cuepoints) ? e.cuepoints.filter(c => c.isActive !== false) : [];
  const has = t => cues.some(c => c.cuepointType === t);
  const d = Number(e.duration) || 0;
  const mids = has("midroll") || (Array.isArray(e.insertionPoints) && e.insertionPoints.length > 0);
  const missing = [];
  if (!has("preroll")) missing.push("pre-roll");
  if (!has("postroll")) missing.push("post-roll");
  if (d >= MID_FROM && !mids) missing.push("mid-roll on a " + Math.round(d / 60) + " min episode");
  return missing;
}

export async function scanPart(mondayTok, part) {
  const t0 = Date.now();
  const tok = await megaphoneToken(mondayTok);
  if (tok.length < 10) throw new Error("Megaphone key missing on monday");
  const pods = await mget(tok, "/networks/" + NET + "/podcasts?per_page=100");
  if (!Array.isArray(pods) || pods.length < 10) throw new Error("short read: " + (pods && pods.length) + " shows");
  const mine = splitShows(pods, PARTS)[part] || [];
  // Every page of every show in this part, read 8 at a time.
  const pages = [];
  mine.forEach(p => { const n = Math.max(1, Math.ceil((p.episodesCount || 0) / 100) + 1); for (let i = 1; i <= n; i++) pages.push({ p, i }); });
  const rows = [], read = {}, failed = new Map();
  const today = day(Date.now());
  const readPage = async pg => {
    const { p, i } = pg;
    if (Date.now() - t0 > BUDGET_MS) { failed.set(pg, "time budget"); return; }
    let list;
    try { list = await mget(tok, "/networks/" + NET + "/podcasts/" + p.id + "/episodes?published=true&per_page=100&page=" + i); }
    catch (e) { failed.set(pg, String(e && e.message || e).slice(0, 80)); return; }
    if (!Array.isArray(list)) { failed.set(pg, "page was not a list"); return; }
    failed.delete(pg);
    read[p.id] = (read[p.id] || 0) + list.length;
    for (const e of list) {
      if (e.status !== "published") continue;
      const miss = adGap(e);
      if (!miss.length) continue;
      rows.push({ channel: "megaphone", brand: p.title, item_id: "ads:" + e.id, title: e.title || "(untitled)", youtube_id: ytOf(e.externalId),
        issue: "ads_missing", detail: "Live, but no " + miss.join(", no "), fix: "set_cues", status: "open", first_seen: today, last_checked: today });
    }
  };
  await pool(pages, 8, readPage);
  // Megaphone sometimes says "busy" (429). Pages that failed get one slower second try.
  if (failed.size) await pool([...failed.keys()], 2, readPage);
  const errOf = {}; failed.forEach((msg, pg) => { if (!errOf[pg.p.id]) errOf[pg.p.id] = msg; });
  const shows = mine.map(p => ({ id: p.id, title: p.title, expected: p.episodesCount || 0, read: read[p.id] || 0, error: errOf[p.id] || null }));
  const out = { part, parts: PARTS, at: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), shows, rows };
  return out;
}

// Tonight's open breaks, every channel. Keyed so the same thing seen on two nights is one entry.
export const keyOf = r => r.channel + ":" + r.item_id;

export async function writeHistory(mondayTok, dry) {
  const dist = await distributionData(mondayTok);
  const data = await breaksData(mondayTok, dist);
  if (data.sources.megaphone.stale || data.sources.megaphone.error) throw new Error("Megaphone read failed; history not written: " + (data.sources.megaphone.error || "stale"));
  const open = {};
  data.items.filter(r => r.status !== "fixed" && r.status !== "wont_fix")
    .forEach(r => { open[keyOf(r)] = { t: String(r.title || "").slice(0, 140), b: r.brand, c: r.channel, i: r.issue, s: r.status }; });
  const prev = await readRecord(mondayTok, "history");
  const nights = (prev && Array.isArray(prev.nights) ? prev.nights : []).filter(n => n.date !== day(Date.now()));
  nights.unshift({ date: day(Date.now()), at: new Date().toISOString(), open });
  const value = { updated: new Date().toISOString(), nights: nights.slice(0, KEEP_NIGHTS) };
  if (!dry) await writeRecord(mondayTok, "history", value);
  return { nights: value.nights.length, openTonight: Object.keys(open).length };
}
