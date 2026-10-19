// SUBPLOT data layer — reads the article store the publisher writes to (Apify KV
// store youtube-mrss-feeds) and shapes it for the site. Server-side only.
// Cached per lambda instance for TTL_MS; the CDN caches rendered pages on top.

import { formatOf } from "./formats.js";
import { ONE_OF_US_FIXES } from "./oneofus.js";

const STORE = "https://api.apify.com/v2/key-value-stores/5yFLBuHJj59ySXY9e";
const TTL_MS = 5 * 60 * 1000;

// Creators who have agreed to SUBPLOT, from the Article Rights board (monday 18427697857,
// "Subplot" column) plus the SubPlotter Applications board. Handles are the REAL YouTube
// handles, which are not always what the article store records.
//
// The list is only enforced when SUBPLOT_APPROVED_ONLY is set in the environment. While the
// site is a private preview it shows everything; setting that env var is the single switch
// that makes it launch-ready, with no deploy needed.
// One record per approved creator. `slug` is the creator's PERMANENT URL segment and the key
// AdSense URL channels are cut on (subplot.tv/a/<slug>/), so it must never change once money
// has flowed through it. `handles` is every YouTube handle that resolves to this creator —
// if someone renames their channel, ADD the new handle here rather than editing the slug.
// Keeping both on one record makes it impossible to restore a renamed creator to the site
// without seeing the slug their earnings are attributed to.
export const CREATORS = [
  { slug: "breakdownsandblockbusters", name: "Breakdowns & Blockbusters",           handles: ["@breakdownsandblockbusters"] },  // Breakdowns & Blockbusters
  { slug: "kristianharloff", name: "Kristian Harloff",                              handles: ["@kristianharloff", "@thekristianharloff"] }, // 18 Oct 2026: his articles arrive as @kristianharloff, so the old handle alone kept him off         // Kristian Harloff
  { slug: "chaosgaming", name: "Chaos",                                             handles: ["@chaosgaming"] },                // Chaos
  { slug: "chaostrektv", name: "ChaosTrek",                                         handles: ["@chaostrektv"] },                // ChaosTrek
  { slug: "chaoscinemayt", name: "Chaos Cinema",                                    handles: ["@chaoscinemayt"] },              // Chaos Cinema, Chaos's fourth channel, approved by Tom 18 Oct 2026
  { slug: "wesnemo", name: "WesNemo",                                               handles: ["@wesnemo", "@wesnemotv"] },                    // WesNemo
  { slug: "filmparadise", name: "Film Paradise",                                    handles: ["@filmparadise", "@film_paradise"] },  // 18 Oct 2026: articles arrive as @filmparadise              // Film Paradise
  { slug: "lorereloaded", name: "Lore Reloaded",                                    handles: ["@lorereloaded"] },               // Lore Reloaded
  { slug: "arealknowitall", name: "Mr. Know-It-All",                                handles: ["@arealknowitall"] },             // Mr. Know-It-All (no articles yet; appears when his feed fills)
  { slug: "coltonogburnchannel", name: "Colton Ogburn",                             handles: ["@coltonogburnchannel"] },        // Colton Ogburn
  { slug: "everythingalways", name: "Everything Always",                            handles: ["@everythingalways", "@everythingalways_snippets"] }, // Everything Always (snippets channel approved by Tom 18 Oct 2026)
  { slug: "gique_", name: "GIQUE",                                                  handles: ["@gique_"] },                     // GIQUE (DFT-owned; dormant channel, evergreen back catalogue)
  { slug: "downtoearthkh", name: "Down to Earth with Kristian Harloff",             handles: ["@downtoearthkh"] },              // Down to Earth with Kristian Harloff (MSN-banned, but that is platform-side and does not apply here)

  // Added 7 Sep 2026. All six were already "Approved" on the Article Rights board 18427697857
  // but missing here, so their creator pages and articles were 404ing on a site they had
  // agreed to. Every handle below was opened on YouTube and checked against the channel it
  // actually resolves to - name and subscriber count in the comment - because a well-formed
  // handle can still be the wrong channel (see the roster's @kristianharloff and Film Paradise
  // lookalike, both fixed 4 Sep).
  { slug: "geekdom101", name: "Geekdom101",                                        handles: ["@geekdom101"] },                 // Geekdom101, 784K
  // REMOVED 25 Sep 2026 (Tom): World of Geekdom cut from article production, articles stay on MSN but not on SUBPLOT. Record kept for the slug.
  // { slug: "worldofgeekdom", name: "World of Geekdom",                              handles: ["@worldofgeekdom"] },             // World of Geekdom, 80.6K
  { slug: "geekdom101plus", name: "Geekdom101 Plus",                               handles: ["@geekdom101plus"] },             // Geekdom101 Plus, 3.41K
  { slug: "danco", name: "DanCo",                                                  handles: ["@danco"] },                      // DanCo, 583K
  // Better Gaming's HANDLE IS @yu-gg, not @bettergaming - the brand name and the handle differ.
  // The slug follows the handle, as every other slug here does, so the URL is /a/yu-gg/.
  { slug: "yu-gg", name: "Better Gaming",                                          handles: ["@yu-gg"] },                      // Better Gaming, 40.8K
  // A SECOND, SEPARATE Chaos channel - not @chaosgaming and not @chaostrektv. YouTube shows it
  // as "ChaosGaming" too, which is why it is easy to mistake for the first one. Same payee.
  { slug: "morechaosgaming", name: "ChaosGaming (second channel)",                 handles: ["@morechaosgaming"] },            // ChaosGaming, 26.7K
  { slug: "witchinghournr", name: "The Witching Hour",                              handles: ["@witchinghournr"] },             // The Witching Hour, approved for SUBPLOT by Tom 18 Oct 2026
  { slug: "beyondthetrailer", name: "Beyond The Trailer",                        handles: ["@beyondthetrailer"] },             // Beyond The Trailer (Grace Randolph), approved 8 Sep 2026
  // Approved on the Article Rights board 23 Sep 2026 (row 12870062853, Tom's confirmation).
  // Handle checked against the videos themselves, not the store: all 91 long-form records in
  // the heavyspoilers feeds resolve to youtube.com/@heavyspoilers and every one is public.
  // SUBPLOT rate card row created the same day; payee HeavySpoilers LTD.
  { slug: "heavyspoilers", name: "Heavy Spoilers",                               handles: ["@heavyspoilers"] },                // Heavy Spoilers (Paul), approved 23 Sep 2026
  // Approved on the Article Rights board 1 Oct 2026 (row 13189658145). Trey Cooper agreed to
  // MSN, Spotify Video and Subplot in Google Chat on 21 Sep 2026; Tom approved it 1 Oct.
  // Handle checked on YouTube: @CommentatorsCurseFGC, channel UCWrdZpY_HEdTnmIpjOm3voQ.
  // SUBPLOT rate card row 13189706168 created the same day.
  { slug: "commentatorscursefgc", name: "Commentator's Curse FGC",               handles: ["@commentatorscursefgc"] },         // Commentator's Curse FGC (Trey Cooper), approved 1 Oct 2026
  // Added 11 Oct 2026 for the launch (Tom: creators approved for MSN articles count as approved for SUBPLOT; "Yes, you can
  // add them"). Slugs are the real YouTube handles the site already resolves from each video, so they match the
  // /a/<slug>/ URLs. Each has a SUBPLOT row on the Platform Rate Card (row id in the comment). Rocket Riley stays off (Tom).
  { slug: "thecosmicwonder", name: "The Cosmic Wonder",                               handles: ["@thecosmicwonder"] },        // rate card row 13156463868
  { slug: "cinepals", name: "CinePals",                                               handles: ["@cinepals"] },               // rate card row 13260159694
  { slug: "newrockstars", name: "New Rockstars",                                      handles: ["@newrockstars"] },           // rate card row 13260159251
  { slug: "ajm_nerdcore", name: "AJM Nerdcore",                                       handles: ["@ajm_nerdcore"] },           // rate card row 13260159459
  { slug: "deepdivenr", name: "The Deep Dive",                                        handles: ["@deepdivenr"] },             // rate card row 13260159636
  { slug: "themoviecouple", name: "The Movie Couple",                                 handles: ["@themoviecouple"] },         // rate card row 13260159637
  { slug: "thegoldman25", name: "The Gold Man",                                       handles: ["@thegoldman25"] },           // rate card row 13260176886
  { slug: "cinedesi", name: "CineDesi",                                               handles: ["@cinedesi"] },               // rate card row 13260159547
  { slug: "moviefactsproyt", name: "Movie Facts Pro",                                 handles: ["@moviefactsproyt", "@moviefactspro"] }, // 18 Oct 2026: most articles arrive as @moviefactspro        // rate card row 13260177181
  { slug: "vettedpodcast", name: "Vetted",                                            handles: ["@vettedpodcast"] },          // rate card row 13260159458
  { slug: "galaxygeeks", name: "Galaxy Geeks",                                        handles: ["@galaxygeeks"] },            // rate card row 13260159577
];

export const APPROVED_HANDLES = CREATORS.flatMap(c => c.handles);

const SLUG_BY_HANDLE = new Map(CREATORS.flatMap(c => c.handles.map(h => [h.toLowerCase(), c.slug])));

// The pinned slug wins over whatever handle YouTube reports today. An unknown creator falls
// back to their handle so the site still works, but nothing unpinned should ever earn money.
export const slugFor = h => SLUG_BY_HANDLE.get(String(h || "").toLowerCase())
  || String(h || "").replace(/^@/, "").toLowerCase();

// Approved creators with no pinned slug — always empty in normal operation. Surfaced so a
// renamed or newly added creator cannot quietly start earning under an unattributed URL.
export const unpinned = arts => [...new Set(arts.map(a => a.c))].filter(h => !SLUG_BY_HANDLE.has(String(h || "").toLowerCase()));

