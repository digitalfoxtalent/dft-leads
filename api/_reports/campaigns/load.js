// Campaign reach: every brand campaign's lifetime views and listens. READ ONLY.
//
// WHERE THE NUMBERS COME FROM
// - Campaign rows, creators, videos, guarantees and YouTube views: monday, read live from
//   US Campaigns 6162879609 and its subitems 6162879732 (cached 10 minutes). YouTube views
//   are LATEST VIEWS, written daily by api/view-count-sync.js.
// - Spotify, Apple Podcasts, Amazon Music and other apps (delivered through Megaphone): each
//   creator row's REACH DETAIL column on monday (long_text_mm7jfzzx), one line per video, written
//   by the Reporting refresh task (a hand-run scheduled task) until an automatic feed exists:
//     as of 2026-09-27 ...
//     <youtube id> ep:<megaphone episode id> sp:<Spotify> ap:<Apple> am:<Amazon> ot:<other apps> by:<id|title>
// - TikTok and Instagram: TIKTOK VIEWS and INSTAGRAM VIEWS (numeric_mm7khyj1, numeric_mm7k2ver), written
//   daily by the social sync (_reports/social.js) for the TikTok / Instagram posts in LIVE VIDEO URLS.
//   Videos with no line there fall back to the dated snapshot in ./podcast.js (26 Sep 2026).
//
// IF MONDAY CANNOT BE READ
// The page still renders. It shows the last good live read this server instance holds, or
// failing that the saved copy in ./snapshot.js, and says when those figures were updated.
// A read with fewer than 80% of the saved rows counts as a failure, never as the truth.

import { monday } from "../monday.js";
import { TEMPLATE } from "./page.js";
import { PODCAST, PODCAST_AS_OF } from "./podcast.js";
import { SNAPSHOT } from "./snapshot.js";

import { AVATARS } from "./avatars.js";
import { PARTNERS } from "../partners.js";
import { parseSocial } from "../social.js";
const SUB_BOARD = 6162879732;
const SUB_COLS = ["connect_boards__1", "text_mm6aq9qp", "date_mm1mb38m", "numeric_mm4bn6yq", "numeric_mm3yxqes", "numeric_mm4b44ta", "color_mm41rsrc", "numeric_mm3vg42g", "timerange_mm1m50vx", "dropdown_mm7jd5dk", "long_text_mm7jfzzx", "numeric_mm7khyj1", "numeric_mm7k2ver", "long_text_mm7kw197"];
const PAR_COLS = ["dropdown_mm1a3tqp", "connect_boards", "deal_value", "status_1", "date__1", "deal_owner", "lookup_mkz6pygk", "lookup_mm5zp13v"]; // the last two: CLIENT (from CONTACTS) and QB Customer mirrors
const CACHE_MS = 10 * 60 * 1000;
let cache = null;    // { at, payload } - what we serve next
let lastGood = null; // the last successful live payload on this instance
let lastError = null; // why the last live read failed, for /status

let avatarCache = { at: 0, map: {} }; // handle (lower case) -> channel picture url, refreshed daily
const AVATAR_MS = 24 * 60 * 60 * 1000;
let apiOffUntil = 0; // when the YouTube API allowance is used up, skip it until the next reset

