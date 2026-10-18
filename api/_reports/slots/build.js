// Slot board: how many sponsor slots each creator has in the next eight weeks, and which are sold.
// ecosystem.digitalfoxtalent.com/partnerships/slot-board (Tom, 17 Oct 2026). Built once a night by
// api/slots-build.js and saved (store.js); the page only reads the saved copy. Nobody types anything in.
// Every 10 minutes a quick refresh (refreshSnapshot) re-reads the rates board and US Campaigns and reuses
// that night's upload pace, so a booking shows within minutes without touching the YouTube key (Tom, 18 Oct 2026).
//
// WHERE THE NUMBERS COME FROM
//   Creators and prices   Rates - View Guarantee Model 18417663127, YouTube channels group: name, handle,
//                         channel id, the brand view guarantee and rate (what a brand is quoted this quarter;
//                         the live figures when the quarter's are empty), and the Hide / List only override.
//   Expected uploads      YouTube Data API: each channel's uploads over the last 12 weeks, long-form only
//                         (over 3 minutes, no live streams). The weekly rate is uploads / weeks covered.
//                         A channel with nothing in 30 days counts as paused: no slots offered.
//   Booked slots          US Campaigns 6162879609 creator rows 6162879732: every row whose deal is at
//                         "Campaign Won" or later, placed in the week its flight starts (LIVE DATE
//                         range), else its publish date. Rows in "Campaign Opportunities" or
//                         "Contract Review" are pencilled: shown, not counted as sold.
//   Busy weeks            Studio/Dev Upcoming Releases 18415007170: release name and date, so the week
//                         headers show what the studios are shipping.
//
// Weeks run Monday to Sunday (Tom, 9 Oct 2026: a Sunday upload counts toward the week before).
// One sponsor read per video is assumed; open slots = expected uploads - booked, never below zero.
//
// RULES (as every report): read only; a short or empty read is a fault, never the truth (build.js throws
// and the previous night's copy stays); every figure carries the time it was built.

import { monday } from "../monday.js";

export const RATES_BOARD = 18417663127;
export const RATES_GROUP = "topics"; // YouTube channels
export const RC = { handle: "text_mm49w81b", url: "text_mm499xez", src: "text_mm49b3x7", avg: "numeric_mm49b3y2", vg: "numeric_mm49rr3n", rate: "numeric_mm497vsg",
  bvg: "numeric_mm7vxae8", brate: "numeric_mm7vx77g", vis: "color_mm7vb4nb", lastPub: "date_mm4an586", logo: "text_mm7v2qns" };
export const GTR_BOARD = 6160485039;       // Global Talent Roster: campaign rows name the creator by this row's name
export const SUB_BOARD = 6162879732;       // US Campaigns creator rows
export const RELEASE_BOARD = 18415007170;  // Studio/Dev Upcoming Releases (George, films)
export const RELEASE_BOARDS = [18415007170, 18435939296];  // plus Tom's Games, TV & Tech board (split off 17 Oct 2026)
export const REL = { date: "date_mm3rpkm4", creators: "long_text_mm5cfcfd" };

export const WEEKS = 8;
export const LOOKBACK_WEEKS = 12;
export const PAUSED_DAYS = 30;
export const MIN_LONG_SECONDS = 180;
// Deal groups from "Campaign Won" on are sold. The two before it are pencilled (an opportunity, not a booking).
export const BOOKED_GROUPS = /campaign won|brief creators|campaigns active|monitoring|view tracking|invoice|client paid|complete/i;
export const PENCIL_GROUPS = /opportunit|contract review/i;