export const APPROVED = process.env.SUBPLOT_APPROVED_ONLY ? APPROVED_HANDLES : null;

export const slug = s => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export const CATS = {
  marvel: "Marvel",
  dc: "DC",
  scifi: "Sci-Fi & Fantasy",
  gaming: "Gaming",
  anime: "Anime",
  screen: "Screen",
};

const KW = {
  dc:     ["dc","batman","lanterns","green lantern","john stewart","superman","hal jordan","dark knight","the flash","wonder woman"],
  anime:  ["dragon ball","goku","vegeta","ultra instinct","toonami","anime","one piece","naruto","jujutsu","demon slayer"],
  gaming: ["gta","call of duty","elder scrolls","warhammer","grand theft auto","gaming","blood angels","miniature","police chase","outlaws","playstation","xbox","nintendo","ps5"],
  marvel: ["marvel","mcu","deadpool","wolverine","avengers","doom","secret wars","scarlet witch","spider-man","vision","x-men","kang","loki","franklin richards","hugh jackman","ryan reynolds","robert downey","kevin feige","elizabeth olsen","cassandra nova","infinity stones","doomsday","hunter b-15","fantastic four"],
  scifi:  ["star trek","star wars","stargate","voth","strange new worlds","prometheus","sci-fi","galaxy's edge","harry potter","ghosts","moaning myrtle","transformers","optimus","lord of the rings","dune","alien","predator"],
};
const ORDER = ["dc","anime","gaming","marvel","scifi"];

export function categorise(tags, headline) {
  const blob = ((tags || []).join(" ") + " " + (headline || "")).toLowerCase();
  for (const k of ORDER) if (KW[k].some(w => blob.includes(w))) return k;
  return "screen";
}

// YouTube-style sign-off ("What do you think…?") as the final paragraph reads as a template on a
// site. Drop it from the rendered body only when it is a short, single, standalone question.
function trimSignoff(html) {
  const m = html.match(/<p>([^<]{12,180}\?)\s*<\/p>\s*$/);
  if (!m) return html;
  const q = m[1];
  if ((q.match(/[.!?]/g) || []).length > 1) return html;      // more than one sentence: keep
  return html.slice(0, m.index).trimEnd();
}
// House style: no em dashes anywhere on the site, including article text from the pipeline.
const noDash = t => String(t || "").replace(/\s*(?:\u2014|&mdash;|&#8212;)\s*/g, " - ");
const cleanBrand = n => (n || "").replace(/\s*—\s*New$/, "").trim();
const norm = t => String(t || "").trim().replace(/\s+and\s+/i, " & ");
const STOP = new Set(["marvel","mcu","marvel studios","marvel cinematic universe","dc","pixar","reaction","sci-fi",
  "gaming community","interview","movie industry","stargate lore","easter egg","dc studios","hbo","star wars",
  "stargate","dragon ball","dragon ball z","x-men","ghosts","ryan reynolds","hugh jackman","netflix","disney"]);

let cache = { at: 0, data: null, pending: null };

// Real channel identity, resolved from the videos themselves. The store's `creator` field
// is not reliable — four of its handles point at the wrong channel or at no channel at all —
// so the video's own channel is the source of truth for the handle and the profile picture.
// Cached for a day; channel art rarely changes.
const CH_TTL = 24 * 3600e3;
const chCache = new Map();                       // brand (lowercased) -> { at, handle, av, title }

async function ytJson(path, key, ids) {
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}&id=${ids.join(",")}&key=${key}`);
  if (!r.ok) throw new Error(`${r.status} from YouTube ${path}`);
  return r.json();
}

// Resolves one channel per FEED and rewrites each article's handle to the real one.
// Returns feed key -> { handle, av, title }, where the feed key is the store's creator handle
// when it has one and the display name otherwise (see feedKey).
//
// WHY THE FEED AND NOT THE BRAND, 16 Sep 2026: four different channels publish under the one
// display name "Chaos" (@chaosgaming, @chaostrektv, @morechaosgaming and @chaoscinemayt). Keyed
// on the display name, one sample video decided the channel for all 64 of their articles, the
// other three channels' pieces were rewritten to that handle, and the approved-only filter
// then dropped the lot: 37 live articles missing from three creators with nothing logged.
// The store's handle is still not trusted for identity (the video's channel is), it is only
// the grouping key, so two feeds are never resolved from one another's videos.
const feedKey = a => (String(a.c || "").startsWith("@") ? a.c : a.b).toLowerCase();
async function resolveChannels(arts) {
  const out = {};
  const now = Date.now();
  const sample = new Map();                      // feed key -> a video to resolve it from
  for (const a of arts) {
    const b = feedKey(a);
    const hit = chCache.get(b);
    if (hit && now - hit.at < CH_TTL) { out[b] = hit; continue; }
    if (!sample.has(b) && a.v) sample.set(b, { brand: b, v: a.v });
  }
  const key = process.env.YOUTUBE_API_KEY;
  if (key && sample.size) {
    try {
      const wanted = [...sample.values()];
      const chByVideo = new Map();
      for (let i = 0; i < wanted.length; i += 50) {
        const j = await ytJson("videos?part=snippet", key, wanted.slice(i, i + 50).map(w => w.v));
        for (const it of j.items || []) chByVideo.set(it.id, it.snippet.channelId);
      }
      const chIds = [...new Set(chByVideo.values())];
      const info = new Map();
      for (let i = 0; i < chIds.length; i += 50) {
        const j = await ytJson("channels?part=snippet", key, chIds.slice(i, i + 50));
        for (const c of j.items || []) {
          const t = c.snippet.thumbnails || {};
          info.set(c.id, { handle: c.snippet.customUrl || "", av: (t.medium || t.default || {}).url || "", title: c.snippet.title || "" });
        }
      }
      for (const w of wanted) {
        const c = info.get(chByVideo.get(w.v));
        if (!c || !c.handle) continue;
        const rec = { at: Date.now(), handle: c.handle, av: c.av, title: c.title };
        chCache.set(w.brand, rec);
        out[w.brand] = rec;
      }
    } catch { /* fall back to whatever the store gave us */ }
  }
  // Rewrite from the feed's own resolution. The key is taken BEFORE the rewrite, so an
  // article whose handle the store got wrong still finds the record made for its feed.
  for (const a of arts) { const c = out[feedKey(a)]; if (c) { a.fk = feedKey(a); a.c = c.handle; } }
  return out;
}

// YouTube view counts for recent articles (used to pick the front-page lead until the site
// has its own read data). Needs YOUTUBE_API_KEY; silently skipped without it.
const VIEWS_WINDOW = 14 * 864e5;
async function addViews(arts) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return;
  const recent = arts.filter(a => Date.now() - new Date(a.p) < VIEWS_WINDOW).slice(0, 150);
  for (let i = 0; i < recent.length; i += 50) {
    const batch = recent.slice(i, i + 50);
    try {
      const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${batch.map(a => a.v).join(",")}&key=${key}`);
      if (!r.ok) continue;
      const j = await r.json();
      for (const it of j.items || []) {
        const a = batch.find(x => x.v === it.id); if (!a) continue;
        a.views = Number(it.statistics?.viewCount || 0);
        a.ageDays = Math.max(1, (Date.now() - new Date(a.u || a.p)) / 864e5);
      }
    } catch { /* leave views undefined */ }
  }
}

