// roster-viewguarantee.digitalfoxtalent.com - the creator roster, in two views.
//
// REBUILT 5 Oct 2026 on Tom's brief:
//   * BRAND VIEW (anyone): the quarter's frozen numbers only - Brand VG / CPM / Rate on the
//     rates board, written once a quarter by renewal-sync brand_quarter_snapshot.py (from the
//     previous quarter's average) and editable by the team on this site until the next reset.
//     Hidden from brands: floored CPM over $30 (long-form) or $50 (Shorts, Instagram, TikTok),
//     shows/feeds that published nothing last quarter, and anything set to "Hide".
//     Shorts, Instagram, TikTok and Snapchat show a View Estimate, a rate at $25 CPM, a $3,000
//     content production fee and the total (Tom, 8 Oct 2026). No CPM in this view.
//   * DFT VIEW (signed in with an @digitalfoxtalent.com Google account): everything, with the
//     live daily averages beside the brand numbers, edits, visibility overrides, saved lists
//     and the column order.
//   * SAVED LISTS (/r/<slug>): a list a team member saved, shown in the brand view. A list can
//     include creators the cap would hide (Margot's call for that pitch); "Hide" still wins.
//
// Before this rebuild the endpoint returned the whole board to anyone, live averages included.
// It must never do that again: the brand payload is built field by field below.
//
// Routes (vercel.json, roster host):
//   GET  /api/roster                 brand payload (edge cached)
//   GET  /api/roster?list=<slug>     a saved list, brand payload
//   GET  /api/roster?view=team       team payload (cookie required, never cached)
//   POST /api/roster  {op:...}       team only: edit | save-list | delete-list | columns
//   GET  /auth/handoff?t=            sign-in handoff from reports.digitalfoxtalent.com/roster-signin
//   GET  /auth/signout
//
// Sign-in happens on reports.digitalfoxtalent.com (the Google client's registered redirect),
// which hands a 60-second signed token back here; this host then sets its own team cookie.

import crypto from "node:crypto";
import { teamEmail, setTeamCookie, clearTeamCookie, isPreview, handoffEmail } from "./_reports/access.js";
import { AVATARS } from "./_reports/campaigns/avatars.js";

const BOARD = 18417663127;          // Rates - View Guarantee Model
const SUB_BOARD = 18417669961;      // its show subitems
const LISTS_BOARD = 18434088297;    // Roster - Saved Pitch Lists
const CREATOR_BOARD = 6160485039;   // Global Talent Roster (State lives there)
// Simulcast (Tom, 5 Oct 2026): a YouTube show that is also published to Spotify Video and
// the podcast apps is marked "Simulcast" - extra reach at the same rate, not a separate
// price. The record of who is live as Simulcast is the Creator x Supplier Setup Register:
// rows with Supplier Libsyn, Listing type Simulcast, Setup state Live, joined on YouTube handle.
const GTR = { country: "dup__of_state6", state: "dup__of_email", yt: "text_mm6nqp7b", ig: "text_mm5pkgn1", tt: "text_mm5pqpaf", sc: "text_mm5pfw8a", full: "dup__of_state", kit: "link_mm7y59q3" };
const GTR_LIVE = new Set(["Youtube Long Form", "Short Form", "Need to set up with Suppliers", "Creator Applied", "To be let go"]);
const COUNTRY_FIX = { "usa": "United States", "us": "United States", "u.s.": "United States", "united states of america": "United States", "uk": "United Kingdom", "u.k.": "United Kingdom" };
const NAME_ALIAS = { normiesanime: "thenormies" }; // secondary channel with no roster row of its own
const normCountry = c => { const t = String(c || "").trim(); return COUNTRY_FIX[t.toLowerCase()] || t; };
const hkey = h => String(h || "").toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_.]/g, "");
const nkey = n => String(n || "").toLowerCase().replace(/\s*[-\u2013]\s*shorts\s*$/, "").replace(/[^a-z0-9]/g, "");
const REGISTER_BOARD = 18430229380;
// Simulcast also counts a show DFT publishes itself through Megaphone (8 Oct 2026, Margot):
// Video Rights & Syndication board, Pipeline status Live with Spotify or Apple Podcasts in
// "Directories live". Its "YouTube channel" cell holds @handles and/or UC channel ids.
const MEGA_BOARD = 18428698730;
const MEGA = { yt: "text_mm6nx38t", status: "color_mm6ncgkd", dirs: "dropdown_mm6npmzw" };
const REG = { handle: "text_mm70axtt", supplier: "color_mm70wx2a", state: "color_mm708t66", type: "color_mm70bcs0" };
const HOST = "roster-viewguarantee.digitalfoxtalent.com";

const GROUPS = [
  { id: "topics", kind: "long" },          // YouTube channels
  { id: "group_mm4av3kr", kind: "short" }, // YouTube Shorts
  { id: "group_mm4a1fe0", kind: "short" }, // Instagram
  { id: "group_mm4bd5tk", kind: "short" }, // TikTok
  { id: "group_mm7yw8cy", kind: "short" }, // Snapchat (added 8 Oct 2026; no sync, numbers kept by hand)
];
const CAP = { long: 30, short: 50 };
// Short form (Shorts, Instagram, TikTok, Snapchat), Tom 8 Oct 2026: the View Estimate x a
// $25 CPM gives the media rate, with NO $1,500 floor, and a flat content production fee of
// $3,000 is added on top. Total Rate = rate + fee. 12 months of digital usage and boosting
// rights are included. YouTube long-form is unchanged ($25 CPM, $1,500 minimum, no fee).
const PRICE = { long: { mult: 1.5, cpm: 25 }, short: { mult: 1, cpm: 25 } };
const FLOOR = 1500;
const FEE = 3000;
// Production fee tiers by View Estimate (Margot, 8 Oct 2026): under 100k views $3,000,
// 100k to 250k $5,000, 250k and over $7,500. A fee typed on a saved list still wins.
const feeFor = vg => (vg >= 250000 ? 7500 : vg >= 100000 ? 5000 : FEE);
// Round numbers for clients (Margot, 8 Oct 2026), every tab: views to the nearest 1,000,
// rates to the nearest $100. The CPM is left exactly as priced, so it stays a clean $25.
const r1k = n => (n == null ? n : Math.max(1000, Math.round(n / 1000) * 1000));
const r100 = n => (n == null ? n : Math.round(n / 100) * 100);
// A discounted row on a saved list rounds its rate to the nearest $10 instead (Tom, 9 Oct 2026),
// so the new price is the full price less exactly the % taken off the CPM. Rounding both to
// $100 made small rates drift a point either side (e.g. $6,800 to $6,500 showed 4% off).
const r10 = n => (n == null ? n : Math.round(n / 10) * 10);
function roundNums(b, fine) {
  if (!b) return b;
  const rr = fine ? r10 : r100;
  const o = Object.assign({}, b, { vg: r1k(b.vg), rate: rr(b.rate) });
  if (b.vgPer != null) o.vgPer = r1k(b.vgPer);
  if (b.ratePer != null) o.ratePer = rr(b.ratePer);
  return o;
}
const RIGHTS = "12 months digital usage + boosting rights included";
// Every creator is sold with ads of up to 60 seconds (Tom, 5 Oct 2026). This replaced the
// old "Videos / mo" column on the roster page.
const AD_LENGTH = "30-90s"; // Margot asked for :60-:90; Tom chose 30-90s, 6 Oct 2026

