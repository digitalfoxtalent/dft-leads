// Campaign Reach dashboard - every brand campaign's lifetime views and listens.
// Built 26 Sep 2026 for Tom. READ ONLY: this function never writes to monday.
//
// WHERE THE NUMBERS COME FROM
// - Campaign rows, creators, videos, guarantees and YouTube views: monday, read live
//   on each (cached) request from US Campaigns 6162879609 and its subitems 6162879732.
//   YouTube views are LATEST VIEWS, written daily by api/view-count-sync.js.
// - Podcast listens: a dated Megaphone snapshot in ./_reach/podcast.js (lifetime
//   delivery per campaign video, matched by YouTube id or exact title). Replace that
//   file, or move the figures onto monday columns, to refresh it.
//
// ROBUSTNESS RULES
// 1. It always renders. If monday fails, or returns fewer than 80% of the rows in the
//    saved copy (./_reach/snapshot.js), the saved copy is shown with a visible badge.
//    A short read is treated as a fault, never as the truth.
// 2. Read only. The monday token is used for queries, never mutations.
// 3. Private. Access is by team link: /api/campaign-reach?k=<key> sets a 90-day
//    HttpOnly cookie and redirects to the clean URL. Only the SHA-256 of the key is in
//    this file. To revoke every link, change KEY_SHA256 and share the new link.
//    Unknown hosts get a 404, like api/roster.js.

import crypto from "node:crypto";
import { TEMPLATE } from "./_reach/page.js";
import { PODCAST, PODCAST_AS_OF } from "./_reach/podcast.js";
import { SNAPSHOT } from "./_reach/snapshot.js";

export const config = { maxDuration: 60 };

const HOSTS = new Set([
  "roster-viewguarantee.digitalfoxtalent.com",
  "reach.digitalfoxtalent.com",
  "dft-leads.vercel.app",
]);
const KEY_SHA256 = "3a1334ac1b147ed68598623dd15de31332e44bdc0b977419bd621ee32d027e7c";
const COOKIE = "dft_reach";
const COOKIE_DAYS = 90;
const SUB_BOARD = 6162879732;
const SUB_COLS = ["connect_boards__1", "text_mm6aq9qp", "date_mm1mb38m", "numeric_mm4bn6yq", "numeric_mm3yxqes", "numeric_mm4b44ta", "color_mm41rsrc"];
const PAR_COLS = ["dropdown_mm1a3tqp", "connect_boards", "deal_value", "status_1", "date__1", "deal_owner"];
const CACHE_MS = 10 * 60 * 1000;
let cache = null; // { at, payload }
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

const hostOf = req => String((req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0])
  .toLowerCase().trim().replace(/^www\./, "").split(":")[0];
const isPreview = h => /^dft-leads-[a-z0-9-]+\.vercel\.app$/.test(h);

function sign(exp, secret) {
  return crypto.createHmac("sha256", secret + "|campaign-reach-v1").update(String(exp)).digest("base64url");
}
function readCookie(req) {
  const raw = String(req.headers.cookie || "");
  const m = raw.split(/;\s*/).find(p => p.startsWith(COOKIE + "="));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : "";
}
function cookieOk(req, secret) {
  const v = readCookie(req); const i = v.indexOf(".");
  if (i < 1) return false;
  const exp = Number(v.slice(0, i)); const sig = v.slice(i + 1);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const want = sign(exp, secret);
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}
function keyOk(k) {
  if (!k) return false;
  const h = crypto.createHash("sha256").update(String(k)).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(KEY_SHA256));
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

async function monday(token, query) {
  const r = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" },
    body: JSON.stringify({ query }),
  });
  const d = await r.json();
  if (!r.ok || (d && d.errors)) throw new Error("monday: " + JSON.stringify((d && d.errors) || r.status).slice(0, 300));
  return d.data;
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

async function getPayload(token) {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.payload;
  const snapRows = SNAPSHOT.c.reduce((s, c) => s + c.r.length, 0);
  const now = new Date();
  const base = { now: now.toISOString(), pod: PODCAST, podAsOf: PODCAST_AS_OF, multi: {} };
  let payload;
  try {
    const live = await loadLive(token);
    if (live.rows < snapRows * 0.8) throw new Error("short read: " + live.rows + " rows against " + snapRows + " saved");
    payload = Object.assign(base, { c: live.c, source: "live", asOf: now.toISOString().slice(0, 10),
      fetchedAt: now.toLocaleString("en-US", { timeZone: "America/Denver", hour: "numeric", minute: "2-digit", month: "short", day: "numeric" }) + " MT" });
    cache = { at: Date.now(), payload };
  } catch (e) {
    payload = Object.assign(base, { c: SNAPSHOT.c, source: "snapshot", asOf: SNAPSHOT.asOf,
      note: "Live monday data could not load just now, so the saved copy from " + SNAPSHOT.asOf + " is shown. It retries every minute." });
    console.error("campaign-reach: live monday load failed:", e && e.message || e);
    cache = { at: Date.now() - CACHE_MS + 60 * 1000, payload }; // retry after a minute
  }
  return payload;
}

const gate = () => '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>DFT Campaign Reach</title>' +
  '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F2F3F6;color:#3A3F49;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:24px}' +
  '@media (prefers-color-scheme:dark){body{background:#0E1014;color:#C8CCD4}h1{color:#F2F3F6!important}}' +
  'main{max-width:420px;text-align:center}h1{font-size:26px;color:#14161B;margin:14px 0 8px}.m{width:40px;height:40px;border-radius:10px;background:#FF8800;margin:0 auto}</style></head>' +
  '<body><main><div class="m"></div><h1>Campaign Reach</h1><p>This dashboard is for the Digital Fox Talent team. Open it with the team link Tom shared, and your browser will remember you for 90 days.</p></main></body></html>';

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  const host = hostOf(req);
  if (!HOSTS.has(host) && !isPreview(host)) return res.status(404).json({ error: "Not found" });
  const token = process.env.MONDAY_API_KEY || process.env.MONDAY_API_TOKEN;
  if (!token) return res.status(500).send("Setup error: monday token missing.");

  const k = req.query && req.query.k;
  if (k) {
    if (!keyOk(k)) { res.setHeader("Content-Type", "text/html; charset=utf-8"); return res.status(403).send(gate()); }
    const exp = Date.now() + COOKIE_DAYS * 864e5;
    res.setHeader("Set-Cookie", COOKIE + "=" + encodeURIComponent(exp + "." + sign(exp, token)) + "; Path=/; Max-Age=" + (COOKIE_DAYS * 86400) + "; HttpOnly; Secure; SameSite=Lax");
    const clean = String(req.url || "/").replace(/([?&])k=[^&]*(&|$)/, "$1").replace(/[?&]$/, "");
    res.setHeader("Location", clean || "/");
    return res.status(303).end();
  }
  if (!cookieOk(req, token)) { res.setHeader("Content-Type", "text/html; charset=utf-8"); return res.status(401).send(gate()); }

  const payload = await getPayload(token);
  const handles = [...new Set(payload.c.flatMap(c => c.r.map(r => r.h)).filter(Boolean))];
  const avatars = await loadAvatars(handles).catch(() => ({}));
  const json = JSON.stringify(Object.assign({}, payload, { avatars })).replace(/</g, "\\u003c");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(TEMPLATE.replace("__DATA__", () => json));
}