// SHORTS, added 9 Sep 2026. A Short becomes a Snippet: a 20-second read with no cover image,
// shown in its own section rather than in the wire. The feed only marks some of them by link,
// so every article that could be one (under the long-form floor, or already flagged) has its
// duration checked once. Three minutes is YouTube's own ceiling for a Short. Without an API
// key only the link-flagged ones count, which is safe: an unflagged Short simply stays below
// the floor as it does today.
const SHORT_MAX_S = 180;
// SPEED, 18 Oct 2026 (launch). Live, a full reload made about 120 YouTube calls one after another
// (mostly the dead-video check below, 25 ids a call over 2,000+ articles), took over 30 seconds
// and could time out, and every five-minute refresh used YouTube quota again for answers that had
// not changed. Now: a video's duration is remembered for good (it never changes), a video seen
// alive is not asked about again for six hours, and the calls that are still needed run six at a
// time instead of one by one.
const durCache = new Map();                      // video id -> seconds
const aliveAt = new Map();                       // video id -> when YouTube last said it is live
const ALIVE_TTL = 6 * 3600 * 1000;
async function inParallel(jobs, width = 6) {
  let next = 0;
  const worker = async () => { while (next < jobs.length) { const j = jobs[next++]; try { await j(); } catch { /* each job guards itself */ } } };
  await Promise.all(Array.from({ length: Math.min(width, jobs.length) }, worker));
}
const isoSeconds = d => { const m = String(d || "").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };
async function addDurations(arts, floor) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return;
  const maybe = arts.filter(a => a.short || a.w < floor);
  const ask = [];
  for (const a of maybe) {
    if (durCache.has(a.v)) { a.dur = durCache.get(a.v); if (a.dur > 0 && a.dur <= SHORT_MAX_S) a.short = true; }
    else ask.push(a);
  }
  const jobs = [];
  for (let i = 0; i < ask.length; i += 50) {
    const batch = ask.slice(i, i + 50);
    jobs.push(async () => {
      try {
        const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${batch.map(a => a.v).join(",")}&key=${key}`);
        if (!r.ok) return;
        const j = await r.json();
        for (const it of j.items || []) {
          const d = isoSeconds(it.contentDetails?.duration);
          if (d > 0) durCache.set(it.id, d);
          for (const a of batch) if (a.v === it.id) { a.dur = d; if (d > 0 && d <= SHORT_MAX_S) a.short = true; }
        }
      } catch { /* leave the batch alone */ }
    });
  }
  await inParallel(jobs);
}

// Articles whose source video has gone (deleted, made private, or pulled) must not stay on the
// site: the whole premise is that every piece links back to a video you can watch, and a dead
// link plus YouTube's grey placeholder thumbnail is worse than no article.
//
// videos.list only returns ids that still exist and are public, so anything missing from the
// response is provably gone. Guarded hard: if a batch errors, or comes back completely empty
// when we asked about real ids, that looks like an API problem rather than 50 dead videos, so
// we leave those articles alone. Losing the whole site to a bad API key is the worse failure.
async function pruneMissing(arts) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];
  const gone = [];
  // Ask about BOTH ids we hold for a piece: `v` from the feed and `id`, the one its URL uses.
  // They should agree, but the store has been wrong before, and a stale `v` would otherwise
  // read as a dead video and pull a perfectly good article. An article is only removed when
  // NEITHER id comes back alive.
  const ids = a => [...new Set([a.v, a.id].filter(Boolean))];
  // Only ask about pieces with no id seen alive in the last six hours.
  const now = Date.now();
  const fresh = id => now - (aliveAt.get(id) || 0) < ALIVE_TTL;
  const toCheck = arts.filter(a => ids(a).length && !ids(a).some(fresh));
  const jobs = [];
  for (let i = 0; i < toCheck.length; i += 25) {
    const batch = toCheck.slice(i, i + 25);
    jobs.push(async () => {
      try {
        const ask = [...new Set(batch.flatMap(ids))];
        const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=id&id=${ask.join(",")}&key=${key}`);
        if (!r.ok) return;
        const j = await r.json();
        const live = new Set((j.items || []).map(it => it.id));
        if (!live.size) return;                 // whole batch missing = suspect the API, not the videos
        const at = Date.now(); for (const id of live) aliveAt.set(id, at);
        for (const a of batch) if (!ids(a).some(id => live.has(id))) gone.push(a);
      } catch { /* leave the batch alone */ }
    });
  }
  await inParallel(jobs);
  if (gone.length) {
    const ids = new Set(gone.map(a => a.id));
    const kept = arts.filter(a => !ids.has(a.id));
    arts.length = 0; arts.push(...kept);
  }
  return gone.map(a => ({ id: a.id, creator: a.c, headline: a.h }));
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${r.status} for ${url}`);
  return r.json();
}

// FEED READS THAT FAIL, 11 Oct 2026 (Tom approved). Seen live that day: for several minutes the
// site showed 27 of its 43 articles and every piece from five creators returned 404, then all 43
// came back. The store still held every article. Likely cause: one read per feed, all ~70 fired at
// once, and a feed whose read failed was silently dropped until the next cache turn. Now each
// read is retried (three tries, short backoff), reads run a few at a time instead of all at once,
// and if a feed still cannot be read this instance keeps serving the last copy it read
// successfully. A feed only disappears from the site when the store stops listing it.
const lastGood = new Map();                      // store key -> last array read successfully
async function readFeed(k) {
  let err;
  for (let t = 0; t < 3; t++) {
    try {
      const v = await fetchJson(STORE + "/records/" + k);
      if (!Array.isArray(v)) throw new Error(`not an array for ${k}`);
      lastGood.set(k, v);
      return v;
    } catch (e) { err = e; await new Promise(r => setTimeout(r, 300 * (t + 1))); }
  }
  if (lastGood.has(k)) { console.warn(`SUBPLOT: feed read failed, serving last good copy: ${k}`); return lastGood.get(k); }
  console.error(`SUBPLOT: feed read failed with no earlier copy, feed missing this turn: ${k}`, String(err));
  throw err;
}
async function readAll(keys, width = 8) {
  const out = new Array(keys.length); let next = 0;
  const worker = async () => { while (next < keys.length) { const i = next++; try { out[i] = { status: "fulfilled", value: await readFeed(keys[i]) }; } catch (e) { out[i] = { status: "rejected", reason: e }; } } };
  await Promise.all(Array.from({ length: Math.min(width, keys.length) }, worker));
  return out;
}

async function load() {
  // 18 Oct 2026 (launch): the store now holds more than 1000 keys, and one page of the listing
  // missed the feeds that sort last (WesNemo, Witching Hour, Better Gaming). Page through them all.
  const all = []; let start = null;
  for (let page = 0; page < 20; page++) {
    const d = (await fetchJson(STORE + "/keys?limit=1000" + (start ? "&exclusiveStartKey=" + encodeURIComponent(start) : ""))).data;
    all.push(...d.items.map(i => i.key));
    if (!d.isTruncated || !d.nextExclusiveStartKey) break;
    start = d.nextExclusiveStartKey;
  }
  const keys = all.filter(k => k.endsWith("__items"));
  const results = await readAll(keys);
  const seen = new Set(); const arts = [];
  results.forEach((res, i) => {
    if (res.status !== "fulfilled" || !Array.isArray(res.value)) return;
    const evergreen = keys[i].includes("evergreen");
    // 18 Oct 2026: 11 approved articles had an empty thumbnail field and 7 had no creator handle,
    // so they never showed. The page builds its own thumbnail from the video id, so an empty field
    // only matters when there is no video id; a missing handle is taken from the feed's name.
    const feedHandle = "@" + keys[i].replace(/__items$/, "").replace(/_(article_feed.*|snippets.*|news.*)$/, "");
    for (const a of res.value) {
      if (!a || !a.guid || !a.headline || seen.has(a.guid)) continue;
      if (/^unable to generate/i.test(a.headline)) continue;
      const brand = cleanBrand(a.displayName);        // feeds without a displayName are old playlist experiments — skip
      const creator = a.creator || feedHandle;
      if (!brand || !creator) continue;
      const v = (String(a.link || "").match(/v=([\w-]+)/) || [])[1] || String(a.guid).replace(/^yt-/, "");
      if (!a.thumbnail && !/^[\w-]{11}$/.test(v)) continue;
      seen.add(a.guid);
      arts.push({
        id: String(a.guid).replace(/^yt-/, ""),
        h: noDash(a.headline), s: noDash(a.subheadline), body: noDash(trimSignoff(a.body_html || "")),
        w: a.word_count || 0, rt: Math.max(1, Math.round((a.word_count || 0) / 220)),
        t: (a.tags || []).slice(0, 8), b: brand, c: creator,
        p: a.pubDate, u: a.uploadDate, v, evergreen,
        k: categorise(a.tags, a.headline),
        thumb: `https://i.ytimg.com/vi/${v}/hq720.jpg`,
        thumbSmall: `https://i.ytimg.com/vi/${v}/mqdefault.jpg`,
        // A Short is a Snippet (see below). The feed link says so for some; the video's
        // duration settles the rest in addDurations().
        // 18 Oct 2026 (launch): everything in a creator's _snippets feed is a Snippet. Those feeds
        // link Shorts as ordinary watch?v= links, so the link test alone missed 420 of 441 and the
        // 400-word floor then dropped them.
        short: /youtube\.com\/shorts\//i.test(String(a.link || "")) || /_snippets__items$/.test(keys[i]),
        format: a.format || "",
      });
    }
  });
  // Some feeds record the display name as the creator instead of the handle.
  // Map those onto the real handle where the brand already has one; otherwise derive one.
  const handleByBrand = new Map();
  for (const a of arts) if (a.c.startsWith("@")) handleByBrand.set(a.b.toLowerCase(), a.c);
  for (const a of arts) {
    if (a.c.startsWith("@")) continue;
    const known = handleByBrand.get(a.c.toLowerCase()) || handleByBrand.get(a.b.toLowerCase());
    a.c = known || ("@" + a.c.toLowerCase().replace(/[^a-z0-9_.-]/g, ""));
  }
  const channels = await resolveChannels(arts);
  arts.sort((x, y) => new Date(y.p) - new Date(x.p));
  await addViews(arts);
  const removed = await pruneMissing(arts);
  // SNIPPET CHANNEL NAMES, 18 Oct 2026 (Tom: release them). Some Snippets carry their snippets feed's name as the
  // creator ("@gique__snippets", "@kristianharloff_snippets") instead of the creator's own handle, so they missed the
  // approved list and never showed. A Snippet belongs to the creator whose feed it came from: drop the suffix.
  for (const a of arts) if (/_snippets$/i.test(a.c)) a.c = a.c.replace(/_snippets$/i, "");
  if (APPROVED) { const kept = arts.filter(a => APPROVED.includes(a.c)); arts.length = 0; arts.push(...kept); }

  // DISPLAY NAMES, 4 Oct 2026 (Tom). The feed's displayName is wrong on some records: one
  // Breakdowns & Blockbusters article carries "Breakdownsandblockbusters", and the ChaosTrek feed
  // shares "Chaos" with Chaos Gaming. Those two creators take their name from CREATORS instead.
  // Everyone else keeps the feed's name, which is right for them. Runs after resolveChannels, so
  // feed grouping (feedKey) is untouched.
  const NAME_FROM_CREATORS = new Set(["breakdownsandblockbusters", "chaostrektv"]);
  for (const a of arts) {
    const s = slugFor(a.c);
    if (!NAME_FROM_CREATORS.has(s)) continue;
    const rec = CREATORS.find(r => r.slug === s);
    if (rec && rec.name) a.b = rec.name;
  }

  // WORD COUNTS AND THE THIN-PAGE FLOOR, both added 8 Sep 2026.
  // Some store records carry no word_count. Those rendered as "0 words - 1 min read" and were
  // quietly disqualified from the lead, the secondary slots and the evergreen rail, all of which
  // test a.w. Count the body ourselves when the number is missing, so an article is judged on
  // its length rather than on whether the publisher happened to record one.
  const countWords = html => (String(html || "").replace(/<[^>]*>/g, " ").match(/\S+/g) || []).length;

  // The publisher's own "About this article" block used to be stripped here, which meant Subplot
  // wrote its own disclosure instead. Since 19 Sep 2026 (Tom) the shared block is kept, so the
  // wording cannot drift between Subplot and the syndicated copy, and render.js no longer emits a
  // second one. It is still removed for MEASUREMENT only, so the disclosure cannot inflate a word
  // count or read time or lift a thin article over MIN_WORDS. The trailing "Watch the original
  // video" link is dropped because the page already carries its own player section below it.
  const DISCLOSURE_RE = /(?:<hr\s*\/?>)?\s*<p class="ai-disclosure">[\s\S]*?<\/p>/gi;
  for (const a of arts) a.body = a.body.replace(/\s*<a\b[^>]*>Watch the original video\.<\/a>/gi, "");
  // Since 7 Oct 2026 the publisher puts that link in its own paragraph above the note; drop the
  // paragraph it leaves empty so no bare orange-ruled line shows under the article.
  for (const a of arts) a.body = a.body.replace(/\s*<p class="ai-disclosure">\s*(?:<em>\s*<\/em>)?\s*<\/p>/gi, "");
  for (const a of arts) if (!a.w) { a.w = countWords(a.body.replace(DISCLOSURE_RE, "")); a.rt = Math.max(1, Math.round(a.w / 220)); }

  // The floor. A site is judged on its weakest pages, and a 140-word explainer reads as scaled
  // AI content however honest the disclosure under it is. Articles below MIN_WORDS are simply
  // not rendered: nothing is deleted, nothing is unpublished in the store, and nothing is
  // withdrawn from MSN. Lower the number and they are back on the next five minute cache turn.
  // SUBPLOT_MIN_WORDS overrides it and 0 turns it off. At 400 this holds back 150 of 539
  // articles and no creator loses all of theirs. Thin pieces are meant to come back by being
  // rewritten longer, not by dropping the floor.
  // 18 Oct 2026 (Tom): floor lowered from 400 to 300 words. The 400 floor was set for the AdSense re-review;
  // at 300 about 135 published articles come back, and the thinnest pieces still stay off.
  const MIN_WORDS = Number(process.env.SUBPLOT_MIN_WORDS ?? 300);
  await addDurations(arts, MIN_WORDS);
  // Snippets are exempt from the long-form floor by definition, but not from having words:
  // a Short that produced fewer than 25 is a failed generation, not a take.
  const MIN_SNIPPET_WORDS = 25;
  if (MIN_WORDS > 0) { const kept = arts.filter(a => a.short ? a.w >= MIN_SNIPPET_WORDS : a.w >= MIN_WORDS); arts.length = 0; arts.push(...kept); }
  // TOPICS SUBPLOT DOES NOT CARRY, 9 Sep 2026. Wrestling arrives through World of Geekdom's
  // feed and sits wrong beside the rest of the site (Tom). The articles stay in the store and
  // on MSN; they are simply not rendered here. A topic block, not a creator block, so the same
  // creator's Marvel and X-Men pieces are untouched. Matched on headline and tags only.
  const BLOCKED_TOPICS = /\b(?:wwe|aew|wrestling|wrestlers?|wrestlemania|summerslam|smackdown|royal rumble|kenny omega|will ospreay|cody rhodes|cm punk|brock lesnar|roman reigns|eric bischoff|hulk hogan|seth rollins|tony khan|aew dynamite|all in 2026)\b/i;
  { const kept = arts.filter(a => !BLOCKED_TOPICS.test(a.h + " " + a.t.join(" "))); arts.length = 0; arts.push(...kept); }
  for (const a of arts) a.f = formatOf(a);
  // Snippets live in their own list. They never enter the wire, the threads, the lead or the
  // evergreen shelf: those are built from `arts` below, which from here on is long-form only.
  // SNIPPETS OFF FOR THE ADSENSE RE-REVIEW, 3 Oct 2026 (Tom). AdSense rejected the site for
  // policy violations; Snippet pages are 120-190 words carrying four ad units, the clearest
  // low-value signal on the site. With SNIPPETS_LIVE false the list is empty, so the front-page
  // column, the /snippets page, the nav link and the sitemap entries all drop out and Snippet
  // URLs 404. Nothing is deleted from the store or MSN. To restore, set this back to true.
  const snippets = SNIPPETS_LIVE ? arts.filter(a => a.short) : [];
  { const kept = arts.filter(a => !a.short); arts.length = 0; arts.push(...kept); }

  // REVIEW SET FOR THE ADSENSE RE-REVIEW, 3 Oct 2026 (Tom: "Let's do 30"). While REVIEW_SET_ON is
  // true the site shows ONLY these 30 long-form articles; every other article is held back
  // exactly like the word floor holds pieces back - nothing is deleted from the store, MSN is
  // untouched, and their URLs simply 404 until this is switched off. Picked from all 734 live
  // articles: 1,300+ words, video from March 2026 on, no time-relative wording, editor Checked
  // OK and approved by Tom on the Review Queue (not auto-approved), no repeat-coverage flag,
  // video embedded and AI note present. 11 creators. To restore the full site, set false.
  if (REVIEW_SET_ON) { const keep = new Set(REVIEW_SET); const kept = arts.filter(a => keep.has(a.id)); arts.length = 0; arts.push(...kept); }
  // DATED CLAIMS HELD AT LAUNCH, 18 Oct 2026 (Tom: set SUBPLOT live with all articles). The publisher's one-off date
  // sweep (build 82, feed store record launch_date_sweep) read every article and found these still presenting a date as
  // upcoming when it has passed ("the Lanterns finale airs October 4th"). They are not rendered until fixed; nothing is
  // deleted from the store. Remove an id once its article is corrected.
  { const hold = new Set([...STALE_HOLD, ...EDITORIAL_HOLD]); const kept = arts.filter(a => !hold.has(a.id)); arts.length = 0; arts.push(...kept); }
  {
    const byId = new Map(); for (const [id, from, to] of [...DATE_FIXES, ...EDITORIAL_FIXES, ...ONE_OF_US_FIXES]) { if (!byId.has(id)) byId.set(id, []); byId.get(id).push([from, to]); }
    const dated = new Set(DATED_IDS);
    const longDate = d => { const t = new Date(d); return isNaN(t) ? "" : t.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }); };
    for (const a of arts) {
      for (const [from, to] of byId.get(a.id) || []) { a.h = a.h.split(from).join(to); a.s = (a.s || "").split(from).join(to); a.body = a.body.split(from).join(to); if (Array.isArray(a.t)) a.t = a.t.map(x => String(x).split(from).join(to)); }
      if (dated.has(a.id) && longDate(a.p)) a.body = `<p class="dated-note"><em>Published ${longDate(a.p)}. Words like "tonight" or "next week" refer to that date.</em></p>` + a.body;
    }
  }

  // CORRECTIONS, 8 Sep 2026. Errors found by auditing every live article, fixed at render rather
  // than in the store, so the source record is untouched, the change is reversible, and the copy
  // MSN holds does not move. Keyed on article id, applied to headline, standfirst and body.
  // ONLY checked proper nouns and plain factual slips belong here, never the creator's argument,
  // opinion or framing: those go back to the creator. Every entry was read in context first.
  const CORRECTIONS = {};
  CORRECTIONS.DKyHeSmlWA8 = [[/Viseris/g, "Viserys"], [/Alison Targaryen/g, "Alysanne Targaryen"]];
  CORRECTIONS.xGwVPYCrgME = [[/Hugh Howie/g, "Hugh Howey"]];
  CORRECTIONS["4iBZK-tITss"] = [[/Mark Alaimo/g, "Marc Alaimo"]];
  CORRECTIONS.sos_1veW_Xw = [[/Gustaf Cannon/g, "Gustav Cannon"]];
  CORRECTIONS.MxbwK2txcE4 = [[/April Fu\b/g, "April Fools"]];
  CORRECTIONS["3SMf4bx1Rgc"] = [[/Granola(?!h)/g, "Granolah"]];
  CORRECTIONS["3deOpyoExa4"] = [[/one-and-one/g, "one and done"]];
  CORRECTIONS.zyN527oP580 = [[/the core/g, "the Corps"]];
  // Star Trek: First Contact was written by Brannon Braga and Ronald D. Moore (3 Oct 2026).
  CORRECTIONS.JOFMVYJFVR4 = [[/Brannon Braga and his co-writer/g, "Brannon Braga and Ronald D. Moore"]];
  for (const a of arts) for (const [re, to] of CORRECTIONS[a.id] || []) { a.h = a.h.replace(re, to); a.s = a.s.replace(re, to); a.body = a.body.replace(re, to); }

  // creators
  const byC = new Map();
  for (const a of arts) {
    const e = byC.get(a.c) || { handle: a.c, name: a.b, fk: a.fk, n: 0, latest: a.p };
    e.n++; byC.set(a.c, e);
  }
  const panel = [...byC.values()].sort((x, y) => y.n - x.n);
  const av = {};
  for (const p of panel) { const c = channels[p.fk] || channels[p.name.toLowerCase()]; p.av = (c && c.av) || ""; if (p.av) av[p.handle] = p.av; }
  // Avatars for creators who appear ONLY in Snippets. The panel above is built from long-form
  // articles, so a Shorts-only creator would otherwise fall back to initials on their own byline.
  for (const a of snippets) { if (av[a.c]) continue; const c = channels[a.fk] || channels[a.b.toLowerCase()]; if (c && c.av) av[a.c] = c.av; }

  // threads: one subject, several creators — ranked by what's moving now, not by lifetime size
  const RECENT = 21 * 864e5;
  const tagmap = new Map();
  for (const a of arts) {
    a.t.forEach((t, i) => {
      const n = norm(t); if (STOP.has(n.toLowerCase())) return;
      const prominent = i < 3 || a.h.toLowerCase().includes(n.toLowerCase());
      if (!prominent) return;
      const list = tagmap.get(n) || []; if (!list.some(x => x.id === a.id)) list.push(a); tagmap.set(n, list);
    });
  }
  const subjects = {};
  for (const [t, items] of tagmap) {
    if (items.length < 2) continue;
    const sl = slug(t); if (!sl) continue;
    const sorted = items.slice().sort((a, b) => new Date(b.p) - new Date(a.p));
    if (!subjects[sl] || subjects[sl].items.length < sorted.length) subjects[sl] = { t, slug: sl, n: sorted.length, c: new Set(sorted.map(i => i.c)).size, items: sorted.map(i => i.id) };
  }
  const threads = [];
  for (const [t, items] of tagmap) {
    const recent = items.filter(i => Date.now() - new Date(i.p) < RECENT).sort((a, b) => new Date(b.p) - new Date(a.p));
    const creators = new Set(recent.map(i => i.c));
    if (recent.length < 3 || creators.size < 2) continue;
    const cats = {}; recent.forEach(i => cats[i.k] = (cats[i.k] || 0) + 1);
    const k = Object.entries(cats).sort((a, b) => b[1] - a[1])[0][0];
    // one take per creator first, then the rest, newest first
    const seenC = new Set(); const firsts = [], rest = [];
    for (const i of recent) (seenC.has(i.c) ? rest : (seenC.add(i.c), firsts)).push(i);
    threads.push({ t, slug: slug(t), n: recent.length, c: creators.size, k, score: recent.length * creators.size,
      items: firsts.concat(rest).slice(0, 6).map(i => i.id) });
  }
  threads.sort((a, b) => b.score - a.score);
  const chosen = []; const used = new Set();
  for (const t of threads) {
    const overlap = t.items.filter(id => used.has(id)).length;
    if (overlap > t.items.length / 2) continue;
    chosen.push(t); t.items.forEach(id => used.add(id));
    if (chosen.length === 3) break;
  }
  // Evergreen picks. A third of the site comes from the evergreen feeds: lore, trivia and
  // explainers that never enter a thread (not recent) and sink out of the wire (not new), but
  // don't date. Surface them deliberately instead: one article per creator, rotated every six
  // hours so the shelf changes through the day, and rendered without dates.
  const SLOT = Math.floor(Date.now() / (6 * 3600e3));
  const hash = str => { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return Math.abs(h); };
  const everBy = new Map();
  for (const a of arts) {
    if (!a.evergreen || a.w < 400) continue;
    const l = everBy.get(a.c) || []; l.push(a); everBy.set(a.c, l);
  }
  const evergreen = [...everBy.values()]
    .map(list => list[SLOT % list.length])
    .sort((x, y) => hash(x.id + SLOT) - hash(y.id + SLOT))
    .slice(0, 5)
    .map(a => a.id);

  return { arts, snippets, panel, threads: chosen, subjects, avatars: av, evergreen, removed, loadedAt: new Date().toISOString() };
}