const C = {
  subs: "numeric_mm49cx8f", rate: "numeric_mm497vsg", vg: "numeric_mm49rr3n", cpm: "numeric_mm49bb66", avg: "numeric_mm49b3y2",
  host: "text_mm4944gw", category: "text_mm49j2nf", location: "text_mm49s85f", handle: "text_mm49w81b",
  about: "long_text_mm492hxg", url: "text_mm499xez", hostGender: "text_mm5nmtz1", hostRead: "text_mm5n7q86",
  exclusive: "text_mm5n8zh3", adTypes: "long_text_mm5n8f4t", adEx: "link_mm5n1zej", videos: "numeric_mm5nn2wj",
  audience: "long_text_mm5nw1s9", male: "text_mm5nkdfn", female: "text_mm5nb2t7",
  a1317: "text_mm5n6m90", a1824: "text_mm5n69hv", a2534: "text_mm5nbatb", a3544: "text_mm5n7syq",
  a4554: "text_mm5n5cc8", a5564: "text_mm5nzj3n", us: "text_mm5nsagz", uk: "text_mm5n7ybc",
  lastPub: "date_mm4an586", rel: "board_relation_mm49w1a4",
  bvg: "numeric_mm7vxae8", bcpm: "numeric_mm7vm3hw", brate: "numeric_mm7vx77g", bbasis: "numeric_mm7vec5",
  bq: "text_mm7v252f", bnote: "text_mm7vn2c", logo: "text_mm7v2qns", vis: "color_mm7vb4nb",
  src: "text_mm49b3x7", // Source ID (the UC channel id), used to match Megaphone shows for Simulcast
  bvideos: "numeric_mm7z64rk", // Brand Videos: a video count DFT set in the DFT view (Tom, 9 Oct 2026)
};
const SC = {
  rate: "numeric_mm495xbb", vg: "numeric_mm49tej8", cpm: "numeric_mm49fe4b", avg: "numeric_mm4957y3", url: "text_mm49bb5z",
  bvg: "numeric_mm7vzc0y", bcpm: "numeric_mm7vjh1a", brate: "numeric_mm7vm5z8", bbasis: "numeric_mm7vhe7f",
  bq: "text_mm7v1hhz", bnote: "text_mm7vjp1y", vis: "color_mm7vvvfz",
  bvideos: "numeric_mm7z2dv1",
};
const L = { slug: "text_mm7vgrr5", items: "long_text_mm7vtnkw", by: "text_mm7v2v06", link: "link_mm7vwxw0", updated: "text_mm7vj42p" };
// List storage (Tom, 10 Oct 2026). monday cuts a long text at 2,000 characters. Locking a
// big list went past that, the cut-off JSON could not be read, and the next save wrote the
// list back empty (Alex's "Avengers: Doomsday"). The JSON is now split across "Items" and
// "Items 2" to "Items 8" (about 15,000 characters), a list that cannot be read is never
// written over, a list is never saved without creators, and every write is read back.
const ITEM_COLS = [L.items, "long_text_mm80t78r", "long_text_mm80ndjr", "long_text_mm80wpxt", "long_text_mm80gas0", "long_text_mm801cds", "long_text_mm80dann", "long_text_mm80qawp"];
const CHUNK = 1900;
const LIST_READ_ERROR = "This list's saved data could not be read, so nothing was changed. Ask Tom to check it.";
function bodyValues(obj) {
  const s = JSON.stringify(obj);
  if (s.length > CHUNK * ITEM_COLS.length) throw new Error("This list is too big to save (" + s.length + " characters). Take some creators or list prices off and try again.");
  const v = {};
  ITEM_COLS.forEach((c, i) => { v[c] = { text: s.slice(i * CHUNK, (i + 1) * CHUNK) }; });
  return { values: v, text: s };
}
function readListBody(cv) {
  const s = ITEM_COLS.map(c => cv[c] || "").join("");
  if (!s.trim()) return { body: {}, bad: false };
  try { const b = JSON.parse(s); return { body: b && typeof b === "object" ? b : {}, bad: !(b && typeof b === "object") }; }
  catch (e) { return { body: {}, bad: true }; }
}
// Write a list's JSON (plus any other columns) and read it back to be sure it stuck.
async function writeList(itemId, body, extra, isSettings) {
  if (!isSettings && !(Array.isArray(body.ids) && body.ids.length)) throw new Error("A list needs at least one creator, so nothing was changed.");
  const { values, text } = bodyValues(body);
  await monday("mutation($b:ID!,$i:ID!,$v:JSON!){change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id}}",
    { b: String(LISTS_BOARD), i: String(itemId), v: JSON.stringify(Object.assign({}, extra || {}, values)) });
  cache = null;
  const d = await monday(`query{items(ids:[${itemId}]){column_values(ids:${JSON.stringify(ITEM_COLS)}){id text}}}`);
  const cv = {}; ((((d || {}).items || [])[0] || {}).column_values || []).forEach(c => { cv[c.id] = c.text || ""; });
  if (ITEM_COLS.map(c => cv[c] || "").join("") !== text) throw new Error("monday did not save the whole list. Please try again, and tell Tom if it keeps happening.");
}
const TEXT_FIELDS = ["host", "category", "location", "about", "hostGender", "hostRead", "exclusive", "adTypes", "audience",
  "male", "female", "a1317", "a1824", "a2534", "a3544", "a4554", "a5564", "us", "uk"];

// ---------------------------------------------------------------- helpers

const token = () => process.env.MONDAY_API_KEY || process.env.MONDAY_API_TOKEN || "";
const hostOf = req => String((req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0])
  .toLowerCase().trim().replace(/^www\./, "").split(":")[0];
const num = t => { const raw = t == null ? "" : String(t).replace(/[^0-9.\-]/g, ""); const n = raw === "" ? NaN : parseFloat(raw); return Number.isFinite(n) ? n : null; };
const pos = t => { const n = num(t); return n && n > 0 ? n : null; };
const pct = t => { const s = String(t == null ? "" : t).trim(); return s ? (s.endsWith("%") ? s : s + "%") : ""; };
const r2 = n => Math.round(n * 100) / 100;

async function monday(query, variables) {
  const r = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token(), "API-Version": "2024-10" },
    body: JSON.stringify({ query, variables: variables || {} }),
  });
  const d = await r.json();
  if (!r.ok || d.errors) throw new Error("monday: " + JSON.stringify(d.errors || r.status).slice(0, 300));
  return d.data;
}

export function quarterLabel(d = new Date()) {
  return "Q" + (Math.floor(d.getUTCMonth() / 3) + 1) + " " + d.getUTCFullYear();
}

// Price a basis the same way the quarterly snapshot does.
export function priceFrom(avg, kind) {
  const p = PRICE[kind];
  const vg = Math.round(avg * p.mult);
  let rate = Math.round(vg * p.cpm / 1000);
  if (kind === "long" && rate < FLOOR) rate = FLOOR;
  return { vg, rate, cpm: vg ? r2(rate * 1000 / vg) : 0 };
}

// What brands are quoted for a row: the frozen quarter numbers, or (for a row the
// snapshot has not reached yet, e.g. signed this morning) a provisional price built
// the same way from today's average.
function brandNumbers(cv, K, kind) {
  const b = brandNumbersRaw(cv, K, kind);
  // Video count set in the DFT view (Tom, 9 Oct 2026). It counts only while the Brand Note
  // says "Edited by", so the quarterly snapshot (which rewrites the note) resets it.
  const n = pos(cv[K.bvideos]);
  if (b && kind === "long" && n && /^Edited by/.test(cv[K.bnote] || "")) b.videosSet = Math.round(n);
  return b;
}
function brandNumbersRaw(cv, K, kind) {
  const vg = pos(cv[K.bvg]), rate = pos(cv[K.brate]);
  if (kind !== "long" && vg) {
    // Short form is re-priced here at $25 so the quarter's stored $50 numbers need no
    // rewrite. A CPM a DFT member typed in (note "Edited by") is kept.
    const cpm = (/^Edited by/.test(cv[K.bnote] || "") && pos(cv[K.bcpm])) || PRICE.short.cpm;
    return { vg, rate: Math.round(vg * cpm / 1000), cpm: r2(cpm), askCpm: r2(cpm), basis: pos(cv[K.bbasis]), quarter: cv[K.bq] || "", note: cv[K.bnote] || "", provisional: false };
  }
  // cpm is always the effective one (rate / views). askCpm is the CPM that was asked
  // for: the same thing, except on a row lifted by the $1,500 floor after a DFT edit.
  if (vg && rate) { const eff = r2(rate * 1000 / vg); return { vg, rate, cpm: eff, askCpm: pos(cv[K.bcpm]) || eff, basis: pos(cv[K.bbasis]), quarter: cv[K.bq] || "", note: cv[K.bnote] || "", provisional: false }; }
  const avg = pos(cv[K.avg]);
  if (!avg) return null;
  return Object.assign(priceFrom(avg, kind), { basis: avg, quarter: "", note: "Provisional: today's average, until the quarterly snapshot runs", provisional: true });
}

