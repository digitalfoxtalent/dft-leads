// SUBPLOT data layer — reads the article store the publisher writes to (Apify KV
// store youtube-mrss-feeds) and shapes it for the site. Server-side only.
// Cached per lambda instance for TTL_MS; the CDN caches rendered pages on top.

import { formatOf } from "./formats.js";

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
const isoSeconds = d => { const m = String(d || "").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };
async function addDurations(arts, floor) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return;
  const maybe = arts.filter(a => a.short || a.w < floor);
  for (let i = 0; i < maybe.length; i += 50) {
    const batch = maybe.slice(i, i + 50);
    try {
      const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${batch.map(a => a.v).join(",")}&key=${key}`);
      if (!r.ok) continue;
      const j = await r.json();
      for (const it of j.items || []) {
        const a = batch.find(x => x.v === it.id); if (!a) continue;
        a.dur = isoSeconds(it.contentDetails?.duration);
        if (a.dur > 0 && a.dur <= SHORT_MAX_S) a.short = true;
      }
    } catch { /* leave the batch alone */ }
  }
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
  for (let i = 0; i < arts.length; i += 25) {
    const batch = arts.slice(i, i + 25).filter(a => ids(a).length);
    if (!batch.length) continue;
    try {
      const ask = [...new Set(batch.flatMap(ids))];
      const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=id&id=${ask.join(",")}&key=${key}`);
      if (!r.ok) continue;
      const j = await r.json();
      const live = new Set((j.items || []).map(it => it.id));
      if (!live.size) continue;                 // whole batch missing = suspect the API, not the videos
      for (const a of batch) if (!ids(a).some(id => live.has(id))) gone.push(a);
    } catch { /* leave the batch alone */ }
  }
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
    for (const a of res.value) {
      if (!a || !a.guid || !a.headline || !a.thumbnail || seen.has(a.guid)) continue;
      if (/^unable to generate/i.test(a.headline)) continue;
      const brand = cleanBrand(a.displayName);        // feeds without a displayName are old playlist experiments — skip
      if (!brand || !a.creator) continue;
      seen.add(a.guid);
      const v = (String(a.link || "").match(/v=([\w-]+)/) || [])[1] || String(a.guid).replace(/^yt-/, "");
      arts.push({
        id: String(a.guid).replace(/^yt-/, ""),
        h: noDash(a.headline), s: noDash(a.subheadline), body: noDash(trimSignoff(a.body_html || "")),
        w: a.word_count || 0, rt: Math.max(1, Math.round((a.word_count || 0) / 220)),
        t: (a.tags || []).slice(0, 8), b: brand, c: a.creator,
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
  const MIN_WORDS = Number(process.env.SUBPLOT_MIN_WORDS ?? 400);
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
  { const hold = new Set(STALE_HOLD); const kept = arts.filter(a => !hold.has(a.id)); arts.length = 0; arts.push(...kept); }

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
export const STALE_HOLD = [
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