// SERVE THE LAST COPY WHILE REFRESHING, 18 Oct 2026 (launch). Seen live on launch day: when the
// five minute copy ran out, the next visitor waited for a full reload of every feed (well over
// 30 seconds) and got nothing back. Now a warm instance keeps serving the copy it has and
// refreshes in the background; only a brand new instance with no copy yet has to wait. A refresh
// that has been running for more than two minutes is treated as stuck and started again.
export async function getData() {
  const now = Date.now();
  if (cache.data && now - cache.at < TTL_MS) return cache.data;
  if (cache.pending && now - (cache.pendingAt || 0) > 120000) cache.pending = null;
  if (!cache.pending) {
    cache.pendingAt = now;
    cache.pending = load().then(d => { cache = { at: Date.now(), data: d, pending: null, pendingAt: 0 }; return d; })
      .catch(err => { cache.pending = null; if (cache.data) return cache.data; throw err; });
  }
  if (cache.data) return cache.data;
  return cache.pending;
}

// See the REVIEW SET note in loadData. true = only these article ids render (43 as at 3 Oct 2026).
// LAUNCH (Tom, 11 Oct 2026: "Before opening to search, we would need to get all of the articles live"). The review set
// ends with the launch: merging this PR shows every article again alongside dropping the noindex. Set true to restore it.
export const REVIEW_SET_ON = false;
// See DATED CLAIMS HELD AT LAUNCH in loadData. 63 articles, 18 Oct 2026.
// 18 Oct 2026 (Tom: "fix these and publish"): the passed-date sentences in all 63 were rewritten (DATE_FIXES)
// and the list emptied. Ids are kept in DATED_IDS, which puts a "published on" line at the top of each.
export const STALE_HOLD = [];
// EDITORIAL REVIEW, 19 Oct 2026 (Tom: "Can you do an analysis on them and approve them ... edit them ... reject them").
// Claude reviewed the 34 live pages that had no person's approval on record; Tom approved the verdicts.
// EDITORIAL_HOLD: 14 pages taken off the site (thin, out of date, or headline not delivered). Nothing is
// deleted from the store; remove an id to bring a page back. EDITORIAL_FIXES: transcript slips and wrong
// names corrected at load, same mechanism as DATE_FIXES (headline, standfirst and body; store untouched).
export const EDITORIAL_HOLD = ["75sW8Npstxc", "FSZsnOIf2r0", "Jol89_DwTyw", "LHBA2P-FMoM", "LcQCpRj9sPw", "Q8ShFZsqxG0", "SkfxNLTD-pw", "YfVO94fNq5k", "cCISra9NEe0", "clZ_l78kh3A", "ioVELS95be4", "nrOx3-1C2Tg", "uZRcRqIN3EY", "vD0BmUziPhg"];
export const EDITORIAL_FIXES = [
  ["PYMMYiTzLBo", "Vanguard's Launch Map, New Town and Three Black Ops 2 Maps Bottom Out the List", "Vanguard's Launch Map, Nuketown and Die Rise Bottom Out the List"],
  ["PYMMYiTzLBo", "Number 49 was New Town from Black Ops 2", "Number 49 was Nuketown from Black Ops 2"],
  ["PYMMYiTzLBo", "Shangri-La, Alpha Omega and Blood of the Dead Show Their Flaws in the Middle", "Shangri-La, Carrier and The Giant Show Their Flaws in the Middle"],
  ["PYMMYiTzLBo", "introducing the Blundergat and an underwater facility hunting the villain Oz", "set in an underwater facility where players hunt the villain Oz"],
  ["PYMMYiTzLBo", "Number seven was Nuketown from Black Ops 4, set in a gladiatorial arena", "Number seven was IX from Black Ops 4, set in a gladiatorial arena"],
  ["PYMMYiTzLBo", "Looking back four years later, I got absolutely cooked for this list. In my words, \"I got", "Looking back four years later, in my words, \"I got"],
  ["sF8PSYnWsdw", "Flooded in Ghost is based", "Flooded in Ghosts is based"],
  ["sF8PSYnWsdw", "arguably the worst map in Ghost,", "arguably the worst map in Ghosts,"],
  ["sF8PSYnWsdw", "Broadcast, sorry, Bog in COD 4 recreates", "Bog in COD 4 recreates"],
  ["sF8PSYnWsdw", "Bream in Modern Warfare 2 is based", "Breenbergh Hotel in Modern Warfare II (2022) is based"],
  ["sF8PSYnWsdw", "Bream, arguably the best map in Modern Warfare 2 even though", "Breenbergh Hotel, arguably the best map in 2022's Modern Warfare II even though"],
  ["sF8PSYnWsdw", "Favela in Modern Warfare 2 recreates", "Favela in Modern Warfare 2 (2009) recreates"],
  ["sF8PSYnWsdw", "Terminal, sorry, Crown Raceway in Modern Warfare 2 is", "Crown Raceway in Modern Warfare II (2022) is"],
  ["sF8PSYnWsdw", "Stonehaven in Ghost is set", "Stonehaven in Ghosts is set"],
  ["sF8PSYnWsdw", "maps in Call of Duty Ghost,", "maps in Call of Duty: Ghosts,"],
  ["EJ5gG68-a8w", "Forespoken", "Forspoken"],
  ["EJ5gG68-a8w", "With a sequel officially announced, reinstalling the first game and forcing through the initial hours reveals what others found compelling.", "Reinstalling it and forcing through the initial hours reveals what others found compelling."],
  ["BTPDlHY785Q", "The IDKFA code, which granted unlimited ammo, armor, and health in Doom, would strip all health and armor in Heretic and label the player as a cheater.", "The IDKFA code, which granted every weapon, full ammo, all keys and armor in Doom, would strip the player's weapons in Heretic and label them a cheater."],
  ["BTPDlHY785Q", "When detected, the game would permanently break the cartridge, removing", "When detected, the game would deliberately sabotage itself, removing"],
  ["BTPDlHY785Q", "or withstand any damage. The damage could not be reversed.", "or withstand any damage."],
  ["BTPDlHY785Q", "trigger character Gruntalda to warn", "trigger the witch Gruntilda to warn"],
  ["BTPDlHY785Q", "combining punishment with the game's Star Wars theme", "a nod to LucasArts' best-known franchise"],
  ["Zjyf1zimNc0", "the film privately began filming over the weekend", "the film privately began filming in late August"],
  ["Zjyf1zimNc0", "and reshoots for Avengers: Doomsday are happening right now, confirmed separately", "and reshoots for Avengers: Doomsday were under way at the same time, confirmed separately"],
  ["Zjyf1zimNc0", "privately started filming over the weekend", "privately started filming in late August"],
  ["Zjyf1zimNc0", "seemingly filmed some scenes privately over the weekend", "seemingly filmed some scenes privately in late August"],
  ["Zjyf1zimNc0", "Magneto's casting has already been separately confirmed by Deadline, with Lee Pace", "Deadline has separately reported on the search for Magneto, with Lee Pace"],
  ["Zjyf1zimNc0", "the cable and Mr. Sinister arc", "the Cable and Mr. Sinister arc"],
  ["Zjyf1zimNc0", "Phantom X", "Fantomex"],
  ["Zjyf1zimNc0", "asking the X-Men to help destroy Weapon 12, who turns out to be Weapon 13, a figure who escaped in a manner similar to Wolverine", "asking the X-Men to help destroy Weapon XII, and is later revealed to be Weapon XIII himself, a living weapon who escaped the program much as Wolverine did"],
  ["pjM2XRyF9UA", "Now that this reaction and review are out, what did you think", "What did you think"],
  ["03P20R_Z5Dg", "Shuri 2", "Shang-Chi 2"],
  ["03P20R_Z5Dg", "The Cosmic Wonder breaks down which confirmed and rumored Marvel projects", "Which confirmed and rumored Marvel projects"],
  ["03P20R_Z5Dg", "The plan originally had director Destin Daniel Cretton attached before Avengers: Kang Dynasty, but those plans shifted and he ended up directing Spider-Man instead.", "Director Destin Daniel Cretton was attached before he moved to Avengers: Kang Dynasty, but those plans shifted and he ended up directing Spider-Man: Brand New Day instead."],
  ["03P20R_Z5Dg", "Even though Shang-Chi 2 is not coming before the other announced films, Shuri is expected", "Even though Shang-Chi 2 is not coming before the other announced films, Shang-Chi is expected"],
  ["ybiqoaMJrjc", "When the Romulans finally return in the 2260s", "When the Romulans finally return in the 2360s"],
  ["ybiqoaMJrjc", "We are not claiming Q built the collective, the record will not carry that, but the record does show a being with a hostile history against exactly one species that could expose him, destroyed in his lifetime by the one enemy purpose fit to destroy them while he watched and said nothing.", "I am not claiming Q built the collective, the record will not carry that, but it does show a being with a hostile history with exactly one species that could expose him, and that species destroyed in his lifetime by the one enemy best suited to the job while he watched and said nothing."],
  ["ybiqoaMJrjc", "Vger", "V'Ger"],
  ["zyN527oP580", "Before episode two makes any of this easier, I'm putting some calls on the record.", "Based on episode one alone, I'm putting some calls on the record."],
  ["zyN527oP580", "an 1988 series", "a 1988 series"],
  ["zyN527oP580", "his history was later revised to make him a Marine before the character was given both, a Marine who becomes an architect", "his history was later revised to make him a Marine, and eventually he was given both: a Marine who becomes an architect"],
  ["zyN527oP580", "Lanterns is not the Green Lantern is true if", "\"Lanterns is not the Green Lantern\" is true if"],
  ["zyN527oP580", "Lanterns is going to be great can still be true", "\"Lanterns is going to be great\" can still be true"],
  ["zyN527oP580", "Jon ", "John "],
  ["zyN527oP580", "Jon'", "John'"],
  ["SWwsCuPQFP0", "Knights of the Sentinels", "Night of the Sentinels"],
  ["SWwsCuPQFP0", "Stanley narrated", "Stan Lee narrated"],
  ["SWwsCuPQFP0", "Sidney Yu An Tung", "Sidney Iwanter"],
  ["zRi_vIXe3hc", "She cut Spellbound and most of Taika Waititi's filmography, including What We Do in the Shadows, Hunt for the Wilderpeople, Thor: Ragnarok and Jojo Rabbit.", "She cut Spellbound and Taika Waititi's What We Do in the Shadows and Hunt for the Wilderpeople."],
  ["zRi_vIXe3hc", "there is a version of this video where", "there is a version of this review where"],
  ["GEukusP-kKs", "at the hour 22 mark", "at the 1 hour 22 minute mark"],
  ["GEukusP-kKs", "about a real-life antivirus, which the government claims is what the Texas site is quarantining", "about hantavirus, the real-life virus the government claims the Texas site is quarantining"],
  ["GEukusP-kKs", "becoming digestation for a new alien race", "becoming hosts for the gestation of a new alien race"],
  ["GEukusP-kKs", "the 1978 film Swarm", "the 1978 film The Swarm"],
  ["GEukusP-kKs", "a fake-out the creator felt was well scored musically", "a fake-out I felt was well scored musically"],
  ["GEukusP-kKs", "The Black-Haired Man Is Shot as Scully Is Taken", "Mulder Is Shot as Scully Is Taken"],
  ["GEukusP-kKs", "Mulder recognizes the driver of the ambulance as the black-haired man and shoots him, echoing", "Mulder recognizes the ambulance driver as the black-haired man, who shoots him at close range, echoing"],
  ["9gJ4Lj08UKY", "As I put it, \"that's the point is we knew what it was.\" ", ""],
  ["tAvJuZcRyrw", "A countdown through every mainline Star Wars film picks out the single decision in each one that did the most damage, ending with a tie for the number one spot.", "A run through every theatrical Star Wars film picks out the single decision in each one that did the most damage."],
  ["tAvJuZcRyrw", "That is the centerpiece of a full countdown through every Star Wars movie", "That is the centerpiece of a run through every Star Wars movie"],
  ["tAvJuZcRyrw", "ChaosCinema Ranks the Biggest Mistake", "ChaosCinema Picks the Biggest Mistake"],
  ["uJiFqHxjppk", "\"It was raw.\"", "It was raw."],
  ["uJiFqHxjppk", "\"He could have become Enterprise's version of Worf,\"", "He could have become Enterprise's version of Worf,"],
  ["uJiFqHxjppk", "\"That was a pitch. It was not a completed episode ready to end production, but it was a pitch.\"", "That was only a pitch, not a completed episode ready to enter production."],
  ["XWxP5cWojV4", "My Time to Shine Hello", "MyTimeToShineHello"],
  ["XWxP5cWojV4", "Cavill is already 42", "Cavill is already 43"],
  ["nh0Y0kfrHs4", "Season 1 communicated that, not great at times.", "Season 1 communicated that, if not always well."],
  ["nh0Y0kfrHs4", "That is, as I put it, \"way stronger than spending another season asking which twin is standing in the room.\"", "That is way stronger than spending another season asking which twin is standing in the room."],
  ["cOFfbgW5vN0", "her half brother Nightcrawler", "her adoptive brother Nightcrawler"],
  ["cOFfbgW5vN0", "zapped by the wild Sentinel in episode 6", "zapped by the wild Sentinel in episode 5"],
  ["cOFfbgW5vN0", "unaired Pride of the X-Men pilot", "1989 Pryde of the X-Men pilot"],
  ["cOFfbgW5vN0", "Uncanny X-Men number one from 1963", "X-Men number one from 1963"],
  ["cOFfbgW5vN0", "severed heads and limbs could be refused", "severed heads and limbs could be re-fused"],
  ["cOFfbgW5vN0", "\"in space no one can hear you snark oh how I've waited to say these two words to you old friend shut up\"", "\"In space, no one can hear you snark. Oh, how I've waited to say these two words to you, old friend: shut up.\""],
  ["8THUXFI59jo", "That is one of 50 additional details and Easter eggs I left out of my massive breakdown of the film, and I am sharing all of them here.", "That is one of the extra details and Easter eggs I left out of my main breakdown of the film, and here are the rest."],
  ["8THUXFI59jo", "Detail number two: if you listen closely", "If you listen closely"],
  ["8THUXFI59jo", "Detail 11: yes, Ganke Lee", "Yes, Ganke Lee"],
  ["8THUXFI59jo", "decided to give Rio Morales's surname of Morales", "decided to give Miles his mother's surname of Morales"],
  ["8THUXFI59jo", ", which I apologise in advance for mispronouncing", ""],
  ["8THUXFI59jo", "Composer Metro Boomin", "Soundtrack producer Metro Boomin"],
  ["8THUXFI59jo", "As I put it: \"how low is the life expectancy of this place\".", "Which makes me wonder how low the life expectancy of this place is."],
  ["8THUXFI59jo", "\"I'm not telling you what to think,\" but these animators", "I'm not telling you what to think, but these animators"],
  ["ifTdbDAcd9U__t3", "Jon ", "John "],
  ["ifTdbDAcd9U__t3", "Jon'", "John'"],
  ["ifTdbDAcd9U__t3", "Jon,", "John,"],
  ["ifTdbDAcd9U__t3", "Jon.", "John."],
  ["xGwVPYCrgME", "a woman who wanted her wife's brother alive but her wife's sister-in-law kept quiet because she is a problem.", "a woman who wanted her wife's brother, Daniel, alive, and his wife, Helen, kept quiet because she is a problem."],
];
export const DATED_IDS = [
  "-4QU76wzWOM", "-ywzCKKPpOI", "2owGtFMcyR0", "3CtzjeYkMhw", "40ci88x8Cl8", "4RoCzA_INZ0",
  "75sW8Npstxc", "ASarfon5VHk", "AeHDhlQeMVI", "CPCDubI2GyA", "CniP8riFc88", "Crs8wmUMkw4",
  "D8HczYJBNrc", "DkZDabzaQT8", "E81Io2ddmgw", "II8XeDMKLqM", "IudWk1vfly4", "JRi9m_GcVQc",
  "JZdr64CzfhM", "JdTzba6ddF8", "K5rkYzlq79c", "KN7efkwFMA8", "KxJTLpVcDwg", "LhNP4piRP8k",
  "MMhXsGHCkfE", "N_29qTiUSFo", "Oaj0wm13JyQ", "Oe0_heyjYEk", "Rkkk9_xz0lU", "SJ0BpMmu_2U",
  "Srgl-KJOOAs", "Tiq_OzEC_oA", "TupbeHzX2-U", "W5IzuA4Gtk0", "X_gDrSn9Dqo", "YznqLLQRFXc",
  "ZS4wSN0pDMs__t20", "_g6-TYV2uo0", "aQH7nc67ZZs", "bDZqzJF4218", "bfHP-Ag-rTE", "cStswtAVSiw",
  "dYhimjWpmlc", "drONnMIL3sU", "fNujcjPGPVc", "faoxn5HzUV8", "iVECSRebjDo", "imEN609ZGV4",
  "kkhVtb_MhZs", "kzI4R1DwXb0", "l1JnbGnI15s", "m800yvSGuaw", "oSwaLyEhbzo", "pdg0kSGPlQM",
  "qRj7uQwgJiQ", "q_8cCpQ9V38", "qii3Jd4HVBs", "ueAeCu6UE7s", "vtHPDuQ6OFI", "wcE83M_g29w__t5",
  "yRu6VoJgE-c", "ynUOk98o5vI", "zU4zUfLqqxU",
];