// Bundles (Tom, 5-6 Oct 2026). A long-form channel or show whose single video cannot reach
// the $1,500 minimum at its CPM is sold as a short bundle instead: the fewest videos that
// get there, at the normal CPM, with the view guarantee covering the whole bundle.
// YouTube tab only (channels and their shows); Shorts and socials are untouched.
// The cap was 4 videos; Tom raised it on 9 Oct 2026 so the small channels that need a
// few more videos are shown as bundles instead of being hidden. Past the cap a row stays
// hidden (a 100-video bundle is not a real offer), but a saved list can still set any count.
const MAX_BUNDLE = 10;
const MAX_LIST_VIDEOS = 50;
export function bundle(b, kind) {
  if (!b) return b;
  const out = Object.assign({}, b, { videos: 1, vgPer: b.vg, ratePer: b.rate });
  // A rate rounded to the dollar can leave $25.01; show the CPM it was priced at.
  if (Math.abs(out.cpm - Math.round(out.cpm)) < 0.02) out.cpm = Math.round(out.cpm);
  const floored = !(b.rate > FLOOR + 1);
  // A CPM typed on a saved list (listCpm) is always the one to bundle at.
  const base = b.listCpm || (!floored ? b.cpm : (b.askCpm && b.askCpm < b.cpm - 0.01 ? b.askCpm : PRICE.long.cpm));
  // Video count set on a saved list (Tom, 9 Oct 2026): the view guarantee is the per-video
  // guarantee x that many videos at the row's CPM. Fewer videos than the minimum needs are
  // still lifted to $1,500; more videos simply add up past it.
  if (kind === "long" && b.videosSet > 0) {
    const n = Math.round(b.videosSet), per = b.vg * base / 1000;
    const rate = Math.max(FLOOR, Math.round(per * n));
    return Object.assign(out, { videos: n, vg: b.vg * n, rate, cpm: r2(rate * 1000 / (b.vg * n)), askCpm: r2(base), ratePer: Math.round(per), videosSet: n });
  }
  if (kind !== "long" || !floored) return out;
  // Any row the $1,500 floor lifts above its CPM is bundled, not just those over the cap,
  // so brands always see the house $25 CPM (Tom, 6 Oct 2026).
  if (b.cpm <= base + 0.005) return out;
  const per = b.vg * base / 1000;
  const n = Math.ceil(FLOOR / per - 1e-9);
  if (n > MAX_BUNDLE) return Object.assign(out, { needs: n });
  return Object.assign(out, { videos: n, vg: b.vg * n, rate: Math.round(per * n), cpm: r2(base), ratePer: Math.round(per) });
}

function visibility(b, override, note, kind) {
  if (override === "Always show") return { show: true, why: "Always show (set by DFT)" };
  if (override === "Hide") return { show: false, why: "Hidden by DFT" };
  // List only (Tom, 10 Oct 2026): creators we pitch but do not represent, such as The Critical
  // Drinker. They can go on a saved list but never show on the main rate card or the website.
  if (override === "List only") return { show: false, why: "List only: shows on saved lists, never the main rate card" };
  if (!b) return { show: false, why: "No figures yet" };
  // Shorts, Instagram and TikTok are never hidden by a rule (Tom, 6 Oct 2026): brands see
  // a rate and a View Estimate there, never the CPM, so the $1,500 minimum simply applies.
  if (kind !== "long") return { show: true, why: "" };
  if (/^No uploads in/i.test(note || "")) return { show: false, why: String(note).split(";")[0] };
  if (b.needs) return { show: false, why: "Needs " + b.needs + " videos to reach $" + FLOOR.toLocaleString("en-US") + " (bundles go up to " + MAX_BUNDLE + ")" };
  // A video count DFT chose (fewer videos, lifted to $1,500) is shown even over the cap.
  if (b.cpm > CAP[kind] + 0.005 && !b.videosSet) return { show: false, why: "CPM $" + b.cpm + " is over the $" + CAP[kind] + " cap" };
  if (b.videos > 1) return { show: true, why: "Sold as a " + b.videos + "-video bundle" };
  return { show: true, why: "" };
}

const normName = n => String(n || "").toLowerCase().replace(/\s*[-–]\s*shorts\s*$/i, "").replace(/[^a-z0-9]/g, "");

// ---------------------------------------------------------------- load

const PCOLS = Object.values(C), SCOLS = Object.values(SC);
let cache = null; // { at, data } per warm instance

