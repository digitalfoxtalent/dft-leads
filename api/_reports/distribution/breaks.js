// Breaks across every distribution channel, in one shared row shape. READ ONLY.
//
// CHANNELS
//   megaphone  read live from the Megaphone API (token from monday, via ../megaphone.js; never logged).
//   msn        mapped from the "distribution-status" record that load.js already reads.
//   facebook   planned: shown greyed until it has a source. To add a channel, write a collector
//              that returns rows in the shape below and add it to CHANNELS and breaksData().
//
// ROW SHAPE (same for every channel)
//   channel, brand, item_id, title, youtube_id, issue, detail, fix, status, first_seen, last_checked
//   issue: file_broken | file_missing | wrong_cut | rejected_thumbnail | rejected_audio | rejected_content |
//          rejected_text | processing_failed | held | cleanup | ads_missing
//   fix:   youtube_pull | reencode | new_thumbnail | mute_audio | delete_copy | set_cues | decision | none
//   status: open | in_progress | fixed
//   youtube_id is the key shared across channels, so one pulled file can fix the same video everywhere.
//
// RULES (as every report): it always renders; if a source cannot be read, show its last good rows and
// say so; an empty or short read is a fault, never the truth; every source shows when it was read.

import { megaphoneToken } from "../megaphone.js";
import { PARTS, readRecord } from "./breaks-store.js";

export const NET = "1b171fa4-a905-11f0-9d4f-a77759d99516";
const CMS = "https://cms.megaphone.fm/api";
const CACHE_MS = 10 * 60 * 1000;
const STUCK_MS = 3 * 60 * 60 * 1000;
const RETRY_MS = 48 * 60 * 60 * 1000; // the re-encode runs twice a day, so an error older than this has had its retries

// Videos whose source file is confirmed broken after a re-encode. Only a fresh file from YouTube fixes them.
const SILENT = "Source file is damaged (silent or cut short); needs the YouTube copy";
const KNOWN_BROKEN = {
  "pMOtFcEioG4": "Megaphone cannot process the VideoNest file, even re-encoded",
  "OTlBxtEfj3Y": "About 45 of 73 min silent in the VideoNest file",
  "tWw_HN55p00": SILENT, "OzR4Q8bgRNk": SILENT, "-8Ez5-Trxx0": SILENT, "2l6U2RJfydQ": SILENT,
  "i7AeWskJRxQ": SILENT, "7M7l6fKf-p8": SILENT, "AQWY3D-bKmU": SILENT, "8jeLtTMFWug": SILENT
};
let cache = null, lastGoodMega = null;

export const CHANNELS = [
  { id: "msn", name: "MSN", kind: "video", status: "live" },
  { id: "megaphone", name: "Megaphone (podcasts)", kind: "podcast", status: "live" },
  { id: "facebook", name: "Facebook pages", kind: "video", status: "planned" }
];

// YouTube long-form uploads per show, counted 27 Sep 2026. Recount by hand and update the date.
const YT_AS_OF = "27 Sep 2026";
const YT_TOTALS = {
  "AJM Nerdcore": 198, "Better Gaming": 198, "Beyond the Trailer": 8162, "CineDesi": 6526, "CinePals": 4839,
  "Colton Ogburn": 232, "DanCo": 2773, "Galaxy Geeks": 1236, "Geekdom": 3153, "Heavy Spoilers": 2839,
  "Lore Reloaded": 1195, "Movie Facts Pro": 264, "Mr. Know-It-All": 898, "One Take Jake": 334,
  "Sideserf Cake Studio": 310, "The Cosmic Wonder": 3627, "Wesnemo": 1901, "WesWorld": 99
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const day = d => new Date(d).toISOString().slice(0, 10);

export async function mget(tok, path) {
  let last = "";
  for (let a = 0; a < 4; a++) {
    const r = await fetch(CMS + path, { headers: { Authorization: 'Token token="' + tok + '"', Accept: "application/json" } });
    if (r.status === 429 || r.status >= 500) { last = String(r.status); await sleep(1500 * (a + 1)); continue; }
    if (!r.ok) throw new Error("Megaphone answered " + r.status);
    return r.json();
  }
  throw new Error("Megaphone busy (" + last + ")");
}

export async function pool(list, n, fn) {
  const out = new Array(list.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) { const k = i++; out[k] = await fn(list[k]); }
  }));
  return out;
}

export const ytOf = ext => { const m = /^(?:yt|failed)-([A-Za-z0-9_-]{11})/.exec(ext || ""); return m ? m[1] : null; };

async function unpublished(tok, pid) {
  const out = [];
  for (let page = 1; page < 30; page++) {
    const p = await mget(tok, "/networks/" + NET + "/podcasts/" + pid + "/episodes?published=false&per_page=100&page=" + page);
    if (!Array.isArray(p)) throw new Error("episode list was not a list");
    out.push(...p);
    if (p.length < 100) return out;
  }
  return out;
}

