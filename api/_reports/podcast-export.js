// Podcast reach from the Megaphone Metrics Export: Spotify, Apple Podcasts, Amazon and other apps, every
// day, with nobody uploading anything. The hand refresh on /refresh (reach-apply.js) still works and the
// two agree: both write the same columns and the same REACH DETAIL lines.
//
// SOURCE: Megaphone (Spotify) writes one file per day into DFT's own S3 bucket dft-megaphone-metrics-export
// (us-west-1, switched on 29 Sep 2026, history from 18 Sep 2026): delivery-v2-day-YYYY-MM-DD.json.gz, one
// JSON line per download or play (episode_id, ip, user_agent, normalized_user_agent, delivery_type,
// media_type, blacklisted_ip/ua, ...), and an empty _finalized_delivery_YYYY_MM_DD_<epoch> marker about
// 12:10 UTC the next day once that day is complete. Only finalized days are read. Spotify Video plays are in
// it (delivery_type "play", media_type "video"). It is read with the read-only AWS user
// dft-reports-megaphone-reader (ListBucket and GetObject on that one bucket); its key is in the Vercel
// variables MEGAPHONE_EXPORT_KEY_ID and MEGAPHONE_EXPORT_SECRET.
//
// COUNTING: one row is one listen or play. Rows flagged blacklisted are left out, and repeats of the same
// episode from the same IP address and app on the same day count once (the IAB rule podcast hosts use).
// Apps: Spotify -> SPOTIFY; Apple Podcasts -> APPLE; anything naming Amazon or Alexa -> AMAZON; the rest
// (Overcast, browsers, Pocket Casts, ...) -> OTHER APPS.
//
// HOW A FIGURE MOVES: each video line in REACH DETAIL holds lifetime figures as of the "as of" date at the
// top (or, when a line ends in base:<date>:<sp>/<ap>/<am>/<ot>, as of that date). A run adds every finalized
// day after that date, then writes the line with the new "as of" date. So a missed or repeated run never
// double counts, and the hand refresh can still set a line (it writes the base token). Figures only rise.
//
// NEW VIDEOS: a campaign video with no line yet is looked up in Megaphone by its YouTube id (the yt-<id>
// stamp the Megaphone sync and the importer put on each episode). Found: it counts every finalized day from
// the day the episode was created. Not found: "<id> ep:none checked:<date>", looked up again after 3 days.
// Up to LOOKUPS_PER_RUN lookups a run (stopping after LOOKUP_MS), newest rows first, about one a second
// (Megaphone allows 60 a minute). The first runs work through the backlog of older videos; after that a
// day needs a few dozen.
//
// Days the bucket lacks (24 to 28 Sep 2026, asked of Megaphone) are not counted; a hand refresh covers them.

import zlib from "node:zlib";
import { monday } from "./monday.js";
import { megaphoneToken } from "./megaphone.js";
import { s3Client } from "./s3.js";