const DAY = 86400000;
export const hkey = h => String(h || "").toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_.]/g, "");
export const nkey = n => String(n || "").toLowerCase().replace(/\s*[-–]\s*shorts\s*$/, "").replace(/[^a-z0-9]/g, "");
const num = x => { const n = parseFloat(String(x == null ? "" : x).replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : null; };
const iso = d => new Date(d).toISOString().slice(0, 10);

// The Monday (UTC) on or before a date, as YYYY-MM-DD.
export function weekStart(date) {
  const d = new Date(date); if (isNaN(d)) return null;
  const u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (u.getUTCDay() + 6) % 7; // Monday 0 ... Sunday 6
  u.setUTCDate(u.getUTCDate() - dow);
  return iso(u);
}
export const addDays = (ymd, n) => iso(Date.parse(ymd + "T00:00:00Z") + n * DAY);

// The eight weeks shown, starting with the current one.
export function weekList(now = new Date()) {
  const first = weekStart(now);
  return Array.from({ length: WEEKS }, (_, i) => { const s = addDays(first, 7 * i); return { start: s, end: addDays(s, 6) }; });
}

// Expected uploads in week k (0-based) from a weekly rate, spread evenly: 0.5 a week gives 1,0,1,0;
// 2.5 a week gives 3,2,3,2. Cumulative rounding, so eight weeks of 0.4 a week still gives 3 uploads.
export function expectedInWeek(rate, k) {
  if (!(rate > 0)) return 0;
  return Math.round(rate * (k + 1)) - Math.round(rate * k);
}

// Weekly upload rate from a list of publish dates (ISO strings), long-form uploads only.
//   rate: uploads per week over the weeks covered (the lookback, or less if the list is shorter and full)
//   last: most recent publish date; paused: nothing in PAUSED_DAYS; irregular: gaps vary a lot
export function cadence(dates, now = new Date(), opts = {}) {
  const lookbackDays = (opts.lookbackWeeks || LOOKBACK_WEEKS) * 7;
  const since = now.getTime() - lookbackDays * DAY;
  const all = dates.map(d => Date.parse(d)).filter(t => Number.isFinite(t) && t <= now.getTime()).sort((a, b) => b - a);
  const last = all[0] ? iso(all[0]) : null;
  const inWindow = all.filter(t => t >= since);
  // If the list was cut off (opts.truncated) and its oldest entry is inside the window, the window really
  // covered is only from that oldest entry, so the rate is not understated.
  let weeksCovered = lookbackDays / 7;
  if (opts.truncated && all.length && all[all.length - 1] > since) weeksCovered = Math.max(1, (now.getTime() - all[all.length - 1]) / (7 * DAY));
  const rate = inWindow.length ? +(inWindow.length / weeksCovered).toFixed(2) : 0;
  const paused = !last || (now.getTime() - all[0]) > PAUSED_DAYS * DAY;
  let irregular = false;
  if (inWindow.length >= 4) {
    const gaps = []; for (let i = 0; i + 1 < inWindow.length; i++) gaps.push((inWindow[i] - inWindow[i + 1]) / DAY);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length);
    irregular = mean > 0 && sd / mean > 0.7;
  }
  return { rate, last, paused, irregular, uploads: inWindow.length, weeksCovered: +weeksCovered.toFixed(1) };
}

// ---------- reads ----------

export async function loadCreators(token) {
  const cols = JSON.stringify(Object.values(RC));
  const d = await monday(token, `query { boards(ids:[${RATES_BOARD}]) { groups(ids:["${RATES_GROUP}"]) { items_page(limit:200) { items { id name column_values(ids:${cols}) { id text } } } } } }`);
  const items = (((d.boards || [])[0] || {}).groups || [])[0];
  const list = ((items && items.items_page && items.items_page.items) || []).map(it => {
    const c = {}; for (const v of it.column_values || []) c[v.id] = v.text || "";
    const url = c[RC.url] || "", src = c[RC.src] || "";
    const m = url.match(/channel\/(UC[\w-]{22})/); const channel = /^UC[\w-]{22}$/.test(src) ? src : (m ? m[1] : "");
    const vg = num(c[RC.bvg]) || num(c[RC.vg]), rate = num(c[RC.brate]) || num(c[RC.rate]);
    return { id: it.id, name: it.name, handle: c[RC.handle] || "", channel, url, logo: c[RC.logo] || "", vg, rate, avg: num(c[RC.avg]), lastPub: c[RC.lastPub] || "",
      hidden: /^(hide|list only)$/i.test(c[RC.vis] || "") };
  });
  if (list.length < 10) throw new Error("rates board read is short (" + list.length + " channels)");
  return list;
}

// Campaign rows: name -> the roster row name is what the campaign rows carry, so map that to a handle.
export async function loadGtrHandles(token) {
  const d = await monday(token, `query { boards(ids:[${GTR_BOARD}]) { items_page(limit:500) { items { name column_values(ids:["text_mm6nqp7b"]) { id text } } } } }`);
  const map = {};
  for (const it of (((d.boards || [])[0] || {}).items_page || {}).items || []) {
    const h = ((it.column_values || [])[0] || {}).text || "";
    map[nkey(it.name)] = hkey(h);
  }
  return map;
}