// Is there a published episode for this YouTube video on the same show?
async function hasLiveTwin(tok, yt, pid) {
  const j = await mget(tok, "/search/episodes?externalId=" + encodeURIComponent("yt-" + yt));
  return Array.isArray(j) && j.some(e => e.status === "published" && (!e.podcastId || e.podcastId === pid));
}

async function megaphoneRows(mondayTok) {
  const tok = await megaphoneToken(mondayTok);
  if (tok.length < 10) throw new Error("Megaphone key missing on monday");
  const pods = await mget(tok, "/networks/" + NET + "/podcasts?per_page=100");
  if (!Array.isArray(pods) || pods.length < 10) throw new Error("short read: " + (pods && pods.length) + " shows");
  const now = Date.now(), today = day(now);
  const perShow = await pool(pods, 6, async p => ({ p, eps: await unpublished(tok, p.id) }));
  const items = [], coverage = [], twinChecks = [];
  for (const { p, eps } of perShow) {
    for (const e of eps) {
      const af = e.audioFileStatus, yt = ytOf(e.externalId);
      const seen = day(e.createdAt || now), touched = e.updatedAt ? new Date(e.updatedAt).getTime() : now;
      const row = { channel: "megaphone", brand: p.title, item_id: e.id, title: e.title || "(untitled)", youtube_id: yt,
        issue: null, detail: "", fix: "none", status: "open", first_seen: seen, last_checked: today, _pid: p.id, _created: new Date(e.createdAt || now).getTime() };
      if (af === "error") {
        if (KNOWN_BROKEN[yt] || /-broken|^failed-/.test(e.externalId || "") || now - new Date(e.createdAt || now).getTime() > RETRY_MS) {
          row.issue = "file_broken"; row.fix = "youtube_pull"; row.detail = KNOWN_BROKEN[yt] || "Megaphone could not process the source file, even re-encoded";
        } else { row.issue = "processing_failed"; row.fix = "reencode"; row.detail = "Megaphone could not process the file; the twice-daily re-encode should fix it"; }
      } else if (e.audioFileProcessing || !af || af === "processing" || af === "pending") {
        if (now - touched < STUCK_MS) continue; // still in flight
        row.issue = "processing_failed"; row.fix = "reencode"; row.detail = "Stuck processing for more than 3 hours";
      } else if (e.draft) {
        row.issue = "held"; row.fix = "decision"; row.detail = "Hidden draft, file is fine: publish or delete";
      } else {
        if (e.pubdate && new Date(e.pubdate).getTime() > now) continue; // scheduled for later
        row.issue = "held"; row.fix = "decision"; row.detail = "File is fine but the episode is not published";
      }
      items.push(row);
      if (yt && (row.issue === "file_broken" || row.issue === "held" || row.issue === "processing_failed")) twinChecks.push(row);
    }
    const tot = YT_TOTALS[p.title];
    coverage.push({ channel: "megaphone", brand: p.title, live: Math.max(0, (p.episodesCount || 0) - eps.length),
      source_total: tot || null, source: tot ? "YouTube long-form (" + YT_AS_OF + " count)" : null });
  }
  // A hidden copy whose video is already live on the same show is clean-up, not a break.
  await pool(twinChecks, 6, async row => {
    let twin = false;
    try { twin = await hasLiveTwin(tok, row.youtube_id, row._pid); } catch (e) { return; }
    if (twin) { row.issue = "cleanup"; row.fix = "delete_copy"; row.detail = "Hidden copy; the live episode is fine"; }
  });
  // Several broken copies of one video on one show: the newest is the break, the rest are clean-up.
  const groups = {};
  items.filter(r => r.youtube_id && (r.issue === "file_broken" || r.issue === "processing_failed"))
    .forEach(r => { const k = r._pid + "|" + r.youtube_id; (groups[k] = groups[k] || []).push(r); });
  Object.values(groups).forEach(g => {
    g.sort((a, b) => (b._created || 0) - (a._created || 0));
    g.slice(1).forEach(r => { r.issue = "cleanup"; r.fix = "delete_copy"; r.detail = "Extra broken copy of a video listed above"; });
  });
  items.forEach(r => { delete r._pid; delete r._created; });
  return { items, coverage, shows: pods.length };
}

const MSN_STATUS = { rejected: "open", ready: "in_progress", sent: "in_progress", published: "fixed" };
function msnIssue(reason) {
  const r = String(reason || "").toLowerCase();
  if (/thumb|cover|image/.test(r)) return ["rejected_thumbnail", "new_thumbnail"];
  if (/audio|swear|profan/.test(r)) return ["rejected_audio", "mute_audio"];
  if (/title|text|caption/.test(r)) return ["rejected_text", "decision"];
  return ["rejected_content", "decision"];
}
function msnRows(dist) {
  const today = day(Date.now());
  return (dist && Array.isArray(dist.videos) ? dist.videos : []).map(v => {
    const [issue, fix] = msnIssue(v.reason);
    return { channel: "msn", brand: v.brand || "", item_id: String(v.id || ""), title: v.title || "", youtube_id: v.yt || null,
      issue, detail: v.reason || "", fix, status: MSN_STATUS[v.status] || "open", first_seen: v.rejectedOn || null, last_checked: today };
  });
}