export const BUCKET = "dft-megaphone-metrics-export", REGION = "us-west-1";
const SUB_BOARD = 6162879732;
const C = { urls: "text_mm6aq9qp", detail: "long_text_mm7jfzzx", sp: "numeric_mm7j691z", ap: "numeric_mm7j7zbb", am: "numeric_mm7kryz6", ot: "numeric_mm7j74wv", src: "text_mm7j9va", live: "timerange_mm1m50vx", pub: "date_mm1mb38m" };
const K = ["sp", "ap", "am", "ot"];
const ID_RE = /(?:v=|youtu\.be\/|shorts\/|live\/|embed\/)([A-Za-z0-9_-]{11})/g;
// The same line as reach-apply.js and campaigns/load.js read (they match the start and ignore the rest).
const LINE_RE = /^([A-Za-z0-9_-]{11})\s+ep:(\S+)\s+sp:(\d+)\s+ap:(\d+)\s+am:(\d+)\s+ot:(\d+)(?:\s+by:(\w+))?(?:.*?\sbase:(\d{4}-\d\d-\d\d):(\d+)\/(\d+)\/(\d+)\/(\d+))?/;
const NONE_RE = /^([A-Za-z0-9_-]{11})\s+ep:none\s+checked:(\d{4}-\d\d-\d\d)/;
const D = 864e5;
const day = s => new Date(String(s).slice(0, 10) + "T00:00:00Z").getTime();
const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
const fmt = s => new Date(day(s)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
export const LOOKUPS_PER_RUN = 150, LOOKUP_MS = 180000, RECHECK_DAYS = 3, NEW_VIDEO_DAYS = 90, MAX_READ_DAYS = 120, STALE_DAYS = 2;

export function appOf(ua) {
  const u = String(ua || "");
  if (/^spotify/i.test(u)) return "sp";
  if (/^apple podcasts/i.test(u)) return "ap";
  if (/amazon|alexa/i.test(u)) return "am";
  return "ot";
}

// One day's file (JSON lines) -> { episodeId: { sp, ap, am, ot } }
export function countDay(text) {
  const out = {}, seen = new Set();
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch (e) { continue; }
    if (!r || !r.episode_id || r.blacklisted_ip === true || r.blacklisted_ua === true) continue;
    const key = r.ip ? r.episode_id + "|" + r.ip + "|" + (r.user_agent || r.normalized_user_agent || "") : "";
    if (key) { if (seen.has(key)) continue; seen.add(key); }
    const e = out[r.episode_id] = out[r.episode_id] || { sp: 0, ap: 0, am: 0, ot: 0 };
    e[appOf(r.normalized_user_agent)]++;
  }
  return out;
}

// Keys in the bucket -> finalized days, oldest first: [{ date, key }]
export function finalizedDays(keys) {
  const files = {}, done = new Set();
  for (const k of keys) {
    let m = k.match(/^delivery-v2-day-(\d{4}-\d\d-\d\d)\.json\.gz$/); if (m) files[m[1]] = k;
    m = k.match(/^_finalized_delivery_(\d{4})_(\d\d)_(\d\d)(?:_|$)/); if (m) done.add(m[1] + "-" + m[2] + "-" + m[3]);
  }
  return Object.keys(files).filter(d => done.has(d)).sort().map(d => ({ date: d, key: files[d] }));
}

// Megaphone episode ids are time-based (UUID version 1): the day the episode was created, or "".
export function createdDay(ep) {
  const m = String(ep).match(/^([0-9a-f]{8})-([0-9a-f]{4})-1([0-9a-f]{3})-/i);
  if (!m) return "";
  const t = (BigInt("0x" + m[3]) << 48n) | (BigInt("0x" + m[2]) << 32n) | BigInt("0x" + m[1]);
  const ms = Number(t / 10000n) - 12219292800000;
  return ms > day("2015-01-01") && ms < Date.now() + 2 * D ? isoDay(ms) : "";
}

// One row's REACH DETAIL -> { asOf, lines: { vid: { ep, by, sp, ap, am, ot, base } }, none: { vid: date } }
export function parseDetail(text) {
  const t = String(text || ""), lines = {}, none = {};
  const asOf = (t.match(/^as of (\d{4}-\d\d-\d\d)/) || [])[1] || "";
  for (const raw of t.split("\n")) {
    const s = raw.trim(); let m = s.match(LINE_RE);
    if (m) {
      const cur = { sp: +m[3], ap: +m[4], am: +m[5], ot: +m[6] };
      lines[m[1]] = { ep: m[2], by: m[7] || "id", ...cur,
        base: m[8] ? { date: m[8], sp: +m[9], ap: +m[10], am: +m[11], ot: +m[12] } : (asOf ? { date: asOf, ...cur } : null) };
      continue;
    }
    m = s.match(NONE_RE); if (m) none[m[1]] = m[2];
  }
  return { asOf, lines, none };
}

// Can this line be counted from the export? (several episodes added by hand, or no date: keep as it is)
const countable = l => !!(l && l.base && !/\+/.test(l.ep));