const ROW_FIELDS = "cursor items { id name parent_item { id name group { title } column_values(ids:[\"status_1\",\"dropdown_mm1a3tqp\",\"deal_value\"]) { id text } } column_values(ids:[\"connect_boards__1\",\"timerange_mm1m50vx\",\"date_mm1mb38m\",\"numeric_mm3yxqes\",\"text_mm6aq9qp\"]) { id text ... on BoardRelationValue { display_value } } }";
export async function loadCampaignRows(token) {
  let d = await monday(token, `query { boards(ids:[${SUB_BOARD}]) { items_page(limit:500) { ${ROW_FIELDS} } } }`);
  let page = d.boards[0].items_page, items = page.items.slice(), guard = 0;
  while (page.cursor && guard++ < 20) {
    d = await monday(token, `query { next_items_page(limit:500, cursor:"${page.cursor}") { ${ROW_FIELDS} } }`);
    page = d.next_items_page; items = items.concat(page.items);
  }
  const out = [];
  for (const it of items) {
    const p = it.parent_item; if (!p) continue;
    const c = {}; for (const v of it.column_values || []) c[v.id] = (v.display_value != null && v.display_value !== "") ? v.display_value : (v.text || "");
    const pc = {}; for (const v of p.column_values || []) pc[v.id] = v.text || "";
    const range = String(c.timerange_mm1m50vx || "");
    const m = range.match(/(\d{4}-\d\d-\d\d)(?:\s*-\s*(\d{4}-\d\d-\d\d))?/);
    out.push({ id: it.id, row: it.name, deal: p.name, dealId: p.id, group: (p.group && p.group.title) || "", status: pc.status_1 || "",
      brand: pc.dropdown_mm1a3tqp || String(p.name).split(/[_ ]/)[0], value: num(pc.deal_value),
      creator: c.connect_boards__1 || "", start: m ? m[1] : "", end: m && m[2] ? m[2] : "", pub: c.date_mm1mb38m || "",
      guaranteed: num(c.numeric_mm3yxqes), hasLinks: !!String(c.text_mm6aq9qp || "").trim() });
  }
  return out;
}

export async function loadReleases(token) {
  const d = await monday(token, `query { boards(ids:[${RELEASE_BOARDS.join(",")}]) { items_page(limit:500) { items { id name column_values(ids:["${REL.date}","${REL.creators}"]) { id text } } } } }`);
  const out = [];
  for (const it of (d.boards || []).flatMap(b => ((b || {}).items_page || {}).items || [])) {
    const c = {}; for (const v of it.column_values || []) c[v.id] = v.text || "";
    if (!/^\d{4}-\d\d-\d\d/.test(c[REL.date] || "")) continue;
    out.push({ id: it.id, name: it.name, date: c[REL.date].slice(0, 10), creators: String(c[REL.creators] || "") });
  }
  return out;
}

// YouTube: a channel's long-form uploads (ids and publish dates) over the lookback, newest first.
// About 2 units per channel (playlistItems + videos). Returns { dates, truncated, error }.
export async function channelUploads(channel, key, now = new Date(), fetchFn = fetch) {
  const since = now.getTime() - LOOKBACK_WEEKS * 7 * DAY;
  const yt = async path => {
    const r = await fetchFn("https://www.googleapis.com/youtube/v3/" + path + "&key=" + key);
    const j = await r.json();
    if (!r.ok) throw new Error("YouTube " + r.status + ": " + String(j.error && j.error.message || "").slice(0, 120));
    return j;
  };
  const uploads = "UU" + String(channel).slice(2);
  const items = [];
  let pageToken = "", pages = 0, truncated = false;
  while (pages++ < 3) {
    const j = await yt("playlistItems?part=contentDetails&maxResults=50&playlistId=" + uploads + (pageToken ? "&pageToken=" + pageToken : ""));
    for (const it of j.items || []) items.push({ id: it.contentDetails.videoId, at: it.contentDetails.videoPublishedAt || "" });
    const oldest = items.length ? Date.parse(items[items.length - 1].at) : 0;
    if (!j.nextPageToken || (oldest && oldest < since)) { truncated = !!j.nextPageToken && !(oldest && oldest < since); break; }
    pageToken = j.nextPageToken; truncated = true;
  }
  const recent = items.filter(v => v.at && Date.parse(v.at) >= since);
  const dates = [];
  for (let i = 0; i < recent.length; i += 50) {
    const ids = recent.slice(i, i + 50).map(v => v.id).join(",");
    const j = await yt("videos?part=contentDetails,liveStreamingDetails,snippet&id=" + ids);
    for (const v of j.items || []) {
      if (v.liveStreamingDetails) continue; // live streams and premieres are not upload slots
      const m = String(v.contentDetails && v.contentDetails.duration || "").match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      const secs = m ? ((+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0)) : 0;
      if (secs <= MIN_LONG_SECONDS) continue;
      const at = (v.snippet && v.snippet.publishedAt) || (recent.find(r => r.id === v.id) || {}).at;
      if (at) dates.push(at);
    }
  }
  return { dates: dates.sort().reverse(), truncated };
}

