// TikTok and Instagram link finder (cron /api/link-finder?pass=social, daily 08:05 UTC). Runs on Vercel.
//
// Why (Tom, 9 Oct 2026): the YouTube link finder cannot see short-form deals. Ceiling Fan CEO's music
// promos and the LoopsLab short-form flights run on TikTok and Instagram, so their rows stayed empty and
// the campaign showed nothing on its report until someone pasted the link by hand.
//
// WHICH ROWS (creator rows on US Campaigns subitems 6162879732):
//   - a won deal (not Opportunities, Contract Review, lost or cancelled), a content row (not an expense line)
//   - live (LIVE DATE start, or DATE PUBLISHED) from today back to 45 days ago
//   - DELIVERABLES names TikTok or an Instagram Reel/post (an Instagram Story disappears, so it is not
//     searched), or DELIVERABLES is empty and the creator is in the roster's Short Form group
//   - EITHER LIVE VIDEO URLS is empty and the deliverables include no long-form YouTube video (that row is
//     left to the YouTube finder, so a TikTok never takes the place of the YouTube integration)
//   - OR the row was already filled by a link finder or backfill (LINK BACKFILL = Linked): its TikTok and
//     Instagram posts are added to what is there (a YouTube Integration + TikTok deal gets both).
// The creator's handles come from the Global Talent Roster (TikTok Handle, Instagram Handle).
//
// WHICH POSTS: published from 3 days before the row's live date to 10 days after its end, and SURE:
//   sound     the post uses the TikTok sound linked in the deal name, or the sound's title (without
//             "feat." or "remix" brackets) is written in the deal name ("JordinSparksNoAir" and the sound
//             "No Air"; "Texture - Brave" and "Brave"; a short title only with its artist, "FloRidaLow"),
//             or a part of the deal name is the sound's title
//   brand     the deal's brand is in the caption as a hashtag or @mention, or written next to #ad, #sponsored
//             or "paid partnership" (jrod_hd: "#LoopsLab #Ad @Loops Lab"). A brand that is a common word
//             never counts on a plain mention.
// The artist alone is never enough (another song by the same artist is not the promo). A post that fits
// two open rows goes to the row whose live dates it falls inside; if that does not settle it, a person
// decides. More than 8 posts for one row is left for a person. Everything not sure is listed in the run
// summary (act "maybe"), never written.
//
// WRITES go through _reports/apply-links.js (row still empty, a post already on another row for the same
// brand is dropped, LINK BACKFILL = Linked, an update with the evidence). Additions to a filled row only
// ever append, never remove, and never add back a post named in any earlier update on that row: a link a
// person took out stays out. Caps: 25 rows a run; Apify spend capped at $1 per platform per run (about
// $0.002 a post, so a normal run is a few cents). The TIKTOK VIEWS and INSTAGRAM VIEWS columns are filled
// by the 09:30 social views sync (/api/social-sync), which reads these links.
//
//   GET /api/link-finder?pass=social&dry=1   (team cookie or CRON_SECRET) the plan, writes nothing.

import { monday } from "./monday.js";
import { parseSocial } from "./social.js";
import { applyLinks, linkedVideoBrands, brandKey } from "./apply-links.js";
import { skipRow, COMMON } from "./flight-match.js";

const SUB_BOARD = 6162879732, GTR_BOARD = 6160485039, D = 864e5;
const LAST_DAY = 45, BEFORE = 3, AFTER = 10, MAX_ROWS = 25, MAX_POSTS = 8, PER_PROFILE = 40, CAP_USD = 1;
const SKIP_GROUP = /opportunit|contract review|lost|cancel|declin|dead|archiv/i;
const LONG_YT = /youtube integration|dedicated|long.?form|podcast/i;