// Lifetime figures for a line: its base plus every counted day after the base date. Never below the old figures.
export function lifetime(line, counts) {
  if (!countable(line)) return { sp: line.sp, ap: line.ap, am: line.am, ot: line.ot };
  const out = { sp: line.base.sp, ap: line.base.ap, am: line.base.am, ot: line.base.ot };
  for (const c of counts) if (c.date > line.base.date) { const e = c.eps[line.ep]; if (e) for (const k of K) out[k] += e[k]; }
  for (const k of K) out[k] = Math.max(out[k], line[k] || 0);
  return out;
}

// A line as written. The base token is kept only while its date is later than the row's "as of" date.
export const lineText = (v, l, asOf) => v + " ep:" + l.ep + " sp:" + l.sp + " ap:" + l.ap + " am:" + l.am + " ot:" + l.ot + " by:" + l.by +
  (l.base && asOf && l.base.date > asOf ? " base:" + l.base.date + ":" + K.map(k => l.base[k]).join("/") : "");

async function loadRows(token) {
  const ids = JSON.stringify(Object.values(C));
  const fields = "cursor items { id name column_values(ids:" + ids + ") { id text } }";
  let d = await monday(token, "query { boards(ids:[" + SUB_BOARD + "]) { items_page(limit:500, query_params:{rules:[{column_id:\"" + C.urls + "\", compare_value:[], operator:is_not_empty}]}) { " + fields + " } } }");
  let page = d.boards[0].items_page, items = page.items.slice(), guard = 0;
  while (page.cursor && guard++ < 10) { d = await monday(token, "query { next_items_page(limit:500, cursor:\"" + page.cursor + "\") { " + fields + " } }"); page = d.next_items_page; items = items.concat(page.items); }
  return items.map(it => { const o = { id: it.id, name: it.name }; for (const c of it.column_values) o[c.id] = c.text || ""; return o; });
}

async function mondayVars(token, query, variables) {
  const r = await fetch("https://api.monday.com/v2", { method: "POST", headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" }, body: JSON.stringify({ query, variables }) });
  const d = await r.json();
  if (!r.ok || (d && d.errors)) throw new Error("monday: " + JSON.stringify((d && d.errors) || r.status).slice(0, 300));
  return d.data;
}

// The Megaphone episode stamped yt-<id>, or "" (none, or more than one: no guess).
async function episodeFor(mTok, vid) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch("https://cms.megaphone.fm/api/search/episodes?externalId=yt-" + encodeURIComponent(vid), { headers: { Authorization: 'Token token="' + mTok + '"', Accept: "application/json" }, signal: ctl.signal });
    if (!r.ok) throw new Error("Megaphone " + r.status);
    const j = await r.json();
    const eps = (Array.isArray(j) ? j : []).filter(e => e && e.id && (e.externalId == null || e.externalId === "yt-" + vid));
    return eps.length === 1 ? String(eps[0].id) : "";
  } finally { clearTimeout(t); }
}