// ---------- assembly (pure, tested) ----------

// creators: loadCreators() rows with .uploads = { dates, truncated, error } attached.
// rows: loadCampaignRows(); handles: loadGtrHandles(); releases: loadReleases().
export function assemble({ creators, rows, handles, releases, now = new Date() }) {
  const weeks = weekList(now);
  const first = weeks[0].start, last = weeks[WEEKS - 1].end;
  const byHandle = {}, byName = {};
  const out = creators.filter(c => !c.hidden).map(c => {
    // A quick refresh hands in last night's cadence; the nightly build works it out from the uploads.
    const cad = c.cadence || cadence((c.uploads && c.uploads.dates) || [], now, { truncated: !!(c.uploads && c.uploads.truncated) });
    const o = { id: c.id, name: c.name, handle: c.handle, channel: c.channel, logo: c.logo, vg: c.vg, rate: c.rate, avg: c.avg,
      cadence: cad, uploadsError: (c.uploadsError != null ? c.uploadsError : (c.uploads && c.uploads.error)) || "", weeks: weeks.map(() => ({ expected: 0, booked: [], pencilled: [], open: 0 })), unscheduled: [] };
    if (!cad.paused && !o.uploadsError) o.weeks.forEach((w, k) => { w.expected = expectedInWeek(cad.rate, k); });
    if (c.handle) byHandle[hkey(c.handle)] = o;
    byName[nkey(c.name)] = o;
    return o;
  });
  const findCreator = name => byName[nkey(name)] || byHandle[handles[nkey(name)] || ""] || byHandle[hkey(name)] || null;
  const skipped = [];
  for (const r of rows) {
    const booked = BOOKED_GROUPS.test(r.group), pencil = !booked && PENCIL_GROUPS.test(r.group);
    if (!booked && !pencil) continue;
    if (/lost|cancel/i.test(r.status)) continue;
    const cr = findCreator(r.creator);
    if (!cr) { skipped.push({ creator: r.creator, deal: r.deal }); continue; }
    const anchor = r.start || r.pub;
    const slot = { deal: r.deal, dealId: r.dealId, brand: r.brand, row: r.id, start: r.start, end: r.end, pub: r.pub, group: r.group, status: r.status, live: r.hasLinks };
    if (!anchor) { if (booked && !r.hasLinks) cr.unscheduled.push(slot); continue; }
    const ws = weekStart(anchor);
    if (ws < first || ws > last) continue;
    const k = Math.round((Date.parse(ws) - Date.parse(first)) / (7 * DAY));
    (booked ? cr.weeks[k].booked : cr.weeks[k].pencilled).push(slot);
  }
  const rel = releases.filter(x => x.date >= first && x.date <= last).map(x => ({ name: x.name, date: x.date, week: Math.round((Date.parse(weekStart(x.date)) - Date.parse(first)) / (7 * DAY)) }));
  const totals = { expected: 0, booked: 0, pencilled: 0, open: 0, openViews: 0, openValue: 0, bookedValue: 0, creators: out.length, paused: 0, unscheduled: 0 };
  for (const cr of out) {
    cr.openSlots = 0; cr.openViews = 0; cr.openValue = 0; cr.bookedSlots = 0;
    for (const w of cr.weeks) {
      w.open = Math.max(0, w.expected - w.booked.length);
      cr.openSlots += w.open; cr.bookedSlots += w.booked.length;
      totals.expected += w.expected; totals.booked += w.booked.length; totals.pencilled += w.pencilled.length;
    }
    cr.openViews = cr.openSlots * (cr.vg || 0); cr.openValue = cr.openSlots * (cr.rate || 0);
    totals.open += cr.openSlots; totals.openViews += cr.openViews; totals.openValue += cr.openValue; totals.bookedValue += cr.bookedSlots * (cr.rate || 0);
    if (cr.cadence.paused) totals.paused++;
    totals.unscheduled += cr.unscheduled.length;
  }
  totals.sellThrough = (totals.booked + totals.open) ? Math.round(100 * totals.booked / (totals.booked + totals.open)) : 0;
  out.sort((a, b) => (b.openValue - a.openValue) || (b.openSlots - a.openSlots) || a.name.localeCompare(b.name));
  weeks.forEach((w, k) => { w.releases = rel.filter(x => x.week === k).map(x => ({ name: x.name, date: x.date })); w.expected = out.reduce((s, c) => s + c.weeks[k].expected, 0); w.booked = out.reduce((s, c) => s + c.weeks[k].booked.length, 0); w.open = out.reduce((s, c) => s + c.weeks[k].open, 0); });
  return { builtAt: now.toISOString(), weeks, creators: out, totals, skipped: skipped.slice(0, 50), skippedCount: skipped.length };
}