async function loadBoard() {
  if (cache && Date.now() - cache.at < 60 * 1000) return cache.data;
  const p = JSON.stringify(PCOLS), s = JSON.stringify(SCOLS);
  const groupQ = g => `query{boards(ids:[${BOARD}]){groups(ids:["${g}"]){id items_page(limit:200){items{id name column_values(ids:${p}){id text value} subitems{id name column_values(ids:${s}){id text}}}}}}}`;
  // Location and State / Region come from the Global Talent Roster (Country dup__of_state6,
  // State dup__of_email) - the agreed source since 9 Sep 2026. The rates board's own Location
  // column had drifted (Red Arcade, Breakdowns & Blockbusters, AJM_Nerdcore and Film Paradise
  // all read "United States"), and the Creator board relation the State used to come through
  // is empty on every row, so State/Region showed blank for everyone. Rows are matched on
  // handle (YouTube, Instagram or TikTok), then on name. Audit 6 Oct 2026.
  const stateQ = `query{boards(ids:[${CREATOR_BOARD}]){items_page(limit:500){items{id name group{title} column_values(ids:${JSON.stringify(Object.values(GTR))}){id text value}}}}}`;
  const listsQ = `query{boards(ids:[${LISTS_BOARD}]){items_page(limit:500){items{id name column_values(ids:${JSON.stringify([...new Set(Object.values(L).concat(ITEM_COLS))])}){id text}}}}}`;
  const regQ = `query{boards(ids:[${REGISTER_BOARD}]){items_page(limit:500){items{column_values(ids:${JSON.stringify(Object.values(REG))}){id text}}}}}`;
  const megaQ = `query{boards(ids:[${MEGA_BOARD}]){items_page(limit:500){items{column_values(ids:${JSON.stringify(Object.values(MEGA))}){id text}}}}}`;
  const [groups, state, lists, register, mega] = await Promise.all([
    Promise.all(GROUPS.map(g => monday(groupQ(g.id)))),
    monday(stateQ).catch(() => null),
    monday(listsQ).catch(() => null),
    monday(regQ).catch(() => null),
    monday(megaQ).catch(() => null),
  ]);
  const simulcast = new Set();
  const simulcastIds = new Set(); // UC channel ids, matched against the rates board's Source ID
  ((((mega || {}).boards || [])[0] || {}).items_page || { items: [] }).items.forEach(it => {
    const v = {}; (it.column_values || []).forEach(c => { v[c.id] = c.text || ""; });
    if (v[MEGA.status] !== "Live" || !/Spotify|Apple Podcasts/.test(v[MEGA.dirs] || "")) return;
    (v[MEGA.yt].match(/@[A-Za-z0-9._-]+/g) || []).forEach(h => simulcast.add(h.slice(1).toLowerCase()));
    (v[MEGA.yt].match(/UC[A-Za-z0-9_-]{22}/g) || []).forEach(id => simulcastIds.add(id));
  });
  ((((register || {}).boards || [])[0] || {}).items_page || { items: [] }).items.forEach(it => {
    const v = {}; (it.column_values || []).forEach(c => { v[c.id] = c.text || ""; });
    if (v[REG.supplier] === "Libsyn" && v[REG.type] === "Simulcast" && v[REG.state] === "Live" && v[REG.handle])
      simulcast.add(v[REG.handle].replace(/^@/, "").toLowerCase());
  });
  const geoById = {}, geoByHandle = {}, geoByName = {};
  ((((state || {}).boards || [])[0] || {}).items_page || { items: [] }).items.forEach(it => {
    const v = {}; (it.column_values || []).forEach(c => { v[c.id] = (c.text || "").trim(); });
    // Media kit (Audience stats link, 8 Oct 2026): the GTR row's "Media kit" link. For Channel
    // Connect creators it is the live audience page, rewritten weekly by api/kit-sync.js.
    let kit = "";
    try { const kc = (it.column_values || []).find(c => c.id === GTR.kit); kit = (JSON.parse((kc && kc.value) || "null") || {}).url || ""; } catch (e) {}
    if (!/^https:\/\//.test(kit)) kit = "";
    const country = normCountry(v[GTR.country]);
    let region = v[GTR.state];
    if (region && region.toLowerCase() === country.toLowerCase()) region = ""; // "Sweden / Sweden"
    const geo = { country, region, kit };
    geoById[String(it.id)] = geo;
    const live = GTR_LIVE.has((it.group || {}).title);
    const put = (map, k) => { if (k && (live || !map[k])) map[k] = geo; };
    [GTR.yt, GTR.ig, GTR.tt, GTR.sc].forEach(k => put(geoByHandle, hkey(v[k])));
    put(geoByName, nkey(it.name)); put(geoByName, nkey(v[GTR.full]));
  });
  const kitFor = (creatorId, handle, name) => {
    const g = (creatorId && geoById[creatorId]) || geoByHandle[hkey(handle)] || geoByName[nkey(name)] || geoByName[NAME_ALIAS[nkey(name)]];
    return (g && g.kit) || "";
  };
  const geoFor = (creatorId, handle, name, fallback) => {
    const g = (creatorId && geoById[creatorId]) || geoByHandle[hkey(handle)] || geoByName[nkey(name)] || geoByName[NAME_ALIAS[nkey(name)]];
    if (g && (g.country || g.region)) return g;
    // No roster match: split the rates board's own text, e.g. "Tennessee, United States".
    const parts = String(fallback || "").split(",").map(x => x.trim()).filter(Boolean);
    return parts.length > 1 ? { country: normCountry(parts[parts.length - 1]), region: parts[0] } : { country: normCountry(parts[0] || ""), region: "" };
  };

  const rows = [];
  groups.forEach((d, gi) => {
    const kind = GROUPS[gi].kind;
    const items = ((((d.boards || [])[0] || {}).groups || [])[0] || { items_page: { items: [] } }).items_page.items || [];
    items.forEach(it => {
      const cv = {}, raw = {};
      (it.column_values || []).forEach(c => { cv[c.id] = c.text || ""; raw[c.id] = c.value || ""; });
      let creator = "";
      try { creator = String((((JSON.parse(raw[C.rel] || "{}").linkedPulseIds) || [])[0] || {}).linkedPulseId || ""); } catch (e) {}
      let adEx = "";
      try { adEx = (JSON.parse(raw[C.adEx] || "null") || {}).url || ""; } catch (e) {}
      const shows = (it.subitems || []).map(sv => {
        const sc = {}; (sv.column_values || []).forEach(c => { sc[c.id] = c.text || ""; });
        return { id: String(sv.id), name: sv.name, cv: sc };
      });
      const sim = kind === "long" && (simulcast.has(String(cv[C.handle] || "").replace(/^@/, "").toLowerCase()) || simulcastIds.has(String(cv[C.src] || "").trim()));
      const geo = geoFor(creator, cv[C.handle], it.name, cv[C.location]);
      rows.push({ id: String(it.id), name: it.name, group: GROUPS[gi].id, kind, cv, creator, adEx, state: geo.region, country: geo.country, kit: kitFor(creator, cv[C.handle], it.name), shows, simulcast: sim });
    });
  });

  // Logos: the snapshot writes each YouTube channel's picture. Instagram/TikTok rows and
  // Shorts rows borrow it from the same creator (board relation first, then the name).
  const logoByCreator = {}, logoByName = {};
  rows.forEach(r => { const l = r.cv[C.logo]; if (l) { if (r.creator) logoByCreator[r.creator] = logoByCreator[r.creator] || l; logoByName[normName(r.name)] = logoByName[normName(r.name)] || l; } });
  // Last resort: the saved channel pictures the Campaign reach report keeps by handle.
  const saved = h => AVATARS[("@" + String(h || "").replace(/^@/, "")).toLowerCase()] || "";
  rows.forEach(r => { r.logo = r.cv[C.logo] || (r.creator && logoByCreator[r.creator]) || logoByName[normName(r.name)] || saved(r.cv[C.handle]) || ""; });

  const listItems = ((((lists || {}).boards || [])[0] || {}).items_page || { items: [] }).items.map(it => {
    const cv = {}; (it.column_values || []).forEach(c => { cv[c.id] = c.text || ""; });
    const { body, bad } = readListBody(cv);
    return { id: String(it.id), name: it.name, slug: cv[L.slug], body, bad, by: cv[L.by], updated: cv[L.updated] };
  });
  const settings = listItems.find(x => x.name === "__settings");
  const data = { rows, lists: listItems.filter(x => x.name !== "__settings" && x.slug), columns: (settings && settings.body.columns) || null,
    rowOrder: (settings && settings.body.rows) || {}, widths: (settings && settings.body.widths) || {}, settingsId: settings && settings.id };
  cache = { at: Date.now(), data };
  return data;
}

// ---------------------------------------------------------------- shaping

function baseFields(r) {
  const cv = r.cv, o = {
    id: r.id, name: r.name, handle: cv[C.handle] || "", url: cv[C.url] || "", logo: r.logo, kind: r.kind, group: r.group,
    subs: pos(cv[C.subs]), adLength: AD_LENGTH, adEx: r.adEx, kit: r.kit || "", state: r.state,
    simulcast: r.simulcast ? "Included" : "",
  };
  TEXT_FIELDS.forEach(k => { o[k] = /^(male|female|a\d|us|uk)/.test(k) ? pct(cv[C[k]]) : (cv[C[k]] || ""); });
  o.location = r.country || ""; // country, from the Global Talent Roster (see geoFor)
  // One "About" column (Margot, 6 Oct 2026): the Audience Information copy reads better, so
  // it is shown when present, with the short description as the fallback.
  if (o.audience) o.about = o.audience;
  return o;
}

// Prices for one saved list (Tom, 6 Oct 2026). A DFT edit made on a saved list's page is
// kept on that list only ({ prices: { <row id>: { vg, cpm } | { rate } } } in its JSON) and
// never touches the roster or any other list. YouTube rows take a per-video view
// guarantee and CPM, and are bundled to the $1,500 minimum like any other row; Shorts,
// Instagram and TikTok rows take a rate.
// A YouTube row can also carry { videos } (Tom, 9 Oct 2026): the number of videos in the
// deal, with or without its own view guarantee and CPM. See bundle().
function listNumbers(b, p, kind) {
  if (!p) return null;
  if (kind === "long") {
    const videos = p.videos > 0 ? { videosSet: Math.round(p.videos) } : {};
    if (p.vg > 0 && p.cpm > 0) {
      const rate = Math.max(FLOOR, Math.round(p.vg * p.cpm / 1000));
      return Object.assign({}, b || {}, { vg: Math.round(p.vg), rate, cpm: r2(rate * 1000 / p.vg), askCpm: p.cpm, listCpm: p.cpm, custom: true }, videos);
    }
    if (b && videos.videosSet) return Object.assign({}, b, { custom: true }, videos);
    return null;
  }
  if (kind !== "long") {
    const base = b || {};
    const vg = p.vg > 0 ? Math.round(p.vg) : base.vg, cpm = p.cpm > 0 ? p.cpm : (base.askCpm || base.cpm || PRICE.short.cpm);
    const o = Object.assign({}, base, { custom: true });
    if (p.rate > 0 && !(p.vg > 0) && !(p.cpm > 0)) o.rate = Math.round(p.rate); // lists saved before 8 Oct 2026
    else if (vg > 0) Object.assign(o, { vg, rate: Math.round(vg * cpm / 1000), cpm: r2(cpm), askCpm: r2(cpm) });
    if (p.fee != null && p.fee >= 0) o.fee = Math.round(p.fee);
    return o;
  }
  return null;
}

// Content production fee and total (short form only; YouTube's total is its rate).
function addFee(b, kind, fine) {
  if (!b) return b;
  b = roundNums(b, fine);
  const fee = kind === "long" ? 0 : (b.fee != null ? b.fee : feeFor(b.vg || 0));
  return Object.assign({}, b, { fee: kind === "long" ? null : fee, total: (b.rate || 0) + fee });
}

// Discounts on a saved list (Tom, 10 Oct 2026): a row ticked "Discount" keeps the CPM it had
// when ticked (discFrom); the CPM typed after that is the discounted one. Brands see the
// price at discFrom crossed out beside the new one, and the % off.
function priced(own, p, kind, isShow) {
  const x = bundle(listNumbers(own, p, kind) || own, kind);
  return isShow ? roundNums(x) : addFee(x, kind);
}
const isDisc = p => !!(p && p.disc && p.discFrom > 0);
function discountFor(own, p, kind, now, isShow) {
  if (!isDisc(p) || !now) return null;
  const was = priced(own, Object.assign({}, p, { cpm: p.discFrom }), kind, isShow);
  if (!was || !(was.rate > now.rate)) return null;
  return { wasRate: was.rate, wasTotal: isShow ? was.rate : was.total, discPct: Math.round((1 - now.rate / was.rate) * 100) };
}
function brandRow(r, includeHiddenByRule, prices, team) {
  prices = prices || {};
  const own = brandNumbers(r.cv, C, r.kind);
  const b = addFee(bundle(listNumbers(own, prices[r.id], r.kind) || own, r.kind), r.kind, isDisc(prices[r.id]));
  const v = visibility(b, r.cv[C.vis], r.cv[C.bnote], r.kind);
  const allowed = v.show || (includeHiddenByRule && b && r.cv[C.vis] !== "Hide");
  if (!allowed) return null;
  const o = baseFields(r);
  o.rate = b.rate; o.total = b.total;
  if (r.kind === "long") { o.vg = b.vg; o.cpm = b.cpm; o.minVideos = b.videos; o.vgPer = b.vgPer; if (team && b.videosSet) { o.videosSet = b.videosSet; o.askCpm = b.askCpm; } }
  // Shorts, Instagram, TikTok and Snapchat: brands see the views figure as a View Estimate
  // (not a guarantee) and never the CPM (Tom, 6 Oct 2026). The team, on a list's page, gets
  // the CPM so it can be changed for that list.
  else { o.vg = b.vg || null; o.fee = b.fee; o.rights = RIGHTS; if (team) o.cpm = b.cpm; }
  if (team && b.custom) o.custom = true; // only the team sees which prices are list-only
  const d = discountFor(own, prices[r.id], r.kind, b, false);
  if (d) Object.assign(o, d);
  if (team && prices[r.id] && prices[r.id].disc) o.disc = true;
  o.shows = r.kind !== "long" ? [] : r.shows.map(s => {
    const sown = brandNumbers(s.cv, SC, "long");
    const sb = roundNums(bundle(listNumbers(sown, prices[s.id], "long") || sown, "long"), isDisc(prices[s.id]));
    const sv = visibility(sb, s.cv[SC.vis], s.cv[SC.bnote], "long");
    if (!(sv.show || (includeHiddenByRule && sb && s.cv[SC.vis] !== "Hide"))) return null;
    const sd = discountFor(sown, prices[s.id], "long", sb, true);
    return Object.assign({ id: s.id, name: s.name, url: s.cv[SC.url] || "", rate: sb.rate, total: sb.rate, vg: sb.vg, cpm: sb.cpm, minVideos: sb.videos, vgPer: sb.vgPer, custom: team && sb.custom ? true : undefined, videosSet: team && sb.videosSet ? sb.videosSet : undefined, askCpm: team && sb.videosSet ? sb.askCpm : undefined, disc: team && prices[s.id] && prices[s.id].disc ? true : undefined }, sd || {});
  }).filter(Boolean).sort((a, b) => b.vgPer - a.vgPer);
  return o;
}

// Live (daily) figures for the blue columns. The daily syncs still write YouTube-style
// pricing (1.5x average, $25 CPM) onto Shorts, Instagram and TikTok rows, so for those the
// live view guarantee, rate and CPM are re-priced here from the live average the way
// brands are priced: 1x average at $50 CPM, $1,500 minimum (Tom, 6 Oct 2026).
function liveFor(r) {
  const avg = pos(r.cv[C.avg]), lastPub = r.cv[C.lastPub] || "";
  if (r.kind !== "long") { const p = avg ? priceFrom(avg, "short") : {}; return { avg, vg: p.vg || null, rate: p.rate || null, cpm: p.cpm || null, lastPub }; }
  return { avg, vg: pos(r.cv[C.vg]), rate: pos(r.cv[C.rate]), cpm: pos(r.cv[C.cpm]), lastPub };
}

function teamRow(r) {
  const o = baseFields(r);
  const b = addFee(bundle(brandNumbers(r.cv, C, r.kind), r.kind), r.kind);
  const v = visibility(b, r.cv[C.vis], r.cv[C.bnote], r.kind);
  if (r.kind !== "long") Object.assign(o, { fee: b ? b.fee : feeFor(0), total: b ? b.total : null, rights: RIGHTS });
  else o.total = b ? b.rate : null;
  Object.assign(o, {
    brand: b, override: r.cv[C.vis] || "Auto", show: v.show, why: v.why,
    live: liveFor(r),
    rate: b ? b.rate : null, vg: b ? b.vg : null, cpm: b ? b.cpm : null,
    minVideos: b && r.kind === "long" ? b.videos : null, vgPer: b ? b.vgPer : null,
    videosSet: b && b.videosSet ? b.videosSet : null,
  });
  o.shows = r.shows.map(s => {
    const sb = roundNums(bundle(brandNumbers(s.cv, SC, "long"), "long"));
    const sv = visibility(sb, s.cv[SC.vis], s.cv[SC.bnote], "long");
    return { id: s.id, name: s.name, url: s.cv[SC.url] || "", brand: sb, total: sb ? sb.rate : null, override: s.cv[SC.vis] || "Auto", show: sv.show, why: sv.why,
      rate: sb ? sb.rate : null, vg: sb ? sb.vg : null, cpm: sb ? sb.cpm : null,
      minVideos: sb ? sb.videos : null, vgPer: sb ? sb.vgPer : null, videosSet: sb && sb.videosSet ? sb.videosSet : null,
      live: { avg: pos(s.cv[SC.avg]), vg: pos(s.cv[SC.vg]), rate: pos(s.cv[SC.rate]), cpm: pos(s.cv[SC.cpm]) } };
  }).sort((a, b) => (b.vgPer || 0) - (a.vgPer || 0));
  return o;
}

// Campaign lock (Tom, 6 Oct 2026). Lists follow the quarter by default. Locking a list
// for a campaign keeps every price on it as it was when locked, past the quarter reset,
// until it is unlocked. Stored as { lock: { on, by, quarter, rows: { id: numbers } } }.
const LOCK_FIELDS = ["rate", "vg", "cpm", "minVideos", "vgPer", "fee", "total", "wasRate", "wasTotal", "discPct"];
function applyLock(o, lock) {
  const put = (x) => { const n = lock.rows && lock.rows[x.id]; if (n) LOCK_FIELDS.forEach(k => { if (n[k] != null) x[k] = n[k]; }); };
  put(o); (o.shows || []).forEach(put);
}
function lockSnapshot(data, list, onlyIds) {
  const p = brandPayload(data, list, false, true);
  const rows = {};
  Object.values(p.groups).forEach(a => a.forEach(o => {
    [o].concat(o.shows || []).forEach(x => {
      if (onlyIds && !onlyIds.has(String(x.id)) && !onlyIds.has(String(o.id))) return;
      const n = {}; LOCK_FIELDS.forEach(k => { if (x[k] != null) n[k] = x[k]; }); rows[x.id] = n;
    });
  }));
  return rows;
}

function brandPayload(data, list, team, noLock) {
  const ids = list ? new Set((list.body.ids || []).map(String)) : null;
  const prices = (list && list.body.prices) || {};
  const lock = list && list.body.lock;
  // Stage (Tom, 10 Oct 2026): Approached, then Confirmed, per creator on a list. Brands see
  // Confirmed only; Approached is for the team.
  const confirmed = new Set(((list && list.body.confirmed) || []).map(String));
  const approached = new Set(((list && list.body.approached) || []).map(String));
  // Brand feedback (Tom, 10 Oct 2026): the brand can approve a creator or leave a note.
  const feedback = (list && list.body.feedback) || {};
  const groups = {};
  GROUPS.forEach(g => { groups[g.id] = []; });
  data.rows.forEach(r => {
    if (ids && !ids.has(r.id)) return;
    const o = brandRow(r, !!ids, prices, team);
    if (o && list) {
      o.confirmed = confirmed.has(r.id); if (team) o.stage = o.confirmed ? "confirmed" : approached.has(r.id) ? "approached" : "";
      const f = feedback[r.id]; if (f && (f.ok || f.note)) o.fb = { ok: !!f.ok, note: String(f.note || "") };
    }
    if (o && lock && !noLock) applyLock(o, lock);
    if (o) groups[r.group].push(o);
  });
  if (ids) { // keep the order the list was saved in
    const order = {}; (list.body.ids || []).forEach((id, i) => { order[String(id)] = i; });
    Object.values(groups).forEach(a => a.sort((x, y) => order[x.id] - order[y.id]));
  } else Object.values(groups).forEach(a => a.sort((x, y) => (y.vgPer || y.vg || y.rate || 0) - (x.vgPer || x.vg || x.rate || 0)));
  return { view: "brand", quarter: quarterLabel(), columns: data.columns, widths: data.widths, rows: ids ? {} : data.rowOrder, list: list ? { title: list.name, slug: list.slug, manual: !!list.body.manual,
    lock: list.body.lock ? { on: list.body.lock.on, quarter: list.body.lock.quarter } : null,
    // Estimated Views (Tom, 10 Oct 2026): a list can call YouTube's View Guarantee
    // "Estimated Views" instead, for pitches where the views are not guaranteed.
    estViews: !!list.body.estViews } : null, groups };
}

function teamPayload(data, email) {
  const groups = {};
  GROUPS.forEach(g => { groups[g.id] = []; });
  data.rows.forEach(r => groups[r.group].push(teamRow(r)));
  Object.values(groups).forEach(a => a.sort((x, y) => (y.vgPer || 0) - (x.vgPer || 0)));
  return { view: "team", email, quarter: quarterLabel(), columns: data.columns, widths: data.widths, rows: data.rowOrder, groups,
    lists: data.lists.map(l => ({ id: l.id, title: l.name, slug: l.slug, ids: l.body.ids || [], by: l.by, updated: l.updated, locked: l.body.lock ? l.body.lock.on : "" })) };
}

// ---------------------------------------------------------------- writes (team only)

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return {};
}
const stamp = () => new Date().toISOString().slice(0, 10);

