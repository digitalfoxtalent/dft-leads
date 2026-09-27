// TikTok and Instagram for campaign reporting.
//
//   parseSocial(text)                -> the TikTok / Instagram posts in a LIVE VIDEO URLS cell
//   socialScan(token, dataset, h)    -> READ ONLY. Matches a scraped profile (an Apify dataset of
//                                       clockworks/tiktok-scraper items) to that creator's creator rows
//                                       that have no link yet. Suggests, never writes.
//
// Matching (music promos and brand posts): a post is a candidate for a row when it was published
// from 7 days before to 60 days after the row's anchor date (date published, live date or the
// deal's close date), and the words of the deal name appear in the post's sound, sound artist or
// caption. Score = share of the deal's words found. Rows are approved by a person before any write.

import { missingRows } from "./backfill.js";

const tok = () => process.env.APIFY_TOKEN || "";
const TT_RE = /tiktok\.com\/@([\w.\-]+)\/(?:video|photo)\/(\d{8,})/i;
const IG_RE = /instagram\.com\/(?:[\w.\-]+\/)?(reel|reels|p|tv)\/([A-Za-z0-9_-]{5,})/i;

export function parseSocial(text) {
  const out = [];
  for (const raw of String(text || "").split(",")) {
    const e = raw.trim(); if (!e) continue;
    let m = e.match(TT_RE); if (m) { out.push({ p: "tt", id: m[2], url: "https://www.tiktok.com/@" + m[1] + "/video/" + m[2] }); continue; }
    m = e.match(IG_RE); if (m) out.push({ p: "ig", id: m[2], url: "https://www.instagram.com/" + (m[1] === "reels" ? "reel" : m[1]) + "/" + m[2] + "/" });
  }
  return out;
}

const STOP = new Set(["ceiling", "fan", "ceo", "ceilingfan", "ceilingfanceo", "bulk", "deal", "ft", "feat", "featuring", "x", "the", "and", "a", "an", "of", "to", "in", "on", "my", "for", "with", "by", "tiktok", "promo", "campaign", "song", "music", "sound"]);
const words = s => String(s || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9$ ]+/g, " ").replace(/\$/g, "s").split(/\s+/).filter(w => w && !STOP.has(w));
const flat = s => String(s || "").normalize("NFKD").toLowerCase().replace(/\$/g, "s").replace(/[^a-z0-9]/g, "");
const day = s => Date.parse(String(s).slice(0, 10) + "T00:00:00Z");

async function datasetItems(id) {
  if (!tok()) throw new Error("APIFY_TOKEN missing");
  if (!/^[A-Za-z0-9]{8,}$/.test(String(id || ""))) throw new Error("bad dataset id");
  const f = "id,createTimeISO,webVideoUrl,playCount,musicMeta,text,isAd,isSponsored,authorMeta";
  const r = await fetch("https://api.apify.com/v2/datasets/" + id + "/items?clean=1&limit=5000&fields=" + f + "&token=" + tok());
  if (!r.ok) throw new Error("Apify dataset " + r.status);
  return r.json();
}

export async function socialScan(token, dataset, h) {
  const [posts, gaps] = await Promise.all([datasetItems(dataset), missingRows(token)]);
  const hk = String(h || "").toLowerCase().replace(/^@/, "");
  const rows = gaps.filter(r => String(r.h || "").toLowerCase().replace(/^@/, "") === hk || flat(r.h) === flat(h));
  const P = posts.map(p => {
    const mm = p.musicMeta || {};
    return { id: String(p.id), d: String(p.createTimeISO || "").slice(0, 10), u: p.webVideoUrl, v: p.playCount || 0, ad: !!(p.isAd || p.isSponsored),
      mu: [mm.musicName, mm.musicAuthor].filter(Boolean).join(" / "), hay: words([mm.musicName, mm.musicAuthor, p.text].join(" ")), hf: flat([mm.musicName, mm.musicAuthor, p.text].join(" ")) };
  }).filter(p => p.d);
  const dates = P.map(p => p.d).sort();
  const out = [];
  for (const r of rows) {
    const a = r.pub || r.live || r.closed; const w = [...new Set(words(r.deal))];
    const res = { id: r.id, deal: r.deal, a, c: [] };
    if (!a || !w.length) { out.push(res); continue; }
    const t0 = day(a) - 7 * 864e5, t1 = day(a) + 60 * 864e5;
    for (const p of P) {
      const t = day(p.d); if (t < t0 || t > t1) continue;
      const hit = w.filter(x => p.hay.includes(x) || (x.length >= 4 && p.hf.includes(x)));
      const whole = flat(r.deal).length >= 5 && p.hf.includes(flat(r.deal));
      const s = whole ? 1 : hit.length / w.length;
      if (s >= 0.5) res.c.push([p.id, p.d, +s.toFixed(2), p.mu.slice(0, 60), p.v, p.ad ? 1 : 0]);
    }
    res.c.sort((x, y) => y[2] - x[2] || Math.abs(day(x[1]) - day(a)) - Math.abs(day(y[1]) - day(a)));
    out.push(res);
  }
  const used = new Set(out.flatMap(r => r.c.map(c => c[0])));
  const ads = P.filter(p => p.ad && !used.has(p.id)).map(p => [p.id, p.d, p.mu.slice(0, 60), p.v]);
  return { h, posts: P.length, from: dates[0], to: dates[dates.length - 1], rows: out.length, matched: out.filter(r => r.c.length).length,
    profile: (posts[0] && posts[0].authorMeta && posts[0].authorMeta.name) || "", out, unmatchedAds: ads };
}