// The whole run. opts: { dry, now, s3, lookup, write (test doubles), lookupMs }
export async function syncPodcastExport(token, opts) {
  opts = opts || {};
  const t0 = Date.now(), now = opts.now || Date.now(), today = isoDay(now), lookupMs = opts.lookupMs || LOOKUP_MS;
  const summary = { pass: "podcast-export", dry: !!opts.dry, lastDay: "", finalizedDays: 0, daysRead: 0, rows: 0, videos: 0, lines: 0, linesInExport: 0, raised: 0, newMatches: 0, notFound: 0, lookups: 0, changed: 0, errors: [] };
  const keyId = process.env.MEGAPHONE_EXPORT_KEY_ID, secret = process.env.MEGAPHONE_EXPORT_SECRET;
  const s3 = opts.s3 || (keyId && secret ? s3Client({ bucket: BUCKET, region: REGION, keyId, secret }) : null);
  if (!s3) { summary.error = "Setup: the Vercel variables MEGAPHONE_EXPORT_KEY_ID and MEGAPHONE_EXPORT_SECRET are not set"; return summary; }

  // 1. Which days are complete.
  const days = finalizedDays(await s3.list(""));
  summary.finalizedDays = days.length;
  if (!days.length) { summary.error = "no finalized delivery files in " + BUCKET; return summary; }
  const lastDay = summary.lastDay = days[days.length - 1].date;
  // Normally the newest day is yesterday. Two days later than that is a real problem: the watchdog alerts the next morning.
  if (day(lastDay) < day(today) - STALE_DAYS * D) { summary.failed = true; summary.errors.push("export stale: the newest finalized day is " + lastDay + " (Megaphone may have stopped the export, or the files are late)"); }

  // 2. Campaign rows, and Megaphone lookups for videos with no line yet (newest rows first).
  const rows = await loadRows(token);
  summary.rows = rows.length;
  const parsed = rows.map(r => ({ r, vids: [...new Set([...String(r[C.urls]).matchAll(ID_RE)].map(m => m[1]))], det: parseDetail(r[C.detail]),
    when: day(r[C.pub] || String(r[C.live]).slice(0, 10)) || 0 })); // 0: no date on the row
  const want = [];
  for (const p of parsed) for (const v of p.vids) {
    if (p.det.lines[v]) continue;
    const checked = p.det.none[v];
    if (checked && day(checked) > now - RECHECK_DAYS * D) continue;
    if (p.when && p.when < now - NEW_VIDEO_DAYS * D) continue; // rows with no date are still looked up (TRR rows often have none)
    want.push({ p, v });
  }
  want.sort((a, b) => (b.p.when || 1) - (a.p.when || 1)); // newest first, undated last
  summary.toLookUp = want.length;
  const found = {}; let mTok = null;
  const lookup = opts.lookup || (async v => {
    if (mTok === null) mTok = await megaphoneToken(token);
    if (!mTok) throw new Error("no Megaphone token on monday");
    await new Promise(res => setTimeout(res, 1100));
    return episodeFor(mTok, v);
  });
  for (const { v } of want) {
    if (found[v] !== undefined) continue;
    if (summary.lookups >= LOOKUPS_PER_RUN) break;
    if (Date.now() - t0 > lookupMs) break; // the rest wait for the next run (counted in lookupsLeft, not an error)
    try { found[v] = await lookup(v); summary.lookups++; }
    catch (e) { summary.errors.push("lookup " + v + ": " + String(e.message || e).slice(0, 80)); if (/429|token/i.test(String(e.message))) break; }
  }

  summary.lookupsLeft = Math.max(0, new Set(want.map(w => w.v)).size - Object.keys(found).length);

  // 3. Read the days the lines need (after the oldest base date, at most MAX_READ_DAYS back).
  const newBase = ep => { const c = createdDay(ep); return { date: c ? isoDay(day(c) - D) : "2000-01-01", sp: 0, ap: 0, am: 0, ot: 0 }; };
  let from = lastDay;
  for (const p of parsed) for (const v of p.vids) {
    const l = p.det.lines[v];
    if (countable(l) && l.base.date < from) from = l.base.date;
    if (!l && found[v]) { const b = newBase(found[v]).date; if (b < from) from = b; }
  }
  const floor = isoDay(day(lastDay) - MAX_READ_DAYS * D);
  if (from < floor) from = floor;
  const need = days.filter(d => d.date > from);
  const counts = [];
  for (let i = 0; i < need.length; i += 6) {
    counts.push(...await Promise.all(need.slice(i, i + 6).map(async d => ({ date: d.date, eps: countDay(zlib.gunzipSync(await s3.getBuffer(d.key)).toString("utf8")) }))));
  }
  summary.daysRead = counts.length; summary.readFrom = need.length ? need[0].date : "";
  const inExport = new Set(); for (const c of counts) for (const e in c.eps) inExport.add(e);

  // 4. New figures, row by row.
  const plans = [];
  for (const p of parsed) {
    const lines = {}, none = {};
    for (const v of p.vids) {
      summary.videos++;
      const old = p.det.lines[v];
      if (old) {
        summary.lines++; if (inExport.has(old.ep)) summary.linesInExport++;
        const f = lifetime(old, counts);
        if (K.some(k => f[k] > old[k])) summary.raised++;
        lines[v] = { ep: old.ep, by: old.by, ...f, base: countable(old) && old.base.date > lastDay ? old.base : null };
        continue;
      }
      if (found[v]) {
        const base = newBase(found[v]);
        lines[v] = { ep: found[v], by: "export", ...lifetime({ ep: found[v], base, sp: 0, ap: 0, am: 0, ot: 0 }, counts), base: null };
        summary.newMatches++; continue;
      }
      if (found[v] === "") { none[v] = today; summary.notFound++; continue; }
      if (p.det.none[v]) none[v] = p.det.none[v];
    }
    if (!Object.keys(lines).length && !Object.keys(none).length) continue;
    const sum = { sp: 0, ap: 0, am: 0, ot: 0 };
    for (const l of Object.values(lines)) for (const k of K) sum[k] += l[k];
    for (const k of K) { const was = parseFloat(p.r[C[k]]); if (Number.isFinite(was)) sum[k] = Math.max(sum[k], was); }
    const body = Object.entries(lines).map(([v, l]) => lineText(v, l, lastDay)).concat(Object.entries(none).map(([v, d]) => v + " ep:none checked:" + d)).join("\n");
    const oldBody = String(p.r[C.detail]).replace(/^as of [^\n]*\n?/, "").trim();
    const hasLines = Object.keys(lines).length > 0; // a row with only "ep:none" lines keeps its listen columns as they are
    if (oldBody === body.trim() && (!hasLines || K.every(k => parseFloat(p.r[C[k]]) === sum[k]))) continue;
    const detail = "as of " + lastDay + " (Spotify and apps, from the Megaphone export, daily; figures only rise)\n" + body;
    const vals = { [C.detail]: { text: detail } };
    if (hasLines) Object.assign(vals, { [C.sp]: String(sum.sp), [C.ap]: String(sum.ap), [C.am]: String(sum.am), [C.ot]: String(sum.ot), [C.src]: "Spotify and apps " + fmt(lastDay) + " (Megaphone export)" });
    plans.push({ id: p.r.id, name: p.r.name, sum, vals });
  }
  summary.changed = plans.length;
  summary.writes = plans.slice(0, 30).map(p => p.id + " " + p.name + " sp " + p.sum.sp + " ap " + p.sum.ap + " am " + p.sum.am + " ot " + p.sum.ot);
  if (opts.dry || !plans.length) { summary.ms = Date.now() - t0; return summary; }

  // 5. Write: 10 rows a request, 5 requests at a time (as the view sync and the hand refresh do).
  const write = opts.write || (async b => {
    const q = "mutation (" + b.map((_, i) => "$v" + i + ": JSON!").join(", ") + ") { " + b.map((p, i) => "r" + i + ": change_multiple_column_values(board_id:" + SUB_BOARD + ", item_id:" + p.id + ", column_values:$v" + i + ") { id }").join(" ") + " }";
    const vars = {}; b.forEach((p, i) => { vars["v" + i] = JSON.stringify(p.vals); });
    await mondayVars(token, q, vars);
  });
  const failed = [];
  const one = async b => {
    try { await write(b); }
    catch (e) { for (const p of b) { try { await write([p]); } catch (e2) { failed.push(p.id + ": " + String(e2.message || e2).slice(0, 100)); } } }
  };
  const batches = []; for (let i = 0; i < plans.length; i += 10) batches.push(plans.slice(i, i + 10));
  for (let i = 0; i < batches.length; i += 5) await Promise.all(batches.slice(i, i + 5).map(one));
  if (failed.length) { summary.failedRows = failed.slice(0, 20); summary.errors.push(failed.length + " of " + plans.length + " rows failed to write"); }
  summary.written = plans.length - failed.length;
  summary.ms = Date.now() - t0;
  return summary;
}
