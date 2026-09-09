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
  { slug: "thekristianharloff", name: "Kristian Harloff",                           handles: ["@thekristianharloff"] },         // Kristian Harloff
  { slug: "chaosgaming", name: "Chaos",                                             handles: ["@chaosgaming"] },                // Chaos
  { slug: "chaostrektv", name: "ChaosTrek",                                         handles: ["@chaostrektv"] },                // ChaosTrek
  { slug: "wesnemo", name: "WesNemo",                                               handles: ["@wesnemo"] },                    // WesNemo
  { slug: "film_paradise", name: "Film Paradise",                                   handles: ["@film_paradise"] },              // Film Paradise
  { slug: "lorereloaded", name: "Lore Reloaded",                                    handles: ["@lorereloaded"] },               // Lore Reloaded
  { slug: "arealknowitall", name: "Mr. Know-It-All",                                handles: ["@arealknowitall"] },             // Mr. Know-It-All (no articles yet; appears when his feed fills)
  { slug: "coltonogburnchannel", name: "Colton Ogburn",                             handles: ["@coltonogburnchannel"] },        // Colton Ogburn
  { slug: "everythingalways", name: "Everything Always",                            handles: ["@everythingalways"] },           // Everything Always
  { slug: "gique_", name: "GIQUE",                                                  handles: ["@gique_"] },                     // GIQUE (DFT-owned; dormant channel, evergreen back catalogue)
  { slug: "downtoearthkh", name: "Down to Earth with Kristian Harloff",             handles: ["@downtoearthkh"] },              // Down to Earth with Kristian Harloff (MSN-banned, but that is platform-side and does not apply here)

  // Added 7 Sep 2026. All six were already "Approved" on the Article Rights board 18427697857
  // but missing here, so their creator pages and articles were 404ing on a site they had
  // agreed to. Every handle below was opened on YouTube and checked against the channel it
  // actually resolves to - name and subscriber count in the comment - because a well-formed
  // handle can still be the wrong channel (see the roster's @kristianharloff and Film Paradise
  // lookalike, both fixed 4 Sep).
  { slug: "geekdom101", name: "Geekdom101",                                        handles: ["@geekdom101"] },                 // Geekdom101, 784K
  { slug: "worldofgeekdom", name: "World of Geekdom",                              handles: ["@worldofgeekdom"] },             // World of Geekdom, 80.6K
  { slug: "geekdom101plus", name: "Geekdom101 Plus",                               handles: ["@geekdom101plus"] },             // Geekdom101 Plus, 3.41K
  { slug: "danco", name: "DanCo",                                                  handles: ["@danco"] },                      // DanCo, 583K
  // Better Gaming's HANDLE IS @yu-gg, not @bettergaming - the brand name and the handle differ.
  // The slug follows the handle, as every other slug here does, so the URL is /a/yu-gg/.
  { slug: "yu-gg", name: "Better Gaming",                                          handles: ["@yu-gg"] },                      // Better Gaming, 40.8K
  // A SECOND, SEPARATE Chaos channel - not @chaosgaming and not @chaostrektv. YouTube shows it
  // as "ChaosGaming" too, which is why it is easy to mistake for the first one. Same payee.
  { slug: "morechaosgaming", name: "ChaosGaming (second channel)",                 handles: ["@morechaosgaming"] },            // ChaosGaming, 26.7K
  { slug: "beyondthetrailer", name: "Beyond The Trailer",                        handles: ["@beyondthetrailer"] },             // Beyond The Trailer (Grace Randolph), approved 8 Sep 2026
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

// Resolves one channel per brand and rewrites each article's handle to the real one.
// Returns brand -> { handle, av, title }.
async function resolveChannels(arts) {
  const out = {};
  const now = Date.now();
  const sample = new Map();                      // brand -> a video to resolve it from
  for (const a of arts) {
    const b = a.b.toLowerCase();
    const hit = chCache.get(b);
    if (hit && now - hit.at < CH_TTL) { out[a.b] = hit; continue; }
    if (!sample.has(b) && a.v) sample.set(b, { brand: a.b, v: a.v });
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
        chCache.set(w.brand.toLowerCase(), rec);
        out[w.brand] = rec;
      }
    } catch { /* fall back to whatever the store gave us */ }
  }
  for (const a of arts) { const c = out[a.b]; if (c) a.c = c.handle; }
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

async function load() {
  const keys = (await fetchJson(STORE + "/keys?limit=1000")).data.items
    .map(i => i.key).filter(k => k.endsWith("__items"));
  const results = await Promise.allSettled(keys.map(k => fetchJson(STORE + "/records/" + k)));
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
        short: /youtube\.com\/shorts\//i.test(String(a.link || "")),
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

  // WORD COUNTS AND THE THIN-PAGE FLOOR, both added 8 Sep 2026.
  // Some store records carry no word_count. Those rendered as "0 words - 1 min read" and were
  // quietly disqualified from the lead, the secondary slots and the evergreen rail, all of which
  // test a.w. Count the body ourselves when the number is missing, so an article is judged on
  // its length rather than on whether the publisher happened to record one.
  const countWords = html => (String(html || "").replace(/<[^>]*>/g, " ").match(/\S+/g) || []).length;

  // Film Paradise's records end with their own "About this article" disclosure paragraph, so those
  // 37 pages carried the disclosure twice, once inside the article and again in the site's footer.
  // Strip the in-body copy before anything measures or renders it. No other feed does this.
  for (const a of arts) a.body = a.body.replace(/(?:<hr\s*\/?>)?\s*<p class="ai-disclosure">[\s\S]*?<\/p>/gi, "");
  for (const a of arts) if (!a.w) { a.w = countWords(a.body); a.rt = Math.max(1, Math.round(a.w / 220)); }

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
  const snippets = arts.filter(a => a.short);
  { const kept = arts.filter(a => !a.short); arts.length = 0; arts.push(...kept); }

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
  for (const a of arts) for (const [re, to] of CORRECTIONS[a.id] || []) { a.h = a.h.replace(re, to); a.s = a.s.replace(re, to); a.body = a.body.replace(re, to); }

  // creators
  const byC = new Map();
  for (const a of arts) {
    const e = byC.get(a.c) || { handle: a.c, name: a.b, n: 0, latest: a.p };
    e.n++; byC.set(a.c, e);
  }
  const panel = [...byC.values()].sort((x, y) => y.n - x.n);
  const av = {};
  for (const p of panel) { const c = channels[p.name]; p.av = (c && c.av) || ""; if (p.av) av[p.handle] = p.av; }
  // Avatars for creators who appear ONLY in Snippets. The panel above is built from long-form
  // articles, so a Shorts-only creator would otherwise fall back to initials on their own byline.
  for (const a of snippets) { if (av[a.c]) continue; const c = channels[a.b]; if (c && c.av) av[a.c] = c.av; }

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

export async function getData() {
  const now = Date.now();
  if (cache.data && now - cache.at < TTL_MS) return cache.data;
  if (!cache.pending) cache.pending = load().then(d => { cache = { at: Date.now(), data: d, pending: null }; return d; })
    .catch(err => { cache.pending = null; if (cache.data) return cache.data; throw err; });
  return cache.pending;
}

// An article by id, long-form or Snippet. Routes and sitemaps use this rather than reaching
// into data.arts, so a Snippet's URL resolves like any other article's.
export const findArt = (data, id) => data.arts.find(a => a.id === id) || (data.snippets || []).find(a => a.id === id) || null;