// The nightly build: reads everything, asks YouTube for each channel, assembles. ytKey: YOUTUBE_API_KEY.
export async function buildSnapshot(token, ytKey, opts = {}) {
  const now = opts.now || new Date();
  const [creators, rows, handles, releases] = await Promise.all([loadCreators(token), loadCampaignRows(token), loadGtrHandles(token), loadReleases(token)]);
  if (rows.length < 50) throw new Error("campaign rows read is short (" + rows.length + ")");
  let units = 0;
  const limit = 6; let i = 0; // six channels at a time
  const run = async () => { while (i < creators.length) { const c = creators[i++]; if (c.hidden) continue;
    if (!c.channel) { c.uploads = { dates: [], error: "no channel id on the rates board" }; continue; }
    try { c.uploads = await channelUploads(c.channel, ytKey, now, opts.fetch); units += 2; }
    catch (e) { c.uploads = { dates: [], error: String(e.message || e).slice(0, 120) }; }
  } };
  await Promise.all(Array.from({ length: limit }, run));
  const snap = assemble({ creators, rows, handles, releases, now });
  const unread = snap.creators.filter(c => c.uploadsError).length;
  if (snap.creators.length && unread > snap.creators.length / 2) {
    const first = snap.creators.find(c => c.uploadsError);
    throw new Error("YouTube could not be read for " + unread + " of " + snap.creators.length + " channels (first: " + first.uploadsError + ")");
  }
  snap.youtubeUnits = units;
  snap.paceAt = snap.builtAt;
  return snap;
}

// The quick refresh (every 10 minutes): re-reads monday only and reuses the pace from the last saved copy
// (prev), matched by rates-board item id. A channel added since last night has no pace yet and offers no
// slots until tonight's build. No YouTube calls. opts.load can stand in for the monday reads (tests).
export async function refreshSnapshot(token, prev, opts = {}) {
  if (!prev || prev.error || !Array.isArray(prev.creators) || !prev.creators.length) throw new Error("no saved copy to refresh from yet");
  const now = opts.now || new Date();
  const L = Object.assign({ creators: loadCreators, rows: loadCampaignRows, handles: loadGtrHandles, releases: loadReleases }, opts.load || {});
  const [creators, rows, handles, releases] = await Promise.all([L.creators(token), L.rows(token), L.handles(token), L.releases(token)]);
  if (rows.length < 50) throw new Error("campaign rows read is short (" + rows.length + ")");
  const pace = {}; for (const c of prev.creators) pace[c.id] = c;
  for (const c of creators) {
    const p = pace[c.id];
    if (p && p.cadence) { c.cadence = p.cadence; c.uploadsError = p.uploadsError || ""; }
    else { c.cadence = { rate: 0, last: null, paused: false, irregular: false, uploads: 0, weeksCovered: 0 }; c.uploadsError = "new channel: upload pace is read tonight"; }
  }
  const snap = assemble({ creators, rows, handles, releases, now });
  snap.paceAt = prev.paceAt || prev.builtAt;
  snap.youtubeUnits = 0;
  snap.refreshed = true;
  return snap;
}