const flat = s => String(s || "").normalize("NFKD").toLowerCase().replace(/\$/g, "s").replace(/[^a-z0-9]/g, "");
const day = s => Date.parse(String(s).slice(0, 10) + "T00:00:00Z");
const iso = t => new Date(t).toISOString().slice(0, 10);
const esc = s => String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const handle = s => String(s || "").trim().replace(/^https?:\/\/(www\.)?(tiktok|instagram)\.com\/@?/i, "").replace(/^@/, "").replace(/[/?#].*$/, "").toLowerCase();
const MONTHS = /(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)(?=\d|$)/g;
const GENERIC = new Set(["originalsound", "sound", "videos", "video", "promo", "tiktok", "trackpack", "trackpromo", "songs", "song", "music", "remix", "spedup", "slowed"]);

// ---------- which platforms a row wants ----------
export function wants(deliverables, shortForm) {
  const d = String(deliverables || "");
  if (!d.trim()) return shortForm ? { tt: true, ig: true, longYT: false } : null;
  const tt = /tiktok/i.test(d);
  const ig = d.split(",").some(x => /instagram/i.test(x) && !/story/i.test(x));
  return (tt || ig) ? { tt, ig, longYT: LONG_YT.test(d) } : null;
}

// rows: loadRows() output; gtr: loadHandles() output. Returns the rows to search, with their window.
export function candidates(rows, gtr, now) {
  const today = day(iso(now || Date.now())), out = [];
  for (const r of rows) {
    if (SKIP_GROUP.test(r.stage || "") || skipRow({ row: r.row })) continue;
    const start = r.pub || r.liveStart; if (!start) continue;
    const age = (today - day(start)) / D;
    if (age < 0 || age > LAST_DAY) continue;
    const g = gtr[String(r.h || "").toLowerCase()];
    if (!g || (!g.tt && !g.ig)) continue;
    const w = wants(r.deliverables, g.shortForm); if (!w) continue;
    const empty = !String(r.links || "").trim() && !r.label;
    const topUp = !!String(r.links || "").trim() && r.label === "Linked";
    if (!empty && !topUp) continue;
    if (empty && w.longYT) continue; // the YouTube finder fills it first; this pass then adds the short-form posts
    const end = r.pub ? r.pub : (r.liveEnd || r.liveStart);
    const plat = { tt: w.tt && g.tt ? g.tt : "", ig: w.ig && g.ig ? g.ig : "" };
    if (!plat.tt && !plat.ig) continue;
    out.push({ ...r, mode: empty ? "fill" : "add", plat, a: day(start) - BEFORE * D, b: day(end) + AFTER * D, core: [day(start), day(end)] });
  }
  return out;
}

// ---------- posts ----------
// TikTok (clockworks/tiktok-scraper) and Instagram (apify/instagram-scraper) items to one shape.
export function normTikTok(it) {
  const mm = it.musicMeta || {};
  const own = handle(it.authorMeta && it.authorMeta.name);
  const original = /^original sound/i.test(mm.musicName || "") || flat(mm.musicAuthor) === flat(it.authorMeta && it.authorMeta.nickName);
  return { p: "tt", id: String(it.id || ""), url: it.webVideoUrl || ("https://www.tiktok.com/@" + own + "/video/" + it.id), owner: own, d: String(it.createTimeISO || "").slice(0, 10),
    cap: String(it.text || ""), tags: (it.hashtags || []).map(h => typeof h === "string" ? h : h && h.name).filter(Boolean), ment: (it.mentions || []).map(String),
    song: original ? "" : String(mm.musicName || ""), artist: original ? "" : String(mm.musicAuthor || ""), sid: String(mm.musicId || ""), ad: !!(it.isAd || it.isSponsored), views: it.playCount || 0 };
}
export function normInstagram(it) {
  const mi = it.musicInfo || {};
  const code = String(it.shortCode || "");
  const reel = it.productType === "clips" || /\/reel\//.test(String(it.url || ""));
  return { p: "ig", id: code, url: "https://www.instagram.com/" + (reel ? "reel" : "p") + "/" + code + "/", owner: handle(it.ownerUsername), d: String(it.timestamp || "").slice(0, 10),
    cap: String(it.caption || ""), tags: (it.hashtags || []).map(String), ment: (it.mentions || []).map(String),
    song: mi.uses_original_audio ? "" : String(mi.song_name || ""), artist: mi.uses_original_audio ? "" : String(mi.artist_name || ""), sid: "", ad: !!it.isSponsored, views: it.videoPlayCount || it.videoViewCount || 0 };
}

// The deal name without the creator, months, years and links: "JordinSparksNoAir_CeilingFanCEO" -> jordinsparksnoair
function dealParts(deal, creator) {
  const raw = String(deal || "").replace(/https?:\/\/\S+/g, " ");
  const me = [flat(creator), "ceilingfanceo", "ceilingfan", "tugboatspenny"].filter(x => x.length >= 4);
  const clean = x => { let f = flat(x); for (const m of me) f = f.split(m).join(""); return f.replace(MONTHS, "").replace(/\d+/g, ""); };
  const parts = raw.split(/[_\-–,+|]|\s+x\s+/i).map(clean).filter(x => x.length >= 5 && !GENERIC.has(x));
  return { whole: clean(raw), parts };
}
const songTitle = s => flat(String(s || "").replace(/[([].*?(feat|ft\.|with|remix|sped|slowed|version|edit).*?[)\]]/gi, " ").replace(/\s-\s.*(remix|sped up|slowed|version|edit).*$/i, ""));

// Evidence for one post against one row: null, or { sure, how }.
export function evidence(post, row) {
  const sid = (String(row.deal || "").match(/tiktok\.com\/music\/[^\s]*?(\d{12,})/) || [])[1];
  if (sid && post.sid === sid) return { sure: true, how: "uses the TikTok sound linked in the deal name" };
  const { whole, parts } = dealParts(row.deal + " " + (/^\d|song|track/i.test(row.row) ? row.row : ""), row.h);
  const st = songTitle(post.song);
  if (st.length >= 5 && !GENERIC.has(st) && whole.includes(st)) return { sure: true, how: "the sound \"" + post.song + "\" by " + post.artist + " is named in the deal" };
  const sf = flat(post.song), af = flat(post.artist);
  // A short title is sure only with its artist written next to it ("FloRidaLow" and "Low" by Flo Rida).
  if (st.length >= 3 && af.length >= 3 && (whole.includes(af + st) || whole.includes(st + af))) return { sure: true, how: "the deal names \"" + post.song + "\" by " + post.artist };
  const part = parts.find(x => sf.includes(x) && !af.includes(x));
  if (part && sf) return { sure: true, how: "the deal names the sound \"" + post.song + "\" by " + post.artist };
  // Brand: hashtag or mention, or next to an ad label.
  const bk = flat(row.brand);
  const me = flat(row.h);
  if (bk.length >= 4 && !(me.length >= 4 && (bk.includes(me) || me.includes(bk)))) {
    const tagged = post.tags.some(t => flat(t) === bk || flat(t).startsWith(bk)) || post.ment.some(m => flat(m).includes(bk)) || new RegExp("[#@]\\s?" + bk, "i").test(flat2(post.cap));
    const inCap = flat(post.cap).includes(bk);
    const adLabel = post.ad || /#ad\b|#sponsored|paid partnership|#partner\b|\bad\s*\|/i.test(post.cap);
    if (tagged && (!COMMON.test(String(row.brand).trim()) || adLabel)) return { sure: true, how: "the caption tags " + row.brand + (adLabel ? " and is marked as an ad" : "") };
    if (inCap && adLabel && !COMMON.test(String(row.brand).trim()) && bk.length >= 5) return { sure: true, how: "the caption names " + row.brand + " and is marked as an ad" };
    if (inCap) return { sure: false, how: "the caption names " + row.brand };
  }
  if (af.length >= 4 && flat(row.deal).includes(af)) return { sure: false, how: "a song by " + post.artist + " (the artist alone is not proof)" };
  return null;
}
// caption with "#" and "@" kept and spaces inside tags removed: "@Loops Lab" -> "@loopslab"
const flat2 = s => String(s || "").normalize("NFKD").toLowerCase().replace(/([#@])\s*([a-z0-9]+)\s+([a-z0-9]+)/g, "$1$2$3").replace(/[^a-z0-9#@]/g, "");

// Match all posts to all candidate rows. Returns per row: { row, sure: [posts], maybe: [posts], why }.
export function matchSocial(posts, cands) {
  const res = cands.map(c => ({ c, sure: [], maybe: [], ambiguous: [] }));
  for (const post of posts) {
    const t = day(post.d);
    const fits = [];
    for (const x of res) {
      const c = x.c;
      if (!c.plat[post.p] || handle(c.plat[post.p]) !== post.owner) continue;
      if (t < c.a || t > c.b) continue;
      const ev = evidence(post, c); if (!ev) continue;
      fits.push({ x, ev, off: t < c.core[0] ? c.core[0] - t : t > c.core[1] ? t - c.core[1] : 0 });
    }
    const sure = fits.filter(f => f.ev.sure).sort((p, q) => p.off - q.off);
    if (sure.length > 1 && sure[0].off === sure[1].off) { for (const f of sure) f.x.ambiguous.push({ ...post, how: f.ev.how }); continue; }
    if (sure.length) { sure[0].x.sure.push({ ...post, how: sure[0].ev.how }); continue; }
    for (const f of fits) f.x.maybe.push({ ...post, how: f.ev.how });
  }
  for (const x of res) {
    x.sure.sort((p, q) => p.d.localeCompare(q.d));
    if (x.sure.length > MAX_POSTS) { x.maybe = x.sure.concat(x.maybe); x.sure = []; x.tooMany = true; }
  }
  return res;
}

// ---------- monday ----------
export async function loadRows(token) {
  const fields = "cursor items { id name parent_item { id name group { title } column_values(ids:[\"dropdown_mm1a3tqp\"]) { id text } } " +
    "column_values(ids:[\"connect_boards__1\",\"text_mm6aq9qp\",\"timerange_mm1m50vx\",\"date_mm1mb38m\",\"color_mm7jh1xw\",\"dropdown_mm3y3k3e\"]) { id text ... on BoardRelationValue { display_value } } }";
  let d = await monday(token, "query { boards(ids:[" + SUB_BOARD + "]) { items_page(limit:500, query_params:{rules:[{column_id:\"timerange_mm1m50vx\", compare_value:[], operator:is_not_empty}]}) { " + fields + " } } }");
  let page = d.boards[0].items_page, items = page.items.slice(), guard = 0;
  while (page.cursor && guard++ < 10) { d = await monday(token, "query { next_items_page(limit:500, cursor:\"" + page.cursor + "\") { " + fields + " } }"); page = d.next_items_page; items = items.concat(page.items); }
  const out = [];
  for (const it of items) {
    const p = it.parent_item; if (!p) continue;
    const cv = {}; for (const c of it.column_values) cv[c.id] = (c.display_value != null && c.display_value !== "") ? c.display_value : (c.text || "");
    const tr = String(cv.timerange_mm1m50vx || "").match(/(\d{4}-\d{2}-\d{2})(?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/);
    const brandDd = (p.column_values.find(c => c.id === "dropdown_mm1a3tqp") || {}).text || "";
    out.push({ id: it.id, row: it.name, deal: p.name, dealId: p.id, stage: p.group && p.group.title, h: cv.connect_boards__1 || "",
      brand: brandDd || String(p.name).split(/[_]/)[0], links: cv.text_mm6aq9qp || "", label: cv.color_mm7jh1xw || "", deliverables: cv.dropdown_mm3y3k3e || "",
      liveStart: tr ? tr[1] : "", liveEnd: tr ? (tr[2] || tr[1]) : "", pub: cv.date_mm1mb38m || "" });
  }
  return out;
}

export async function loadHandles(token) {
  const d = await monday(token, "query { boards(ids:[" + GTR_BOARD + "]) { items_page(limit:500) { items { name group { title } column_values(ids:[\"text_mm5pqpaf\",\"text_mm5pkgn1\"]) { id text } } } } }");
  const out = {};
  for (const it of d.boards[0].items_page.items) {
    const cv = {}; for (const c of it.column_values) cv[c.id] = c.text || "";
    out[String(it.name).toLowerCase()] = { tt: handle(cv.text_mm5pqpaf), ig: handle(cv.text_mm5pkgn1), shortForm: /short form/i.test(it.group && it.group.title || "") };
  }
  return out;
}

// ---------- Apify ----------
async function apify(actor, input, fields) {
  const tok = process.env.APIFY_TOKEN; if (!tok) throw new Error("APIFY_TOKEN missing");
  const u = "https://api.apify.com/v2/acts/" + actor + "/run-sync-get-dataset-items?timeout=200&clean=1&maxTotalChargeUsd=" + CAP_USD + "&fields=" + fields + "&token=" + tok;
  const r = await fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  if (!r.ok) throw new Error("Apify " + actor + " " + r.status + " " + (await r.text()).slice(0, 160));
  return r.json();
}
export async function fetchPosts(cands, opts) {
  const since = {}, errors = [], posts = [];
  for (const c of cands) for (const p of ["tt", "ig"]) if (c.plat[p]) { const k = p + ":" + handle(c.plat[p]); since[k] = Math.min(since[k] || Infinity, c.a); }
  const tt = Object.keys(since).filter(k => k.startsWith("tt:")), ig = Object.keys(since).filter(k => k.startsWith("ig:"));
  const oldest = ks => iso(Math.min(...ks.map(k => since[k])));
  const jobs = [];
  if (tt.length) jobs.push(((opts && opts.tiktok) || (() => apify("clockworks~tiktok-scraper", { profiles: tt.map(k => k.slice(3)), resultsPerPage: PER_PROFILE, profileScrapeSections: ["videos"], profileSorting: "latest", oldestPostDateUnified: oldest(tt), shouldDownloadVideos: false, shouldDownloadCovers: false, shouldDownloadSubtitles: false, shouldDownloadSlideshowImages: false, shouldDownloadAvatars: false, shouldDownloadMusicCovers: false, commentsPerPost: 0 }, "id,createTimeISO,webVideoUrl,text,musicMeta,mentions,hashtags,isAd,isSponsored,playCount,authorMeta")))()
    .then(items => { for (const it of items || []) { const p = normTikTok(it); if (p.id && p.d) posts.push(p); } }).catch(e => errors.push("TikTok: " + String(e.message || e).slice(0, 160))));
  if (ig.length) jobs.push(((opts && opts.instagram) || (() => apify("apify~instagram-scraper", { directUrls: ig.map(k => "https://www.instagram.com/" + k.slice(3) + "/"), resultsType: "posts", resultsLimit: PER_PROFILE, onlyPostsNewerThan: oldest(ig), addParentData: false }, "shortCode,url,timestamp,caption,hashtags,mentions,ownerUsername,productType,musicInfo,isSponsored,videoPlayCount,videoViewCount")))()
    .then(items => { for (const it of items || []) { const p = normInstagram(it); if (p.id && p.d) posts.push(p); } }).catch(e => errors.push("Instagram: " + String(e.message || e).slice(0, 160))));
  await Promise.all(jobs);
  return { posts, errors, profiles: { tt: tt.length, ig: ig.length } };
}

// ---------- adding to a filled row ----------
async function mondayVars(token, query, variables) {
  const r = await fetch("https://api.monday.com/v2", { method: "POST", headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" }, body: JSON.stringify({ query, variables }) });
  const d = await r.json();
  if (!r.ok || (d && d.errors)) throw new Error("monday: " + JSON.stringify((d && d.errors) || r.status).slice(0, 300));
  return d.data;
}
const keyOf = p => p.p + ":" + p.id;
async function addPosts(token, adds, dry) {
  if (!adds.length) return [];
  const used = await linkedVideoBrands(token);
  const out = [];
  for (let i = 0; i < adds.length; i += 25) {
    const ids = adds.slice(i, i + 25).map(a => a.c.id);
    const d = await monday(token, "query { items(ids:[" + ids.join(",") + "], limit:25) { id parent_item { name column_values(ids:[\"dropdown_mm1a3tqp\"]) { text } } column_values(ids:[\"text_mm6aq9qp\",\"color_mm7jh1xw\"]) { id text } updates(limit:100) { text_body body } } }");
    for (const it of d.items) {
      const a = adds.find(x => String(x.c.id) === String(it.id)); if (!a) continue;
      const cv = {}; for (const c of it.column_values) cv[c.id] = c.text || "";
      if (cv.color_mm7jh1xw !== "Linked" || !cv.text_mm6aq9qp.trim()) { out.push({ id: it.id, result: "skipped: row changed since it was read" }); continue; }
      const p = it.parent_item || {}; const b = brandKey(p.column_values && p.column_values[0] && p.column_values[0].text, p.name);
      const have = new Set(parseSocial(cv.text_mm6aq9qp).map(s => s.p + ":" + s.id));
      const said = (it.updates || []).map(u => (u.text_body || "") + " " + (u.body || "")).join(" ");
      const keep = a.posts.filter(x => !have.has(keyOf(x)) && !said.includes(x.id) && !(used.get(keyOf(x)) || new Set()).has(b));
      if (!keep.length) { out.push({ id: it.id, deal: a.c.deal, result: "nothing new to add" }); continue; }
      if (!dry) {
        const cell = cv.text_mm6aq9qp.replace(/[,\s]+$/, "") + ", " + keep.map(x => x.url).join(", ");
        await mondayVars(token, "mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id:$b, item_id:$i, column_values:$v) { id } }", { b: String(SUB_BOARD), i: String(it.id), v: JSON.stringify({ text_mm6aq9qp: cell }) });
        const body = "<p><b>TikTok / Instagram link finder: added " + keep.length + (keep.length === 1 ? " post" : " posts") + "</b></p><p>Posts on the creator's profile from this row's live dates whose sound or caption ties them to this deal. Added to the links already here; nothing was removed.</p><ul>" +
          keep.map(x => "<li>" + esc(x.d) + " " + esc(x.url.replace(/^https:\/\/(www\.)?/, "")) + " - " + esc(x.how) + "</li>").join("") + "</ul><p>If any is wrong, take it out of LIVE VIDEO URLS. It is never added back, because it is named in this update.</p>";
        await mondayVars(token, "mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t) { id } }", { i: String(it.id), t: body });
      }
      for (const x of keep) { if (!used.has(keyOf(x))) used.set(keyOf(x), new Set()); used.get(keyOf(x)).add(b); }
      out.push({ id: it.id, deal: a.c.deal, result: dry ? "would add" : "added", posts: keep.length });
    }
  }
  return out;
}

// ---------- the pass ----------
export async function runSocial(token, opts) {
  opts = opts || {};
  const t0 = Date.now();
  const summary = { pass: "social", dry: !!opts.dry, rows: 0, profiles: {}, posts: 0, fill: 0, add: 0, maybe: 0, errors: [], plan: [] };
  const [rows, gtr] = await Promise.all([loadRows(token), loadHandles(token)]);
  const cands = candidates(rows, gtr, opts.now);
  summary.rows = cands.length;
  if (!cands.length) { summary.ms = Date.now() - t0; return summary; }
  const got = await fetchPosts(cands, opts);
  summary.profiles = got.profiles; summary.posts = got.posts.length; summary.errors.push(...got.errors);
  const matched = matchSocial(got.posts, cands);
  const fills = [], adds = [];
  for (const m of matched) {
    const c = m.c;
    const line = { id: c.id, deal: c.deal, row: c.row, mode: c.mode, live: c.pub || c.liveStart, sure: m.sure.map(p => p.url + " " + p.d + " (" + p.how + ")"), maybe: m.maybe.slice(0, 4).map(p => p.url + " " + p.d + " (" + p.how + ")") };
    if (m.ambiguous.length) line.ambiguous = m.ambiguous.map(p => p.url + " fits more than one row");
    if (m.tooMany) line.note = "more than " + MAX_POSTS + " posts: left for a person";
    if (m.maybe.length) summary.maybe++;
    if (m.sure.length || m.maybe.length || m.ambiguous.length) summary.plan.push(line);
    if (!m.sure.length) continue;
    if (c.mode === "fill" && fills.length < MAX_ROWS) fills.push({ id: c.id, v: m.sure.map(p => [p.url, p.d, p.how]) });
    if (c.mode === "add" && fills.length + adds.length < MAX_ROWS) adds.push({ c, posts: m.sure });
  }
  if (fills.length) {
    const r = await applyLinks(token, { rows: fills, rule: "TikTok / Instagram link finder: posts on the creator's profile from this row's live dates whose sound or caption ties them to this deal (the deal names the sound, or the caption tags the brand as an ad)." }, !!opts.dry);
    summary.fill = r.linked; summary.fillDetail = r.out.map(o => ({ id: o.id, deal: o.deal, result: o.result, posts: o.videos }));
  }
  if (adds.length) {
    try { const r = await addPosts(token, adds, !!opts.dry); summary.add = r.filter(o => /add/.test(o.result) && !/nothing/.test(o.result)).length; summary.addDetail = r; }
    catch (e) { summary.errors.push("add: " + String(e.message || e).slice(0, 160)); }
  }
  summary.ms = Date.now() - t0;
  return summary;
}