// Safeguards on main rate card edits (Tom, 9 Oct 2026, after a saved-list session changed 39
// main rows by accident):
//   * scope: the page must say it is editing the main rate card. Pages loaded before this
//     rule (still open in someone's browser) do not send it, so they cannot change it.
//   * undo: every edit returns the exact column values it replaced; op "undo-edit" puts
//     them back, notes included.
//   * audit: every change and undo is posted as an update on the monday item.
const UNDO_KEYS = ["bvg", "bcpm", "brate", "bvideos", "bnote", "bq", "vis"];
async function audit(itemId, text) {
  try { await monday("mutation($i:ID!,$t:String!){create_update(item_id:$i,body:$t){id}}", { i: itemId, t: text }); } catch (e) {}
}
async function editRow(b, email) {
  if (b.scope !== "roster") throw new Error("This page is out of date. Refresh it to keep editing.");
  const isShow = !!b.show;
  const board = isShow ? SUB_BOARD : BOARD, K = isShow ? SC : C;
  const id = String(b.id || "");
  if (!/^\d+$/.test(id)) throw new Error("bad id");
  cache = null; // read the row fresh, so Undo restores exactly what was there
  const data = await loadBoard();
  let row = null, kind = "long";
  data.rows.forEach(r => {
    if (!isShow && r.id === id) { row = r; kind = r.kind; }
    if (isShow) r.shows.forEach(s => { if (s.id === id) { row = s; kind = "long"; } });
  });
  if (!row) throw new Error("row not found");
  const values = {};
  if (b.override != null) {
    if (!["Auto", "Always show", "Hide", "List only"].includes(b.override)) throw new Error("bad override");
    values[K.vis] = { label: b.override };
  }
  if (b.videos !== undefined) {
    // Number of videos brands are quoted (Tom, 9 Oct 2026). Blank goes back to the automatic
    // bundle. Resets with the quarter like the other DFT edits (see brandNumbers).
    if (kind !== "long") throw new Error("Videos can only be set on YouTube rows");
    const cur = brandNumbers(row.cv, K, kind);
    if (!cur) throw new Error("This row has no brand numbers yet");
    const was = bundle(cur, "long").videos;
    let n = null;
    if (b.videos !== null && b.videos !== "") {
      n = num(b.videos);
      if (!(n >= 1) || n > MAX_LIST_VIDEOS || Math.round(n) !== n) throw new Error("Videos must be a whole number from 1 to " + MAX_LIST_VIDEOS);
    }
    Object.assign(values, {
      [K.bvideos]: n == null ? "" : String(n), [K.bq]: quarterLabel(),
      [K.bnote]: "Edited by " + email + " on " + stamp() + " (videos " + (n == null ? "automatic" : n) + ", was " + was + "); resets next quarter",
    });
  }
  if (b.vg != null || b.cpm != null) {
    const cur = brandNumbers(row.cv, K, kind) || {};
    const vg = Math.round(num(b.vg != null ? b.vg : cur.vg) || 0);
    // Short form: the CPM is $25 unless DFT has typed another one for this row.
    const cpm = num(b.cpm != null ? b.cpm : (kind === "long" ? cur.cpm : (cur.askCpm || PRICE.short.cpm))) || 0;
    if (!(vg > 0) || !(cpm > 0) || cpm > 10000 || vg > 1e9) throw new Error("View guarantee and CPM must be positive numbers");
    let rate = Math.round(vg * cpm / 1000);
    if (kind === "long" && rate < FLOOR) rate = FLOOR;
    // Brand CPM keeps the CPM that was asked for (not rate / views), so a small row lifted
    // by the floor is bundled at the CPM DFT chose rather than the house $25.
    Object.assign(values, {
      [K.bvg]: String(vg), [K.bcpm]: String(r2(cpm)), [K.brate]: String(rate), [K.bq]: quarterLabel(),
      [K.bnote]: "Edited by " + email + " on " + stamp() + " (was VG " + (cur.vg || "-") + ", CPM $" + (cur.cpm || "-") + "); resets next quarter",
    });
  }
  if (!Object.keys(values).length) throw new Error("nothing to change");
  const before = {};
  UNDO_KEYS.forEach(k => { if (K[k]) before[k] = row.cv[K[k]] || ""; });
  await monday("mutation($b:ID!,$i:ID!,$v:JSON!){change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id}}",
    { b: String(board), i: id, v: JSON.stringify(values) });
  cache = null;
  const what = b.override != null ? "visibility to " + b.override
    : b.videos !== undefined ? "videos to " + (b.videos == null || b.videos === "" ? "automatic" : b.videos)
    : [b.vg != null ? "view guarantee to " + b.vg : "", b.cpm != null ? "CPM to $" + b.cpm : ""].filter(Boolean).join(", ");
  await audit(id, "Roster site: " + email + " changed " + what + " on the main rate card.");
  return { ok: true, undo: { id, show: isShow, values: before } };
}

