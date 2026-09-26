// Campaign reach: every brand campaign's lifetime views and listens. READ ONLY.
//
// WHERE THE NUMBERS COME FROM
// - Campaign rows, creators, videos, guarantees and YouTube views: monday, read live from
//   US Campaigns 6162879609 and its subitems 6162879732 (cached 10 minutes). YouTube views
//   are LATEST VIEWS, written daily by api/view-count-sync.js.
// - Podcast listens: a dated Megaphone snapshot in ./podcast.js until the daily Megaphone
//   collector writes them to monday columns.
//
// IF MONDAY CANNOT BE READ
// The page still renders. It shows the last good live read this server instance holds, or
// failing that the saved copy in ./snapshot.js, and says when those figures were updated.
// A read with fewer than 80% of the saved rows counts as a failure, never as the truth.

import { monday } from "../monday.js";
import { TEMPLATE } from "./page.js";
import { PODCAST, PODCAST_AS_OF } from "./podcast.js";
import { SNAPSHOT } from "./snapshot.js";

const SUB_BOARD = 6162879732;
const SUB_COLS = ["connect_boards__1", "text_mm6aq9qp", "date_mm1mb38m", "numeric_mm4bn6yq", "numeric_mm3yxqes", "numeric_mm4b44ta", "color_mm41rsrc"];
const PAR_COLS = ["dropdown_mm1a3tqp", "connect_boards", "deal_value", "status_1", "date__1", "deal_owner"];
const CACHE_MS = 10 * 60 * 1000;
let cache = null;    // { at, payload } - what we serve next
let lastGood = null; // the last successful live payload on this instance

let avatarCache = { at: 0, map: {} }; // handle (lower case) -> channel picture url, refreshed daily
const AVATAR_MS = 24 * 60 * 60 * 1000;

// Creator pictures. One YouTube Data API call per handle (1 quota unit each), in parallel,
// capped at 5 seconds overall. Any failure just means lettered circles on the page;
// it never blocks or breaks the dashboard.
async function loadAvatars(handles) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return avatarCache.map;
  const fresh = Date.now() - avatarCache.at < AVATAR_MS;
  const want = handles.filter(h => /^@[A-Za-z0-9._-]{2,40}$/.test(h) && (!fresh || !(h.toLowerCase() in avatarCache.map)));
  if (!want.length) return avatarCache.map;
  const one = async h => {
    try {
      const r = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&forHandle=" + encodeURIComponent(h) + "&key=" + key);
      const d = await r.json();
      const th = d && d.items && d.items[0] && d.items[0].snippet && d.items[0].snippet.thumbnails;
      const url = th && ((th.medium && th.medium.url) || (th.default && th.default.url));
      return [h.toLowerCase(), url || null];
    } catch (e) { return [h.toLowerCase(), null]; }
  };
  const timeout = new Promise(res => setTimeout(() => res(null), 5000));
  const got = await Promise.race([Promise.all(want.map(one)), timeout]);
  if (got) {
    const map = fresh ? Object.assign({}, avatarCache.map) : {};
    for (const [h, u] of got) if (u) map[h] = u;
    avatarCache = { at: fresh ? avatarCache.at : Date.now(), map };
  }
  return avatarCache.map;
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
    "query { items(ids:[" + ids.join(",") + "]) { id name group { title } column_values(ids:" + pc + ") { id text ... on BoardRelationValue { display_value } } } }")));
  const pars = {};
  parts.forEach(p => (p.items || []).forEach(it => {
    const c = cvMap(it);
    pars[it.id] = { n: it.name, grp: it.group && it.group.title, b: c.dropdown_mm1a3tqp || String(it.name).split(/[_ ]/)[0],
      cl: c.connect_boards || "", val: c.deal_value ? parseFloat(c.deal_value) : null, st: c.status_1 || "", cd: c.date__1 || "", own: c.deal_owner || "" };
  }));
  const byC = {}; let rows = 0;
  for (const s of subs) {
    const pid = s.parent_item && s.parent_item.id; if (!pid || !pars[pid]) continue;
    const c = cvMap(s), ids = parseIds(c.text_mm6aq9qp); if (!ids.v.length) continue;
    const cc = byC[pid] = byC[pid] || Object.assign({ id: pid, r: [] }, pars[pid]);
    cc.r.push({ id: s.id, h: c.connect_boards__1 || "", nm: s.name, p: c.date_mm1mb38m || "", y: num(c.numeric_mm4bn6yq),
      d30: num(c.numeric_mm4b44ta), g: num(c.numeric_mm3yxqes), lk: c.color_mm41rsrc || "", v: ids.v, k: ids.k });
    rows++;
  }
  return { c: Object.values(byC), rows };
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
    payload = Object.assign(base, { c: live.c, source: "live", asOf: now.toISOString().slice(0, 10), fetchedAt: stamp(now) });
    lastGood = payload;
    cache = { at: Date.now(), payload };
  } catch (e) {
    console.error("reports/campaigns: live monday read failed:", e && e.message || e);
    payload = lastGood
      ? Object.assign({}, lastGood, { now: now.toISOString(), source: "stale" })
      : Object.assign(base, { c: SNAPSHOT.c, source: "stale", asOf: SNAPSHOT.asOf, fetchedAt: SNAPSHOT.asOf });
    cache = { at: Date.now() - CACHE_MS + 60 * 1000, payload }; // try monday again in a minute
  }
  return payload;
}

export async function renderCampaigns(token) {
  const payload = await getPayload(token);
  const handles = [...new Set(payload.c.flatMap(c => c.r.map(r => r.h)).filter(Boolean))];
  const avatars = await loadAvatars(handles).catch(() => ({}));
  const json = JSON.stringify(Object.assign({}, payload, { avatars })).replace(/</g, "\\u003c");
  return TEMPLATE.replace("__DATA__", () => json);
}