// PASSED DATES, REWRITTEN 18 Oct 2026. Each entry is [article id, text as published, corrected text]. Applied to the
// headline, subheadline and body when the site loads; the store is untouched, so the publisher cannot undo them.
// Every "find" text was checked to occur exactly once in the article as the site renders it.
export const DATE_FIXES = [
[
"oSwaLyEhbzo",
"is expected to sell for up to £20,000 at auction on 15 October, and the reason",
"was expected to sell for up to £20,000 at auction on 15 October, and the reason"
],
[
"W5IzuA4Gtk0",
"is a free upgrade for existing owners, arriving 29th of September.",
"is a free upgrade for existing owners, released on 29 September."
],
[
"X_gDrSn9Dqo",
"Rockstar's own GTA 6 extended look lands on Netflix on the 27th.",
"Rockstar's own GTA 6 extended look landed on Netflix on 27 August."
],
[
"DkZDabzaQT8",
", and I will get into that in more detail later this week.",
"."
],
[
"ueAeCu6UE7s",
"A lot of how it lands is going to depend on how they represent him in that hologram next week.",
"A lot of how it lands was always going to depend on how they represented him in that hologram in the finale."
],
[
"AeHDhlQeMVI",
"which arrives on Peacock October 15",
"which arrived on Peacock on October 15"
],
[
"AeHDhlQeMVI",
"Crystal Lake drops its entire season, all eight episodes, on Peacock on October 15th, this Thursday.",
"Crystal Lake dropped its entire season, all eight episodes, on Peacock on October 15th."
],
[
"IudWk1vfly4",
"and it hasn't hit China or Japan yet: China arrives tomorrow and Japan on Friday, so it should easily become the franchise's top film.",
"and at the time it still had China and Japan to come, with China opening the next day and Japan that Friday, so it looked set to become the franchise's top film."
],
[
"LhNP4piRP8k",
"and I hope Lanterns sticks the landing with its season finale on Sunday.",
"and I was hoping Lanterns would stick the landing with its season finale on Sunday, October 4."
],
[
"faoxn5HzUV8",
"who is my favorite character on a new show that starts on Thursday;",
"who is my favorite character on a new show that started on October 1;"
],
[
"3CtzjeYkMhw",
"Street Fighter and Clayface both have tickets going on sale this week, with Street Fighter also landing in IMAX, and neither has enough A-list reservations right now,",
"Street Fighter and Clayface both had tickets going on sale that week, with Street Fighter also landing in IMAX, and neither had enough A-list reservations at the time,"
],
[
"3CtzjeYkMhw",
"DreamWorks releases its animated film Forgotten Island this week.",
"DreamWorks released its animated film Forgotten Island that same week."
],
[
"SJ0BpMmu_2U",
"though I cannot review it until it drops on October 1st, I expect",
"though I could not review it until it dropped on October 1st, I expect"
],
[
"SJ0BpMmu_2U",
"The Traitors returns this week with civilian contestants",
"The Traitors returned that week with civilian contestants"
],
[
"pdg0kSGPlQM",
"How do you think Resident Evil will perform this weekend, and can it prove Zach Cregger is more than a one hit wonder?",
"Can Resident Evil prove Zach Cregger is more than a one hit wonder?"
],
[
"-ywzCKKPpOI",
"Infinity Ward's DMZ Week Starting October 4th Needs to Show Substance",
"Infinity Ward's DMZ Week From October 4th Needed to Show Substance"
],
[
"-ywzCKKPpOI",
"Infinity Ward has announced five days of DMZ coverage beginning October 4th,",
"Infinity Ward announced five days of DMZ coverage beginning October 4th,"
],
[
"aQH7nc67ZZs",
"Modern Warfare 4's Beta Arrives Today With Its First Ever Campaign Mission",
"Modern Warfare 4's Beta Arrived With Its First Ever Campaign Mission"
],
[
"aQH7nc67ZZs",
"The Modern Warfare 4 beta starts today, and it's a big deal.",
"The Modern Warfare 4 beta started on August 22, and it was a big deal."
],
[
"aQH7nc67ZZs",
"requires a pre-order to access, and it starts today, so this should be a peak moment for pre-orders.",
"required a pre-order to access, so its start on August 22 was a peak moment for pre-orders."
],
[
"75sW8Npstxc",
"launches August 13th on PC",
"launched August 13th on PC"
],
[
"75sW8Npstxc",
"arrives August 11th with retro",
"arrived August 11th with retro"
],
[
"75sW8Npstxc",
"releases August 18th via 3D Realms",
"released August 18th via 3D Realms"
],
[
"MMhXsGHCkfE",
"Marvel's marketing push for Avengers Doomsday is entering full swing, with the official first trailer arriving at San Diego Comic-Con on July 25th.",
"Marvel's marketing push for Avengers Doomsday was entering full swing, with the official first trailer set for San Diego Comic-Con on July 25th."
],
[
"imEN609ZGV4",
"VisionQuest premieres tonight on Disney Plus, and the first reviews",
"VisionQuest premiered on Disney Plus on October 14, and the first reviews"
],
[
"m800yvSGuaw",
"Avengers Endgame Encore is set for release next week on September 25th in most places, though here in the US you can actually find showings starting September 24th.",
"Avengers Endgame Encore was released on September 25th in most places, with US showings starting September 24th."
],
[
"JRi9m_GcVQc",
"point to a brand new Avengers Doomsday trailer arriving by the end of this month or sometime next month, and there is a good chance",
"pointed to a brand new Avengers Doomsday trailer arriving by the end of September or sometime in October, and there was a good chance"
],
[
"2owGtFMcyR0",
"That Endgame Encore doesn't come out until September 25th with the new Doomsday footage attached, but Marvel is being extremely structured",
"That Endgame Encore did not come out until September 25th with the new Doomsday footage attached, and Marvel was being extremely structured"
],
[
"Oaj0wm13JyQ",
"Dragon Ball Super Beerus episode 1 premieres this Sunday evening in Japan, which is morning for us over here.",
"Dragon Ball Super Beerus episode 1 premiered on Sunday evening, October 11, in Japan, which was morning in the US."
],
[
"Crs8wmUMkw4",
"The 19 episode series debuts on Fuji TV on October 11,",
"The 19 episode series debuted on Fuji TV on October 11,"
],
[
"Crs8wmUMkw4",
"will arrive on the service starting October 17, but that date puts it a full week behind",
"would arrive on the service starting October 17, a full week behind"
],
[
"Crs8wmUMkw4",
"Dragon Ball Super Beerus premieres on Fuji TV on October 11",
"Dragon Ball Super Beerus premiered on Fuji TV on October 11"
],
[
"Oe0_heyjYEk",
"Dragon Ball Super Beerus Premieres October 11 on Fuji TV",
"Dragon Ball Super Beerus Premiered October 11 on Fuji TV"
],
[
"Tiq_OzEC_oA",
"The new broadcast begins October 11, a Sunday, at 11:15 p.m.",
"The new broadcast began on Sunday, October 11, at 11:15 p.m."
],
[
"ASarfon5VHk",
"The panel is scheduled for Thursday, October 8, from 12:00 p.m.",
"The panel was held on Thursday, October 8, from 12:00 p.m."
],
[
"N_29qTiUSFo",
"The Lanterns finale airs October 4th, and HBO kept the trailer under wraps",
"The Lanterns finale aired October 4th, and HBO kept the trailer under wraps"
],
[
"N_29qTiUSFo",
"The season finale airs October 4th and is rumoured to be titled Dirt and Stars.",
"The season finale aired October 4th and was rumoured to be titled Dirt and Stars."
],
[
"-4QU76wzWOM",
"The episode arrives on September 27th, and according to the wiki, the title is The Jordan Boys Legacy.",
"The episode arrived on September 27th, and according to the wiki, the title is The Jordan Boys Legacy."
],
[
"CPCDubI2GyA",
"The first episode launches August 27th with new episodes airing weekly, and the fifth episode, covering Endgame, will coincide",
"The first episode launched August 27th with new episodes airing weekly, and the fifth episode, covering Endgame, was set to coincide"
],
[
"K5rkYzlq79c",
"D23 kicked off today, and from what I'm hearing, the panel dropping later tonight is going to be the only thing anyone is talking about",
"When D23 kicked off on August 15, the word was that the panel that night would be the only thing anyone talked about"
],
[
"D8HczYJBNrc",
"With Lantern set to premiere on HBO this Sunday, The Ankler published",
"With Lanterns set to premiere on HBO on Sunday, August 16, The Ankler published"
],
[
"D8HczYJBNrc",
"and Lanterns debuts this Sunday, but the rest",
"and Lanterns debuted on August 16, but the rest"
],
[
"yRu6VoJgE-c",
"IMAX screenings launching later this week could add substantial revenue.",
"IMAX screenings launching later that week were expected to add substantial revenue."
],
[
"40ci88x8Cl8",
"from the upcoming Spider-Man film arriving next week,",
"from the Spider-Man film that was arriving the following week,"
],
[
"TupbeHzX2-U",
"The Odyssey releases on July 17, 2026.",
"The Odyssey was released on July 17, 2026."
],
[
"II8XeDMKLqM",
"Toy Story will likely dominate for at least two weeks, with Minions and Monsters arriving July 1st.",
"Toy Story was expected to dominate for at least two weeks, with Minions and Monsters arriving July 1st."
],
[
"ZS4wSN0pDMs__t20",
"Double Episode Drops Begin October 14",
"Double Episode Drops Began October 14"
],
[
"ZS4wSN0pDMs__t20",
"Vision Quest is coming to Disney Plus on Wednesdays at 6 PM Pacific, and the first three weeks of the show are going to be double episode drops, starting October 14.",
"Vision Quest airs on Disney Plus on Wednesdays at 6 PM Pacific, and its first three weeks are double episode drops, starting October 14."
],
[
"drONnMIL3sU",
"Marvel's VisionQuest premieres with two episodes on October 14 on Disney Plus, and this is the complete history you need to go in caught up.",
"Marvel's VisionQuest premiered with two episodes on October 14 on Disney Plus, and this is the complete history you need to be caught up."
],
[
"kkhVtb_MhZs",
"It all starts with a two episode premiere on October 14th.",
"It all started with a two episode premiere on October 14th."
],
[
"bfHP-Ag-rTE",
"The series is set to premiere October 14th.",
"The series premiered on October 14th."
],
[
"qii3Jd4HVBs",
"We disagreed slightly on whether a trailer drops tomorrow, but agreed",
"We disagreed slightly on whether a trailer would drop at D23, but agreed"
],
[
"kzI4R1DwXb0",
"Vision Quest is the new series coming to Disney Plus on October 14th,",
"Vision Quest is the series that arrived on Disney Plus on October 14th,"
],
[
"CniP8riFc88",
"yet it is opening in theaters on August 28th anyway.",
"yet it opened in theaters on August 28th anyway."
],
[
"vtHPDuQ6OFI",
"That one releases October 14th, 2026.",
"That one was released on October 14th, 2026."
],
[
"ynUOk98o5vI",
"VisionQuest comes out next week on October 14th, and Avengers: Doomsday arrives on December 18th.",
"VisionQuest came out on October 14th, and Avengers: Doomsday arrives on December 18th."
],
[
"q_8cCpQ9V38",
"The trailer is reportedly, though not confirmed by Marvel, set to release globally on September 25.",
"The trailer was reportedly, though not confirmed by Marvel, set to release globally on September 25."
],
[
"q_8cCpQ9V38",
"and then stated that something will be shown worldwide on Friday according to his source.",
"and then stated that something would be shown worldwide on Friday, September 25, according to his source."
],
[
"Srgl-KJOOAs",
"Endgame Encore comes out September 25th, just a month later,",
"Endgame Encore came out September 25th, just a month later,"
],
[
"KN7efkwFMA8",
"but it will now open on October 6, 2023.",
"before being moved to October 6, 2023, and then pushed back again."
],
[
"fNujcjPGPVc",
"Avengers: Endgame Encore Arrives September 25, 2026 With New Doomsday-Connected Footage",
"Avengers: Endgame Encore Arrived September 25, 2026 With New Doomsday-Connected Footage"
],
[
"fNujcjPGPVc",
"The next project up is Avengers: Endgame Encore, coming out September 25, 2026.",
"The next project up was Avengers: Endgame Encore, which came out September 25, 2026."
],
[
"fNujcjPGPVc",
"Vision Quest Closes Out the Wanda Trilogy on October 14, 2026",
"Vision Quest Closed Out the Wanda Trilogy From October 14, 2026"
],
[
"dYhimjWpmlc",
"arrives ahead of its October 2 release.",
"arrived ahead of its October 2 release."
],
[
"dYhimjWpmlc",
"and it drops in theaters October 2, which is roughly two months away.",
"and it opened in theaters on October 2."
],
[
"wcE83M_g29w__t5",
"Allegedly he also has an interview scheduled to release tomorrow, a little pregame, I think, with Bret Baier on Fox News.",
"Allegedly he also had an interview scheduled to release the next day, a little pregame, with Bret Baier on Fox News."
],
[
"iVECSRebjDo",
"I think Rockstar is probably preparing some kind of formal music reveal very soon, whether that lands this week, later this month, or as part of a larger September marketing beat.",
"I think Rockstar was probably preparing some kind of formal music reveal, possibly as part of a larger September marketing beat."
],
[
"YznqLLQRFXc",
"The Witcher 3 Remastered launches September 29th, 2026.",
"The Witcher 3 Remastered launched September 29th, 2026."
],
[
"cStswtAVSiw",
"The Witcher 3 Remastered Launches Free on September 29, With Songs of the Past Coming in 2027",
"The Witcher 3 Remastered Launched Free on September 29, With Songs of the Past Coming in 2027"
],
[
"cStswtAVSiw",
"is releasing on September 29, 2026, and the whole upgrade is free.",
"would release on September 29, 2026, and the whole upgrade is free."
],
[
"cStswtAVSiw",
"The Witcher 3 Remastered Launches Free on September 29, 2026",
"The Witcher 3 Remastered Launched Free on September 29, 2026"
],
[
"4RoCzA_INZ0",
"vampire RPG launches September 3 with 55-70 hours",
"vampire RPG launched September 3 with 55-70 hours"
],
[
"4RoCzA_INZ0",
"Blood of Dawnwalker is launching September 3 as an open-world dark fantasy RPG that could blindside players this year.",
"Blood of Dawnwalker launched September 3 as an open-world dark fantasy RPG that could blindside players this year."
],
[
"JZdr64CzfhM",
"Ubisoft is confirmed as an exhibitor at Gamescom Opening Night Live on August 25,",
"Ubisoft was confirmed as an exhibitor at Gamescom Opening Night Live on August 25,"
],
[
"bDZqzJF4218",
"Rockstar's marketing plan is set to accelerate next month, with a major investor call scheduled for early August.",
"Rockstar's marketing plan was set to accelerate, with a major investor call scheduled for early August."
],
[
"E81Io2ddmgw",
"and all eight films will screen worldwide from August 27th through September 3rd.",
"and all eight films screened worldwide from August 27th through September 3rd."
],
[
"E81Io2ddmgw",
"If Hogwarts Legacy 2 is announced on September 1st, it likely won't be a full gameplay breakdown.",
"If Hogwarts Legacy 2 was announced on September 1st, it was unlikely to be a full gameplay breakdown."
],
[
"l1JnbGnI15s",
"Gamescom Opening Night Live is confirmed for Tuesday, August 25th, 2026,",
"Gamescom Opening Night Live took place on Tuesday, August 25th, 2026,"
],
[
"qRj7uQwgJiQ",
"and I am assuming episode 8 will not even be locked until later this month.",
"and I was assuming episode 8 would not even be locked until later in September."
],
[
"qRj7uQwgJiQ",
"and we will not know for sure until the episode airs.",
"and there was no way to know for sure until the episode aired."
]
];