async function undoEdit(b, email) {
  const isShow = !!b.show;
  const board = isShow ? SUB_BOARD : BOARD, K = isShow ? SC : C;
  const id = String(b.id || "");
  if (!/^\d+$/.test(id)) throw new Error("bad id");
  const src = b.values && typeof b.values === "object" ? b.values : {};
  const values = {};
  UNDO_KEYS.forEach(k => {
    if (!K[k] || !(k in src)) return;
    const v = String(src[k] == null ? "" : src[k]).slice(0, 500);
    if (k === "vis") values[K[k]] = { label: ["Auto", "Always show", "Hide", "List only"].includes(v) ? v : "Auto" };
    else if (["bvg", "bcpm", "brate", "bvideos"].includes(k)) values[K[k]] = v === "" ? "" : String(num(v) == null ? "" : num(v));
    else values[K[k]] = v;
  });
  if (!Object.keys(values).length) throw new Error("nothing to undo");
  await monday("mutation($b:ID!,$i:ID!,$v:JSON!){change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id}}",
    { b: String(board), i: id, v: JSON.stringify(values) });
  cache = null;
  await audit(id, "Roster site: " + email + " undid the last change on the main rate card.");
  return { ok: true };
}

const slugify = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "roster";

// List links carry no team member's name (Tom, 6 Oct 2026): names typed into the list
// title are dropped from the link and the lead who saved it appears as initials, e.g.
// "Marvel - Margot" saved by margot@ -> /r/marvel-mg-3f9a1c. The title itself is unchanged.
const TEAM = {
  tom: { names: ["tom", "james"], initials: "tj" },
  margot: { names: ["margot", "grant"], initials: "mg" },
  alex: { names: ["alex", "mackenzie"], initials: "am" },
  george: { names: ["george", "roush"], initials: "gr" },
  vivianne: { names: ["vivianne", "viv", "lee"], initials: "vl" },
  brian: { names: ["brian"], initials: "b" },
};
const TEAM_NAMES = new Set(Object.values(TEAM).flatMap(t => t.names));
const initialsFor = email => {
  const local = String(email || "").split("@")[0].toLowerCase().replace(/[^a-z]/g, "");
  return (TEAM[local] && TEAM[local].initials) || local.slice(0, 2) || "dft";
};
const listSlug = (title, email) => {
  const words = String(title || "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w && !TEAM_NAMES.has(w));
  return [slugify(words.join("-")), initialsFor(email), crypto.randomBytes(3).toString("hex")].join("-");
};

async function saveList(b, email) {
  const title = String(b.title || "").trim().slice(0, 80);
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).filter(x => /^\d+$/.test(x)).slice(0, 300);
  if (!title) throw new Error("Give the list a name");
  if (!ids.length) throw new Error("Pick at least one creator");
  const data = await loadBoard();
  const existing = b.slug ? data.lists.find(l => l.slug === b.slug) : null;
  if (existing && existing.bad) throw new Error(LIST_READ_ERROR);
  const nextBody = Object.assign({}, existing ? existing.body : {}, { ids });
  if (existing && nextBody.lock) { // creators added to a locked list are locked at today's prices
    const fresh = new Set(ids.filter(id => !(nextBody.lock.rows || {})[id]));
    if (fresh.size) nextBody.lock = Object.assign({}, nextBody.lock, { rows: Object.assign({}, nextBody.lock.rows, lockSnapshot(data, { name: title, slug: existing.slug, body: nextBody }, fresh)) });
  }
  if (existing) {
    await writeList(existing.id, nextBody, { name: title, [L.updated]: email + " " + stamp() });
    return { ok: true, slug: existing.slug, url: "https://" + HOST + "/r/" + existing.slug };
  }
  // A random tail so one brand cannot guess another brand's list from its name.
  const slug = listSlug(title, email);
  const url = "https://" + HOST + "/r/" + slug;
  const created = await monday("mutation($b:ID!,$n:String!,$v:JSON!){create_item(board_id:$b,item_name:$n,column_values:$v){id}}",
    { b: String(LISTS_BOARD), n: title, v: JSON.stringify({ [L.slug]: slug, [L.by]: email + " " + stamp(), [L.link]: { url, text: "Open list" } }) });
  await writeList(created.create_item.id, nextBody, {});
  return { ok: true, slug, url };
}