// Creator pictures, in three layers so the rail never falls back to letters:
//   1. AVATARS (avatars.js): a saved copy of every roster picture, always available.
//   2. The YouTube Data API (1 unit per handle) for newer or changed pictures.
//   3. If the API allowance is used up, the channel's public page (its og:image), which uses no allowance.
// Everything is capped at 5 seconds and any failure keeps the saved picture.
async function viaApi(h, key) {
  if (!key || Date.now() < apiOffUntil) return null;
  const r = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&forHandle=" + encodeURIComponent(h) + "&key=" + key);
  const d = await r.json();
  if (r.status === 403) { const n = new Date(); n.setUTCHours(7, 5, 0, 0); if (n <= new Date()) n.setUTCDate(n.getUTCDate() + 1); apiOffUntil = n.getTime(); return null; }
  const th = d && d.items && d.items[0] && d.items[0].snippet && d.items[0].snippet.thumbnails;
  return (th && ((th.medium && th.medium.url) || (th.default && th.default.url))) || null;
}
async function viaPage(h) {
  const r = await fetch("https://www.youtube.com/" + encodeURIComponent(h).replace("%40", "@"), { headers: { "Accept-Language": "en-US,en;q=0.9", "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36" } });
  if (!r.ok) return null;
  const t = await r.text();
  const m = t.match(/<meta property="og:image" content="([^"]+)"/);
  return m && /^https:\/\/yt\d\.(ggpht|googleusercontent)\.com\//.test(m[1]) ? m[1].replace(/=s\d+-/, "=s176-") : null;
}
export async function loadAvatars(handles) {
  const key = process.env.YOUTUBE_API_KEY;
  const fresh = Date.now() - avatarCache.at < AVATAR_MS;
  const valid = handles.filter(h => /^@[A-Za-z0-9._-]{2,40}$/.test(h));
  const want = valid.filter(h => !fresh || !(h.toLowerCase() in avatarCache.map));
  const merged = () => Object.assign({}, AVATARS, avatarCache.map);
  if (!want.length) return merged();
  const one = async h => {
    let u = null;
    try { u = await viaApi(h, key); } catch (e) {}
    if (!u) { try { u = await viaPage(h); } catch (e) {} }
    return [h.toLowerCase(), u];
  };
  const timeout = new Promise(res => setTimeout(() => res(null), 5000));
  const got = await Promise.race([Promise.all(want.map(one)), timeout]);
  if (got) {
    const map = fresh ? Object.assign({}, avatarCache.map) : {};
    for (const [h, u] of got) if (u) map[h] = u;
    avatarCache = { at: fresh ? avatarCache.at : Date.now(), map };
  }
  return merged();
}