export async function breaksData(mondayTok, dist) {
  let mega;
  if (cache && Date.now() - cache.at < CACHE_MS) mega = cache.mega;
  else {
    try {
      const m = await megaphoneRows(mondayTok);
      mega = Object.assign(m, { updated: new Date().toISOString() });
      lastGoodMega = mega;
      cache = { at: Date.now(), mega };
    } catch (e) {
      const error = String(e && e.message || e).slice(0, 160);
      mega = lastGoodMega ? Object.assign({}, lastGoodMega, { stale: true, error }) : { items: [], coverage: [], stale: true, error, updated: null };
    }
  }
  const night = await nightly(mondayTok);
  const items = msnRows(dist).concat(mega.items, night.adRows);
  // first_seen for overnight rows comes from the history: the earliest night the item was open.
  const firstNight = {};
  night.nights.slice().reverse().forEach(n => Object.keys(n.open || {}).forEach(k => { if (!firstNight[k]) firstNight[k] = n.date; }));
  night.adRows.forEach(r => { const f = firstNight[r.channel + ":" + r.item_id]; if (f) r.first_seen = f; });
  return {
    generated: new Date().toISOString(),
    channels: CHANNELS,
    sources: {
      megaphone: { updated: mega.updated, stale: !!mega.stale, error: mega.error || null, shows: mega.shows || null },
      msn: { updated: dist && (dist.summary && dist.summary.updated || dist.fetchedAt) || null, stale: !!(dist && dist.stale), error: dist && dist.error || null },
      scan: night.scan
    },
    items,
    fixed: fixedSince(night.nights, items, { megaphone: !!(mega.error || mega.stale), msn: !(dist && Array.isArray(dist.videos)) || !!(dist && dist.error), scan: night.scan.stale }),
    coverage: mega.coverage
  };
}

// OVERNIGHT RECORDS (breaks-scan.js writes them, this only reads). Cached like the live read.
let nightCache = null;
const SCAN_STALE_MS = 36 * 60 * 60 * 1000;
async function nightly(mondayTok) {
  if (nightCache && Date.now() - nightCache.at < CACHE_MS) return nightCache.v;
  const recs = await Promise.all(Array.from({ length: PARTS }, (_, i) => readRecord(mondayTok, "adgaps-" + i)).concat([readRecord(mondayTok, "history")]));
  const hist = recs.pop();
  const seen = {}, adRows = [], notes = [];
  let oldest = null, shows = 0, unread = 0;
  recs.forEach((r, i) => {
    if (!r) { notes.push("part " + (i + 1) + " has not run yet"); return; }
    if (r.error) { notes.push("part " + (i + 1) + ": " + r.error); return; }
    if (!oldest || r.at < oldest) oldest = r.at;
    if (Date.now() - new Date(r.at).getTime() > SCAN_STALE_MS) notes.push("part " + (i + 1) + " last ran " + r.at.slice(0, 10));
    (r.shows || []).forEach(sh => { shows++; if (sh.error) unread++; });
    (r.rows || []).forEach(row => { if (!seen[row.item_id]) { seen[row.item_id] = 1; adRows.push(row); } });
  });
  if (unread) notes.push(unread + " show" + (unread === 1 ? "" : "s") + " could not be read in full");
  const nights = hist && Array.isArray(hist.nights) ? hist.nights : [];
  const v = { adRows, nights, scan: { updated: oldest, stale: notes.length > 0, error: notes.length ? notes.join("; ").slice(0, 200) : null, shows } };
  nightCache = { at: Date.now(), v };
  return v;
}

// Anything open on one of the last 7 nights that is not open, sent or waiting now was fixed or cleared
// (published, rebuilt, given its ad breaks, or deleted as a duplicate).
// A source that could not be read tonight says nothing about what was fixed, so its items are left out.
function fixedSince(nights, items, unreadable) {
  const srcOf = k => k.startsWith("megaphone:ads:") ? "scan" : k.split(":")[0];
  const now = new Set(items.filter(r => r.status !== "fixed" && r.status !== "wont_fix").map(r => r.channel + ":" + r.item_id));
  const cutoff = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const out = {};
  nights.filter(n => n.date >= cutoff).forEach(n => Object.keys(n.open || {}).forEach(k => {
    if (now.has(k) || out[k] || unreadable[srcOf(k)]) return;
    const o = n.open[k]; out[k] = { channel: o.c, brand: o.b, title: o.t, issue: o.i, last_seen: n.date };
  }));
  return Object.values(out).sort((a, b) => String(b.last_seen).localeCompare(String(a.last_seen)));
}