async function deleteList(b) {
  const data = await loadBoard();
  const l = data.lists.find(x => x.slug === String(b.slug || ""));
  if (!l) throw new Error("list not found");
  // Archived, not deleted: it can be restored from the board's archive.
  await monday("mutation($i:ID!){archive_item(item_id:$i){id}}", { i: l.id });
  cache = null;
  return { ok: true };
}

async function listPrice(b, email) {
  const data = await loadBoard();
  const list = data.lists.find(x => x.slug === String(b.slug || ""));
  if (!list) throw new Error("list not found");
  const id = String(b.id || "");
  if (!/^\d+$/.test(id)) throw new Error("bad id");
  let kind = null;
  data.rows.forEach(r => { if (r.id === id) kind = r.kind; r.shows.forEach(s => { if (s.id === id) kind = "long"; }); });
  if (!kind) throw new Error("row not found");
  if (list.bad) throw new Error(LIST_READ_ERROR);
  const prices = Object.assign({}, list.body.prices || {});
  if (b.clear && b.field === "videos") { // back to the automatic count, keep any price
    const rest = Object.assign({}, prices[id] || {}); delete rest.videos;
    if (Object.keys(rest).length) prices[id] = rest; else delete prices[id];
  } else if (b.clear) delete prices[id];
  else if (b.disc != null) {
    // Discount tick: remember the CPM it starts from; unticking puts that CPM back.
    const cur = Object.assign({}, prices[id] || {});
    if (b.disc) {
      const from = r2(num(cur.cpm != null ? cur.cpm : b.curCpm) || 0), vg = Math.round(num(cur.vg != null ? cur.vg : b.curVg) || 0);
      if (!(from > 0) || !(vg > 0)) throw new Error("This row has no price to discount yet");
      Object.assign(cur, { disc: true, discFrom: from, cpm: from, vg });
    } else {
      if (cur.discFrom > 0) cur.cpm = cur.discFrom;
      delete cur.disc; delete cur.discFrom;
    }
    prices[id] = cur;
  } else if (kind === "long" && b.videos != null) {
    // Number of videos for this row on this list only (Tom, 9 Oct 2026).
    const n = num(b.videos);
    if (!(n >= 1) || n > MAX_LIST_VIDEOS || Math.round(n) !== n) throw new Error("Videos must be a whole number from 1 to " + MAX_LIST_VIDEOS);
    prices[id] = Object.assign({}, prices[id] || {}, { videos: n });
  } else if (kind === "long") {
    const cur = prices[id] || {};
    const vg = Math.round(num(b.vg != null ? b.vg : (cur.vg || b.curVg)) || 0), cpm = num(b.cpm != null ? b.cpm : (cur.cpm || b.curCpm)) || 0;
    if (!(vg > 0) || !(cpm > 0) || cpm > 10000 || vg > 1e9) throw new Error("View guarantee and CPM must be positive numbers");
    prices[id] = Object.assign({ vg, cpm: r2(cpm) }, cur.videos ? { videos: cur.videos } : {}, cur.disc ? { disc: true, discFrom: cur.discFrom } : {});
  } else {
    // Short form on a list: View Estimate, CPM and the content production fee.
    const cur = prices[id] || {};
    const pick = (k, curK) => num(b[k] != null ? b[k] : (cur[k] != null ? cur[k] : b[curK]));
    const vg = Math.round(pick("vg", "curVg") || 0), cpm = pick("cpm", "curCpm") || 0, fee = pick("fee", "curFee");
    if (!(vg > 0) || !(cpm > 0) || cpm > 10000 || vg > 1e9) throw new Error("View estimate and CPM must be positive numbers");
    if (fee == null || fee < 0 || fee > 1e6) throw new Error("Production fee must be zero or more");
    prices[id] = Object.assign({ vg, cpm: r2(cpm), fee: Math.round(fee) }, cur.disc ? { disc: true, discFrom: cur.discFrom } : {});
  }
  const body = Object.assign({}, list.body, { prices });
  if (body.lock) { // a price changed on a locked list is locked at its new value
    const snap = lockSnapshot(data, Object.assign({}, list, { body }), new Set([id]));
    const rows = Object.assign({}, body.lock.rows); delete rows[id]; Object.assign(rows, snap);
    body.lock = Object.assign({}, body.lock, { rows });
  }
  await writeList(list.id, body, { [L.updated]: email + " " + stamp() });
  const fresh = await loadBoard();
  return brandPayload(fresh, fresh.lists.find(x => x.slug === list.slug) || Object.assign({}, list, { body }), true);
}

// The brand's own feedback on a list (Tom, 10 Oct 2026). Brands are not signed in: the list's
// link (with its random tail) is what lets them in, the same as viewing it. They can only
// approve or un-approve a creator already on the list and leave a short note on it. Each
// change is posted as an update on the list's monday item so the team hears about it.
async function brandFeedback(b) {
  cache = null; // read the list fresh so one brand click never undoes another
  const data = await loadBoard();
  const list = data.lists.find(x => x.slug === String(b.slug || ""));
  if (!list) throw new Error("This list is no longer available");
  if (list.bad) throw new Error("Sorry, that could not be saved. Please let Digital Fox Talent know.");
  const id = String(b.id || "");
  if (!(list.body.ids || []).map(String).includes(id)) throw new Error("That creator is not on this list");
  const note = String(b.note == null ? "" : b.note).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, 500);
  const ok = !!b.ok;
  const feedback = Object.assign({}, list.body.feedback || {});
  const before = feedback[id] || {};
  if (ok || note) feedback[id] = { ok, note, at: stamp() }; else delete feedback[id];
  const body = Object.assign({}, list.body, { feedback });
  await writeList(list.id, body, {});
  const row = data.rows.find(r => r.id === id), who = (row && row.name) || "a creator";
  const bits = [];
  if (!!before.ok !== ok) bits.push(ok ? "approved " + who : "took the approval off " + who);
  if (String(before.note || "") !== note) bits.push(note ? "left a note on " + who + ": " + note : "removed their note on " + who);
  if (bits.length) await audit(list.id, "Brand feedback on \u201c" + list.name + "\u201d: " + bits.join("; "));
  const fresh = await loadBoard();
  return brandPayload(fresh, fresh.lists.find(x => x.slug === list.slug) || Object.assign({}, list, { body }), false);
}