const ID_RE = [
  /(?:youtube\.com|youtube-nocookie\.com)\/watch\?(?:[^#\s]*&)?v=([A-Za-z0-9_-]{11})/,
  /youtu\.be\/([A-Za-z0-9_-]{11})/,
  /(?:youtube\.com|youtube-nocookie\.com)\/(?:shorts|live|embed|v)\/([A-Za-z0-9_-]{11})/,
];
function parseIds(text) {
  const v = [], k = [];
  for (const raw of String(text || "").split(",")) {
    const e = raw.trim(); if (!e) continue;
    for (const re of ID_RE) { const m = re.exec(e); if (m) { if (!v.includes(m[1])) { v.push(m[1]); k.push(e.includes("/shorts/") ? 1 : 0); } break; } }
  }
  return { v, k };
}
const cvMap = it => {
  const o = {};
  for (const c of it.column_values || []) o[c.id] = (c.display_value != null && c.display_value !== "") ? c.display_value : c.text;
  return o;
};
const num = x => { const n = parseFloat(x); return Number.isFinite(n) ? n : null; };
const DETAIL_RE = /^([A-Za-z0-9_-]{11})\s+ep:(\S+)\s+sp:(\d+)\s+ap:(\d+)\s+am:(\d+)\s+ot:(\d+)(?:\s+by:(\w+))?/;
// One row's REACH DETAIL -> { asOf, vids: { youtubeId: { t, s, a, am, o, m, e } } }
function parseDetail(text) {
  const out = { asOf: "", vids: {} };
  const m0 = String(text || "").match(/as of (\d{4}-\d{2}-\d{2})/); if (m0) out.asOf = m0[1];
  for (const line of String(text || "").split(/\n/)) {
    const m = line.trim().match(DETAIL_RE); if (!m) continue;
    const [s, a, am, o] = [m[3], m[4], m[5], m[6]].map(Number);
    out.vids[m[1]] = { t: s + a + am + o, s, a, am, o, m: m[7] === "title" ? "t" : "i", e: m[2] };
  }
  return out;
}


async function loadLive(token) {
  const sc = JSON.stringify(SUB_COLS), pc = JSON.stringify(PAR_COLS);
  const fields = "cursor items { id name parent_item { id } column_values(ids:" + sc + ") { id text ... on BoardRelationValue { display_value } } }";
  let d = await monday(token, "query { boards(ids:[" + SUB_BOARD + "]) { items_page(limit:500, query_params:{rules:[{column_id:\"text_mm6aq9qp\", compare_value:[], operator:is_not_empty}]}) { " + fields + " } } }");
  let page = d.boards[0].items_page, subs = page.items.slice(), guard = 0;
  while (page.cursor && guard++ < 10) {
    d = await monday(token, "query { next_items_page(limit:500, cursor:\"" + page.cursor + "\") { " + fields + " } }");
    page = d.next_items_page; subs = subs.concat(page.items);
  }
  const pids = [...new Set(subs.map(s => s.parent_item && s.parent_item.id).filter(Boolean))];
  const chunks = []; for (let i = 0; i < pids.length; i += 100) chunks.push(pids.slice(i, i + 100));
  const parts = await Promise.all(chunks.map(ids => monday(token,
    "query { items(ids:[" + ids.join(",") + "], limit:100) { id name group { title } column_values(ids:" + pc + ") { id text ... on BoardRelationValue { display_value } ... on MirrorValue { display_value } } } }")));
  const pars = {};
  parts.forEach(p => (p.items || []).forEach(it => {
    const c = cvMap(it);
    pars[it.id] = { n: it.name, grp: it.group && it.group.title, b: c.dropdown_mm1a3tqp || String(it.name).split(/[_ ]/)[0],
      cl: [...new Set([c.connect_boards, c.lookup_mkz6pygk, c.lookup_mm5zp13v].flatMap(x => String(x || "").split(/,\s*/)).filter(Boolean))].join(", "), val: c.deal_value ? parseFloat(c.deal_value) : null, st: c.status_1 || "", cd: c.date__1 || "", own: c.deal_owner || "" };
  }));
  const byC = {}; let rows = 0; const pod = {}; let podAsOf = "";
  for (const s of subs) {
    const pid = s.parent_item && s.parent_item.id; if (!pid || !pars[pid]) continue;
    const c = cvMap(s), ids = parseIds(c.text_mm6aq9qp), sv = parseSocial(c.text_mm6aq9qp).map(x => [x.p, x.url]); if (!ids.v.length && !sv.length) continue;
    const det = parseDetail(c.long_text_mm7jfzzx);
    if (Object.keys(det.vids).length) { Object.assign(pod, det.vids); if (det.asOf > podAsOf) podAsOf = det.asOf; }
    const cc = byC[pid] = byC[pid] || Object.assign({ id: pid, r: [] }, pars[pid]);
    cc.r.push({ id: s.id, h: c.connect_boards__1 || "", nm: s.name, p: c.date_mm1mb38m || "", y: num(c.numeric_mm4bn6yq),
      d30: num(c.numeric_mm4b44ta), g: num(c.numeric_mm3yxqes), lk: c.color_mm41rsrc || "", v: ids.v, k: ids.k,
      gr: num(c.numeric_mm3vg42g), ld: String(c.timerange_mm1m50vx || "").slice(0, 10), cg: c.dropdown_mm7jd5dk || "",
      tt: num(c.numeric_mm7khyj1), ig: num(c.numeric_mm7k2ver), sv, at: c.long_text_mm7kw197 || "" });
    rows++;
  }
  return { c: Object.values(byC), rows, pod, podAsOf };
}

// Who is on the signed roster: the active groups of the Global Talent Roster 6160485039
// (Youtube Long Form, Short Form, Need to set up with Suppliers), or Contract Status "Signed".
// Keyed by the GTR row name, which is what the campaign rows' roster link shows. Cached an hour.
const GTR_BOARD = 6160485039;
const ROSTER_GROUPS = new Set(["youtube long form", "short form", "need to set up with suppliers"]);
let rosterCache = { at: 0, map: null };
async function loadRoster(token) {
  if (rosterCache.map && Date.now() - rosterCache.at < 60 * 60 * 1000) return rosterCache.map;
  const d = await monday(token, "query { boards(ids:[" + GTR_BOARD + "]) { items_page(limit:500) { items { name group { title } column_values(ids:[\"color_mm6cgavk\",\"text_mm6nqp7b\"]) { id text } } } } }");
  const map = {};
  for (const it of d.boards[0].items_page.items) {
    const cv = {}; for (const c of it.column_values) cv[c.id] = c.text || "";
    const signed = ROSTER_GROUPS.has(String(it.group && it.group.title || "").toLowerCase()) || cv.color_mm6cgavk === "Signed";
    for (const k of [it.name, cv.text_mm6nqp7b]) if (k) { const key = String(k).toLowerCase().trim(); map[key] = map[key] || signed; }
  }
  rosterCache = { at: Date.now(), map };
  return map;
}

const stamp = d => d.toLocaleString("en-US", { timeZone: "America/Denver", hour: "numeric", minute: "2-digit", month: "short", day: "numeric" }) + " MT";

async function getPayload(token) {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.payload;
  const snapRows = SNAPSHOT.c.reduce((s, c) => s + c.r.length, 0);
  const now = new Date();
  const base = { now: now.toISOString(), pod: PODCAST, podAsOf: PODCAST_AS_OF, multi: {} };
  let payload;
  try {
    const live = await loadLive(token);
    if (live.rows < snapRows * 0.8) throw new Error("short read: " + live.rows + " rows against " + snapRows + " saved");
    payload = Object.assign(base, { c: live.c, source: "live", asOf: now.toISOString().slice(0, 10), fetchedAt: stamp(now),
      pod: Object.assign({}, PODCAST, live.pod), podAsOf: live.podAsOf || PODCAST_AS_OF });
    lastGood = payload;
    cache = { at: Date.now(), payload };
  } catch (e) {
    lastError = { at: new Date().toISOString(), message: String(e && e.message || e).slice(0, 400) };
    console.error("reports/campaigns: live monday read failed:", e && e.message || e);
    payload = lastGood
      ? Object.assign({}, lastGood, { now: now.toISOString(), source: "stale" })
      : Object.assign(base, { c: SNAPSHOT.c, source: "stale", asOf: SNAPSHOT.asOf, fetchedAt: SNAPSHOT.asOf });
    cache = { at: Date.now() - CACHE_MS + 60 * 1000, payload }; // try monday again in a minute
  }
  return payload;
}

export const campaignPayload = token => getPayload(token);

export async function renderCampaigns(token) {
  const payload = await getPayload(token);
  const handles = [...new Set(payload.c.flatMap(c => c.r.map(r => r.h)).filter(Boolean))];
  const [avatars, roster] = await Promise.all([loadAvatars(handles).catch(() => Object.assign({}, AVATARS)), loadRoster(token).catch(() => null)]);
  const json = JSON.stringify(Object.assign({}, payload, { avatars, roster })).replace(/</g, "\\u003c");
  return TEMPLATE.replace("__DATA__", () => json);
}

// A partner's own view: only its campaigns, and nothing internal. Everything is removed here,
// on the server, so none of it reaches the partner's browser.
export async function renderPartner(token, id) {
  const P = PARTNERS[id]; if (!P) return null;
  const payload = await getPayload(token);
  const c = payload.c.filter(x => P.match.test(x.cl || "")).map(x => ({
    id: x.id, n: x.n, grp: x.grp, b: x.b, cl: P.name, val: null, st: "", cd: x.cd, own: "",
    r: x.r.map(r => ({ id: r.id, h: r.h, nm: r.nm, p: r.p, y: r.y, d30: r.d30, g: r.g, lk: "", v: r.v, k: r.k, gr: null, ld: r.ld, cg: r.cg, tt: r.tt, ig: r.ig, sv: r.sv, at: r.at })),
  }));
  const vids = new Set(c.flatMap(x => x.r.flatMap(r => r.v)));
  const pod = {}; for (const v in (payload.pod || {})) if (vids.has(v)) pod[v] = payload.pod[v];
  const handles = [...new Set(c.flatMap(x => x.r.map(r => r.h)).filter(Boolean))];
  const avatars = await loadAvatars(handles).catch(() => Object.assign({}, AVATARS));
  const av = {}; for (const h of handles) { const u = avatars[h.toLowerCase()]; if (u) av[h.toLowerCase()] = u; }
  const out = { now: payload.now, pod, podAsOf: payload.podAsOf, multi: {}, c, source: payload.source, asOf: payload.asOf, fetchedAt: payload.fetchedAt, avatars: av, roster: null, partner: { id, name: P.name } };
  const json = JSON.stringify(out).replace(/</g, "\\u003c");
  return TEMPLATE.replace("__DATA__", () => json).replace("<title>DFT Campaign Reach</title>", "<title>" + P.name + " campaign reach</title>");
}

// For /status: try a live read now and report what happened, without the data itself.
export async function campaignsHealth(token) {
  const t0 = Date.now();
  try {
    const live = await loadLive(token);
    const snapRows = SNAPSHOT.c.reduce((s, c) => s + c.r.length, 0);
    return { ok: live.rows >= snapRows * 0.8, rows: live.rows, savedRows: snapRows, campaigns: live.c.length, ms: Date.now() - t0, lastError };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: String(e && e.message || e).slice(0, 400), lastError };
  }
}