export const REVIEW_SET = [
  "JOFMVYJFVR4", "dVDVnbpeco4", "jkJfhdqfSrE", "QKEOyUJ5oJQ", "ECdZTmkiN5U", "tmdRhQm4Ask",
  "N69s8oDSD-E", "ZHMmndWNelQ", "hVHYb8lZKhk", "RcyW0YLDxYU", "1yeVdXjnPMM", "dVpDUQoeM_Q",
  "gkkljDxvtgE", "KJsvGbE3E1o", "QHXt9HKjQM4", "1IMNyHGtPNY", "-bX68Czfv_Y", "gtyOJoXBlAY",
  "90Wco6PuQC4", "byyS9TCgbB8", "fPLUODZ_1sI", "m2LbWXdEHBk", "bbHmfxZlzVo", "rdjLDT557yM",
  "nL1QUuc2kdA", "kyAq4hV3DOU", "ed8YLzWYQTY", "Xd8ArT-MeMM", "JOdLqPumrL0", "2N30ikVRPjQ",
  // Added 3 Oct 2026 (Tom: go to 50 if they pass; 13 more passed the same checks).
  "gy673tq6CR4", "0Iz3a1Jd1Ok", "N_iOHF2a2K8", "_VdSv4t-S-Q", "c9hqOnFYpBQ", "rztW3ozx-_k",
  "nsrUPTJ-XEg", "tPuQhyOkyuU", "8tiGf8QMOwU", "_ahRLcUA7z0", "X5psFyTuA1s", "w2EwJGZNOMY",
  "REqdcJvHgUA",
];

// See the SNIPPETS OFF note in loadData. false = Snippets hidden site-wide.
export const SNIPPETS_LIVE = true; // back on at launch, 18 Oct 2026 (Tom: "get the snippets going")

// An article by id, long-form or Snippet. Routes and sitemaps use this rather than reaching
// into data.arts, so a Snippet's URL resolves like any other article's.
export const findArt = (data, id) => data.arts.find(a => a.id === id) || (data.snippets || []).find(a => a.id === id) || null;