async function listLabel(b, email) {
  const data = await loadBoard();
  const list = data.lists.find(x => x.slug === String(b.slug || ""));
  if (!list) throw new Error("list not found");
  if (list.bad) throw new Error(LIST_READ_ERROR);
  const body = Object.assign({}, list.body, { estViews: !!b.est });
  await writeList(list.id, body, { [L.updated]: email + " " + stamp() });
  const fresh = await loadBoard();
  return brandPayload(fresh, fresh.lists.find(x => x.slug === list.slug) || Object.assign({}, list, { body }), true);
}

async function listConfirm(b, email) {
  const data = await loadBoard();
  const list = data.lists.find(x => x.slug === String(b.slug || ""));
  if (!list) throw new Error("list not found");
  if (list.bad) throw new Error(LIST_READ_ERROR);
  const id = String(b.id || "");
  if (!(list.body.ids || []).map(String).includes(id)) throw new Error("That creator is not on this list");
  // stage: "" | "approached" | "confirmed". The older on:true/false still means confirmed.
  const stage = b.stage != null ? String(b.stage) : (b.on ? "confirmed" : "");
  if (!["", "approached", "confirmed"].includes(stage)) throw new Error("Unknown stage");
  const conf = new Set((list.body.confirmed || []).map(String)), appr = new Set((list.body.approached || []).map(String));
  conf.delete(id); appr.delete(id);
  if (stage === "confirmed") conf.add(id);
  if (stage === "approached") appr.add(id);
  const body = Object.assign({}, list.body, { confirmed: [...conf], approached: [...appr] });
  await writeList(list.id, body, { [L.updated]: email + " " + stamp() });
  const fresh = await loadBoard();
  return brandPayload(fresh, fresh.lists.find(x => x.slug === list.slug) || Object.assign({}, list, { body }), true);
}

async function listLock(b, email) {
  const data = await loadBoard();
  const list = data.lists.find(x => x.slug === String(b.slug || ""));
  if (!list) throw new Error("list not found");
  if (list.bad) throw new Error(LIST_READ_ERROR);
  const body = Object.assign({}, list.body);
  if (b.lock) body.lock = { on: stamp(), by: email, quarter: quarterLabel(), rows: lockSnapshot(data, list) };
  else delete body.lock;
  await writeList(list.id, body, { [L.updated]: email + " " + stamp() });
  const fresh = await loadBoard();
  return brandPayload(fresh, fresh.lists.find(x => x.slug === list.slug) || Object.assign({}, list, { body }), true);
}

async function saveColumns(b, email) {
  const cols = (Array.isArray(b.columns) ? b.columns : []).map(String).filter(x => /^[a-zA-Z0-9]+$/.test(x)).slice(0, 60);
  if (!cols.length) throw new Error("no columns");
  // Row order per tab (the team's default for everyone), ids only.
  const rows = {};
  const src = b.rows && typeof b.rows === "object" ? b.rows : {};
  GROUPS.forEach(g => { if (Array.isArray(src[g.id])) rows[g.id] = src[g.id].map(String).filter(x => /^\d+$/.test(x)).slice(0, 300); });
  // Column widths (dragged on a header edge), key -> pixels.
  const widths = {};
  const ws = b.widths && typeof b.widths === "object" ? b.widths : {};
  Object.keys(ws).slice(0, 80).forEach(k => { const w = Math.round(num(ws[k]) || 0); if (/^[a-zA-Z0-9]+$/.test(k) && w >= 40 && w <= 1600) widths[k] = w; });
  const data = await loadBoard();
  let sid = data.settingsId;
  if (!sid) sid = (await monday("mutation($b:ID!,$n:String!){create_item(board_id:$b,item_name:$n){id}}", { b: String(LISTS_BOARD), n: "__settings" })).create_item.id;
  await writeList(sid, { columns: cols, rows, widths }, { [L.updated]: email + " " + stamp() }, true);
  return { ok: true };
}

// ---------------------------------------------------------------- handler

export default async function handler(req, res) {
  try {
    const host = hostOf(req);
    if (host !== HOST && !isPreview(host)) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(404).json({ error: "Not found" }); // 404 not 403: do not confirm it exists
    }
    if (!token()) return res.status(500).json({ error: "MONDAY_API_KEY env var not set" });
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    const q = req.query || {};
    const secret = token();
    const email = teamEmail(req, secret);

    if (q.op === "handoff") {
      res.setHeader("Cache-Control", "private, no-store");
      const who = handoffEmail(q.t, secret);
      if (!who) { res.setHeader("Location", "/?signin=failed"); return res.status(302).end(); }
      res.setHeader("Set-Cookie", setTeamCookie(res, secret, who));
      res.setHeader("Location", "/");
      return res.status(302).end();
    }
    if (q.op === "signout") {
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Set-Cookie", clearTeamCookie());
      res.setHeader("Location", "/");
      return res.status(302).end();
    }

    if (req.method === "POST") {
      res.setHeader("Cache-Control", "private, no-store");
      const origin = String(req.headers.origin || "");
      if (origin && origin !== "https://" + host) return res.status(403).json({ error: "Bad origin" });
      const b = await readBody(req);
      // The only thing a brand (not signed in) can do: feedback on the list it was sent.
      if (b && b.op === "brand-feedback") {
        if (!origin) return res.status(403).json({ error: "Bad origin" });
        try { return res.status(200).json(await brandFeedback(b)); }
        catch (e) { return res.status(400).json({ error: String(e && e.message || e) }); }
      }
      if (!email) return res.status(401).json({ error: "Sign in with your DFT Google account" });
      try {
        if (b.op === "edit") return res.status(200).json(await editRow(b, email));
        if (b.op === "undo-edit") return res.status(200).json(await undoEdit(b, email));
        if (b.op === "save-list") return res.status(200).json(await saveList(b, email));
        if (b.op === "delete-list") return res.status(200).json(await deleteList(b));
        if (b.op === "columns") return res.status(200).json(await saveColumns(b, email));
        if (b.op === "list-price") return res.status(200).json(await listPrice(b, email));
        if (b.op === "list-lock") return res.status(200).json(await listLock(b, email));
        if (b.op === "list-confirm") return res.status(200).json(await listConfirm(b, email));
        if (b.op === "list-label") return res.status(200).json(await listLabel(b, email));
      } catch (e) {
        return res.status(400).json({ error: String(e && e.message || e) });
      }
      return res.status(400).json({ error: "unknown op" });
    }

    if (q.view === "team") {
      res.setHeader("Cache-Control", "private, no-store");
      if (!email) return res.status(401).json({ error: "signin" });
      if (q.fresh) cache = null;
      const data = await loadBoard();
      res.setHeader("Set-Cookie", setTeamCookie(res, secret, email)); // keep the session alive while used
      return res.status(200).json(teamPayload(data, email));
    }

    const data = await loadBoard();
    if (q.list) {
      const list = data.lists.find(l => l.slug === String(q.list));
      if (!list) { res.setHeader("Cache-Control", "s-maxage=30"); return res.status(404).json({ error: "This list is no longer available" }); }
      if (email) { // the team sees which prices are list-only; never cache that copy
        res.setHeader("Cache-Control", "private, no-store");
        return res.status(200).json(brandPayload(data, list, true));
      }
      // Not edge-cached: a brand's own approvals and notes must show as soon as they reload.
      res.setHeader("Cache-Control", "private, no-store");
      return res.status(200).json(brandPayload(data, list, false));
    }
    // Brand numbers change once a quarter or when the team edits one, so a short edge
    // cache with a long stale window keeps the page instant without hiding an edit for long.
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=86400");
    return res.status(200).json(brandPayload(data, null));
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
