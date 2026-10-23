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
const REG = { handle: "text_mm70axtt", supplier: "color_mm70wx2a", state: "color_mm708t66", type: "color_mm70bcs0", reach: "numeric_mm70p44q", price: "numeric_mm86mxk2" };
const HOST = "roster-viewguarantee.digitalfoxtalent.com";

const GROUPS = [
  { id: "topics", kind: "long" },          // YouTube channels
  // YouTube Dedicated (Tom, 13 Oct 2026): a whole video about the brand. Not a monday group:
  // each YouTube channel row is shown again here, priced from its own numbers (see dedNumbers).
  { id: "dedicated", kind: "long", virtual: true },
  // YouTube Live (Tom, 22 Oct 2026, RayNeo x Call of Duty asked for a livestream): one live stream on the channel,
  // priced exactly as a dedicated video. Shown like Dedicated: each YouTube channel row again, ids l<item id>.
  { id: "live", kind: "long", virtual: true },
  { id: "group_mm4av3kr", kind: "short" }, // YouTube Shorts
  { id: "group_mm4a1fe0", kind: "short" }, // Instagram
  { id: "group_mm4bd5tk", kind: "short" }, // TikTok
  { id: "group_mm7yw8cy", kind: "short" }, // Snapchat (added 8 Oct 2026; no sync, numbers kept by hand)
];
const CAP = { long: 30, short: 50 };
// Dedicated video pricing (Tom, 13 Oct 2026): 3x the channel's integration rate for the same
// per-video view guarantee (so 3x its CPM, $75 at the house $25), one video, never bundled,
// with the same $1,500 minimum. The brand cap scales the same way: hidden over $90 CPM.
const DED = { mult: 3, minRate: 1500 };
const REAL_GROUPS = () => GROUPS.filter(g => !g.virtual);
const isDedId = id => /^[dl]\d+$/.test(String(id)); // Dedicated (d) and YouTube Live (l) rows share the dedicated price
const ROW_ID = /^[dl]?\d+$/; // monday item ids, d<item id> for a channel's Dedicated row, l<item id> for its YouTube Live row
// Short form (Shorts, Instagram, TikTok, Snapchat), Tom 8 Oct 2026: the View Estimate x a
// $25 CPM gives the media rate, with NO $1,500 floor, and a content production fee (tiered,
// see feeFor) is added on top. Total Rate = rate + fee. 12 months of digital usage and
// boosting rights are included. YouTube long-form is unchanged ($25 CPM, $1,500 minimum, no fee).
// View Estimate = HALF the average (Tom and Margot, 13 Oct 2026; was 1x), so the publishing
// rate halves with it. This is the one place that number lives for the roster: brandNumbersRaw
// works the estimate out from Brand Basis Avg x this, and liveFor / priceFrom use it too.
// Short form (Tom, 13 Oct 2026, from Alex): priced by the post, not by views. Brands pay the
// production fee (tier by channel size, feeFor) plus a Publishing Rate of POST_SHARE of it for
// the creator to post. The views figure is the plain quarter average (mult 1), shown for
// context only. short.cpm is kept only for the team's blue Live columns.
const PRICE = { long: { mult: 1.5, cpm: 25 }, short: { mult: 1, cpm: 25 } };
const POST_SHARE = 0.2;
const FLOOR = 1500;
const FEE = 3000;
// Production fee tiers (Margot, 8 Oct 2026): under 100k views $3,000, 100k to 250k $5,000,
// 250k and over $7,500. A fee typed on a saved list still wins. The tier follows the creator's
// FULL average, not the halved View Estimate (Tom, 13 Oct 2026), so it is worked out from the
// estimate / PRICE.short.mult and halving the estimate never drops anyone a fee tier.
const feeFor = vg => { const avg = (vg || 0) / PRICE.short.mult; return avg >= 250000 ? 7500 : avg >= 100000 ? 5000 : FEE; };
// Round numbers for clients (Margot, 8 Oct 2026), every tab: views to the nearest 1,000,
// rates to the nearest $100. The CPM is left exactly as priced, so it stays a clean $25.
const r1k = n => (n == null ? n : Math.max(1000, Math.round(n / 1000) * 1000));
const r100 = n => (n == null ? n : Math.round(n / 100) * 100);
// A discounted row on a saved list rounds its rate to the nearest $10 instead (Tom, 9 Oct 2026),
// so the new price is the full price less exactly the % taken off the CPM. Rounding both to
// $100 made small rates drift a point either side (e.g. $6,800 to $6,500 showed 4% off).
const r10 = n => (n == null ? n : Math.round(n / 10) * 10);
// YouTube rates are shown exactly, to the dollar (Margot, 12 Oct 2026: "$6,875 becomes
// $6,900, can we change it back?"). Views still round to the nearest 1,000 on every tab,
// and Shorts, Instagram, TikTok and Snapchat rates still round to $100 as before.
const r1 = n => (n == null ? n : Math.round(n));
function roundNums(b, fine, kind = "long") {
  if (!b) return b;
  const rr = kind === "long" ? r1 : fine ? r10 : r100;
  // Views a DFT member typed (on the main rate card or a list) show exactly as typed (Tom and
  // Margot, 12 Oct 2026: rounding a typed 287,500 to 288,000 felt like the page fighting back).
  // Only the views the quarterly sync works out are rounded to the nearest 1,000.
  const rv = b.typed || b.custom ? (n => (n == null ? n : Math.round(n))) : r1k;
  const o = Object.assign({}, b, { vg: rv(b.vg), rate: rr(b.rate) });
  if (b.vgPer != null) o.vgPer = rv(b.vgPer);
  if (b.ratePer != null) o.ratePer = rr(b.ratePer);
  // YouTube: the rate is the views shown x the CPM shown, so a brand checking the sum gets the
  // same answer (116,000 views at $25 is $2,900, not the $2,911 of the unrounded 116,420).
  // Never below the $1,500 minimum.
  if (kind === "long" && b.listCpm > 0) { // a list's own CPM: exactly views x CPM, no minimum
    // The unrounded list CPM (a rate typed on a list is stored as a CPM to 4 decimals), so the
    // rate shown is exactly the rate typed (Tom, 15 Oct 2026).
    if (o.vg > 0) o.rate = Math.round(o.vg * b.listCpm / 1000);
    if (o.vgPer != null) o.ratePer = Math.round(o.vgPer * b.listCpm / 1000);
  }
  else if (kind === "long" && Math.abs((b.rate || 0) - FLOOR) <= 1) { // held at the minimum
    o.rate = FLOOR;
    if (b.ded && o.vg > 0) o.cpm = r2(FLOOR * 1000 / o.vg); // Dedicated: the CPM shown matches the views shown
  }
  else if (kind === "long" && o.vg > 0 && o.cpm > 0 && b.rate >= FLOOR) {
    o.rate = Math.max(FLOOR, Math.round(o.vg * o.cpm / 1000));
    if (o.vgPer != null && b.ratePer != null) o.ratePer = Math.round(o.vgPer * o.cpm / 1000);
  }
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
  // Short form only (Tom, 13 Oct 2026, "the board should match"): the production fee and
  // publishing rate + fee, as the roster quotes them. Written by edits here and the quarterly
  // snapshot; the roster itself works the fee out from the views, so it never reads these.
  bfee: "numeric_mm833t0", btotal: "numeric_mm83h8tz",
  // Press packages (Tom, 16 Oct 2026): the creator's typical earned media ideas, one per line.
  // Shown on press packages instead of prices. Edited here or on a press package's page.
  ideas: "long_text_mm865v16",
};
const SC = {
  rate: "numeric_mm495xbb", vg: "numeric_mm49tej8", cpm: "numeric_mm49fe4b", avg: "numeric_mm4957y3", url: "text_mm49bb5z",
  bvg: "numeric_mm7vzc0y", bcpm: "numeric_mm7vjh1a", brate: "numeric_mm7vm5z8", bbasis: "numeric_mm7vhe7f",
  bq: "text_mm7v1hhz", bnote: "text_mm7vjp1y", vis: "color_mm7vvvfz",
  bvideos: "numeric_mm7z2dv1",
};
const L = { slug: "text_mm7vgrr5", items: "long_text_mm7vtnkw", by: "text_mm7v2v06", link: "link_mm7vwxw0", updated: "text_mm7vj42p", opened: "date_mm867kmd" };
// List storage (Tom, 10 Oct 2026). monday cuts a long text at 2,000 characters. Locking a
// big list went past that, the cut-off JSON could not be read, and the next save wrote the
// list back empty (Alex's "Avengers: Doomsday"). The JSON is now split across "Items" and
// "Items 2" to "Items 8" (about 15,000 characters), a list that cannot be read is never
// written over, a list is never saved without creators, and every write is read back.
// Items 9 to 16 (16 Oct 2026): campaign ideas, research and briefs on big lists (Ghost Soldier) went past 15,000.
const ITEM_COLS = [L.items, "long_text_mm80t78r", "long_text_mm80ndjr", "long_text_mm80wpxt", "long_text_mm80gas0", "long_text_mm801cds", "long_text_mm80dann", "long_text_mm80qawp",
  "long_text_mm86jf1e", "long_text_mm862ksn", "long_text_mm86jxrd", "long_text_mm86njsy", "long_text_mm86wrfm", "long_text_mm86nd9s", "long_text_mm86ndpb", "long_text_mm8623cn"];
const CHUNK = 1900;
const LIST_READ_ERROR = "This list's saved data could not be read, so nothing was changed. Ask Tom to check it.";
function bodyValues(obj) {
  const s = JSON.stringify(obj);
  if (s.length > CHUNK * ITEM_COLS.length) throw new Error("This list is too big to save (" + s.length + " characters). Take some creators or list prices off and try again.");
  // Never cut next to a space: monday trims a long text's edges, which dropped spaces from the joined
  // JSON (God of War Laufey list, 16 Oct 2026). Each piece ends and starts on a non-space character.
  const parts = []; let pos = 0;
  while (pos < s.length) { let end = Math.min(pos + CHUNK, s.length); while (end < s.length && end > pos + 1 && (/\s/.test(s[end - 1]) || /\s/.test(s[end]))) end--; parts.push(s.slice(pos, end)); pos = end; }
  if (parts.length > ITEM_COLS.length) throw new Error("This list is too big to save (" + s.length + " characters). Take some creators or list prices off and try again.");
  const v = {};
  ITEM_COLS.forEach((c, i) => { v[c] = { text: parts[i] || "" }; });
  return { values: v, text: s };
}
function readListBody(cv) {
  const s = ITEM_COLS.map(c => cv[c] || "").join("");
  if (!s.trim()) return { body: {}, bad: false };
  try { const b = JSON.parse(s); return { body: b && typeof b === "object" ? b : {}, bad: !(b && typeof b === "object") }; }
  catch (e) { return { body: {}, bad: true }; }
}
// Write a list's JSON (plus any other columns) and read it back to be sure it stuck.
// Speed (Tom, 11 Oct 2026): the read-back comes back in the same call as the write, and the
// warm copy of the board is patched with the new list instead of being thrown away, so a
// tick or price edit costs one monday call rather than a full reload of the roster.
async function writeList(itemId, body, extra, isSettings) {
  if (!isSettings && !(Array.isArray(body.ids) && body.ids.length)) throw new Error("A list needs at least one creator, so nothing was changed.");
  const { values, text } = bodyValues(body);
  const d = await monday(`mutation($b:ID!,$i:ID!,$v:JSON!){change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id name column_values(ids:${JSON.stringify(ITEM_COLS.concat([L.updated]))}){id text}}}`,
    { b: String(LISTS_BOARD), i: String(itemId), v: JSON.stringify(Object.assign({}, extra || {}, values)) });
  const item = (d || {}).change_multiple_column_values || {};
  const cv = {}; (item.column_values || []).forEach(c => { cv[c.id] = c.text || ""; });
  if (ITEM_COLS.map(c => cv[c] || "").join("") !== text) { cache = null; throw new Error("monday did not save the whole list. Please try again, and tell Tom if it keeps happening."); }
  if (isSettings) { cache = null; return; }
  if (cache) {
    const l = cache.data.lists.find(x => x.id === String(itemId));
    if (l) { Object.assign(l, { body: JSON.parse(text), bad: false, updated: cv[L.updated] || l.updated, name: item.name || l.name }); await noteWrite(LISTS_BOARD); }
    else cache = null; // a new list: the next read loads it
  }
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
// A channel's Dedicated numbers, from its integration numbers: the same per-video view
// guarantee at 3x the CPM it is sold at (the house $25 for a row the minimum lifted).
function dedNumbers(b) {
  if (!b || !(b.vg > 0)) return null;
  const floored = !(b.rate > FLOOR + 1);
  const base = !floored ? (b.askCpm || b.cpm) : (b.askCpm && b.askCpm < b.cpm - 0.01 ? b.askCpm : PRICE.long.cpm);
  const cpm = r2(base * DED.mult), rate = Math.max(DED.minRate, Math.round(b.vg * cpm / 1000));
  const o = Object.assign({}, b, { rate, cpm: r2(rate * 1000 / b.vg), askCpm: cpm, ded: true, noBundle: true });
  delete o.videosSet; // a video count set for integrations is not a dedicated count
  return o;
}
const ownNumbers = r => r.dedicated ? dedNumbers(brandNumbers(r.cv, C, "long")) : brandNumbers(r.cv, C, r.kind);
function brandNumbersRaw(cv, K, kind) {
  const vg = pos(cv[K.bvg]), rate = pos(cv[K.brate]);
  const sBasis = pos(cv[K.bbasis]);
  if (kind !== "long" && (vg || sBasis)) {
    // Short form is re-priced here at $25 so the quarter's stored $50 numbers need no
    // rewrite. A CPM a DFT member typed in (note "Edited by") is kept.
    // The View Estimate is worked out HERE from the quarter's average (Brand Basis Avg) x
    // PRICE.short.mult (Tom, 13 Oct 2026), so the page never depends on which multiplier a
    // sync or the quarterly snapshot last stored in Brand VG. A View Estimate a DFT member
    // typed (note "Edited by") is shown exactly as typed.
    const typed = /^Edited by/.test(cv[K.bnote] || "");
    const est = typed && vg ? vg : sBasis ? Math.round(sBasis * PRICE.short.mult) : vg;
    const cpm = (typed && pos(cv[K.bcpm])) || PRICE.short.cpm;
    return { vg: est, rate: Math.round(est * cpm / 1000), cpm: r2(cpm), askCpm: r2(cpm), typed, basis: sBasis, quarter: cv[K.bq] || "", note: cv[K.bnote] || "", provisional: false };
  }
  // cpm is always the effective one (rate / views). askCpm is the CPM that was asked
  // for: the same thing, except on a row lifted by the $1,500 floor after a DFT edit.
  if (vg && rate) { const eff = r2(rate * 1000 / vg); return { vg, rate, cpm: eff, askCpm: pos(cv[K.bcpm]) || eff, typed: /^Edited by/.test(cv[K.bnote] || ""), basis: pos(cv[K.bbasis]), quarter: cv[K.bq] || "", note: cv[K.bnote] || "", provisional: false }; }
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
  // A row priced on a saved list (Tom, 12 Oct 2026): the bundle size is set at the normal CPM
  // (or the CPM a discount started from), and the price is the views x the list's CPM, with no
  // $1,500 minimum, so a lower CPM or a discount always lowers the rate.
  if (kind === "long" && b.noBundle && !(b.listCpm > 0)) { // Dedicated: one video unless a list sets more
    if (!(b.videosSet > 0)) return out;
    const n = Math.round(b.videosSet), per = b.vg * (b.askCpm || b.cpm) / 1000;
    return Object.assign(out, { videos: n, vg: b.vg * n, rate: Math.max(DED.minRate, Math.round(per * n)), ratePer: Math.round(per), videosSet: n });
  }
  if (kind === "long" && b.listCpm > 0) {
    const lc = b.listCpm, per = b.vg * lc / 1000;
    let n = b.videosSet > 0 ? Math.round(b.videosSet) : 1;
    if (!(b.videosSet > 0) && !b.noBundle) {
      const perRef = b.vg * (b.refCpm || PRICE.long.cpm) / 1000;
      if (perRef > 0 && perRef < FLOOR - 0.5) { const need = Math.ceil(FLOOR / perRef - 1e-9); if (need <= MAX_BUNDLE) n = need; }
    }
    return Object.assign(out, { videos: n, vg: b.vg * n, rate: Math.round(per * n), cpm: r2(lc), askCpm: r2(lc), ratePer: Math.round(per) }, b.videosSet > 0 ? { videosSet: n } : {});
  }
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
  const cap = b.ded ? CAP.long * DED.mult : CAP[kind];
  if (b.cpm > cap + 0.005 && !b.videosSet) return { show: false, why: "CPM $" + b.cpm + " is over the $" + cap + " cap" };
  if (b.videos > 1) return { show: true, why: "Sold as a " + b.videos + "-video bundle" };
  return { show: true, why: "" };
}

const normName = n => String(n || "").toLowerCase().replace(/\s*[-–]\s*shorts\s*$/i, "").replace(/[^a-z0-9]/g, "");

// ---------------------------------------------------------------- load

const PCOLS = Object.values(C), SCOLS = Object.values(SC);
let cache = null; // { at, data, stamps } per warm instance

// Every page sees the latest (Tom, 12 Oct 2026). Each warm server copy used to keep the
// board for up to a minute, so a change made through one copy could be missing from a page
// served by another ("updating in some areas and not others"). Now, before using its copy,
// a server asks monday when each board it reads last changed (one small call) and reloads
// only if something did. Changes made here patch the copy and note the board's new time.
const STAMP_BOARDS = [BOARD, SUB_BOARD, LISTS_BOARD, CREATOR_BOARD, REGISTER_BOARD, MEGA_BOARD];
async function boardStamps() {
  const d = await monday(`query{boards(ids:[${STAMP_BOARDS.join(",")}]){id updated_at}}`);
  const o = {}; ((d || {}).boards || []).forEach(b => { o[String(b.id)] = b.updated_at || ""; });
  return o;
}
const sameStamps = (a, b) => !!a && !!b && STAMP_BOARDS.every(id => (a[id] || "") === (b[id] || ""));
async function noteWrite(boardId) { // after our own write: keep the patched copy, note the board's new time
  if (!cache) return;
  try { const s = await boardStamps(); STAMP_BOARDS.forEach(id => { if (String(id) !== String(boardId) && s[id] !== cache.stamps[id]) cache = null; }); if (cache) cache.stamps = s; }
  catch (e) { cache = null; }
}

async function loadBoard() {
  let stamps = null;
  try { stamps = await boardStamps(); } catch (e) { if (cache && Date.now() - cache.at < 60 * 1000) return cache.data; }
  if (cache && sameStamps(stamps, cache.stamps)) { cache.at = Date.now(); return cache.data; }
  const p = JSON.stringify(PCOLS), s = JSON.stringify(SCOLS);
  const groupQ = g => `query{boards(ids:[${BOARD}]){groups(ids:["${g}"]){id items_page(limit:200){items{id name column_values(ids:${p}){id text value} subitems{id name column_values(ids:${s}){id text}}}}}}}`;
  // Location and State / Region come from the Global Talent Roster (Country dup__of_state6,
  // State dup__of_email) - the agreed source since 9 Sep 2026. The rates board's own Location
  // column had drifted (Red Arcade, Breakdowns & Blockbusters, AJM_Nerdcore and Film Paradise
  // all read "United States"), and the Creator board relation the State used to come through
  // is empty on every row, so State/Region showed blank for everyone. Rows are matched on
  // handle (YouTube, Instagram or TikTok), then on name. Audit 6 Oct 2026.
  const stateQ = `query{boards(ids:[${CREATOR_BOARD}]){items_page(limit:500){items{id name group{title} column_values(ids:${JSON.stringify(Object.values(GTR))}){id text value}}}}}`;
  // Every saved list, page by page (16 Oct 2026): a single page stopped at 500, and lists past it would have stopped opening.
  const listCols = `{id name column_values(ids:${JSON.stringify([...new Set(Object.values(L).concat(ITEM_COLS))])}){id text}}`;
  const allLists = async () => {
    const first = await monday(`query{boards(ids:[${LISTS_BOARD}]){items_page(limit:250){cursor items${listCols}}}}`);
    const pg = ((((first || {}).boards || [])[0] || {}).items_page) || { items: [] };
    let items = pg.items || [], cur = pg.cursor;
    for (let n = 0; cur && n < 40; n++) { const nx = await monday(`query($c:String!){next_items_page(limit:250,cursor:$c){cursor items${listCols}}}`, { c: cur }); const p2 = (nx || {}).next_items_page || {}; items = items.concat(p2.items || []); cur = p2.cursor; }
    return { boards: [{ items_page: { items } }] };
  };
  const regQ = `query{boards(ids:[${REGISTER_BOARD}]){items_page(limit:500){items{column_values(ids:${JSON.stringify(Object.values(REG))}){id text}}}}}`;
  const megaQ = `query{boards(ids:[${MEGA_BOARD}]){items_page(limit:500){items{column_values(ids:${JSON.stringify(Object.values(MEGA))}){id text}}}}}`;
  const [groups, state, lists, register, mega] = await Promise.all([
    Promise.all(REAL_GROUPS().map(g => monday(groupQ(g.id)))),
    monday(stateQ).catch(() => null),
    allLists().catch(() => null),
    monday(regQ).catch(() => null),
    monday(megaQ).catch(() => null),
  ]);
  const simulcast = new Set();
  const libsynListing = {}; // YouTube handle -> { reach, price } on the creator's Libsyn Ads listing
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
    // The Libsyn Ads listing's own reach and price (Tom, 16 Oct 2026): lists pitched to Libsyn use them exactly.
    if (v[REG.supplier] === "Libsyn" && v[REG.handle] && pos(v[REG.reach]) && pos(v[REG.price]) && !/Inactive|Not a fit/.test(v[REG.state]))
      libsynListing[v[REG.handle].replace(/^@/, "").toLowerCase()] = { reach: pos(v[REG.reach]), price: pos(v[REG.price]) };
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
    const kind = REAL_GROUPS()[gi].kind;
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
      rows.push({ id: String(it.id), name: it.name, group: REAL_GROUPS()[gi].id, kind, cv, creator, adEx, state: geo.region, country: geo.country, kit: kitFor(creator, cv[C.handle], it.name), shows, simulcast: sim, libsyn: kind === "long" ? libsynListing[String(cv[C.handle] || "").replace(/^@/, "").toLowerCase()] || null : null });
    });
  });

  // Logos: the snapshot writes each YouTube channel's picture. Instagram/TikTok rows and
  // Shorts rows borrow it from the same creator (board relation first, then the name).
  const logoByCreator = {}, logoByName = {};
  rows.forEach(r => { const l = r.cv[C.logo]; if (l) { if (r.creator) logoByCreator[r.creator] = logoByCreator[r.creator] || l; logoByName[normName(r.name)] = logoByName[normName(r.name)] || l; } });
  // Last resort: the saved channel pictures the Campaign reach report keeps by handle.
  const saved = h => AVATARS[("@" + String(h || "").replace(/^@/, "")).toLowerCase()] || "";
  rows.forEach(r => { r.logo = r.cv[C.logo] || (r.creator && logoByCreator[r.creator]) || logoByName[normName(r.name)] || saved(r.cv[C.handle]) || ""; });
  // The Dedicated tab: every YouTube channel again, sharing the same column values (cv), so a
  // change to the channel on the YouTube tab is a change here too. Shows are not sold this way.
  rows.filter(r => r.group === "topics").forEach(r => rows.push(Object.assign({}, r, { id: "d" + r.id, group: "dedicated", dedicated: true, parentId: r.id, shows: [] })));
  rows.filter(r => r.group === "topics").forEach(r => rows.push(Object.assign({}, r, { id: "l" + r.id, group: "live", dedicated: true, live: true, parentId: r.id, shows: [] })));

  const listItems = ((((lists || {}).boards || [])[0] || {}).items_page || { items: [] }).items.map(it => {
    const cv = {}; (it.column_values || []).forEach(c => { cv[c.id] = c.text || ""; });
    const { body, bad } = readListBody(cv);
    return { id: String(it.id), name: it.name, slug: cv[L.slug], body, bad, by: cv[L.by], updated: cv[L.updated], opened: cv[L.opened] || "" };
  });
  const settings = listItems.find(x => x.name === "__settings");
  const data = { rows, lists: listItems.filter(x => x.name !== "__settings" && x.slug), columns: (settings && settings.body.columns) || null,
    rowOrder: (settings && settings.body.rows) || {}, widths: (settings && settings.body.widths) || {}, settingsId: settings && settings.id };
  cache = { at: Date.now(), data, stamps };
  return data;
}

// One list, read straight from monday (Tom, 11 Oct 2026). Every change to a list starts from
// this, never from the warm copy, so two people (or two open tabs) can never undo each
// other's ticks, and pages always show the list as it is now. One small call, not a reload.
async function freshList(slug) {
  let data = await loadBoard();
  let l = data.lists.find(x => x.slug === String(slug || ""));
  if (!l) { cache = null; data = await loadBoard(); l = data.lists.find(x => x.slug === String(slug || "")); }
  if (!l) return { data, list: null };
  const d = await monday(`query{items(ids:[${l.id}]){id name state column_values(ids:${JSON.stringify([...new Set(Object.values(L).concat(ITEM_COLS))])}){id text}}}`);
  const it = ((d || {}).items || [])[0];
  if (!it || it.state === "archived" || it.state === "deleted") { data.lists = data.lists.filter(x => x !== l); return { data, list: null }; }
  const cv = {}; (it.column_values || []).forEach(c => { cv[c.id] = c.text || ""; });
  const { body, bad } = readListBody(cv);
  Object.assign(l, { name: it.name, slug: cv[L.slug] || l.slug, body, bad, by: cv[L.by], updated: cv[L.updated], opened: cv[L.opened] || "" });
  return { data, list: l };
}

// ---------------------------------------------------------------- shaping

function baseFields(r) {
  const cv = r.cv, o = {
    id: r.id, name: r.name, handle: cv[C.handle] || "", url: cv[C.url] || "", logo: r.logo, kind: r.kind, group: r.group,
    subs: pos(cv[C.subs]), adLength: r.live ? "Live stream" : r.dedicated ? "Full video" : AD_LENGTH, adEx: r.adEx, kit: r.kit || "", state: r.state,
    simulcast: r.simulcast ? "Included" : "",
  };
  if (r.dedicated) o.parentId = r.parentId;
  TEXT_FIELDS.forEach(k => { o[k] = /^(male|female|a\d|us|uk)/.test(k) ? pct(cv[C[k]]) : (cv[C[k]] || ""); });
  o.location = r.country || ""; // country, from the Global Talent Roster (see geoFor)
  // One "About" column (Margot, 6 Oct 2026): the Audience Information copy reads better, so
  // it is shown when present, with the short description as the fallback.
  if (o.audience) o.about = o.audience;
  // Ad Types matches the row's price (Tom, 20 Oct 2026, after NETA AI's agency read "Dedicated Video, Integrations" next to an
  // integration rate and asked which one the price was for). The creator's own note stays on the Rates board.
  // Exclusivity reads "30 days" rather than "Yes" (Tom, 20 Oct 2026: "so it's clearer"). The Rates board keeps Yes / Y / No.
  if (/^\s*(y|yes|true)\s*$/i.test(o.exclusive)) o.exclusive = "30 days";
  if (r.kind === "long") o.adTypes = r.live ? "YouTube livestream" : r.dedicated ? "Dedicated video" : "Integration (mid-roll)";
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
      // A CPM set on a saved list prices the row at exactly that CPM, below $1,500 if it comes
      // to that (Tom, 12 Oct 2026: "we do need the rates to reduce below $1500 in line with the
      // cpm"). refCpm is the CPM the bundle size is worked out at, so lowering the CPM or taking
      // a discount lowers the price without adding videos.
      const rate = Math.round(p.vg * p.cpm / 1000);
      const refCpm = p.disc && p.discFrom > 0 ? p.discFrom : PRICE.long.cpm;
      return Object.assign({}, b || {}, { vg: Math.round(p.vg), rate, cpm: r2(p.cpm), askCpm: p.cpm, listCpm: p.cpm, refCpm, custom: true }, videos);
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
  b = roundNums(b, fine, kind);
  if (kind === "long") return Object.assign({}, b, { fee: null, total: b.rate || 0 });
  // Short form: Publishing Rate = POST_SHARE of the production fee, whatever the views.
  const fee = b.fee != null ? b.fee : feeFor(b.vg || 0);
  const rate = Math.round(fee * POST_SHARE);
  return Object.assign({}, b, { fee, rate, total: rate + fee });
}

// Discounts on a saved list (Tom, 10 Oct 2026): a row ticked "Discount" keeps the CPM it had
// when ticked (discFrom); the CPM typed after that is the discounted one. Brands see the
// price at discFrom crossed out beside the new one, and the % off.
function priced(own, p, kind, isShow) {
  const x = bundle(listNumbers(own, p, kind) || own, kind);
  return isShow ? roundNums(x) : addFee(x, kind);
}
const isDisc = p => !!(p && p.disc && p.discFrom > 0);
// Discount by rate as well as CPM, on every tab (Tom, 15 Oct 2026). Short form has been priced
// by its production fee since 13 Oct, so a lower fee never moved the CPM the discount started
// from and brands saw no old price. The price compared against is now the price at the CPM the
// discount started from, or, when that is no higher (short form, or a rate lowered before the
// box was ticked), the rate card price for the row. The order of ticking and lowering no longer
// matters. Short form compares Total Rates; YouTube compares Rates.
function discountFor(own, p, kind, now, isShow) {
  if (!isDisc(p) || !now) return null;
  const amt = x => (isShow || kind === "long" ? x.rate : x.total) || 0;
  let was = priced(own, Object.assign({}, p, { cpm: p.discFrom }), kind, isShow);
  if (!was || !(amt(was) > amt(now))) was = priced(own, p.videos > 0 ? { videos: p.videos } : null, kind, isShow);
  if (!was || !(amt(was) > amt(now))) return null;
  return { wasRate: was.rate, wasTotal: isShow ? was.rate : was.total, discPct: Math.round((1 - amt(now) / amt(was)) * 100) };
}
function brandRow(r, includeHiddenByRule, prices, team, showVis) {
  prices = prices || {};
  const own = ownNumbers(r);
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
    // Shows on a saved list (Tom, 13 Oct 2026): DFT can show a show on one list even though it is
    // hidden on the main rate card, or hide it on that list only (list JSON showVis: { <show id>:
    // "show" | "hide" }). The team on the list's page still gets a hidden show, flagged listHidden,
    // so it can switch it back on. Brands never receive a show that is off for their list.
    const lv = showVis ? showVis[s.id] || "" : "";
    let ok = !!(sv.show || (includeHiddenByRule && sb && s.cv[SC.vis] !== "Hide"));
    if (lv === "show" && sb) ok = true;
    if (lv === "hide") ok = false;
    if (!ok && !(team && showVis && sb)) return null;
    const sd = discountFor(sown, prices[s.id], "long", sb, true);
    return Object.assign({ id: s.id, name: s.name, url: s.cv[SC.url] || "", rate: sb.rate, total: sb.rate, vg: sb.vg, cpm: sb.cpm, minVideos: sb.videos, vgPer: sb.vgPer, custom: team && sb.custom ? true : undefined, videosSet: team && sb.videosSet ? sb.videosSet : undefined, askCpm: team && sb.videosSet ? sb.askCpm : undefined, disc: team && prices[s.id] && prices[s.id].disc ? true : undefined, listHidden: ok ? undefined : true }, sd || {});
  }).filter(Boolean).sort((a, b) => b.vgPer - a.vgPer);
  return o;
}

// Live (daily) figures for the blue columns. For Shorts, Instagram, TikTok and Snapchat the
// Live Estimate is the full live average and the Live Rate is the Publishing Rate today's
// average would give (POST_SHARE of its production fee tier, Tom 13 Oct 2026). Worked out
// here from the live average, so they never depend on what a sync last wrote.
function liveFor(r) {
  const avg = pos(r.cv[C.avg]), lastPub = r.cv[C.lastPub] || "";
  if (r.kind !== "long") return { avg, vg: avg || null, rate: avg ? Math.round(feeFor(avg) * POST_SHARE) : null, cpm: null, lastPub };
  return { avg, vg: pos(r.cv[C.vg]), rate: pos(r.cv[C.rate]), cpm: pos(r.cv[C.cpm]), lastPub };
}

// The live (blue) figures on the Dedicated tab: today's view guarantee at 3x the house CPM.
function dedLive(l) {
  const rate = l.vg ? Math.max(DED.minRate, Math.round(l.vg * PRICE.long.cpm * DED.mult / 1000)) : null;
  return Object.assign({}, l, { rate, cpm: rate && l.vg ? r2(rate * 1000 / l.vg) : null });
}
function teamRow(r) {
  const o = baseFields(r);
  o.ideas = r.cv[C.ideas] || "";
  const b = addFee(bundle(ownNumbers(r), r.kind), r.kind);
  const v = visibility(b, r.cv[C.vis], r.cv[C.bnote], r.kind);
  if (r.kind !== "long") Object.assign(o, { fee: b ? b.fee : feeFor(0), total: b ? b.total : null, rights: RIGHTS });
  else o.total = b ? b.rate : null;
  Object.assign(o, {
    brand: b, override: r.cv[C.vis] || "Auto", show: v.show, why: v.why,
    live: r.dedicated ? dedLive(liveFor(r)) : liveFor(r),
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
  // The creator's answer (Margot, 14 Oct 2026): set by DFT, interested or declined, with an
  // optional note the brand can read, e.g. why they declined or the idea they already have.
  const creatorRes = (list && list.body.creator) || {};
  // Press packages (Tom, 16 Oct 2026): earned media pitches. Same creators, stages and brand
  // feedback as a paid list, but no prices anywhere in what the brand receives, and a column of
  // campaign ideas instead: the list's own idea for a creator, or the creator's standard ideas.
  const press = !!(list && list.body.press);
  const listIdeas = (list && list.body.ideas) || {};
  // Campaign ideas on a paid list (Tom, 16 Oct 2026, Sony's Ghost Soldier: "they want campaign ideas, so I think we
  // might need to add another column"). Ideas for this campaign only, kept on the list; prices stay.
  const ideasOn = !press && !!(list && list.body.ideasOn);
  // Position on AI (Tom, 21 Oct 2026, Genghis for Authors First: "a column ... which clarifies the creators current
  // position on AI in film"). A list-only column, shown once any creator on the list has an entry.
  const aiView = list && list.body.aiView && typeof list.body.aiView === "object" ? list.body.aiView : {};
  const aiViewOn = Object.keys(aiView).length > 0;
  const groups = {};
  GROUPS.forEach(g => { groups[g.id] = []; });
  data.rows.forEach(r => {
    if (ids && !ids.has(r.id)) return;
    if (press && r.dedicated) return; // a paid format only
    const o = brandRow(r, !!ids, press ? {} : prices, team, list ? (list.body.showVis || {}) : null);
    if (o && press) pressRow(o, r, listIdeas, team);
    if (o && ideasOn) { o.ideas = String(listIdeas[r.id] || ""); if (team && o.ideas) o.ideaOwn = true; }
    if (o && aiViewOn) o.aiView = String(aiView[r.id] || "");
    if (o && list) {
      // Brands see the whole Stage too (Tom, 10 Oct 2026), read only apart from Brand approved.
      o.confirmed = confirmed.has(r.id); o.stage = o.confirmed ? "confirmed" : approached.has(r.id) ? "approached" : "";
      const f = feedback[r.id]; if (f && (f.ok || f.no || f.note)) o.fb = { ok: !!f.ok, no: !f.ok && !!f.no, note: String(f.note || "") };
      const cr = creatorRes[r.id]; if (cr && (cr.ok || cr.no || cr.note)) o.cr = { ok: !!cr.ok, no: !cr.ok && !!cr.no, note: String(cr.note || "") };
    }
    if (o && lock && !noLock) applyLock(o, lock);
    // Dedicated videos (Tom, 14 Oct 2026): brands never see the CPM, only the flat price and
    // estimated views. The team keeps it so it can still change a list's price.
    if (o && r.dedicated && !team && !noLock) { delete o.cpm; (o.shows || []).forEach(s => { delete s.cpm; }); }
    if (o) groups[r.group].push(o);
  });
  if (ids) { // keep the order the list was saved in
    const order = {}; (list.body.ids || []).forEach((id, i) => { order[String(id)] = i; });
    Object.values(groups).forEach(a => a.sort((x, y) => order[x.id] - order[y.id]));
  } else Object.values(groups).forEach(a => a.sort((x, y) => (y.vgPer || y.vg || y.rate || 0) - (x.vgPer || x.vg || x.rate || 0)));
  return { view: "brand", quarter: quarterLabel(), columns: data.columns, widths: data.widths, rows: ids ? {} : data.rowOrder, list: list ? { title: list.name, slug: list.slug, manual: !!list.body.manual, gate: !team && listShared(list.body),
    ids: team ? (list.body.ids || []).map(String) : undefined, // the team's copy: every creator, shown or not
    lock: list.body.lock ? { on: list.body.lock.on, quarter: list.body.lock.quarter } : null,
    // Estimated Views (Tom, 10 Oct 2026): a list can call YouTube's View Guarantee
    // "Estimated Views" instead, for pitches where the views are not guaranteed.
    estViews: !!list.body.estViews, press, ideasOn, aiViewOn } : null, groups };
}
// Press rows: views as typical views (the quarter's average, not a guarantee), every price and
// pricing note taken out, shows dropped (they are sold separately), ideas added.
const PRESS_STRIP = ["rate", "total", "fee", "cpm", "askCpm", "wasRate", "wasTotal", "discPct", "rights", "minVideos", "vgPer", "videosSet", "custom", "disc", "simulcast", "adLength", "adTypes", "adEx", "exclusive", "hostRead"];
function pressRow(o, r, listIdeas, team) {
  const avg = r.kind === "long" ? (o.vgPer || o.vg || 0) / PRICE.long.mult : (o.vg || 0);
  PRESS_STRIP.forEach(k => { delete o[k]; });
  o.vg = avg > 0 ? Math.max(1000, Math.round(avg / 1000) * 1000) : null;
  o.shows = [];
  const own = String(listIdeas[r.id] || "");
  o.ideas = own || r.cv[C.ideas] || "";
  if (team) { o.ideaStd = r.cv[C.ideas] || ""; if (own) o.ideaOwn = true; }
}

function teamPayload(data, email) {
  const groups = {};
  GROUPS.forEach(g => { groups[g.id] = []; });
  data.rows.forEach(r => groups[r.group].push(teamRow(r)));
  Object.values(groups).forEach(a => a.sort((x, y) => (y.vgPer || 0) - (x.vgPer || 0)));
  return { view: "team", email, quarter: quarterLabel(), columns: data.columns, widths: data.widths, rows: data.rowOrder, groups,
    lists: data.lists.map(l => ({ id: l.id, title: l.name, slug: l.slug, ids: l.body.ids || [], by: l.by, updated: l.updated, locked: l.body.lock ? l.body.lock.on : "", press: !!l.body.press, fb: feedbackCounts(l.body) })) };
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
const UNDO_KEYS = ["bvg", "bcpm", "brate", "bvideos", "bnote", "bq", "vis", "bfee", "btotal"];
async function audit(itemId, text) {
  try { await monday("mutation($i:ID!,$t:String!){create_update(item_id:$i,body:$t){id}}", { i: itemId, t: text }); } catch (e) {}
}
// Main rate card rows (Tom, 11 Oct 2026): read and write one row, and patch the warm copy
// of the board with what monday sends back, instead of reloading the whole roster twice.
async function freshRow(id, isShow) {
  const data = await loadBoard();
  let row = null, kind = "long";
  data.rows.forEach(r => {
    if (!isShow && r.id === id) { row = r; kind = r.kind; }
    if (isShow) r.shows.forEach(s => { if (s.id === id) { row = s; kind = "long"; } });
  });
  if (!row) throw new Error("row not found");
  const d = await monday(`query{items(ids:[${id}]){id name column_values(ids:${JSON.stringify(isShow ? SCOLS : PCOLS)}){id text}}}`);
  const it = ((d || {}).items || [])[0];
  if (!it) throw new Error("row not found");
  (it.column_values || []).forEach(c => { row.cv[c.id] = c.text || ""; });
  return { data, row, kind };
}
async function writeRow(board, id, values, K, isShow) {
  const ids = Object.keys(values);
  const d = await monday(`mutation($b:ID!,$i:ID!,$v:JSON!){change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id column_values(ids:${JSON.stringify(ids)}){id text}}}`,
    { b: String(board), i: id, v: JSON.stringify(values) });
  const got = {}; ((((d || {}).change_multiple_column_values || {}).column_values) || []).forEach(c => { got[c.id] = c.text || ""; });
  if (!cache) return;
  cache.data.rows.forEach(r => {
    if (!isShow && r.id === id) Object.assign(r.cv, got);
    if (isShow) r.shows.forEach(s => { if (s.id === id) Object.assign(s.cv, got); });
  });
  await noteWrite(board);
}

async function editRow(b, email) {
  if (b.scope !== "roster") throw new Error("This page is out of date. Refresh it to keep editing.");
  const isShow = !!b.show;
  const board = isShow ? SUB_BOARD : BOARD, K = isShow ? SC : C;
  const id = String(b.id || "");
  if (!/^\d+$/.test(id)) throw new Error("bad id");
  // The row itself is read fresh (one small call, not a reload of the roster), so Undo
  // restores exactly what was there.
  const { data, row, kind } = await freshRow(id, isShow);
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
    // A CPM-only change keeps the views that were on screen (rounded unless typed before).
    const vg = Math.round(num(b.vg != null ? b.vg : (cur.typed ? cur.vg : r1k(cur.vg))) || 0);
    // Short form: the CPM is $25 unless DFT has typed another one for this row.
    // Keep the CPM brands see on the page, not rate / views: a bundled row stores an effective
    // CPM like $25.77, and re-pricing at that turned a typed 60,000 into $1,546 (12 Oct 2026).
    let longCpm = cur.cpm;
    if (kind === "long" && cur.vg) {
      const sb = bundle(cur, "long");
      longCpm = sb.videosSet ? sb.askCpm : sb.needs ? (cur.askCpm && cur.askCpm < cur.cpm - 0.01 ? cur.askCpm : PRICE.long.cpm) : sb.cpm;
    }
    const cpm = num(b.cpm != null ? b.cpm : (kind === "long" ? longCpm : (cur.askCpm || PRICE.short.cpm))) || 0;
    if (!(vg > 0) || !(cpm > 0) || cpm > 10000 || vg > 1e9) throw new Error("View guarantee and CPM must be positive numbers");
    let rate = Math.round(vg * cpm / 1000);
    if (kind === "long" && rate < FLOOR) rate = FLOOR;
    // Short form is priced by the post (Tom and Alex, 13 Oct 2026): store what the page shows,
    // the Publishing Rate (POST_SHARE of the production fee for these views) beside the fee and
    // the total, so the board reads the same as the page (fixed 18 Oct 2026; it had kept
    // writing the old views x CPM rate).
    const sFee = kind !== "long" ? feeFor(vg) : 0;
    if (kind !== "long") rate = Math.round(sFee * POST_SHARE);
    // Brand CPM keeps the CPM that was asked for (not rate / views), so a small row lifted
    // by the floor is bundled at the CPM DFT chose rather than the house $25.
    Object.assign(values, {
      [K.bvg]: String(vg), [K.bcpm]: String(r2(cpm)), [K.brate]: String(rate), [K.bq]: quarterLabel(),
      [K.bnote]: "Edited by " + email + " on " + stamp() + " (was VG " + (cur.vg || "-") + ", CPM $" + (cur.cpm || "-") + "); resets next quarter",
    });
    if (kind !== "long" && K.bfee) Object.assign(values, { [K.bfee]: String(sFee), [K.btotal]: String(rate + sFee) });
  }
  if (!Object.keys(values).length) throw new Error("nothing to change");
  const before = {};
  UNDO_KEYS.forEach(k => { if (K[k]) before[k] = row.cv[K[k]] || ""; });
  await writeRow(board, id, values, K, isShow);
  const what = b.override != null ? "visibility to " + b.override
    : b.videos !== undefined ? "videos to " + (b.videos == null || b.videos === "" ? "automatic" : b.videos)
    : [b.vg != null ? "view guarantee to " + b.vg : "", b.cpm != null ? "CPM to $" + b.cpm : ""].filter(Boolean).join(", ");
  await audit(id, "Roster site: " + email + " changed " + what + " on the main rate card.");
  await noteWrite(board); // the audit note also counts as a change on monday
  // The page gets the updated roster back with the answer, so it does not reload it.
  return { ok: true, undo: { id, show: isShow, values: before }, team: teamPayload(data, email) };
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
    else if (["bvg", "bcpm", "brate", "bvideos", "bfee", "btotal"].includes(k)) values[K[k]] = v === "" ? "" : String(num(v) == null ? "" : num(v));
    else values[K[k]] = v;
  });
  if (!Object.keys(values).length) throw new Error("nothing to undo");
  const { data } = await freshRow(id, isShow);
  await writeRow(board, id, values, K, isShow);
  await audit(id, "Roster site: " + email + " undid the last change on the main rate card.");
  await noteWrite(board);
  return { ok: true, team: teamPayload(data, email) };
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
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).filter(x => ROW_ID.test(x)).slice(0, 300);
  if (!title) throw new Error("Give the list a name");
  if (!ids.length) throw new Error("Pick at least one creator");
  const { data, list: existing } = b.slug ? await freshList(b.slug) : { data: await loadBoard(), list: null };
  if (b.slug && !existing) throw new Error("list not found");
  if (existing && existing.bad) throw new Error(LIST_READ_ERROR);
  const nextBody = Object.assign({}, existing ? existing.body : {}, { ids });
  if (!existing && b.press) nextBody.press = true;
  if (!existing && Array.isArray(b.for) && b.for.length) nextBody.for = b.for.map(String).filter(Boolean);
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
  const { list: l } = await freshList(b.slug);
  if (!l) throw new Error("list not found");
  // Archived, not deleted: it can be restored from the board's archive.
  await monday("mutation($i:ID!){archive_item(item_id:$i){id}}", { i: l.id });
  cache = null;
  return { ok: true };
}

async function listPrice(b, email) {
  const { data, list } = await freshList(b.slug);
  if (!list) throw new Error("list not found");
  const id = String(b.id || "");
  if (!ROW_ID.test(id)) throw new Error("bad id");
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
    const vg = Math.round(num(b.vg != null ? b.vg : (cur.vg || b.curVg)) || 0);
    // A Rate typed on a list (Tom, 15 Oct 2026, "offer discounts by adjusting the rate too"):
    // kept as the CPM that gives exactly that rate for the videos shown, which are pinned so
    // the automatic bundle size cannot change under it.
    let cpm, videos = cur.videos;
    if (b.rate != null) {
      const rate = num(b.rate), n = Math.round(num(cur.videos || b.curVideos) || 1);
      if (!(rate > 0) || rate > 1e7) throw new Error("Rate must be a positive number");
      if (!(vg > 0) || !(n >= 1)) throw new Error("This row has no views to price from yet");
      cpm = Math.round(rate * 1000 / (vg * n) * 1e4) / 1e4;
      if (n > 1 || cur.videos) videos = n;
    } else cpm = r2(num(b.cpm != null ? b.cpm : (cur.cpm || b.curCpm)) || 0);
    if (!(vg > 0) || !(cpm > 0) || cpm > 10000 || vg > 1e9) throw new Error("View guarantee and CPM must be positive numbers");
    prices[id] = Object.assign({ vg, cpm }, videos ? { videos } : {}, cur.disc ? { disc: true, discFrom: cur.discFrom } : {});
  } else {
    // Short form on a list: View Estimate, CPM and the content production fee.
    const cur = prices[id] || {};
    const pick = (k, curK) => num(b[k] != null ? b[k] : (cur[k] != null ? cur[k] : b[curK]));
    const vg = Math.round(pick("vg", "curVg") || 0), cpm = pick("cpm", "curCpm") || 0;
    let fee = pick("fee", "curFee");
    // A Total Rate typed on a list (Tom, 15 Oct 2026): the production fee that gives exactly
    // that total once the Publishing Rate (POST_SHARE of the fee) is added.
    if (b.total != null) {
      const t = num(b.total);
      if (!(t > 0) || t > 1e7) throw new Error("Total Rate must be a positive number");
      const f0 = Math.round(t / (1 + POST_SHARE));
      fee = [0, -1, 1, -2, 2].map(d => f0 + d).find(f => f + Math.round(f * POST_SHARE) === Math.round(t));
      if (fee == null) fee = f0;
    }
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
  return brandPayload(data, Object.assign({}, list, { body }), true);
}

// One CPM for every creator on a list tab (Margot, 15 Oct 2026): "rather than going in and
// changing CPMs to $20" one by one. Same rules as list-price for each row (this list only, the
// row's views and any discount kept), saved in one write so the list never half-changes.
async function listPriceAll(b, email) {
  const { data, list } = await freshList(b.slug);
  if (!list) throw new Error("list not found");
  if (list.bad) throw new Error(LIST_READ_ERROR);
  const cpmIn = num(b.cpm);
  if (!(cpmIn > 0) || cpmIn > 10000) throw new Error("CPM must be a positive number");
  const kinds = {};
  data.rows.forEach(r => { kinds[r.id] = r.kind; r.shows.forEach(s => { kinds[s.id] = "long"; }); });
  const prices = Object.assign({}, list.body.prices || {});
  const changed = new Set();
  (Array.isArray(b.items) ? b.items.slice(0, 1000) : []).forEach(it => {
    const id = String((it && it.id) || "");
    if (!ROW_ID.test(id) || !kinds[id]) return;
    const cur = prices[id] || {};
    const vg = Math.round(num(cur.vg != null ? cur.vg : it.curVg) || 0);
    if (!(vg > 0) || vg > 1e9) return;
    // Set all as a discount (Tom, 15 Oct 2026): every row remembers the CPM it starts from, so brands see the old price
    // crossed out and the % off. A row already discounted keeps its original starting CPM.
    const fromCpm = r2(num(cur.cpm != null ? cur.cpm : it.curCpm) || 0);
    const keep = b.disc === true ? { disc: true, discFrom: cur.disc && cur.discFrom > 0 ? cur.discFrom : fromCpm } : cur.disc ? { disc: true, discFrom: cur.discFrom } : {};
    if (b.disc === true && !(keep.discFrom > 0)) return;
    if (kinds[id] === "long") prices[id] = Object.assign({ vg, cpm: r2(cpmIn) }, cur.videos ? { videos: cur.videos } : {}, keep);
    else {
      const fee = num(cur.fee != null ? cur.fee : it.curFee);
      if (fee == null || fee < 0 || fee > 1e6) return;
      prices[id] = Object.assign({ vg, cpm: r2(cpmIn), fee: Math.round(fee) }, keep);
    }
    changed.add(id);
  });
  if (!changed.size) throw new Error("No creators on this tab have a price to change");
  const body = Object.assign({}, list.body, { prices });
  if (body.lock) { // prices changed on a locked list are locked at their new values
    const snap = lockSnapshot(data, Object.assign({}, list, { body }), changed);
    const rows = Object.assign({}, body.lock.rows); changed.forEach(id => { delete rows[id]; }); Object.assign(rows, snap);
    body.lock = Object.assign({}, body.lock, { rows });
  }
  await writeList(list.id, body, { [L.updated]: email + " " + stamp() });
  return brandPayload(data, Object.assign({}, list, { body }), true);
}

// Brand feedback tracking (Tom, 15 Oct 2026): "We need to set up a slick system here so we can see who is
// accepted and track it." The Saved Pitch Lists board carries the brand's answers per list, and the Saved
// lists panel on the roster site shows the counts.
const FB = { ok: "long_text_mm85mveg", no: "long_text_mm85rnfg", notes: "long_text_mm85eqf2", at: "date_mm85p562" };
function feedbackSummary(data, body) {
  const fb = body.feedback || {}, name = id => ((data.rows.find(r => r.id === id) || {}).name) || "a creator";
  const ids = (body.ids || []).map(String).filter(id => fb[id]);
  return { ok: ids.filter(id => fb[id].ok).map(name), no: ids.filter(id => fb[id].no).map(name), notes: ids.filter(id => fb[id].note).map(id => name(id) + ": " + fb[id].note) };
}
function feedbackCounts(body) {
  const v = Object.values((body && body.feedback) || {});
  return { ok: v.filter(x => x && x.ok).length, no: v.filter(x => x && x.no).length, notes: v.filter(x => x && x.note).length, at: (body && body.fbAt) || "" };
}
function feedbackColumns(data, body) {
  const s = feedbackSummary(data, body), cut = a => a.join("\n").slice(0, 1900);
  const v = { [FB.ok]: { text: cut(s.ok) }, [FB.no]: { text: cut(s.no) }, [FB.notes]: { text: cut(s.notes) } };
  if (body.fbAt) { const d = new Date(body.fbAt).toISOString(); v[FB.at] = { date: d.slice(0, 10), time: d.slice(11, 19) }; }
  return v;
}
// The brand-feedback email (Tom approved the send, 15 Oct 2026). One email per list, about 15 minutes after
// the brand's last tick or note, so a brand clicking through forty creators sends one email, not forty.
// Run by the roster-warm cron every five minutes. Internal only: from theteam@ to Tom, Alex and Margot,
// never to a brand or a creator. Ticks a teammate makes for the brand do not trigger it.
const ALERT_TO = ["tom@digitalfoxtalent.com", "alex@digitalfoxtalent.com", "margot@digitalfoxtalent.com"];
const ALERT_FROM = "theteam@digitalfoxtalent.com";
const ALERT_WAIT_MS = 15 * 60 * 1000;
async function feedbackAlerts() {
  const data = await loadBoard(), now = Date.now(), sent = [];
  const due = b => !!b && Number(b.fbSeq) > (Number(b.fbAlerted) || 0) && now - Date.parse(b.fbAt) >= ALERT_WAIT_MS;
  for (const l0 of data.lists.slice()) {
    if (!due(l0.body)) continue;
    const { list } = await freshList(l0.slug);
    if (!list || list.bad || !due(list.body)) continue;
    const { subject, html, seen, ok } = feedbackEmail(data, list);
    const extra = await sendAlert(list, subject, html, ok);
    await writeList(list.id, Object.assign({}, list.body, { fbAlerted: list.body.fbSeq, fbSeen: seen }, extra), {});
    sent.push(list.slug);
  }
  return sent;
}
// The alert email itself (Tom, 15 Oct 2026: "Can we make this a bit more dynamic with more info?"). One row per
// creator the brand has answered, with the format, price and views the brand sees on the list, newest answers
// marked NEW (compared with what the last email showed, kept on the list as fbSeen), plus the totals and the
// next step. Built from brandPayload, so the numbers are exactly the ones on the brand's page.
const ALERT_FMT = { topics: "YouTube integration", dedicated: "YouTube dedicated", live: "YouTube Live", group_mm4av3kr: "YouTube Short", group_mm4a1fe0: "Instagram Reel", group_mm4bd5tk: "TikTok", group_mm7yw8cy: "Snapchat" };
function feedbackEmail(data, list, submitted) {
  const body = list.body, fb = body.feedback || {}, prev = body.fbSeen || {};
  const sig = f => (f.ok ? "y" : f.no ? "n" : "") + "|" + String(f.note || "");
  const usd = n => "$" + Math.round(n).toLocaleString("en-US"), k = n => n >= 1e6 ? (Math.round(n / 1e5) / 10) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : String(n);
  const p = brandPayload(data, list, false), byId = {};
  Object.keys(p.groups).forEach(g => p.groups[g].forEach(o => { byId[o.id] = Object.assign({ gid: g }, o); }));
  const all = (body.ids || []).map(String), seen = {}, items = [];
  all.forEach(id => {
    const f = fb[id]; if (!f || !(f.ok || f.no || f.note)) return;
    seen[id] = sig(f);
    const o = byId[id] || {}, r = data.rows.find(x => x.id === id) || {};
    const price = body.press ? null : typeof o.total === "number" ? o.total : typeof o.rate === "number" ? o.rate : null;
    items.push({ id, name: o.name || r.name || "A creator", url: o.url || "", subs: o.subs || null, fmt: ALERT_FMT[o.gid || r.group] || "", long: /^(topics|dedicated)$/.test(o.gid || r.group || ""), videos: o.minVideos > 1 ? o.minVideos : 1, price, views: o.vg || null, ok: !!f.ok, no: !f.ok && !!f.no, note: String(f.note || ""), stage: o.stage || "", isNew: Object.keys(prev).length > 0 && prev[id] !== seen[id] });
  });
  const rank = x => x.ok ? 0 : x.no ? 2 : 1;
  items.sort((a, b) => (b.isNew - a.isNew) || (rank(a) - rank(b)));
  const ok = items.filter(x => x.ok), no = items.filter(x => x.no), notes = items.filter(x => x.note), fresh = items.filter(x => x.isNew);
  const value = ok.reduce((s, x) => s + (x.price || 0), 0), left = all.length - items.length;
  const url = "https://" + HOST + "/r/" + list.slug, mon = "https://digitalfoxtalent.monday.com/boards/" + LISTS_BOARD + "/pulses/" + list.id;
  const viewsWord = body.estViews ? "est. views" : "views";
  const F = "font-family:Arial,Helvetica,sans-serif;", muted = "color:#6b7280;", td = "padding:10px 12px;border-bottom:1px solid #eceef1;vertical-align:top;";
  const pill = x => { const c = x.ok ? ["#e7f6ec", "#1a7f37", "Approved"] : x.no ? ["#fdecec", "#b42318", "Declined"] : ["#eef2ff", "#3949ab", "Note only"]; return "<span style=\"display:inline-block;padding:3px 9px;border-radius:999px;background:" + c[0] + ";color:" + c[1] + ";font-size:12px;font-weight:bold\">" + c[2] + "</span>"; };
  const stat = (n, label, sub, color) => "<td style=\"" + F + "padding:14px 16px;background:#f7f8fa;border-radius:10px;width:23%\"><div style=\"font-size:22px;font-weight:bold;color:" + color + "\">" + n + "</div><div style=\"font-size:12px;" + muted + "margin-top:2px\">" + escH(label) + (sub ? "<br><span style=\"color:#1f2328\">" + escH(sub) + "</span>" : "") + "</div></td>";
  const gap = "<td style=\"width:2%;font-size:0\">&nbsp;</td>";
  const rowsHtml = items.map(x => "<tr>" +
    "<td style=\"" + F + td + "\">" + (x.isNew ? "<span style=\"font-size:10px;font-weight:bold;color:#fff;background:#f97316;border-radius:4px;padding:1px 5px;margin-right:6px\">NEW</span>" : "") + (x.url ? "<a href=\"" + escH(x.url) + "\" style=\"color:#1f2328;font-weight:bold;text-decoration:none\">" + escH(x.name) + "</a>" : "<b>" + escH(x.name) + "</b>") + "<div style=\"font-size:12px;" + muted + "margin-top:2px\">" + escH([x.fmt, x.subs ? k(x.subs) + " subs" : ""].filter(Boolean).join(" · ")) + "</div></td>" +
    "<td style=\"" + F + td + "white-space:nowrap\">" + (x.price ? "<b>" + usd(x.price) + "</b>" : "<span style=\"" + muted + "\">n/a</span>") + (x.views ? "<div style=\"font-size:12px;" + muted + "margin-top:2px\">" + k(x.views) + " " + viewsWord + "</div>" : "") + "</td>" +
    "<td style=\"" + F + td + "\">" + pill(x) + (x.stage ? "<div style=\"font-size:12px;" + muted + "margin-top:4px\">Stage: " + (x.stage === "confirmed" ? "Confirmed" : "Approached") + "</div>" : "") + "</td>" +
    "<td style=\"" + F + td + "font-size:13px\">" + (x.note ? "“" + escH(x.note) + "”" : "<span style=\"" + muted + "\">No note</span>") + "</td></tr>").join("");
  const toConfirm = ok.filter(x => x.stage !== "confirmed").map(x => x.name);
  const next = toConfirm.length ? "Confirm " + (toConfirm.length > 4 ? toConfirm.slice(0, 4).join(", ") + " and " + (toConfirm.length - 4) + " more" : toConfirm.join(", ").replace(/, ([^,]*)$/, " and $1")) + " with the creator" + (toConfirm.length > 1 ? "s" : "") + " and the brand, then set Stage on the list." : notes.length ? "Reply to the brand's " + (notes.length === 1 ? "note" : "notes") + " on the list." : "";
  const btn = (href, label, solid) => "<a href=\"" + href + "\" style=\"" + F + "display:inline-block;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:bold;text-decoration:none;" + (solid ? "background:#f97316;color:#ffffff" : "background:#ffffff;color:#1f2328;border:1px solid #d0d4da") + "\">" + label + "</a>";
  const html = "<div dir=\"ltr\" style=\"" + F + "color:#1f2328;font-size:14px;line-height:1.45;max-width:680px;padding:8px 4px\">" +
    "<div style=\"font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#f97316;font-weight:bold\">" + (submitted ? "Picks sent by the brand" : "Brand feedback") + "</div>" +
    "<div style=\"font-size:22px;font-weight:bold;margin:4px 0 6px\">" + escH(list.name) + "</div>" +
    "<div style=\"" + muted + "margin-bottom:20px\">The brand has answered on " + items.length + " of " + all.length + " creators" + (fresh.length ? ", " + fresh.length + " new since the last email" : "") + "." + (submitted ? " They pressed Send my picks, so they are waiting to hear from us." : "") + "</div>" +
    "<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" style=\"width:100%;border-collapse:separate;margin-bottom:22px\"><tr>" +
    stat(ok.length, "Approved", value ? usd(value) : "", "#1a7f37") + gap + stat(no.length, "Declined", "", "#b42318") + gap + stat(notes.length, notes.length === 1 ? "Note" : "Notes", "", "#3949ab") + gap + stat(left, "Not answered yet", "", "#1f2328") +
    "</tr></table>" +
    (next ? "<div style=\"background:#fff7ed;border-left:4px solid #f97316;padding:12px 14px;border-radius:6px;margin-bottom:22px\"><b>Next step:</b> " + escH(next) + "</div>" : "") +
    "<table cellspacing=\"0\" cellpadding=\"0\" style=\"width:100%;border-collapse:collapse;margin-bottom:24px\"><tr>" +
    ["Creator", body.press ? "Typical views" : "Price", "Brand", "Note"].map(h => "<th align=\"left\" style=\"" + F + "padding:8px 12px;font-size:11px;letter-spacing:.05em;text-transform:uppercase;" + muted + "border-bottom:2px solid #eceef1\">" + h + "</th>").join("") + "</tr>" + rowsHtml + "</table>" +
    "<div style=\"margin-bottom:22px\">" + btn(url, "Open the list", true) + " &nbsp; " + btn(mon, "Open on monday", false) + "</div>" +
    "<div style=\"font-size:12px;" + muted + "\">" + (submitted ? "Sent when the brand pressed Send my picks" : "Sent automatically about 15 minutes after the brand's last change") + (list.by ? ". List made by " + escH(String(list.by).split(" ")[0]) : "") + ".</div></div>";
  const subject = (submitted ? "Brand sent their picks: " : "Brand feedback: ") + list.name + " (" + ok.length + " approved" + (value ? ", " + usd(value) : "") + ", " + no.length + " declined" + (notes.length ? ", " + notes.length + (notes.length === 1 ? " note" : " notes") : "") + ")";
  return { subject, html, seen, ok, value };
}
// Send my picks (Tom, 15 Oct 2026): the brand's own "I'm done" button on its list. Sends the feedback email to Tom,
// Alex and Margot straight away instead of 15 minutes after the last tick. Anyone with the list's link can press it,
// so it sends at most once every 10 minutes per list; later ticks still reach us through the normal alert.
async function brandSubmit(b) {
  const { data, list } = await freshList(b.slug);
  if (!list) throw new Error("This list is no longer available");
  if (list.bad) throw new Error("Sorry, that could not be sent. Please let Digital Fox Talent know.");
  const body = list.body, fb = body.feedback || {};
  if (!Object.values(fb).some(f => f && (f.ok || f.no || f.note))) throw new Error("Tick \u201cApprove?\u201d on the creators you would like to book first.");
  if (Date.now() - (Date.parse(body.fbSubmitted || "") || 0) < 10 * 60 * 1000) return { ok: true, sent: false };
  const { subject, html, seen, ok } = feedbackEmail(data, list, true);
  const extra = await sendAlert(list, subject, html, ok);
  await writeList(list.id, Object.assign({}, body, { fbAlerted: Number(body.fbSeq) || 0, fbSeen: seen, fbSubmitted: new Date().toISOString() }, extra), {});
  await audit(list.id, "Brand pressed Send my picks on \u201c" + list.name + "\u201d").catch(() => null);
  return { ok: true, sent: true };
}
// Brand feedback in the brand's own email thread (Tom, 16 Oct 2026: "Is there a way for this to be sent to me as part
// of the original thread?"). The thread is the one where the list's link was sent: found once in Tom's mailbox (his
// sent mail, or a teammate's pitch he was copied on) and kept on the list as body.thread. The alert is then sent as a
// reply in that thread (same subject, In-Reply-To and References), so it lands under the brand's emails for Tom, Alex
// and Margot. Still internal only: To is Tom, Alex and Margot, never the brand. With no thread found it is sent on
// its own, as before. The counts that were in the subject are in the email's own heading.
// Pitch audit (Tom, 16 Oct 2026): every list link the team has emailed out, and which companies received it. A list
// sent to more than one company is flagged, since its title, approvals and comments are shared by everyone holding the
// link. With write:true each list records the company it was first sent to (body.for), so it is only ever reused for
// that company and its feedback alerts and confirmation drafts go to that company's thread.
async function pitchAudit(b) {
  const days = Math.min(90, Math.max(1, +b.days || 30));
  const boxes = ["tom", "alex", "margot", "george", "hani"].map(x => x + "@digitalfoxtalent.com");
  const data = await loadBoard();
  const bySlug = {}; data.lists.forEach(l => { if (l.slug) bySlug[l.slug] = l; });
  const sent = {}; const errors = [];
  const hd = (m, n) => (((m.payload || {}).headers || []).find(h => h.name.toLowerCase() === n) || {}).value || "";
  const text = pl => { let out = ""; const walk = x => { if (!x) return; if (x.body && x.body.data) out += Buffer.from(x.body.data, "base64url").toString("utf8"); (x.parts || []).forEach(walk); }; walk(pl); return out; };
  for (const box of boxes) {
    let tok; try { tok = await gmailToken(box); } catch (e) { errors.push(box + ": " + e.message); continue; }
    if (!tok) continue;
    const G = path => fetch("https://gmail.googleapis.com/gmail/v1/users/me" + path, { headers: { Authorization: "Bearer " + tok } }).then(r => r.ok ? r.json() : {}).catch(() => ({}));
    const q = "in:sent newer_than:" + days + "d {\"creator list\" \"roster-viewguarantee\" \"digitalfoxtalent.com/r\"}";
    let ms = [], pt = "";
    do { const r = await G("/messages?maxResults=100&q=" + encodeURIComponent(q) + (pt ? "&pageToken=" + pt : "")); ms = ms.concat(r.messages || []); pt = r.nextPageToken || ""; } while (pt && ms.length < 400);
    for (let i = 0; i < ms.length; i += 10) {
      const full = await Promise.all(ms.slice(i, i + 10).map(m => G("/messages/" + m.id + "?format=full")));
      full.forEach(m => {
        if (!m || !m.payload) return;
        const sj = hd(m, "subject"); if (/brand feedback|brand sent their picks/i.test(sj)) return;
        const rc = (hd(m, "to") + "," + hd(m, "cc")).match(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
        const ext = [...new Set(rc.map(a => a.toLowerCase()).filter(a => !DFT_DOMAIN.test(a)))];
        if (!ext.length) return;
        const slugs = [...new Set((text(m.payload).match(/digitalfoxtalent\.com\/r\/([a-z0-9-]+)/gi) || []).map(x => x.split("/r/")[1].toLowerCase()))];
        const at = new Date(+m.internalDate || 0).toISOString();
        slugs.forEach(sl => { (sent[sl] = sent[sl] || []).push({ at, from: box, to: ext, orgs: [...new Set(ext.map(orgOf).filter(Boolean))], subject: sj, thread: m.threadId, id: m.id }); });
      });
    }
  }
  const out = [];
  for (const sl of Object.keys(sent)) {
    const l = bySlug[sl]; const rows = sent[sl].filter((x, i, a) => a.findIndex(y => y.id === x.id) === i).sort((x, y) => x.at.localeCompare(y.at));
    const orgs = []; rows.forEach(r => r.orgs.forEach(o => { if (!orgs.includes(o) && !TEST_ADDRESSES.has(o)) orgs.push(o); }));
    out.push({ slug: sl, title: l ? l.name : "(list deleted)", orgs, flagged: companies(orgs).length > 1, sends: rows.map(r => ({ at: r.at.slice(0, 16), from: r.from.split("@")[0], to: r.to.join(", "), subject: r.subject.slice(0, 90), thread: r.thread })) });
    if (b.write && l && l.id && orgs.length) {
      const sentNow = {}; rows.forEach(r => r.orgs.forEach(o => { if (!sentNow[o] && !TEST_ADDRESSES.has(o)) sentNow[o] = { thread: r.thread, at: r.at.slice(0, 10) }; }));
      const had = l.body.sent || {}, needFor = !(Array.isArray(l.body.for) && l.body.for.length), newOrgs = Object.keys(sentNow).filter(o => !had[o]);
      if (needFor || newOrgs.length) {
        const fresh = (await freshList(sl).catch(() => ({}))).list;
        if (fresh && !fresh.bad) { const sent = Object.assign({}, sentNow, fresh.body.sent || {}); await writeList(fresh.id, Object.assign({}, fresh.body, { sent }, needFor && !(fresh.body.for || []).length ? { for: [orgs[0]] } : {}), {}); }
      }
    }
  }
  out.sort((x, y) => (y.flagged - x.flagged) || x.title.localeCompare(y.title));
  return { ok: true, days, lists: out.length, flagged: out.filter(x => x.flagged).length, errors, out };
}
// Creator preview (Tom, 16 Oct 2026): a brand clicks a creator's name and sees their latest videos without leaving the
// list. Read only, from the channel's public YouTube feed, for a roster row's own channel link. Cached for six hours per channel, so a busy list costs a handful of API units, not one per click.
const ytPreviewCache = new Map();
async function creatorVideos(b) {
  const data = await loadBoard();
  const r = data.rows.find(x => x.id === String(b.id || "")); if (!r) throw new Error("creator not found");
  const url = String(r.cv[C.url] || "");
  const m = url.match(/youtube\.com\/(?:channel\/(UC[\w-]{22})|@([\w.\-]+))/i);
  if (!m) return { ok: true, videos: [], channel: url };
  const shorts = /shorts/i.test(String(r.name)) || r.group === "group_mm4av3kr";
  const ck = (m[1] || "@" + m[2].toLowerCase()) + (shorts ? "|s" : "|l");
  const hit = ytPreviewCache.get(ck); if (hit && Date.now() - hit.at < 6 * 3600e3) return hit.v;
  // YouTube's public channel feed: no API key and no daily quota (the Data API quota is used up by the sync jobs).
  const UA = { "User-Agent": "Mozilla/5.0 (compatible; DFT roster)", "Accept-Language": "en" };
  let cid = m[1];
  if (!cid) { const hk = "@" + m[2].toLowerCase(); cid = (ytPreviewCache.get(hk) || {}).v;
    if (!cid) { const h = await fetch("https://www.youtube.com/@" + encodeURIComponent(m[2]), { headers: UA }).then(x => x.text()).catch(() => "");
      cid = ((h.match(/"externalId":"(UC[\w-]{22})"/) || h.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/) || h.match(/"channelId":"(UC[\w-]{22})"/) || [])[1]) || "";
      if (cid) ytPreviewCache.set(hk, { at: Date.now(), v: cid }); } }
  if (!cid) return { ok: true, videos: [], channel: url };
  const xml = await fetch("https://www.youtube.com/feeds/videos.xml?channel_id=" + cid, { headers: UA }).then(x => x.ok ? x.text() : "").catch(() => "");
  const un = t => String(t || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const all = (xml.split("<entry>").slice(1)).map(e => { const g = re => (e.match(re) || [])[1] || ""; const href = g(/<link rel="alternate" href="([^"]+)"/); return { id: g(/<yt:videoId>([^<]+)</), title: un(g(/<title>([^<]*)</)), at: g(/<published>([^<]+)</), views: +g(/<media:statistics views="(\d+)"/) || 0, thumb: g(/<media:thumbnail url="([^"]+)"/), url: href, short: /\/shorts\//.test(href) }; }).filter(v => v.id);
  const want = all.filter(v => v.short === shorts);
  const out = { ok: true, channel: url, videos: (want.length >= 2 ? want : all).slice(0, 6).map(v => ({ id: v.id, title: v.title, at: v.at, views: v.views, thumb: v.thumb, url: v.url || "https://www.youtube.com/watch?v=" + v.id })) };
  if (out.videos.length) ytPreviewCache.set(ck, { at: Date.now(), v: out });
  return out;
}

// Sales Desk outreach (Tom, 16 Oct 2026: "when it nudges Margot, and she presses 'draft email', it drafts a Pitch email
// instead", and the same for George's press opportunities). The alert's Draft button opens /api/roster?op=outreach. The
// page asks for outreach-draft, which reads the monday row, runs the pitch engine in outreach mode (a list made for that
// brand, wording that opens the conversation rather than thanking them) and saves the email as a fresh draft in the
// clicker's own Gmail, with Tom and Alex copied. No thread: these are first emails. Nothing is ever sent.
const OUTREACH_BOARDS = { "18415192682": "spend", "18421619922": "winback", "18415007170": "studio", "18435939296": "studio" }; // 18435939296: Tom's Games, TV & Tech release board (17 Oct 2026)
async function outreachDraft(b, email) {
  const board = String(b.board || ""), kind = OUTREACH_BOARDS[board];
  if (!kind) throw new Error("This alert type cannot make a pitch yet");
  const to = String(b.to || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(to) || DFT_DOMAIN.test(to)) throw new Error("No brand email on this alert");
  const d = await monday(`query{items(ids:[${Number(b.item) || 0}]){id name board{id} column_values{text column{title}}}}`);
  const it = d && d.items && d.items[0];
  if (!it || String(it.board && it.board.id) !== board) throw new Error("monday row not found");
  const facts = (it.column_values || []).map(c => [String((c.column || {}).title || ""), String(c.text || "").replace(/\s+/g, " ").trim()]).filter(([k, v]) => k && v && v.length < 600 && !/send via gmail|alert sent|status|draft|link|verified|contacts?$|notes?$/i.test(k)).map(([k, v]) => k + ": " + v).join("\n").slice(0, 3000);
  const brand = String(it.name || "").trim();
  const first = String(b.name || "").trim().split(/\s+/)[0] || "";
  // The sender's own display name, for the signature (Gmail's Send As setting).
  const tok = await gmailToken(email); if (!tok) throw new Error("Gmail is not connected for " + email);
  const G = (path, opt = {}) => fetch("https://gmail.googleapis.com/gmail/v1/users/me" + path, Object.assign({}, opt, { headers: Object.assign({ Authorization: "Bearer " + tok }, opt.headers || {}) })).then(async r => { const t = await r.text(); let j = {}; try { j = t ? JSON.parse(t) : {}; } catch (_) {} return r.ok ? j : Object.assign(j, { _status: r.status }); });
  const sa = await G("/settings/sendAs").catch(() => ({}));
  const sendAs = (sa.sendAs || []).find(x => String(x.sendAsEmail).toLowerCase() === email) || (sa.sendAs || [])[0] || {};
  const NAMES = { "tom@digitalfoxtalent.com": "Tom James", "margot@digitalfoxtalent.com": "Margot Grant", "george@digitalfoxtalent.com": "George Roush" };
  const fromName = NAMES[email] || String(sendAs.displayName || "").trim() || email.split("@")[0].replace(/^./, c => c.toUpperCase());
  const me = fromName.split(/\s+/)[0];
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const lastCampaign = String(b.last || "").replace(/[<>]/g, "").slice(0, 80);
  const opener = kind === "studio"
    ? pick(["I'm " + me + " from Digital Fox Talent. We manage creators across film, gaming and pop culture, and with " + brand + " coming up we'd love to support it.", "I'm " + me + " at Digital Fox Talent, where we look after film, gaming and pop culture creators. We'd love to help get " + brand + " in front of their audiences.", "I'm reaching out from Digital Fox Talent: our creators cover film, gaming and pop culture, and " + brand + " is right in their wheelhouse."])
    : kind === "winback"
    ? pick(["Hope you're well! It's been a little while since we last worked together" + (lastCampaign ? " on " + lastCampaign : "") + ", and I wanted to reconnect.", "It's been a while since we last worked together, so I wanted to say hello and share what's new on our side.", "Hope all's well with you. We loved working with you before and wanted to reconnect."])
    : pick(["I'm " + me + " from Digital Fox Talent. We manage YouTube creators across film, gaming and tech, and I've seen " + brand + " working with creators in our space.", "I'm " + me + " at Digital Fox Talent, where we look after YouTube creators in film, gaming and tech. " + brand + " looks like a great fit for our audience.", "I'm reaching out from Digital Fox Talent: we manage YouTube creators across film, gaming and tech, and I think " + brand + " would be a strong fit with our roster."]);
  const note = (kind === "studio"
    ? "OUTREACH, not an enquiry: a press package. Digital Fox Talent is writing first to the studio behind " + brand + " to offer press coverage and interviews from our creators around its release. Pick creators whose audiences suit " + brand + ". They have not asked any questions."
    : kind === "winback"
    ? "OUTREACH, not an enquiry. Digital Fox Talent is writing first to " + brand + ", a former client we want to win back. Build a shortlist that fits what " + brand + " has booked with us before and what they promote now. They have not asked any questions."
    : "OUTREACH, not an enquiry. Digital Fox Talent is writing first to " + brand + ", which is spending on creator campaigns in our niche. Build a shortlist that fits " + brand + "'s product and audience. They have not asked any questions.")
    + " Name the list after " + brand + " (and its product if clear), never after an agency.";
  const subject = kind === "studio" ? "Creator partnerships for " + brand : "Digital Fox Talent × " + brand;
  // Logged on Roster - Pitch Requests like any forward, so the pitch engine's checks and the monday trail are the same.
  const cr = await monday("mutation($b:ID!,$n:String!,$v:JSON!){create_item(board_id:$b,item_name:$n,column_values:$v){id}}", { b: String(PITCH_BOARD), n: "Outreach: " + brand, v: JSON.stringify({ [PB.by]: email, [PB.contact]: to }) });
  const item = cr && cr.create_item && cr.create_item.id; if (!item) throw new Error("Could not log the outreach on monday");
  const text = note + "\n\n---------- Forwarded message ---------\nFrom: " + (b.name ? String(b.name).replace(/[<>"]/g, "") + " " : "") + "<" + to + ">\nSubject: " + subject + "\nTo: " + email + "\n\nWHAT WE KNOW ABOUT " + brand.toUpperCase() + " (from our monday row, not from them):\n" + facts;
  const r = await pitchFromEmail({ item, fromEmail: email, fromName, text, subject, outreach: { kind, opener, subject }, sentTo: kind === "studio" ? "press@digitalfoxtalent.com" : "" });
  let html = String(r.html || "").replace(/Hi [^,<]{1,60},/, "Hi " + escH(first || "there") + ",");
  let plain = String(r.text || "").replace(/^Hi [^,\n]{1,60},/, "Hi " + (first || "there") + ",");
  // Tom's drafts keep his standard sign-off. Anyone else signs with their own Gmail signature (Margot's and George's
  // carry their title and number), or their name if they have none.
  if (email !== "tom@digitalfoxtalent.com") {
    const sigH = String(sendAs.signature || "").trim(), sigT = htmlToText(sigH).trim();
    const tailH = escH(fromName) + "<br>Digital Fox Talent<br>\u{1F98A}", tailT = fromName + "\nDigital Fox Talent\n\u{1F98A}";
    html = html.replace(tailH, sigH ? '<div class="gmail_signature">' + sigH + "</div>" : escH(fromName) + "<br>Digital Fox Talent");
    plain = plain.replace(tailT, sigT || fromName + "\nDigital Fox Talent");
  }
  const cc = ["tom@digitalfoxtalent.com", "alex@digitalfoxtalent.com"].filter(x => x !== email).join(", ");
  const mime = pitchMime({ to, cc, subject, html, text: plain }).draft;
  const dr = await G("/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: mime });
  if (!dr.id) throw new Error("Gmail did not save the draft" + (dr.error ? ": " + (dr.error.message || "") : ""));
  const mid = (dr.message || {}).id || "";
  return { ok: true, list: r.listUrl, title: r.title, placements: r.placements, draft: dr.id, url: "https://mail.google.com/mail/?authuser=" + encodeURIComponent(email) + "#drafts?compose=" + (dr.message && dr.message.threadId ? "thread-f:" + BigInt("0x" + dr.message.threadId).toString() + "%2Bmsg-a:" + dr.id : mid) };
}
// Creator recruitment drafts (Tom, 18 Oct 2026: make the creator alerts work like the new business alerts, with a Draft
// button that writes the email). The creator alert's Draft button opens /api/roster?op=recruit; the page asks for
// recruit-draft, which reads the Target Creators row, the creator's latest videos (public feed, no API quota) and
// 2 to 3 similar creators DFT already represents, has Claude write a short direct email offering a call, and saves it
// as a fresh draft in the clicker's own Gmail with Alex copied. Nothing is ever sent.
// What the email leans on (Tom, 18 Oct 2026): brand deals and content distribution, similar creators we represent,
// "Since 2017". It offers a call (direct recruitment); since 19 Oct 2026 (Tom's edit to the Volrusk email) the close also
// offers the sign-up page for creators who would rather not do a video call, as a real link in the draft.
// Tom's first edits (18 Oct 2026): no opening line about their videos, and only name creators who are actually signed
// (a Rates row linked to a Global Talent Roster creator in a signed group, so Markiplier/Corridor Crew style pitch rows
// never count). The email as written is kept on the row (Draft as written / Draft thread) and api/recruit-learn.js
// compares it with what was actually sent each night, turning the edits into the standing lessons read below.
const RECRUIT_BOARD = "18415381478";
const RC = { url: "link_mm3t777s", email: "email_mm3t61sv", subs: "numeric_mm3tmrdz", avg: "numeric_mm3tr6gy", niche: "color_mm3tx56z", notes: "long_text_mm3tqaqs" };
const RC_DRAFT = { text: "long_text_mm88pfn1", thread: "text_mm886vha" };
const RECRUIT_LESSONS_ITEM = 13320786518; // Pitch Requests item "Standing lessons for creator recruitment emails"
const SIGNED_GROUPS = ["new_group__1", "group_mks8q6fd", "group_mkwg3f5r"]; // Global Talent Roster: Youtube Long Form, Short Form, Need to set up with Suppliers
const NICHE_WORDS = { Film: /film|movie|cinema|horror|tv|series|review|trailer|marvel|dc|star wars|pop culture/i, Gaming: /gam|esport|nintendo|xbox|playstation|retro/i, Entertainment: /entertain|pop culture|anime|comic|story|commentary|reaction|animation|cartoon/i, Tech: /tech|gadget|phone|pc|hardware|review/i };
async function recruitDraft(b, email) {
  const item = Number(b.item) || 0;
  const d = await monday(`query{items(ids:[${item}]){id name board{id} column_values(ids:${JSON.stringify(Object.values(RC))}){id text value}}}`);
  const it = d && d.items && d.items[0];
  if (!it || String((it.board || {}).id) !== RECRUIT_BOARD) throw new Error("Creator row not found");
  const v = {}; (it.column_values || []).forEach(c => { v[c.id] = c; });
  const t = id => String((v[id] || {}).text || "").trim();
  const to = (String(b.to || "") || t(RC.email)).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(to) || DFT_DOMAIN.test(to)) throw new Error("No creator email on this row");
  let url = ""; try { url = JSON.parse((v[RC.url] || {}).value || "{}").url || ""; } catch (e) {}
  if (!url) { const tx = t(RC.url); const i = tx.indexOf("http"); url = i >= 0 ? tx.slice(i) : ""; }
  const niche = t(RC.niche) || "Entertainment";
  const name = String(it.name || "").trim();
  // Similar creators DFT represents: signed long-form rows whose category fits the niche, biggest first.
  const [data, signedQ, lessonsQ, relQ] = await Promise.all([
    loadBoard(),
    monday(`query{boards(ids:[${CREATOR_BOARD}]){groups(ids:${JSON.stringify(SIGNED_GROUPS)}){items_page(limit:500){items{id}}}}}`).catch(() => null),
    monday(`query{items(ids:[${RECRUIT_LESSONS_ITEM}]){column_values(ids:["long_text_mm83jwpf"]){text}}}`).catch(() => null),
    // The Rates row's link to its roster creator. Read with linked_item_ids: the column's raw value comes back null on
    // this API version, so loadBoard's r.creator is empty and cannot be used for this.
    monday(`query{boards(ids:[${BOARD}]){groups(ids:["topics"]){items_page(limit:500){items{id column_values(ids:["${C.rel}"]){... on BoardRelationValue{linked_item_ids}}}}}}}`).catch(() => null)
  ]);
  const signed = new Set();
  ((((signedQ || {}).boards || [])[0] || {}).groups || []).forEach(g => (((g || {}).items_page || {}).items || []).forEach(x => signed.add(String(x.id))));
  const signedRow = new Set();
  ((((((relQ || {}).boards || [])[0] || {}).groups || [])[0] || {}).items_page || { items: [] }).items.forEach(x => { if ((((x.column_values || [])[0] || {}).linked_item_ids || []).some(id => signed.has(String(id)))) signedRow.add(String(x.id)); });
  const lessons = String((((((lessonsQ || {}).items || [])[0] || {}).column_values || [])[0] || {}).text || "").split("\n").map(x => x.replace(/^[-\s]+/, "").trim()).filter(Boolean).slice(0, 25);
  const fit = NICHE_WORDS[niche] || NICHE_WORDS.Entertainment;
  const similar = data.rows.filter(r => r.kind === "long" && !r.dedicated && r.group === "topics" && signedRow.has(String(r.id)) && fit.test(String(r.cv[C.category] || "") + " " + String(r.cv[C.about] || "").slice(0, 300)))
    .sort((a, b2) => (+b2.cv[C.avg] || 0) - (+a.cv[C.avg] || 0)).slice(0, 8)
    .map(r => ({ name: r.name, category: String(r.cv[C.category] || ""), avgViews: +r.cv[C.avg] || 0 }));
  const tok = await gmailToken(email); if (!tok) throw new Error("Gmail is not connected for " + email);
  const NAMES = { "tom@digitalfoxtalent.com": "Tom James", "margot@digitalfoxtalent.com": "Margot Grant", "george@digitalfoxtalent.com": "George Roush", "alex@digitalfoxtalent.com": "Alex Mackenzie" };
  const fromName = NAMES[email] || email.split("@")[0].replace(/^./, c => c.toUpperCase());
  const prompt = [
    "Write a short first email from " + fromName + " at Digital Fox Talent, a creator management agency, to the YouTube creator below. It is direct recruitment: we want to represent them.",
    "Rules:",
    "- Under 140 words in the body. Plain, warm, confident. No em dashes, no hype words, no bullet points, no exclamation-heavy tone.",
    "- Do not open with a compliment or any comment on their channel or videos. Start straight in with who you are. Never invent facts about them.",
    "- Say Digital Fox Talent has represented creators since 2017.",
    "- Lead with brand partnerships (our core offer: we bring them sponsorship deals), then content distribution (we put their existing videos on more platforms so the same content earns more).",
    similar.length ? "- Name 2 or 3 creators from SIGNED CREATORS WE REPRESENT who best fit their niche, as creators we work with. Use only names from that list, exactly as written; never name anyone else as a creator we work with." : "- Do not name any creators as ones we work with.",
    "- Say we'd (the agency) like to talk with them about representing them, not I'd.",
    "- Close with one sentence offering a quick call this week or next to explain how we work and answer any questions, then: \"or if you prefer not to do a video call, you can sign up here.\" End the email with exactly those words (\"sign up here.\"); the link is added after.",
    "- Greet them by their channel or first name if obvious. Do not include a signature; it is added after.",
    lessons.length ? "STANDING LESSONS FROM " + fromName.toUpperCase() + "'S EDITS TO EARLIER EMAILS (follow every one; where one conflicts with a rule above, the lesson wins):\n- " + lessons.join("\n- ") : "",
    'Reply with ONLY JSON: {"subject":"short subject, no emojis","body":"plain text with \\n line breaks"}',
    "",
    "CREATOR: " + name + " (" + niche + ")",
    "CHANNEL: " + url,
    "SUBSCRIBERS: " + (t(RC.subs) || "unknown") + ", AVERAGE VIEWS: " + (t(RC.avg) || "unknown"),
    "WHAT WE NOTED: " + t(RC.notes).split(" Measured ")[0].slice(0, 500),
    "SIGNED CREATORS WE REPRESENT: " + JSON.stringify(similar)
  ].filter(x => x !== "").join("\n");
  const key = process.env.ANTHROPIC_API_KEY; if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  let out = null;
  for (const model of PITCH_MODELS) {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model, max_tokens: 1200, messages: [{ role: "user", content: prompt }] }) }).catch(() => null);
    const j = r && await r.json().catch(() => null);
    if (!r || !r.ok || !j || !j.content) continue;
    const txt = j.content.filter(x => x.type === "text").map(x => x.text).join("\n");
    try { const m = txt.match(/\{[\s\S]*\}/); out = m ? JSON.parse(m[0]) : null; } catch (e) { out = null; }
    if (out && out.body) break;
  }
  if (!out || !out.body) throw new Error("Could not write the email, try again");
  const subject = noDash(String(out.subject || "Working with Digital Fox Talent")).slice(0, 120);
  const sig = fromName + "\nDigital Fox Talent\n\u{1F98A}";
  let plain = "";
  // The sign-up page for creators who would rather not do a call (Tom, 19 Oct 2026): "here" becomes the link.
  const SIGNUP = "https://digitalfoxtalent.com/sign-up";
  let bodyOut = noDash(String(out.body)).replace(/\r/g, "").trim();
  if (!/sign up here/i.test(bodyOut)) bodyOut += "\n\nIf you prefer not to do a video call, you can sign up here.";
  plain = bodyOut.replace(/sign up here/i, m => m + " (" + SIGNUP + ")") + "\n\nWarm regards\n" + sig;
  // The first "Digital Fox Talent" in the body links to our website (Tom, 19 Oct 2026: "our website is impressive so it
  // should build trust"). The signature stays plain.
  let siteLinked = false;
  const para = p => "<p>" + escH(p).replace(/\n/g, "<br>") + "</p>";
  const html = bodyOut.split(/\n{2,}/).map(p => para(p)
    .replace(/Digital Fox Talent/, m => siteLinked ? m : (siteLinked = true, '<a href="https://digitalfoxtalent.com">' + m + "</a>"))
    .replace(/sign up here/i, m => m.slice(0, -4) + '<a href="' + SIGNUP + '">here</a>')).join("") + para("Warm regards\n" + sig);
  const cc = ["tom@digitalfoxtalent.com", "alex@digitalfoxtalent.com"].filter(x => x !== email).join(", ");
  const G = (path, opt = {}) => fetch("https://gmail.googleapis.com/gmail/v1/users/me" + path, Object.assign({}, opt, { headers: Object.assign({ Authorization: "Bearer " + tok }, opt.headers || {}) })).then(async r => { const tx = await r.text(); let j = {}; try { j = tx ? JSON.parse(tx) : {}; } catch (_) {} return r.ok ? j : Object.assign(j, { _status: r.status }); });
  const dr = await G("/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: pitchMime({ to, cc, subject, html, text: plain }).draft });
  if (!dr.id) throw new Error("Gmail did not save the draft" + (dr.error ? ": " + (dr.error.message || "") : ""));
  const mid = (dr.message || {}).id || "";
  // Keep the email as written, so the nightly learner can see what was changed before it went out.
  if (dr.message && dr.message.threadId) await monday("mutation($b:ID!,$i:ID!,$v:JSON!){change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id}}", { b: RECRUIT_BOARD, i: String(item), v: JSON.stringify({ [RC_DRAFT.text]: { text: plain }, [RC_DRAFT.thread]: email + "|" + dr.message.threadId + "|" + new Date().toISOString().slice(0, 10) }) }).catch(() => null);
  return { ok: true, draft: dr.id, similar: similar.slice(0, 3).map(x => x.name), url: "https://mail.google.com/mail/?authuser=" + encodeURIComponent(email) + "#drafts?compose=" + (dr.message && dr.message.threadId ? "thread-f:" + BigInt("0x" + dr.message.threadId).toString() + "%2Bmsg-a:" + dr.id : mid) };
}
function recruitPage(q) {
  const e = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const args = JSON.stringify({ op: "recruit-draft", item: String(q.item || ""), to: String(q.to || "") });
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Writing your email</title>
<style>body{margin:0;background:#f5f3ef;font:15px/1.55 Poppins,Arial,sans-serif;color:#1a1a1a;display:grid;place-items:center;min-height:100vh}.c{background:#fff;border:1px solid #ece9e4;border-radius:16px;padding:40px 44px;max-width:460px;margin:24px;text-align:center}.sp{width:34px;height:34px;border:3px solid #f2dcc6;border-top-color:#f58220;border-radius:50%;animation:s 1s linear infinite;margin:0 auto 18px}@keyframes s{to{transform:rotate(360deg)}}h1{font-size:20px;margin:0 0 8px}p{color:#6b6b76;margin:0}a{color:#0f085e;font-weight:600}</style></head>
<body><div class="c" id="c"><div class="sp"></div><h1>Writing your email${q.name ? " to " + e(q.name) : ""}…</h1><p id="m">Picking similar creators we represent and writing the email. This takes about 20 seconds, then your draft opens in Gmail.</p></div>
<script>fetch("/api/roster",{method:"POST",headers:{"content-type":"application/json"},credentials:"same-origin",body:${JSON.stringify(args)}}).then(r=>r.json()).then(j=>{ if(j&&j.url){ document.getElementById("m").textContent="Done. Opening your draft…"; location.href=j.url; } else throw new Error((j&&j.error)||"Something went wrong"); }).catch(err=>{ const c=document.getElementById("c"); c.innerHTML="<h1>That didn’t work</h1><p>"+String(err.message||err).replace(/[<>&]/g,"")+"</p><p style=\\"margin-top:14px\\"><a href=\\"javascript:location.reload()\\">Try again</a></p>"; });</script></body></html>`;
}

// ---------------------------------------------------------------------------
// Contract amendment draft (Tom, 23 Oct 2026). The Make contract review already
// writes each flag with client-ready "Ask:" wording into CLAUDE REVIEW. This turns
// those Asks into a Gmail draft on the brand's own thread, in the sales lead's
// mailbox, so the team never retypes them. Same shape as the Sales Desk Draft
// button: ?op=contract&item=<deal> -> sign in if needed -> contractPage -> this.
const CAMPAIGN_BOARD = "6162879609";                 // US Campaigns
const CC = { review: "long_text_mm15j0h2", contact: "lookup_mm5z54ns", owner: "deal_owner", advertiser: "dropdown_mm1a3tqp", status: "color_mm1atc11" };
const CONTRACT_CC = ["tom@digitalfoxtalent.com", "alex@digitalfoxtalent.com", "margot@digitalfoxtalent.com"]; // Tom, 23 Oct 2026

// Pull the flags out of a CLAUDE REVIEW. Each item is "<issue> Ask: <wording>" under a
// Red/Orange/Yellow heading; the wording after "Ask:" is what the brand reads, the text
// before it is why we are asking. Yellow flags are questions, not amendments, so the
// draft carries Red and Orange by default.
function contractAsks(review) {
  const out = []; let level = "";
  for (let line of String(review || "").split(/\r?\n/)) {
    line = line.trim();
    const h = /^(Red|Orange|Yellow)\s+Flags?\b/i.exec(line);
    if (h) { level = h[1].toLowerCase(); continue; }
    if (!level) continue;
    const item = /^[*\-•]\s*(.+)$/.exec(line);
    if (!item) continue;
    const i = item[1].search(/\bAsk:\s/);
    if (i < 0) continue;
    const issue = item[1].slice(0, i).replace(/\s*[.;:]\s*$/, "").trim();
    const ask = item[1].slice(i).replace(/^Ask:\s*/, "").trim();
    if (ask) out.push({ level, issue, ask });
  }
  return out;
}

async function contractDraft(b, email) {
  const item = Number(b.item) || 0;
  const d = await monday(`query{items(ids:[${item}]){id name board{id} column_values(ids:${JSON.stringify(Object.values(CC))}){id text ... on MirrorValue{display_value}}}}`);
  const it = d && d.items && d.items[0];
  if (!it || String((it.board || {}).id) !== CAMPAIGN_BOARD) throw new Error("Deal not found on US Campaigns");
  const v = {}; (it.column_values || []).forEach(c => { v[c.id] = c; });
  const t = id => String((v[id] || {}).text || (v[id] || {}).display_value || "").trim(); // mirrors answer on display_value

  const asks = contractAsks(t(CC.review)).filter(a => b.all ? true : a.level !== "yellow");
  if (!asks.length) throw new Error("No amendments to ask for: this review has no Red or Orange flags with an Ask");

  // The CLIENTS mirror is empty on plenty of rows (nobody has linked the client yet), so rather than
  // dead-ending, the page asks for the address once and sends it back as `to`.
  const to = String(b.to || t(CC.contact)).split(/[,;\s]+/).filter(x => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(x))[0] || "";
  if (!to) return { ok: false, need: "to", deal: String(it.name || "").trim(), asks: asks.length };
  if (DFT_DOMAIN.test(to)) throw new Error("That is a DFT address. Use the brand's own contact.");

  const deal = String(it.name || "").trim();
  const advertiser = t(CC.advertiser);
  const me = String(email.split("@")[0] || "").replace(/[._-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  // The brand's own thread, so the amendments land where the deal is being discussed.
  let threadId = String(b.threadId || "");
  if (!threadId) {
    const tok = await gmailToken(email);
    if (tok) {
      const q = encodeURIComponent("from:" + to + " OR to:" + to);
      const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/threads?maxResults=1&q=" + q, { headers: { Authorization: "Bearer " + tok } }).then(x => x.json()).catch(() => ({}));
      threadId = (((r.threads || [])[0]) || {}).id || "";
    }
  }

  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const lead = asks.length === 1
    ? "Thanks for sending the agreement over. Before we sign, there is one point we would like to adjust:"
    : "Thanks for sending the agreement over. Before we sign, there are " + asks.length + " points we would like to adjust:";
  const html = '<div dir="ltr"><p>Hi,</p><p>' + esc(lead) + "</p><ol>"
    + asks.map(a => "<li style=\"margin-bottom:10px\">" + esc(a.ask) + "</li>").join("")
    + "</ol><p>Everything else looks good to us, and we are ready to move as soon as these are in. Happy to jump on a quick call if that is easier.</p>"
    + "<p>Best,<br>" + esc(me) + "<br>Digital Fox Talent</p></div>";
  const subject = "Agreement amendments" + (advertiser || deal ? " - " + (advertiser || deal) : "");

  // makeDraft does the threading, the quote, the one-draft-per-thread rule and the link check.
  const made = await makeDraft({ to, cc: CONTRACT_CC.join(", "), subject, html, threadId }, email);
  const gmailUrl = "https://mail.google.com/mail/?authuser=" + encodeURIComponent(email) + "#drafts?compose=" + (made.threadId ? "thread-f:" + BigInt("0x" + made.threadId).toString() + "%2Bmsg-a:" + made.draftId : made.draftId);
  return { ok: true, draft: made.draftId, asks: asks.length, to, threaded: !!made.threadId, url: gmailUrl };
}

function contractPage(q) {
  const e = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const args = JSON.stringify({ op: "contract-draft", item: String(q.item || ""), all: q.all === "1" }); // injected below as an object literal, not a string
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Writing your amendment email</title>
<style>body{margin:0;background:#f5f3ef;font:15px/1.55 Poppins,Arial,sans-serif;color:#1a1a1a;display:grid;place-items:center;min-height:100vh}.c{background:#fff;border:1px solid #ece9e4;border-radius:16px;padding:40px 44px;max-width:460px;margin:24px;text-align:center}.sp{width:34px;height:34px;border:3px solid #f2dcc6;border-top-color:#f58220;border-radius:50%;animation:s 1s linear infinite;margin:0 auto 18px}@keyframes s{to{transform:rotate(360deg)}}h1{font-size:20px;margin:0 0 8px}p{color:#6b6b76;margin:0}a{color:#0f085e;font-weight:600}</style></head>
<body><div class="c" id="c"><div class="sp"></div><h1>Writing your amendment email${q.name ? " for " + e(q.name) : ""}…</h1><p id="m">Turning the review's asks into a reply on the brand's thread. Your draft opens in Gmail in a moment.</p></div>
<script>
const args=${args};
const c=document.getElementById("c");
function go(extra){ c.innerHTML='<div class="sp"></div><h1>Writing your amendment email…</h1><p id="m">Turning the review\u2019s asks into a reply on the brand\u2019s thread.</p>';
  fetch("/api/roster",{method:"POST",headers:{"content-type":"application/json"},credentials:"same-origin",body:JSON.stringify(Object.assign({},args,extra||{}))}).then(r=>r.json()).then(j=>{
    if(j&&j.url){ document.getElementById("m").textContent="Done. Opening your draft\u2026"; location.href=j.url; return; }
    if(j&&j.need==="to"){ ask(j); return; }
    throw new Error((j&&j.error)||"Something went wrong");
  }).catch(err=>{ c.innerHTML="<h1>That didn\u2019t work</h1><p>"+String(err.message||err).replace(/[<>&]/g,"")+'</p><p style="margin-top:14px"><a href="javascript:location.reload()">Try again</a></p>'; });
}
function ask(j){ c.innerHTML='<h1>Who should this go to?</h1><p>We have '+j.asks+' amendment'+(j.asks===1?"":"s")+" ready for "+String(j.deal||"this deal").replace(/[<>&]/g,"")+', but no brand contact is linked on the deal. Add their address and we will write the draft.</p><p style="margin-top:18px"><input id="e" type="email" placeholder="name@brand.com" style="width:100%;padding:11px 13px;border:1px solid #ddd9d2;border-radius:9px;font:15px Poppins,Arial,sans-serif"></p><p style="margin-top:12px"><button id="b" style="background:#f58220;color:#fff;border:0;border-radius:9px;padding:11px 22px;font:600 15px Poppins,Arial,sans-serif;cursor:pointer">Write the draft</button></p>';
  const e=document.getElementById("e"), b=document.getElementById("b");
  const fire=()=>{ const v=e.value.trim(); if(!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v)){ e.style.borderColor="#d64545"; e.focus(); return; } go({to:v}); };
  b.onclick=fire; e.onkeydown=ev=>{ if(ev.key==="Enter") fire(); }; e.focus();
}
go();
</script></body></html>`;
}
function outreachPage(q) {
  const e = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const args = JSON.stringify({ op: "outreach-draft", board: String(q.board || ""), item: String(q.item || ""), to: String(q.to || ""), name: String(q.name || ""), last: String(q.last || "") });
  const plain = String(q.plain || "");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Building your pitch</title>
<style>body{margin:0;background:#f5f3ef;font:15px/1.55 Poppins,Arial,sans-serif;color:#1a1a1a;display:grid;place-items:center;min-height:100vh}.c{background:#fff;border:1px solid #ece9e4;border-radius:16px;padding:40px 44px;max-width:460px;margin:24px;text-align:center}.sp{width:34px;height:34px;border:3px solid #f2dcc6;border-top-color:#f58220;border-radius:50%;animation:s 1s linear infinite;margin:0 auto 22px}@keyframes s{to{transform:rotate(360deg)}}h1{font-size:20px;margin:0 0 8px}p{color:#6b6b76;margin:0}a{color:#f58220;font-weight:600}.err .sp{display:none}</style></head>
<body><div class="c" id="c"><div class="sp"></div><h1>Building your pitch${q.brand ? " for " + e(q.brand) : ""}…</h1><p id="m">Picking the right creators and writing the email. This takes up to a minute, then your draft opens in Gmail.</p></div>
<script>fetch("/api/roster",{method:"POST",headers:{"content-type":"application/json"},credentials:"same-origin",body:${JSON.stringify(args)}}).then(r=>r.json()).then(j=>{ if(j&&j.url){ document.getElementById("m").textContent="Done. Opening your draft…"; location.href=j.url; } else throw new Error((j&&j.error)||"Something went wrong"); }).catch(err=>{ const c=document.getElementById("c"); c.className="c err"; c.querySelector("h1").textContent="The pitch could not be built"; document.getElementById("m").innerHTML=String(err.message).replace(/[<>&]/g,"")+${plain ? JSON.stringify('<br><br><a href="' + e(plain) + '">Write a plain email instead</a>') : '""'}; });</script></body></html>`;
}
// One list per agency, even after a link went to several (Tom, 16 Oct 2026: "ensure that a unique one is made per contact").
// A list our sent mail shows went to more than one company is "shared": a brand opening it is asked for their work
// email once, and gets their own copy (same creators and prices, their own ticks, comments and email thread). The
// company it was first made for keeps the original. The team never sees the question.
// One company, several domains: Libsyn sells ads as AdvertiseCast, and some agencies run two (givoolink/givoolinking,
// noxinfluencer/noxinfluencergroup). Domains whose names start the same are treated as one company.
const ORG_ALIAS = { "advertisecast.com": "libsyn.com" };
const coStem = o => { const d = ORG_ALIAS[o] || o; return /@/.test(d) ? d : d.split(".")[0]; };
const sameCo = (a, b) => { const x = coStem(String(a || "")), y = coStem(String(b || "")); return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 7 && (x.startsWith(y) || y.startsWith(x)))); };
const companies = orgs => orgs.reduce((acc, o) => (acc.some(a => sameCo(a, o)) ? acc : acc.concat([o])), []);
// Addresses the team uses for tests (Tom, 16 Oct 2026: the Ghost Soldier send to beccaalpine@ "was just a test"). Sends
// to them never make a list count as shared.
const TEST_ADDRESSES = new Set(["beccaalpine@gmail.com"]);
const realOrgs = orgs => orgs.filter(o => !TEST_ADDRESSES.has(o));
const listShared = body => !!body && !body.forkOf && companies(realOrgs(Object.keys(body.sent || {}))).length > 1;
const FORK_SKIP = ["feedback", "fbSeq", "fbAt", "fbAlerted", "fbSeen", "fbSubmitted", "thread", "confirm", "forks", "sent", "for", "forkOf"];
async function listClaim(b) {
  const em = String(b.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(em)) throw new Error("Please enter your work email");
  const { list } = await freshList(String(b.slug || ""));
  if (!list || list.bad) throw new Error("list not found");
  const org = DFT_DOMAIN.test(em) ? "" : orgOf(em);
  const body = list.body || {};
  if (!org || !listShared(body) || sameCo((body.for || [])[0], org)) return { ok: true, slug: list.slug };
  const known = (body.forks || {})[Object.keys(body.forks || {}).find(k => sameCo(k, org)) || ""];
  if (known) { const k = await freshList(known).catch(() => ({})); if (k && k.list && !k.list.bad) return { ok: true, slug: known }; }
  const by = String(list.by || "").replace(/\s+\d{4}-\d\d-\d\d.*$/, "").trim() || "tom@digitalfoxtalent.com (pitch)";
  const made = await saveList({ title: list.name, ids: body.ids || [], press: !!body.press }, by);
  const { list: nl } = await freshList(made.slug);
  const copy = {}; Object.keys(body).forEach(k => { if (!FORK_SKIP.includes(k)) copy[k] = body[k]; });
  const th = (body.sent || {})[Object.keys(body.sent || {}).find(k => sameCo(k, org)) || ""];
  await writeList(nl.id, Object.assign({}, nl.body, copy, { for: [org], forkOf: list.slug }, th && th.thread ? { thread: { id: th.thread } } : {}), {});
  const { list: again } = await freshList(list.slug);
  if (again && !again.bad) await writeList(again.id, Object.assign({}, again.body, { forks: Object.assign({}, again.body.forks || {}, { [org]: made.slug }) }), {});
  return { ok: true, slug: made.slug };
}
// Old lists tidy themselves away (Tom, 16 Oct 2026: "if a list hasn't been opened or touched for 90 days, let's have it
// automatically deleted"). A brand opening a list stamps Last opened once a day; the cron archives (monday's archive,
// restorable for 30 days) any list with no open, edit, brand tick or creation in 90 days. The AI campaigns list stays.
async function listSeen(b) {
  const data = await loadBoard(); const l = data.lists.find(x => x.slug === String(b.slug || ""));
  const today = new Date().toISOString().slice(0, 10);
  if (!l || l.opened === today) return { ok: true };
  l.opened = today;
  await monday(`mutation{change_simple_column_value(board_id:${LISTS_BOARD},item_id:${Number(l.id)},column_id:"${L.opened}",value:"${today}"){id}}`).catch(() => null);
  return { ok: true };
}
async function archiveStaleLists() {
  const data = await loadBoard(), cutoff = Date.now() - 90 * 864e5, gone = [];
  for (const l of data.lists) {
    if (!l.slug || l.slug === AI_LIST || l.bad) continue;
    const days = (String(l.by || "") + " " + String(l.updated || "") + " " + String(l.opened || "") + " " + String((l.body && l.body.fbAt) || "")).match(/\d{4}-\d\d-\d\d/g) || [];
    if (!days.length) continue;
    const last = Math.max(...days.map(d => Date.parse(d)).filter(Number.isFinite));
    if (!(last < cutoff)) continue;
    await monday("mutation($i:ID!){archive_item(item_id:$i){id}}", { i: l.id }).then(() => gone.push(l.name)).catch(() => null);
    if (gone.length >= 25) break;
  }
  if (gone.length) cache = null;
  return gone.length ? "archived " + gone.length + ": " + gone.join(", ").slice(0, 300) : "none";
}
async function listThread(list) {
  const tok = await gmailToken("tom@digitalfoxtalent.com"); if (!tok) return null;
  const G = path => fetch("https://gmail.googleapis.com/gmail/v1/users/me" + path, { headers: { Authorization: "Bearer " + tok } }).then(r => r.ok ? r.json() : {}).catch(() => ({}));
  let id = list.body.thread && list.body.thread.id;
  // The sent-mail check already knows which thread the list went out in, per company: use the owner's.
  if (!id && list.body.sent) { const own = (list.body.for || [])[0]; const k = Object.keys(list.body.sent).find(o => own ? sameCo(o, own) : true); if (k && list.body.sent[k].thread) id = list.body.sent[k].thread; }
  if (!id) {
    const want = "/r/" + list.slug, name = subjectWords(list.name);
    const q = "from:digitalfoxtalent.com -from:" + ALERT_FROM + " -subject:\"Brand feedback\" -subject:\"Brand sent their picks\" newer_than:60d {\"creator list\"" + (name ? " \"" + name + "\"" : "") + "}";
    const ms = (await G("/messages?maxResults=40&q=" + encodeURIComponent(q))).messages || [];
    const text = pl => { let out = ""; const walk = x => { if (!x) return; if (x.body && x.body.data) out += Buffer.from(x.body.data, "base64url").toString("utf8"); (x.parts || []).forEach(walk); }; walk(pl); return out; };
    for (const m of ms) { const full = await G("/messages/" + m.id + "?format=full"); const sj = (((full.payload || {}).headers || []).find(h => h.name.toLowerCase() === "subject") || {}).value || ""; const rc = ["to", "cc"].map(n => (((full.payload || {}).headers || []).find(h => h.name.toLowerCase() === n) || {}).value || "").join(","); const forOk = !Array.isArray(list.body.for) || !list.body.for.length || (rc.match(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).some(a => list.body.for.includes(orgOf(a))); if (forOk && !/brand feedback|brand sent their picks/i.test(sj) && text(full.payload).includes(want)) { id = full.threadId; break; } }
  }
  if (!id) return null;
  const t = await G("/threads/" + id + "?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Subject");
  const ms = t.messages || []; if (!ms.length) return null;
  const hd = (m, n) => (((m.payload || {}).headers || []).find(h => h.name.toLowerCase() === n) || {}).value || "";
  const ids = ms.map(m => hd(m, "message-id")).filter(Boolean);
  const subj = hd(ms[0], "subject").replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "").trim();
  if (!ids.length || !subj || /^(brand feedback|brand sent their picks)/i.test(subj)) return null; // never an alert's own thread
  return { id, subject: "Re: " + subj, inReplyTo: ids[ids.length - 1], references: ids.slice(-20).join(" ") };
}
// Confirmation draft (Tom approved, 16 Oct 2026, after sending Yumi a screenshot of her picks: "if a draft could be
// produced, in a similar way to the email I just sent"). When the brand has approved creators, a reply is drafted in
// Tom's Gmail, in the brand's thread: his wording, a table of the approved creators (format, views, rate, total) and
// the ask for their agreement. Draft only; Tom sends. Made again only when the approved set changes. A previous
// confirmation draft is replaced only if nobody has edited it, and one Tom sent or deleted is never re-made for the
// same picks. Never for press packages (no prices).
async function confirmDraft(list, ok, th) {
  if (!th || list.body.press || !ok || !ok.length) return null;
  const sig = ok.map(x => x.id + ":" + (x.price || 0)).sort().join(",");
  const prev = list.body.confirm || {};
  if (prev.sig === sig) return null;
  const tok = await gmailToken("tom@digitalfoxtalent.com"); if (!tok) return null;
  const G = (path, opt = {}) => fetch("https://gmail.googleapis.com/gmail/v1/users/me" + path, Object.assign({}, opt, { headers: Object.assign({ Authorization: "Bearer " + tok }, opt.headers || {}) })).then(async r => { const t = await r.text(); let j = {}; try { j = t ? JSON.parse(t) : {}; } catch (_) {} return r.ok ? j : Object.assign(j, { _status: r.status }); });
  if (prev.draft) { const d = await G("/drafts/" + prev.draft + "?format=minimal"); if (d.message && d.message.id === prev.msg) await G("/drafts/" + prev.draft, { method: "DELETE" }); }
  const t = await G("/threads/" + th.id + "?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Message-ID");
  const ms = (t.messages || []).filter(m => !(m.labelIds || []).some(l => l === "DRAFT" || l === "TRASH"));
  const hd = (m, n) => (((m.payload || {}).headers || []).find(h => h.name.toLowerCase() === n) || {}).value || "";
  const addrs = v => (String(v || "").match(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).map(a => a.toLowerCase());
  const outside = a => !DFT_DOMAIN.test(a);
  const brand = ms.slice().reverse().find(m => addrs(hd(m, "from")).some(outside));
  if (!brand) return null;
  const to = addrs(hd(brand, "from")).find(outside);
  const first = (String(hd(brand, "from")).replace(/<.*>/, "").replace(/["']/g, "").trim().split(/\s+/)[0] || "").replace(/@.*/, "");
  const cc = [...new Set(addrs(hd(brand, "to") + "," + hd(brand, "cc")).filter(a => outside(a) && a !== to))].concat(["alex@digitalfoxtalent.com"]).join(", ");
  // Replies to the brand's messages only: never point at an internal alert in the thread.
  const refs = ms.filter(m => !addrs(hd(m, "from")).includes(ALERT_FROM)).map(m => hd(m, "message-id")).filter(Boolean);
  const usd = n => "$" + Math.round(n).toLocaleString("en-US");
  const views = x => x.views ? Math.round(x.views).toLocaleString("en-US") + (x.long && !list.body.estViews ? " view guarantee" : " est. views") : "";
  const fmt = x => x.fmt + (x.videos > 1 ? " x " + x.videos : "");
  const F = "font-family:Arial,Helvetica,sans-serif;font-size:14px;", td = "padding:8px 12px;border:1px solid #e3e6ea;vertical-align:top;";
  const total = ok.reduce((n, x) => n + (x.price || 0), 0);
  const table = "<table cellspacing=\"0\" cellpadding=\"0\" style=\"border-collapse:collapse;" + F + "\"><tr>" + ["Creator", "Format", "Views", "Rate"].map(h => "<th align=\"left\" style=\"" + td + "background:#f5f6f8\">" + h + "</th>").join("") + "</tr>" +
    ok.map(x => "<tr><td style=\"" + td + "\">" + (x.url ? "<a href=\"" + escH(x.url) + "\">" + escH(x.name) + "</a>" : escH(x.name)) + "</td><td style=\"" + td + "\">" + escH(fmt(x)) + "</td><td style=\"" + td + "\">" + escH(views(x)) + "</td><td style=\"" + td + "\">" + (x.price ? usd(x.price) : "") + "</td></tr>").join("") +
    (ok.length > 1 && total ? "<tr><td colspan=\"3\" style=\"" + td + "font-weight:bold\">Total</td><td style=\"" + td + "font-weight:bold\">" + usd(total) + "</td></tr>" : "") + "</table>";
  const hi = "Hi " + (first && !/^(the|team|info|hello|support|admin|contact)$/i.test(first) ? first : "there") + ",";
  const html = "<div dir=\"ltr\" style=\"" + F + "\">" + escH(hi) + "<br><br>Can you confirm that you would like to proceed with the details below?<br><br>" + table + "<br>Could you please send over your agreement, and we will get this booked in for you?<br><br>Warm regards<br>Tom James<br>Digital Fox Talent<br>🦊</div>";
  const text = hi + "\n\nCan you confirm that you would like to proceed with the details below?\n\n" + ok.map(x => "- " + x.name + ": " + fmt(x) + (x.views ? ", " + views(x) : "") + (x.price ? ", " + usd(x.price) : "")).join("\n") + (ok.length > 1 && total ? "\nTotal: " + usd(total) : "") + "\n\nCould you please send over your agreement, and we will get this booked in for you?\n\nWarm regards\nTom James\nDigital Fox Talent\n🦊";
  const mime = pitchMime({ to, cc, subject: th.subject, html, text, threadId: th.id, inReplyTo: refs[refs.length - 1] || th.inReplyTo, references: refs.slice(-20, -1).join(" ") }).draft;
  const d = await G("/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: mime });
  if (!d.id) return null;
  return { sig, draft: d.id, msg: (d.message || {}).id || "", to, at: new Date().toISOString() };
}
async function sendAlert(list, subject, html, ok) {
  const th = await listThread(list).catch(() => null);
  const extra = th ? { thread: { id: th.id } } : {};
  const c = th ? await confirmDraft(list, ok, th).catch(() => null) : null;
  if (c) {
    extra.confirm = c;
    html = "<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:14px;background:#e7f6ec;border-left:4px solid #1a7f37;padding:12px 14px;border-radius:6px;margin:0 0 16px\"><b>Reply drafted:</b> a confirmation to " + escH(c.to) + " with the approved creators and the ask for their agreement is in Tom's Drafts, in this thread.</div>" + html;
  }
  if (th) await sendInternal(ALERT_TO, th.subject, html, th);
  else await sendInternal(ALERT_TO, subject, html);
  return extra;
}
async function sendInternal(to, subject, html, reply) {
  const tok = await gmailToken(ALERT_FROM); if (!tok) throw new Error("GMAIL_DELEGATE_KEY not set");
  const enc = s => "=?UTF-8?B?" + Buffer.from(s).toString("base64") + "?=";
  const mime = ["From: Digital Fox Talent <" + ALERT_FROM + ">", "To: " + to.join(", "), "Subject: " + enc(subject)].concat(reply && reply.inReplyTo ? ["In-Reply-To: " + reply.inReplyTo, "References: " + reply.references] : []).concat(["MIME-Version: 1.0", "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", Buffer.from(html).toString("base64")]).join("\r\n");
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify({ raw: Buffer.from(mime).toString("base64url") }) });
  if (!r.ok) throw new Error("Gmail send " + r.status + " " + (await r.text()).slice(0, 200));
}
// Rename a list (Alex, 15 Oct 2026): the name brands see at the top of the list. The link stays the same.
async function listRename(b, email) {
  const { list } = await freshList(b.slug);
  if (!list) throw new Error("list not found");
  const title = noDash(String(b.title || "")).replace(/\s+/g, " ").trim().slice(0, 80);
  if (!title) throw new Error("Give the list a name");
  await monday(`mutation($b:ID!,$i:ID!,$v:JSON!){change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id}}`, { b: String(LISTS_BOARD), i: String(list.id), v: JSON.stringify({ name: title, [L.updated]: email + " " + stamp() }) });
  cache = null;
  return { ok: true, title };
}

// The brand's own feedback on a list (Tom, 10 Oct 2026). Brands are not signed in: the list's
// link (with its random tail) is what lets them in, the same as viewing it. They can only
// approve or un-approve a creator already on the list and leave a short note on it. Each
// change is posted as an update on the list's monday item so the team hears about it.
async function brandFeedback(b, email) {
  const { data, list } = await freshList(b.slug); // fresh, so one brand click never undoes another
  if (!list) throw new Error("This list is no longer available");
  if (list.bad) throw new Error("Sorry, that could not be saved. Please let Digital Fox Talent know.");
  const id = String(b.id || "");
  if (!(list.body.ids || []).map(String).includes(id)) throw new Error("That creator is not on this list");
  const note = String(b.note == null ? "" : b.note).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, 500);
  // The brand's decision on a creator (Tom, 10 Oct 2026): "yes" approved, "no" rejected, "" none.
  const decision = b.decision != null ? String(b.decision) : (b.ok ? "yes" : "");
  if (!["", "yes", "no"].includes(decision)) throw new Error("Unknown decision");
  const ok = decision === "yes", no = decision === "no";
  const feedback = Object.assign({}, list.body.feedback || {});
  const before = feedback[id] || {};
  if (ok || no || note) feedback[id] = { ok, no, note, at: stamp() }; else delete feedback[id];
  // Tracking (Tom, 15 Oct 2026: ARZOPA's feedback sat unseen for a day). Every change keeps the list's
  // monday row current (Brand approved, Brand declined, Brand notes); a change made by the brand itself,
  // not a teammate ticking for them, also stamps Last brand activity.
  const changed = (before.ok ? "yes" : before.no ? "no" : "") !== decision || String(before.note || "") !== note;
  const body = Object.assign({}, list.body, { feedback });
  if (changed && !email) { body.fbAt = new Date().toISOString(); body.fbSeq = (Number(list.body.fbSeq) || 0) + 1; }
  await writeList(list.id, body, changed ? feedbackColumns(data, body) : {});
  const row = data.rows.find(r => r.id === id), who = (row && row.name) || "a creator";
  const bits = [];
  const was = before.ok ? "yes" : before.no ? "no" : "";
  if (was !== decision) bits.push(decision === "yes" ? "approved " + who : decision === "no" ? "rejected " + who : "cleared their decision on " + who);
  if (String(before.note || "") !== note) bits.push(note ? "left a note on " + who + ": " + note : "removed their note on " + who);
  // The team can tick "Brand approved" in Stage for a brand that approved by email.
  if (bits.length) { await audit(list.id, (email ? email + " (for the brand)" : "Brand feedback") + " on \u201c" + list.name + "\u201d: " + bits.join("; ")); await noteWrite(LISTS_BOARD); }
  return brandPayload(data, Object.assign({}, list, { body }), !!email);
}

// The creator's answer to the brand (Margot, 14 Oct 2026). Team only: "yes" interested,
// "no" declined, "" none, plus a short note shown to the brand on the list.
async function creatorResponse(b, email) {
  const { data, list } = await freshList(b.slug);
  if (!list) throw new Error("list not found");
  if (list.bad) throw new Error(LIST_READ_ERROR);
  const id = String(b.id || "");
  if (!(list.body.ids || []).map(String).includes(id)) throw new Error("That creator is not on this list");
  const note = String(b.note == null ? "" : b.note).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, 500);
  const decision = String(b.decision == null ? "" : b.decision);
  if (!["", "yes", "no"].includes(decision)) throw new Error("Unknown response");
  const ok = decision === "yes", no = decision === "no";
  const creator = Object.assign({}, list.body.creator || {});
  if (ok || no || note) creator[id] = { ok, no, note, at: stamp(), by: email }; else delete creator[id];
  const body = Object.assign({}, list.body, { creator });
  await writeList(list.id, body, { [L.updated]: email + " " + stamp() });
  return brandPayload(data, Object.assign({}, list, { body }), true);
}

// Press package on or off for a list (Tom, 16 Oct 2026). The link stays the same.
// Campaign ideas on or off for a paid list (Tom, 16 Oct 2026).
async function listIdeasOn(b, email) {
  const { data, list } = await freshList(b.slug);
  if (!list) throw new Error("list not found");
  if (list.bad) throw new Error(LIST_READ_ERROR);
  const body = Object.assign({}, list.body);
  if (b.on) body.ideasOn = true; else delete body.ideasOn;
  if (b.brief != null) body.brief = String(b.brief).slice(0, 4000);
  await writeList(list.id, body, { [L.updated]: email + " " + stamp() });
  return brandPayload(data, Object.assign({}, list, { body }), true);
}
// Paid campaign ideas with Claude for the creators on a list (Tom, 16 Oct 2026). Unlike the press ideas these are
// sponsored content the creator would make for the brand: specific to this campaign and to the creator's channel.
// Kept on the list only, so the team edits them there. Up to 20 creators a call; the page calls again until done.
// What each format is, so every idea fits what the brand is buying on that tab (Tom, 16 Oct 2026, Ghost Soldier:
// the YouTube tab "really needs to say YouTube Integrated Ads and have the campaign idea tailored to that, or
// Dedicated videos").
const PAID_FMT = {
  // About 60 seconds, so the idea must fit a 60 second ad read (Tom, 16 Oct 2026: ideas "might be tough to fit into a 60s ad").
  topics: "YouTube Integrated Ad: an ad read of about 60 seconds inside one of the creator's regular long-form videos. It must fit 60 seconds: one hook, one beat, a call to action. Not a whole video and not a change to the video's topic.",
  dedicated: "YouTube Dedicated Video: a whole long-form video about the campaign, in the creator's own format and voice.",
  live: "YouTube Live: one live stream on the creator's channel featuring the campaign, in their own live format.",
  group_mm4av3kr: "YouTube Short: one vertical video under 60 seconds.",
  group_mm4a1fe0: "Instagram Reel: one vertical video on the creator's Instagram.",
  group_mm4bd5tk: "TikTok: one vertical video on the creator's TikTok.",
  group_mm7yw8cy: "Snapchat: one vertical Story or Spotlight video.",
};
// The Campaign ideas playbook (Tom, 16 Oct 2026: "some kind of system to help us understand what typical campaign
// ideas might be ... so other Claude's can access it"): a Pitch Requests item whose text the idea writer reads every
// time. The team edits it on monday; good creator ideas get added there.
const PLAYBOOK_ITEM = 13313762403;
async function ideasPlaybook() {
  const q = await monday(`query{items(ids:[${PLAYBOOK_ITEM}]){column_values(ids:["long_text_mm83jwpf"]){text}}}`).catch(() => null);
  return String(((((q || {}).items || [])[0] || {}).column_values || [{}])[0].text || "").trim().slice(0, 2500);
}
// The campaign itself, researched once per list with web search and kept on the list (body.research).
async function campaignResearch(list) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return "";
  const prompt = [
    "Research this campaign for a creator talent agency that will pitch creator content for it. Use web search (at most 4 searches). Be factual; leave out anything you cannot confirm.",
    "CAMPAIGN: " + list.name,
    "BRIEF FROM THE BRAND: " + String(list.body.brief || "").slice(0, 3000),
    "Answer in at most 8 short plain lines: what it is (for a film: studio, genre, premise); release or launch date; key cast, director or makers; tone; 3 to 5 comparable titles or products fans would know; the 3 strongest hooks for creators. No em dashes."
  ].join("\n");
  for (const model of PITCH_MODELS) {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model, max_tokens: 1500, tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }], messages: [{ role: "user", content: prompt }] }) }).catch(() => null);
    const d = r && await r.json().catch(() => ({}));
    if (!r || !r.ok || !d || !d.content) continue;
    return noDash(d.content.filter(x => x.type === "text").map(x => x.text).join("\n")).slice(0, 2000);
  }
  return "";
}
async function campaignIdeas(list, data, opt = {}) {
  let body = list.body;
  const ids = new Set((body.ids || []).map(String)), have = body.ideas || {};
  const brief = String(opt.brief != null ? opt.brief : body.brief || "").slice(0, 4000);
  const press = !!body.press;
  const only = Array.isArray(opt.ids) && opt.ids.length ? new Set(opt.ids.map(String)) : null; // a redo goes a batch of ids at a time
  const rows = data.rows.filter(r => ids.has(r.id) && (!only || only.has(r.id)) && (press ? !r.dedicated : true) && (opt.redo || !String(have[r.id] || "").trim()));
  const todo = rows.slice(0, press ? 20 : 12);
  if (!todo.length) return { done: 0, left: 0, body };
  const playbook = await ideasPlaybook();
  if (!press && (!body.research || opt.redo === "all")) body = Object.assign({}, body, { research: await campaignResearch(Object.assign({}, list, { body: Object.assign({}, body, { brief }) })).catch(() => "") });
  const seed = opt.seed || {};
  const known = Object.keys(have).filter(id => String(have[id] || "").trim() && !todo.some(r => r.id === id)).slice(0, 8).map(id => { const r = data.rows.find(x => x.id === id); return r ? "- " + r.name + ": " + String(have[id]).replace(/\n/g, " / ") : ""; }).filter(Boolean);
  const lines = todo.map(r => JSON.stringify(press
    ? { id: r.id, name: r.name, platform: PAID_FMT[r.group] || "", category: r.cv[C.category] || "", host: r.cv[C.host] || "", about: String(r.cv[C.about] || r.cv[C.audience] || "").slice(0, 500) }
    : { id: r.id, name: r.name, format: PAID_FMT[r.live ? "live" : r.dedicated ? "dedicated" : r.group] || "", category: r.cv[C.category] || "", host: r.cv[C.host] || "", about: String(r.cv[C.about] || "").slice(0, 700), audience: String(r.cv[C.audience] || "").slice(0, 300), creator_said: seed[r.id] || undefined }));
  const prompt = press ? [
    "You write press opportunities for Digital Fox Talent, a creator management agency, for an EARNED MEDIA (press) campaign. The partner does not pay the creator; it offers access, and the creator decides what, if anything, to make from it.",
    "Campaign (title of the press package and the partner's brief):", "Title: " + list.name, brief ? "Brief: " + brief : "Brief: not given, work from the title.",
    known.length ? "Ideas already on this package (match their spirit and level of detail):\n" + known.join("\n") : "",
    "For each creator below write 3 press opportunities for THIS campaign that would genuinely excite this creator and suit their channel. Each one is the ACCESS the partner gives, named specifically for the campaign: an interview with named talent, cast or developers from the brief; an early screening, screener or hands-on play of this title; an exclusive early trailer, clip or cinematic to react to; a premiere, launch event, junket or convention invite; a studio, set or HQ visit; a press mailer or review copy; a talent guest spot on the creator's own show, podcast or livestream. Use the names, dates and offers in the brief; never invent talent or events the brief does not support (general ones like a launch event invite are fine). Never propose a dedicated, sponsored or integrated video, an ad read or anything the creator must publish. Each idea is one plain sentence of at most 20 words. No prices. Never use em dashes or en dashes.",
    "Answer with JSON only: {\"ideas\": {\"<id>\": [\"idea\", \"idea\", \"idea\"]}}",
    "Creators:", ...lines,
  ].filter(Boolean).join("\n") : [
    "You are a senior creator campaign strategist at Digital Fox Talent, a creator management agency. Write campaign ideas for a PAID brand campaign: the brand pays each creator to feature it in their own content. The brand wants ideas it can approve, so each one must be concrete, fit the creator's real channel and fit the exact format being bought.",
    playbook ? "DFT CAMPAIGN IDEAS PLAYBOOK (follow it):\n" + playbook : "",
    "CAMPAIGN: " + list.name,
    "BRIEF FROM THE BRAND: " + (brief || "(not given, work from the campaign name)"),
    "RESEARCH ON THE CAMPAIGN: " + (body.research || "(none)"),
    known.length ? "IDEAS ALREADY ON THIS LIST (from the team or the creators; match their quality and do not repeat them):\n" + known.join("\n") : "",
    "For each creator write 2 ideas. Rules:",
    "1. Fit the FORMAT exactly. A YouTube Integrated Ad is an ad read of about 60 seconds inside a regular video, so it must be deliverable in 60 seconds: the creator on camera with one hook (a trailer moment, a personal reason to watch, a quick comparison or a single pick), a natural segue from the video they are already making, and a call to action (release date, tickets, link). Never a ranking, tier list, breakdown or anything that changes or takes over the video; those big concepts belong on Dedicated Videos. A Dedicated Video is a whole video about the campaign. Short-form ideas are single vertical videos.",
    "2. Fit the creator: use what the channel actually makes (from 'about' and 'category'). If 'creator_said' is given, build on it first.",
    // Top-line only (Tom, 16 Oct 2026: "be careful about getting too detailed. These should be top line ideas at this point").
    "3. TOP-LINE IDEAS ONLY. Use the research to understand the campaign's genre and tone, never to state facts: no release dates, places, plot details, character names, directors, crew, past films of the makers, or any detail that would need checking. Name only the campaign title and anything the brand's brief itself states.",
    "4. Each idea is one plain sentence of at most 18 words, starting with the hook, not the host's name. Positive and brand safe. No promises of views, dates or results. No prices. Never use em dashes or en dashes.",
    "Answer with JSON only: {\"ideas\": {\"<id>\": [\"idea\", \"idea\"]}}",
    "CREATORS:", ...lines,
  ].filter(Boolean).join("\n");
  const out = await askClaude(prompt);
  const got = (out && out.ideas) || {}, ideas = Object.assign({}, have);
  let done = 0;
  todo.forEach(r => { const text = cleanIdeas((Array.isArray(got[r.id]) ? got[r.id] : []).join("\n")); if (text) { ideas[r.id] = text; done++; } });
  const next = Object.assign({}, body, { ideas });
  if (brief && opt.brief != null) next.brief = brief;
  const left = rows.length - todo.length + (todo.length - done);
  if (!left) delete next.ideasPending;
  await writeList(list.id, next, opt.by ? { [L.updated]: opt.by + " " + stamp() } : {});
  return { done, left: Math.max(0, rows.length - done), body: next, model: out && out.model };
}
async function listCampaignIdeas(b, email) {
  const { data, list } = await freshList(b.slug);
  if (!list) throw new Error("list not found");
  if (list.bad) throw new Error(LIST_READ_ERROR);
  const r = await campaignIdeas(Object.assign({}, list, { body: list.body.press ? list.body : Object.assign({}, list.body, { ideasOn: true }) }), data, { brief: b.brief, redo: b.redo === "all" ? "all" : !!b.redo, seed: b.seed || {}, ids: b.ids, by: email });
  return { done: r.done, left: r.left };
}
// Lists waiting for campaign ideas (set by the pitch pipeline when a brand asks for ideas): drafted by the
// roster-warm cron, a batch at a time, so the pitch reply is never slowed down.
async function pendingIdeas() {
  const data = await loadBoard(), done = [];
  for (const l0 of data.lists) {
    if (!l0.body || !l0.body.ideasPending) continue;
    const { list } = await freshList(l0.slug);
    if (!list || list.bad || !list.body.ideasPending) continue;
    const r = await campaignIdeas(list, data, {}).catch(() => null);
    if (r) done.push(list.slug + ":" + r.done);
    if (done.length >= 2) break;
  }
  return done;
}
// Position on AI for creators on a list (see brandPayload). One creator ({ id, text }) or several ({ items: [{ id, text }] });
// empty text removes the entry, and the column goes away when no creator has one.
const cleanAiView = t => String(t || "").replace(/\r/g, "").replace(/\s*[\u2014\u2013]\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, 400);
async function listAiView(b, email) {
  const { data, list } = await freshList(b.slug);
  if (!list) throw new Error("list not found");
  if (list.bad) throw new Error(LIST_READ_ERROR);
  const items = Array.isArray(b.items) ? b.items.slice(0, 300) : [{ id: b.id, text: b.text }];
  const aiView = Object.assign({}, list.body.aiView || {});
  items.forEach(it => { const id = String((it && it.id) || ""); if (!ROW_ID.test(id)) return; const t = cleanAiView(it.text); if (t) aiView[id] = t; else delete aiView[id]; });
  const body = Object.assign({}, list.body, { aiView });
  if (!Object.keys(aiView).length) delete body.aiView;
  await writeList(list.id, body, { [L.updated]: email + " " + stamp() });
  return brandPayload(data, Object.assign({}, list, { body }), true);
}
async function listType(b, email) {
  const { data, list } = await freshList(b.slug);
  if (!list) throw new Error("list not found");
  if (list.bad) throw new Error(LIST_READ_ERROR);
  const body = Object.assign({}, list.body);
  if (b.press) body.press = true; else delete body.press;
  await writeList(list.id, body, { [L.updated]: email + " " + stamp() });
  return brandPayload(data, Object.assign({}, list, { body }), true);
}
// Ideas text: plain lines, no em or en dashes as breaks (Tom's standing rule), at most 600 characters.
const cleanIdeas = t => String(t || "").replace(/\r/g, "").replace(/\s*[\u2014\u2013]\s*/g, ", ").split("\n").map(x => x.replace(/^\s*[-*\u2022]\s*/, "").trim()).filter(Boolean).slice(0, 6).join("\n").slice(0, 600);
// One creator's ideas on a press package: for this list only, or as the creator's standard
// ideas (the Earned Media Ideas column on the rates board, used by every press package).
async function listIdea(b, email) {
  const id = String(b.id || "");
  if (!ROW_ID.test(id) || (isDedId(id) && (b.standard || !b.slug))) throw new Error("bad id"); // dedicated rows: campaign ideas on a list only
  const text = cleanIdeas(b.text);
  if (b.standard) {
    const { row } = await freshRow(id, false);
    await writeRow(BOARD, id, { [C.ideas]: text }, C, false);
    await audit(id, "Earned media ideas " + (text ? "set" : "cleared") + " by " + email + (text ? ":\n" + text : ""));
    void row;
    if (!b.slug) return { ok: true, id, ideas: text }; // edited in the DFT view, no list involved
  }
  if (!b.slug) throw new Error("list not found");
  const { data, list } = await freshList(b.slug);
  if (!list) throw new Error("list not found");
  if (list.bad) throw new Error(LIST_READ_ERROR);
  const ideas = Object.assign({}, list.body.ideas || {});
  if (b.standard || !text) delete ideas[id]; else ideas[id] = text;
  const body = Object.assign({}, list.body, { ideas });
  if (!Object.keys(ideas).length) delete body.ideas;
  await writeList(list.id, body, { [L.updated]: email + " " + stamp() });
  return brandPayload(await loadBoard(), Object.assign({}, list, { body }), true);
}
// Draft standard ideas with Claude for creators that have none (Tom, 16 Oct 2026: "typical
// ideas for what the creators do based on their channels"). Up to 25 rows a call; the page
// calls again until nothing is missing. Written to the rates board, so the team can edit them.
const FMT_WORD = { topics: "YouTube long-form channel", group_mm4av3kr: "YouTube Shorts", group_mm4a1fe0: "Instagram", group_mm4bd5tk: "TikTok", group_mm7yw8cy: "Snapchat" };
async function ideasDraft(b, email) {
  const data = await loadBoard();
  const want = Array.isArray(b.ids) && b.ids.length ? new Set(b.ids.map(String)) : null;
  const todo = data.rows.filter(r => !r.dedicated && (want ? want.has(r.id) : true) && (b.redo ? true : !String(r.cv[C.ideas] || "").trim()) && r.cv[C.vis] !== "Hide").slice(0, Math.min(25, Math.max(1, Number(b.limit) || 25)));
  if (!todo.length) return { done: 0, left: 0 };
  const lines = todo.map(r => JSON.stringify({ id: r.id, handle: r.cv[C.handle] || "", name: r.name, platform: FMT_WORD[r.group] || "", category: r.cv[C.category] || "", host: r.cv[C.host] || "", about: String(r.cv[C.audience] || r.cv[C.about] || "").slice(0, 600) }));
  const prompt = [
    "You write short press and earned media ideas for Digital Fox Talent, a creator management agency. These go on press packages sent to film and TV studios, game publishers, brands and PR agencies, who offer creators access (interviews, events, screenings, early play, product) instead of paying a fee.",
    "For each creator below, write 3 press opportunities (Tom, 16 Oct 2026: press and earned media, never what a brand would pay for). Each idea is the ACCESS the partner gives the creator, never a video, Short or post the creator is asked to make. Choose from: an interview with cast, talent, developers or experts; event, premiere, junket, convention or festival attendance; an early screening or screener; a press mailer or review unit to unbox; early hands-on or preview access to a game; an exclusive early clip or trailer to react to; a studio, set or HQ visit; a guest spot on the creator's own show or livestream. Pick the ones that would genuinely excite this creator and suit their channel, judged from its description, category and platform. Never propose a dedicated, sponsored or integrated video, an ad read, a paid post or anything the creator must publish. Each idea is one plain sentence of at most 16 words. Do not promise coverage, views, positive opinions or dates. Do not invent facts about the creator. Do not mention money. Never use em dashes or en dashes.",
    "Answer with JSON only: {\"ideas\": {\"<id>\": [\"idea\", \"idea\", \"idea\"]}}",
    "Creators:", ...lines,
  ].join("\n");
  const out = await askClaude(prompt);
  const got = (out && out.ideas) || {};
  let done = 0;
  for (const r of todo) {
    const arr = Array.isArray(got[r.id]) ? got[r.id] : [];
    const text = cleanIdeas(arr.join("\n"));
    if (!text) continue;
    await writeRow(BOARD, r.id, { [C.ideas]: text }, C, false);
    done++;
  }
  const left = data.rows.filter(r => !r.dedicated && r.cv[C.vis] !== "Hide" && !String(r.cv[C.ideas] || "").trim() && (want ? want.has(r.id) : true)).length;
  return { done, left, model: out && out.model };
}

async function listLabel(b, email) {
  const { data, list } = await freshList(b.slug);
  if (!list) throw new Error("list not found");
  if (list.bad) throw new Error(LIST_READ_ERROR);
  const body = Object.assign({}, list.body, { estViews: !!b.est });
  await writeList(list.id, body, { [L.updated]: email + " " + stamp() });
  return brandPayload(data, Object.assign({}, list, { body }), true);
}

// Show or hide one of a channel's shows on this saved list only (Tom, 13 Oct 2026). The main
// rate card is never touched. vis "show" puts it on the list even if it is hidden on the main
// rate card, "hide" takes it off this list, "" goes back to following the main rate card.
async function listShow(b, email) {
  const { data, list } = await freshList(b.slug);
  if (!list) throw new Error("list not found");
  if (list.bad) throw new Error(LIST_READ_ERROR);
  const id = String(b.id || "");
  const row = data.rows.find(r => !r.dedicated && r.shows.some(s => s.id === id));
  if (!row) throw new Error("show not found");
  if (!(list.body.ids || []).map(String).includes(row.id)) throw new Error("That channel is not on this list");
  const vis = String(b.vis == null ? "" : b.vis);
  if (!["", "show", "hide"].includes(vis)) throw new Error("bad visibility");
  const showVis = Object.assign({}, list.body.showVis || {});
  if (vis) showVis[id] = vis; else delete showVis[id];
  const body = Object.assign({}, list.body, { showVis });
  if (body.lock && vis === "show") { // a show switched on for a locked list is locked at today's price
    const snap = lockSnapshot(data, Object.assign({}, list, { body }), new Set([id]));
    body.lock = Object.assign({}, body.lock, { rows: Object.assign({}, body.lock.rows, snap) });
  }
  await writeList(list.id, body, { [L.updated]: email + " " + stamp() });
  return brandPayload(data, Object.assign({}, list, { body }), true);
}

async function listConfirm(b, email) {
  const { data, list } = await freshList(b.slug);
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
  return brandPayload(data, Object.assign({}, list, { body }), true);
}

async function listLock(b, email) {
  const { data, list } = await freshList(b.slug);
  if (!list) throw new Error("list not found");
  if (list.bad) throw new Error(LIST_READ_ERROR);
  const body = Object.assign({}, list.body);
  if (b.lock) body.lock = { on: stamp(), by: email, quarter: quarterLabel(), rows: lockSnapshot(data, list) };
  else delete body.lock;
  await writeList(list.id, body, { [L.updated]: email + " " + stamp() });
  return brandPayload(data, Object.assign({}, list, { body }), true);
}

// Reordering and removing (Tom, 11 Oct 2026). These used to send the page's whole copy of
// the list, so a tab opened a while ago could put back creators removed since. Now the page
// sends only the order it wants, or the creators to take off, and the server applies that
// to the list as it is on monday right now.
async function listOrder(b, email) {
  const { data, list } = await freshList(b.slug);
  if (!list) throw new Error("list not found");
  if (list.bad) throw new Error(LIST_READ_ERROR);
  const cur = (list.body.ids || []).map(String), have = new Set(cur);
  const want = (Array.isArray(b.ids) ? b.ids : []).map(String).filter((x, i, a) => have.has(x) && a.indexOf(x) === i);
  // The moved creators take the slots those same creators held; everyone else stays put.
  const moved = new Set(want), queue = want.slice();
  const ids = cur.map(id => moved.has(id) ? queue.shift() : id);
  const body = Object.assign({}, list.body, { ids });
  await writeList(list.id, body, { [L.updated]: email + " " + stamp() });
  return brandPayload(data, Object.assign({}, list, { body }), true);
}
async function listRemove(b, email) {
  const { data, list } = await freshList(b.slug);
  if (!list) throw new Error("list not found");
  if (list.bad) throw new Error(LIST_READ_ERROR);
  const drop = new Set((Array.isArray(b.ids) ? b.ids : []).map(String));
  const ids = (list.body.ids || []).map(String).filter(id => !drop.has(id));
  if (!ids.length) throw new Error("That would leave the list empty, so nothing was changed.");
  const body = Object.assign({}, list.body, { ids });
  await writeList(list.id, body, { [L.updated]: email + " " + stamp() });
  return brandPayload(data, Object.assign({}, list, { body }), true);
}

// Live totals while choosing creators (Tom, 12 Oct 2026). Read only: works out what a list
// would cost with these creators, at the prices brands would see (the list's own prices,
// discounts and any campaign lock included), plus the saved list's total to compare with.
function totalsOf(p) {
  let total = 0, was = 0, ytViews = 0, dedViews = 0, shortViews = 0, videos = 0, profiles = 0;
  GROUPS.forEach(g => (p.groups[g.id] || []).forEach(c => {
    const t = typeof c.total === "number" ? c.total : (typeof c.rate === "number" ? c.rate : 0);
    total += t; was += c.wasTotal ? c.wasTotal - t : 0; profiles++;
    // Dedicated videos carry no view guarantee (Tom, 13 Oct 2026), so their views are counted apart.
    if (g.id === "dedicated" || g.id === "live") { dedViews += c.vg || 0; videos += c.minVideos || 1; }
    else if (g.kind === "long") { ytViews += c.vg || 0; videos += c.minVideos || 1; } else { shortViews += c.vg || 0; videos += 1; }
  }));
  return { total, discount: was, ytViews, dedViews, shortViews, videos, profiles };
}
async function listPreview(b) {
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).filter(x => ROW_ID.test(x)).slice(0, 300);
  const { data, list } = b.slug ? await freshList(b.slug) : { data: await loadBoard(), list: null };
  if (list && list.bad) throw new Error(LIST_READ_ERROR);
  const base = list ? list.body : {};
  const asList = body => ({ name: list ? list.name : "", slug: list ? list.slug : "", body });
  const now = totalsOf(brandPayload(data, asList(Object.assign({}, base, { ids })), false));
  const saved = list ? totalsOf(brandPayload(data, asList(base), false)) : null;
  // Creators chosen that brands would not see on a list (set to Hide, or no figures yet).
  const missing = ids.length - now.profiles;
  return { now, saved, missing, estViews: !!base.estViews };
}

async function saveColumns(b, email) {
  const cols = (Array.isArray(b.columns) ? b.columns : []).map(String).filter(x => /^[a-zA-Z0-9]+$/.test(x)).slice(0, 60);
  if (!cols.length) throw new Error("no columns");
  // Row order per tab (the team's default for everyone), ids only.
  const rows = {};
  const src = b.rows && typeof b.rows === "object" ? b.rows : {};
  GROUPS.forEach(g => { if (Array.isArray(src[g.id])) rows[g.id] = src[g.id].map(String).filter(x => ROW_ID.test(x)).slice(0, 300); });
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

// ---------------------------------------------------------------- pitch from a forwarded enquiry
// Pitch pipeline (Tom, 13 Oct 2026). Someone at DFT forwards a brand enquiry to the Make mailhook
// "DFT pitch". Make logs it as an item on Roster - Pitch Requests and posts it here (op "pitch")
// with that item id. The item is the proof: only one made on that board in the last 15 minutes,
// by the same forwarder and not yet used, can trigger a pitch, so no secret is needed. Claude reads
// the brief and picks from what brands can see on the roster today: creators the brand named or
// wrote to first, then the closest fits, then a few broader picks (8 to 14 creators, only the
// formats asked for). A saved list is created, the result is written back to the item, and the
// reply comes back for Make to save as a Gmail draft (op "pitch-mime" builds the raw message, so
// links in the draft stay clean).
export const config = { maxDuration: 300 }; // 300 since 19 Oct 2026: a multi-campaign forward builds its lists in parallel
const PITCH_BOARD = 18435316650;
const AI_LIST = "ai-campaigns-tj-50001f"; // Tom's saved list of creators open to AI brands (13 Oct 2026). Edit the list, not the code.
const PB = { by: "text_mm83t28h", contact: "text_mm83nbr6", result: "text_mm83dzmw", list: "link_mm832b9j", draft: "long_text_mm89wehb", check: "text_mm897m47" };
// Learning from Tom's sent replies (Tom, 19 Oct 2026: "review the emails I have sent, and try to learn from them").
// Each pitch draft is kept on its row (Draft as written, Draft check); api/pitch-learn.js compares it each night with
// what was actually sent and keeps the edits as standing lessons on this item, which polishPitch applies to new drafts.
const PITCH_LESSONS_ITEM = 13327548036; // Pitch Requests item "Standing lessons for pitch replies"
const PITCH_MODELS = ["claude-opus-5-5", "claude-sonnet-4-5", "claude-haiku-4-5-20251001"]; // strongest first (Tom, 14 Oct 2026), older models only as a fallback
const FACTS_ITEM = 13283766377; // Pitch Requests item "Standing facts for pitch replies": the only facts a reply may state
const PITCH_LABEL = { topics: "YouTube integration", dedicated: "YouTube dedicated video", live: "YouTube livestream", group_mm4av3kr: "YouTube Shorts", group_mm4a1fe0: "Instagram", group_mm4bd5tk: "TikTok", group_mm7yw8cy: "Snapchat" };
// The model's opening line is used only when it reads like Tom (19 Oct 2026): a thank-you, one sentence, no stock
// opinion of the product, nothing that could be a promise or a figure.
function pitchOpener(o) {
  const s = noDash(String(o || "")).replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
  if (s.length < 15 || s.length > 160 || !/^thank/i.test(s)) return "";
  if (/[\[\]!?;:]|https?:|www\.|\$|%|\d{1,3},\d{3}|\b(?!20\d\d\b)\d{4,}/.test(s) || /\.\s+\S/.test(s)) return "";
  if (/\b(fun|great|amazing|exciting|excited|awesome|perfect|incredible|fantastic|cool|love|lovely|brilliant|guarantee\w*)\b/i.test(s)) return "";
  return s + ".";
}
const kfmt = n => !n ? "" : n >= 1e6 ? (Math.round(n / 1e5) / 10) + "M" : n >= 1000 ? Math.round(n / 1000) + "K" : String(n);
const escH = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const noDash = s => String(s == null ? "" : s).replace(/\s*\u2014\s*/g, ", ").replace(/\u2013/g, "-").trim();
const htmlToText = h => String(h || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/\n{3,}/g, "\n\n").trim();

// Which email is the brand's (Tom, 14 Oct 2026, Margot's Base44 forward): a forward of DFT's own
// reply has a DFT address in From, so the brand is the outside address it was sent To. A forward
// of a forward is followed down to the first header with an outside sender or recipient.
const DFT_DOMAIN = /@digitalfoxtalent\.com$/i;
// Who a list was made for (Tom, 16 Oct 2026, after Blossom & Wood and Dorun Media were sent the list made for StarAce:
// "double check that any agencies names are actually the intended recipient"). A company is its email domain
// (creator.noxinfluencer.com and noxinfluencer.com are one company); on a free mail domain the person is the address.
const FREE_MAIL_DOM = /^(gmail|googlemail|icloud|me|mac|yahoo|ymail|rocketmail|hotmail|outlook|live|msn|aol|proton|protonmail|pm|gmx|mail|zoho|yandex|qq|163|126|hey|fastmail)\./i;
const mailDom = x => { const p = String(String(x || "").split("@")[1] || "").toLowerCase().split("."); return p.slice(p.length > 2 && p[p.length - 1].length === 2 && p[p.length - 2].length <= 3 ? -3 : -2).join("."); };
const orgOf = x => { const a = String(x || "").trim().toLowerCase(); if (!/@/.test(a) || DFT_DOMAIN.test(a)) return ""; const d = mailDom(a); return FREE_MAIL_DOM.test(d) ? a : d; };
// The note above a forward ends where the forwarder's signature starts: their own name on a line,
// a phone number or the DFT web address (Margot's signature was being saved as a pointer, 14 Oct 2026).
function stripSig(note, fromName) {
  const fn = String(fromName || "").trim().toLowerCase(), lines = String(note || "").split("\n");
  const at = lines.findIndex(l => (fn && l.trim().toLowerCase() === fn) || /^\s*(\+?\d[\d .()-]{8,}|(https?:\/\/)?(www\.)?digitalfoxtalent\.com\/?)\s*$/i.test(l));
  return (at >= 0 ? lines.slice(0, at) : lines).join("\n").trim();
}
function parseForward(b) {
  const text = String(b.text || "").trim() || htmlToText(b.html);
  const at = text.search(/-{3,}\s*Forwarded message\s*-{3,}|Begin forwarded message:/i);
  const fwd = at >= 0 ? text.slice(at) : text;
  const addrs = s => (String(s || "").match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).map(x => x.toLowerCase());
  const line = (h, k) => ((h.match(new RegExp("(?:^|\\n)[ \\t*]*" + k + ":[ \\t]*\\*?[ \\t]*([^\\n]*)", "i")) || [])[1] || "").replace(/\*+/g, "").trim();
  const nameFor = (ln, em) => { const m = ln.match(new RegExp("\"?([^\"<>,;]*?)\"?\\s*<" + em.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ">", "i")); return m ? m[1].trim() : ""; };
  const marks = []; const mre = /-{3,}\s*Forwarded message\s*-{3,}|Begin forwarded message:/gi; let mm;
  while ((mm = mre.exec(text))) marks.push(mm.index);
  if (!marks.length) marks.push(0);
  const heads = marks.map(i => { const seg = text.slice(i); const fa = Math.max(0, seg.search(/From:/i)); const hl = seg.slice(fa).search(/\n[ \t]*\n/); return { at: i, h: seg.slice(fa, hl > 0 ? fa + hl : fa + 800) }; });
  let pick = null;
  for (const hd of heads) {
    const fl = line(hd.h, "From"), fe = addrs(fl)[0] || "";
    if (fe && !DFT_DOMAIN.test(fe)) { pick = { hd, email: fe, name: nameFor(fl, fe), fromName: nameFor(fl, fe), fromEmail: fe }; break; }
    const tl = line(hd.h, "To"), te = addrs(tl).find(x => !DFT_DOMAIN.test(x));
    if (te) { pick = { hd, email: te, name: nameFor(tl, te), fromName: nameFor(fl, fe) || fl.replace(/<[^>]*>/g, "").trim(), fromEmail: fe }; break; }
  }
  if (!pick) { const hd = heads[0], fl = line(hd.h, "From"), fe = addrs(fl)[0] || ""; pick = { hd, email: fe, name: nameFor(fl, fe), fromName: nameFor(fl, fe), fromEmail: fe }; }
  // A website brief (Tom, 16 Oct 2026, Nativex): the notification comes from theteam@ and the brand's address is only
  // in its body ("Email: ..."). Reply to that address, never to a DFT one.
  if (DFT_DOMAIN.test(pick.email || "")) {
    const seg = text.slice(pick.hd.at);
    const em = ((seg.match(/(?:^|\n)[ \t*]*E-?mail[ \t]*:[ \t]*\*?[ \t]*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i) || [])[1] || addrs(seg).find(x => !DFT_DOMAIN.test(x)) || "").toLowerCase();
    if (em && !DFT_DOMAIN.test(em)) { const un = ((seg.match(/(?:^|\n)[ \t*]*(?:User|Name)[ \t]*:[ \t]*([^\n]+)/i) || [])[1] || "").replace(/\*+/g, "").trim(); pick = Object.assign({}, pick, { email: em, name: un }); }
  }
  const body = text.slice(pick.hd.at);
  const subj = body.match(/\nSubject:\s*\*?\s*(.+)/i);
  return {
    contactName: pick.name,
    contactEmail: pick.email,
    // Who wrote the forwarded message, for the "On ... wrote:" line above the quote.
    quoteName: pick.fromName, quoteEmail: pick.fromEmail || pick.email,
    subject: String(String(b.subject || "").replace(/^\s*((fwd?|fw):\s*)+/i, "").trim() || (subj ? subj[1] : "")).replace(/\*+/g, "").trim(),
    to: line(pick.hd.h, "To"),
    others: [...new Set(addrs(line(pick.hd.h, "To") + " " + line(pick.hd.h, "Cc")))].filter(x => x !== pick.email),
    note: at > 0 ? stripSig(text.slice(0, at).split(/(?:^|\n)\s*(?:Warm regards|Kind regards|Best regards|Thanks,?\s*\n\s*Tom)/i)[0], b.fromName).slice(0, 1500) : "",
    body: (at >= 0 ? body : fwd).slice(0, 12000),
  };
}

// What brands can see today, one line per placement, for Claude to choose from.
// Press pitches (Tom, 16 Oct 2026) see no prices and no dedicated videos, and views as typical views.
function pitchCatalogue(data, press) {
  const p = brandPayload(data, null, false), lines = [], byId = {};
  GROUPS.forEach(g => (p.groups[g.id] || []).forEach(c => {
    if (press && (g.id === "dedicated" || g.id === "live")) return;
    byId[String(c.id)] = Object.assign({ gid: g.id }, c);
    const price = press ? 0 : typeof c.total === "number" ? c.total : c.rate;
    const typical = g.kind === "long" ? (c.vgPer || c.vg || 0) / PRICE.long.mult : c.vg;
    const views = press ? (typical ? kfmt(Math.round(typical)) + " typical views" : "") : c.vg ? kfmt(c.vg) + (g.kind !== "long" ? " avg views" : g.id === "dedicated" || g.id === "live" ? " est views" : " guaranteed views") : "";
    lines.push([c.id, PITCH_LABEL[g.id], c.name, c.handle, c.category || "", c.subs ? kfmt(c.subs) + " subs" : "", views, price ? "$" + price : "", c.location ? "based in " + c.location : "", c.us ? "US audience " + c.us : "", c.uk ? "UK audience " + c.uk : "", c.male ? "male " + c.male : "", String(c.about || "").replace(/\s+/g, " ").slice(0, 140)].join(" | "));
  }));
  return { lines, byId };
}

// The first complete JSON object in a model answer (Tom, 19 Oct 2026, Mediacube "prepare 2 pitches"): the answer came
// back as two objects one after the other, and parsing from the first "{" to the last "}" failed with "Unexpected
// non-whitespace character after JSON". Scans brace depth, ignoring braces inside strings. Null when there is none.
function firstJson(t) {
  t = String(t || "");
  for (let a = t.indexOf("{"); a >= 0; a = t.indexOf("{", a + 1)) {
    let depth = 0, str = false, esc = false;
    for (let i = a; i < t.length; i++) {
      const ch = t[i];
      if (str) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === "\"") str = false; continue; }
      if (ch === "\"") str = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) { try { const o = JSON.parse(t.slice(a, i + 1)); if (o && typeof o === "object") return o; } catch (_) {} break; }
    }
  }
  return null;
}

async function askClaude(prompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  let last = "";
  for (const model of PITCH_MODELS) {
    // A network error or a hung call on one model falls through to the next (audit, 19 Oct 2026: "fetch failed" ended the pitch).
    let r, d;
    try {
      r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal: AbortSignal.timeout(110000), headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model, max_tokens: 9000, messages: [{ role: "user", content: prompt }] }) });
      d = await r.json().catch(() => ({}));
    } catch (e) { last = model + ": " + String((e && e.message) || e).slice(0, 120); continue; }
    if (r.ok && d && d.content) {
      const t = String((d.content.find(x => x.type === "text") || {}).text || "").split("```json").join("").split("```").join("");
      const o = firstJson(t);
      if (o) return Object.assign(o, { model });
      last = model + ": no readable JSON in the answer"; continue;
    }
    last = model + " " + r.status + " " + (d && d.error ? d.error.message : "");
  }
  throw new Error("Claude: " + last);
}

// A quick audit of the brand (Tom, 14 Oct 2026): its website, what it sells and to whom, and creators it has partnered with.
// Uses Claude's web search tool; any failure simply means no research, never a failed pitch.
async function brandResearch(f, latest) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return null;
  const prompt = [
    "Research the brand or product in this enquiry for a creator talent agency. Use web search: find the brand's own website, what the product is and who it is for, and YouTube, Instagram or TikTok creators the brand has partnered with in roughly the last 18 months (sponsored videos, ambassador programmes, launch campaigns).",
    "Search at most 4 times. Be factual; leave fields empty rather than guess.",
    "ENQUIRY SUBJECT: " + String(f.subject || ""),
    "ENQUIRY: " + String(latest || f.body || "").slice(0, 3000),
    "Return ONLY JSON: {\"brand\":\"\",\"website\":\"\",\"product\":\"one line\",\"audience\":\"one line: age, interests, markets\",\"tone\":\"one line\",\"past_creators\":[{\"name\":\"\",\"platform\":\"\",\"kind\":\"e.g. gaming, family, reaction\"}],\"notes\":\"one line on what kind of creator they favour\"}"
  ].join("\n");
  for (const model of PITCH_MODELS) {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model, max_tokens: 2500, tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }], messages: [{ role: "user", content: prompt }] }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d || !d.content) continue;
    const t = d.content.filter(x => x.type === "text").map(x => x.text).join("\n").split("```json").join("").split("```").join("");
    return firstJson(t);
  }
  return null;
}

function reviewPrompt(f, lines, pointers, researchTxt) {
  return [
    "You are Tom James, founder of Digital Fox Talent, checking a creator shortlist before it goes to a brand. Be a demanding, experienced talent agent who knows these creators.",
    "THE ENQUIRY (newest message first, then any earlier thread; DFT's own replies in the thread stand):",
    String(f.subject || ""),
    String(f.body || "").slice(0, 9000),
    f.thread ? "THE WHOLE GMAIL THREAD (oldest first):\n" + String(f.thread).slice(-9000) : "",
    "",
    "BRAND RESEARCH (the brand's site and past creator partners):",
    researchTxt || "(none)",
    "",
    "PAST POINTERS FROM THE DFT TEAM:",
    (pointers || []).slice(-30).map(p => "- " + String(p).replace(/\s+/g, " ")).join("\n") || "(none)",
    "",
    "THE SHORTLIST (id | format | name | handle | category | ... | about | DFT FIT NOTE if any):",
    lines.join("\n"),
    "",
    "Remove only clear misfits, the ones that would make Tom wince: an audience age or tone that clashes with the product, a DFT FIT NOTE or past pointer that rules them out, something DFT already said in the thread, or an audience in the wrong market. Big, fun reaction and personality channels are deliberate adjacent picks (Tom likes The Reel Rejects and The Normies for broad, fun products), so keep them unless something above applies. Breadth is good: Tom wants at least 10 creators. Never remove a creator the brand's newest message asks for by name.",
    "When you remove a creator, list every one of their ids (all formats). Order removals worst fit first.",
    "Return ONLY JSON: {\"remove\":[{\"id\":\"\",\"reason\":\"max 8 words\"}]}"
  ].join("\n");
}

function pitchPrompt(f, lines, fwdName, aiNames, namedNames, pointers, facts, researchTxt, press) {
  return [
    "You help Digital Fox Talent (DFT), a creator management agency, answer a brand enquiry with a shortlist from its creator roster.",
    press ? "THIS IS A PRESS PITCH (earned media): " + fwdName + " marked it press. The partner offers creators something other than a fee, such as product, early access, screenings, events or interviews, and the list shows the press access that suits each creator (interviews, events, screenings, early play, mailers, clips, visits) instead of prices. Pick creators who would genuinely make content about this for their own audience. Press costs the partner nothing per creator, so go wide: aim for 40 or more placements across every creator whose audience would care, in each requested format. There are no prices and no dedicated videos; integration simply means the creator's YouTube channel. Never mention money, rates, fees or guarantees anywhere in your answer." : "",
    "",
    "THE ENQUIRY (forwarded by " + fwdName + " at DFT. Original sender: " + (f.contactName || "unknown") + " <" + f.contactEmail + ">. Sent to: " + (f.to || "unknown") + ")",
    f.note ? "POINTER FROM " + fwdName.toUpperCase() + " FOR THIS ENQUIRY (top priority, follow it exactly: creators to add or leave out, formats, angle, list size): " + f.note : "",
    pointers && pointers.length ? "PAST POINTERS FROM THE DFT TEAM (standing guidance learned from earlier pitches; apply wherever relevant):\n- " + pointers.join("\n- ") : "",
    "-----", f.body, "-----",
    f.thread ? "THE WHOLE GMAIL THREAD (oldest message first, each without its quoted history). This is the full context of the enquiry: read every message, including DFT's own replies, before you decide anything:\n" + f.thread + "\n-----" : "",
    "",
    "THE ROSTER (one line per placement: id | format | creator | handle | category | subscribers | views | price | location and audience | about). Only these ids exist. guaranteed views = YouTube integration view guarantee; est views = estimated views for a dedicated video (no guarantee); avg views = short-form average, for context only (short form is priced per post).",
    lines.join("\n"),
    "",
    "BRAND RESEARCH (from the brand's website and its past creator partnerships, found by web search just now):",
    researchTxt || "(none found)",
    "Use it: match the audience, tone and kind of creator the brand already works with, and if a past partner of the brand is on DFT's roster, strongly consider them.",
    "",
    "THE THREAD",
    "- The forwarded email may carry earlier messages quoted below the newest one. Read them all. Replies from DFT (signed Tom James or Digital Fox Talent, even when sent from a creator's DFT inbox, e.g. 'Emmaiden wrote') are DFT's own words and stand: if DFT already said a creator is not a fit, leave that creator out unless the brand's NEWEST message asks for them by name.",
    "- Set stage to 'new' if DFT should propose creators, or 'shortlist' if the brand has already chosen specific creators from DFT's roster. On a shortlist, mark the creators the brand chose named: true (each in every format the brand asks about that they have), and ALSO pick every other strong fit as you would for a new enquiry, so DFT always offers more (Tom, 14 Oct 2026).",
    "- Set closing to true only when the brand's newest message is definitive or the deal is near booking: it confirms exact creators to book, or asks for contracts, invoices, posting dates or final terms for creators it has chosen. Then DFT offers only the brand's chosen creators. Being interested in a few creators, or asking questions about them, is NOT closing.",
    "- The note from " + fwdName + " wins: if it asks to expand, offer more even when closing; if it says only these creators, offer only the brand's chosen ones.",
    "- A creator's DFT inbox in the To line only counts as naming that creator on a first enquiry with no earlier thread.",
    "",
    "DFT FIT NOTES (on some catalogue lines) are Tom's own judgement about that creator. Follow them strictly: never pick a creator whose note rules them out for this kind of brand or product, unless the brand's newest message asks for them by name.",
    "",
    "QUESTIONS",
    "- List each practical question the brand asks in its NEWEST message (not ones DFT already answered) in questions, as a short paraphrase. Answer each ONLY from the DFT FACTS below, in one short plain sentence in Tom's warm voice, no dashes. If the facts do not answer it, leave answer empty so Tom answers it himself. Never guess terms, prices, exclusivity, platforms, dates or policies.",
    "DFT FACTS:",
    facts || "(none yet)",
    "",
    "HOW TO PICK (think like an experienced talent agent, not a category filter)",
    "- AI campaigns: only these creators accept AI brands (AI tools, AI apps, generative AI): " + (aiNames || []).join(", ") + ". Set ai_product to true only when AI is the main thing being sold (an AI tool, AI app, AI companion or generative AI service), and then pick ONLY from them (any of their formats), except creators the enquiry names or says DFT already confirmed, who are always included. A product that only has some AI features (smart or AR glasses, phones, cameras, headphones, a game or app with an AI assistant) is NOT an AI product: set ai_product to false and pick from the whole roster.",
    "- First work out who would buy or love this product and what kind of video would sell it. Then name 4 to 6 different angles a creator could cover it from: the same-genre angle, plus adjacent ones such as reaction and commentary, pop culture, film and TV, comedy and group personalities, family, lifestyle, fitness or tech, whichever genuinely fit.",
    "- Big, engaged reaction and personality channels (group reaction shows, for example) often sell fun, social or entertainment products better than niche specialists. Consider them seriously.",
    "- Read each creator's about line, not just the category, to judge audience and tone.",
    "- Respect any market or territory limit (a pointer or brief saying a campaign is for one country only means only creators based in, or with a real audience in, that country). If that leaves one creator, return one.",
    "- Always include any creator the brand's newest message names, asks about, or says DFT already confirmed, and any creator it was sent to (a creator's DFT inbox in the To line counts only on a first enquiry with no earlier thread), plus any creator the note from " + fwdName + " asks for. Mark these picks named: true. A named creator who is not in the roster above has left DFT: leave them out and do not mention them.",
    namedNames && namedNames.length ? "- Named in this enquiry and on the roster: " + namedNames.join(", ") + ". They are always on the list, whatever else applies." : "",
    "- How many: every creator who genuinely fits, with no upper limit (the whole roster is fine if the brief truly suits everyone). Aim for at least 10 creators, topping up with the next-best real fits, unless a pointer, a market limit or the AI rule leaves fewer. Mix the closest fits with adjacent angles so the brand sees options it would not have thought of.",
    "- Be considerate about fit, creator by creator: leave out anyone whose audience, tone or content would jar with this brand or product, even if the category looks close (for example an edgy, mature or horror-led channel on a family or kids brief, a hardcore gaming channel on a beauty brief, an adult-skewing audience for a toy). Check age split, gender split and location against who the product is for. When unsure, leave them out.",
    "- Give each pick a fit score from 1 to 5 (5 = obvious fit, 4 = strong, 3 = solid adjacent fit). Do not pick anyone below 3. Named creators are always included whatever their fit.",
    "- Formats: strictly the ones the brand explicitly asks for in this campaign. A passing mention of a platform (e.g. 'as we grow on TikTok') is not a request. List them in formats using only: integration, dedicated, livestream, shorts, instagram, tiktok, snapchat (a general 'YouTube video' means integration; a live stream on YouTube or Twitch means livestream). If the brand does not define formats, leave formats empty and DFT offers YouTube: integration plus Shorts. Integration = YouTube integration; dedicated or full video = YouTube dedicated video; Shorts = YouTube Shorts; TikTok, Instagram and Snapchat as named. Give each creator every requested format they have; skip formats they lack.",
    "- Leave out short-form placements under 5K avg views and YouTube placements under 20K views unless the creator is named.",
    "- Never invent ids.",
    "",
    "THE REPLY",
    "Do not write the email (it is built from a fixed template). Give only: opener, one short thank-you sentence (under 20 words) starting with Thanks that shows we read their email, naming one concrete thing from it in plain words, such as what they are promoting, when it runs or who it is for (e.g. Thanks for sending over the details on your Christmas tech deals roundup. or Thanks for getting in touch about Fishing Clash for October and November.). Use only facts from their email, never an opinion about the product (never fun, great, exciting or amazing), no exclamation marks, no dashes, no promises; product, the short brand or product name exactly as people would say it (e.g. Catch Flex, Higgsfield), never a description; mix, a short phrase for the kinds of channels on your list (e.g. gaming, reaction, and personality channels); and answer, one or two short plain sentences that directly answer any practical question the enquiry asks, otherwise empty. answer may only use these facts: " + (press ? "the press opportunities that suit each creator are on the list; " : "the current rates are on the list; ") + "availability and posting dates are confirmed with each creator as soon as they approve, and we can move quickly; which of the named creators are on the list (only those given above as named and on the roster). Never say a creator is not on the roster, has left, or is unavailable: simply leave other names out. Never invent availability, dates, prices or numbers, never mention creators who left, and never refer to anything below or attached. No em dashes, no slashes.",
    "",
    "- ALWAYS pick creators. Every enquiry forwarded to DFT is an opportunity to pitch and recommend creators (Tom, 19 Oct 2026: \"This is an opportunity to pitch something and recommend creators, so we should be open to it\", and after a refusal on a vague outreach email: \"It's not helpful\"). Never return an empty picks list, whatever the email is: a vague or generic outreach email, an invitation addressed to one creator (including one who is not on the roster), a follow-up or an ongoing booking all get a shortlist of the strongest fits, using the whole thread to judge what the brand is after. If the brief is thin (no brand, product, deliverables or budget named), pick a broad, strong shortlist anyway and put a short plain phrase naming what is missing in needs_details (e.g. the brand, deliverables and budget), so the draft can ask for it. If something makes you hesitate (for example it reads like mass outreach, or it is mid-booking), still pick, and put one short plain sentence about it in no_pitch_reason as a heads-up for the DFT teammate. Otherwise leave both empty.",
    "- SCAMS (Tom, 19 Oct 2026): if the email is very likely a scam or fake sponsorship, set scam to true and give one plain sentence naming the signs in scam_reason. Signs: a well-known brand writing from a free mail address or a lookalike domain, asking creators to download an installer or file, moving the talk to WhatsApp, Telegram or WeChat, asking for an upfront fee, or payment by gift card or crypto. Ordinary agency or mass outreach is not a scam. Otherwise scam is false.",
    "",
    "Return ONLY JSON, no prose:",
    "{\"brand\":\"\",\"ai_product\":false,\"product\":\"\",\"opener\":\"\",\"title\":\"short list name naming the IP, game, film, show or product being promoted (and the release or season if there is one), e.g. Transformers: Eternal War, Ghost Soldier, EXT (Exterminauts). NEVER the agency, network or the sender's company\",\"contact_first_name\":\"the sender's first name if known, else empty\",\"angles\":[\"\"],\"mix\":\"\",\"answer\":\"\",\"stage\":\"new\",\"closing\":false,\"formats\":[],\"questions\":[{\"q\":\"short paraphrase\",\"answer\":\"\"}],\"picks\":[{\"id\":\"\",\"named\":false,\"fit\":4,\"why\":\"max 6 words\"}],\"scam\":false,\"scam_reason\":\"\",\"no_pitch_reason\":\"\",\"needs_details\":\"\"}"
  ].join("\n");
}

async function pitchItem(id, fromEmail) {
  const d = await monday("query($i:[ID!]){items(ids:$i){id name created_at board{id} column_values(ids:[\"" + PB.by + "\",\"" + PB.result + "\"]){id text}}}", { i: [String(id || "0")] });
  const it = d && d.items && d.items[0];
  if (!it || String(it.board && it.board.id) !== String(PITCH_BOARD)) throw new Error("Unknown pitch request");
  if (Date.now() - Date.parse(it.created_at) > 15 * 60 * 1000) throw new Error("Pitch request is too old");
  const cv = {}; (it.column_values || []).forEach(c => { cv[c.id] = String(c.text || ""); });
  if (cv[PB.result]) throw new Error("Pitch request already used");
  // Claim it now (audit 19 Oct 2026): a Make retry while this run is working sees "Working" and stops, instead of a second list and draft.
  await monday("mutation($b:ID!,$i:ID!,$v:JSON!){change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id}}", { b: String(PITCH_BOARD), i: String(it.id), v: JSON.stringify({ [PB.result]: "Working on it..." }) }).catch(() => null);
  const by = cv[PB.by].trim().toLowerCase();
  if (!/@digitalfoxtalent\.com$/.test(by) || by !== String(fromEmail || "").trim().toLowerCase()) throw new Error("Pitch request does not match the forwarder");
  return it;
}
async function pitchMark(id, result, url) {
  const v = {}; v[PB.result] = result; if (url) v[PB.list] = { url, text: "Open list" };
  await monday("mutation($b:ID!,$i:ID!,$v:JSON!){change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id}}", { b: String(PITCH_BOARD), i: String(id), v: JSON.stringify(v) });
}

// Several pitches from one forward (Tom, 19 Oct 2026, Mediacube: "Can you prepare 2 pitches? One for each of these please?").
// A note like that splits the email into its campaigns; each gets its own list, and one reply draft carries every list.
const SEVERAL_RE = /\b(\d+|two|three|four|both|separate)\s+(separate\s+)?(pitch(es)?|lists|shortlists)\b|\bone (pitch |list )?(for|per) each\b|\bpitch(es)? for (each|both)\b|\bseparate (pitch(es)?|lists?)\b/i; // audit 19 Oct 2026: "Need 10+ creators on the list" no longer splits
const wantsSeveral = note => SEVERAL_RE.test(String(note || ""));
// The reply for a lists-only forward (see pitchFromEmail): Make emails this to the sender instead of making a draft.
function listsOnlyResult(f, lists, failed) {
  const subj = String(f.subject || "your request").replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "").trim();
  const html = "<p><b>Your " + (lists.length > 1 ? lists.length + " lists are" : "list is") + " ready.</b> Nobody outside DFT was in this email, so no reply draft was made.</p><ul>" +
    lists.map(l => '<li><a href="' + escH(l.url) + '">' + escH(l.title) + "</a>: " + l.placements + " placements</li>").join("") + "</ul>" +
    (failed && failed.length ? "<p>Not made: " + escH(failed.join("; ")) + "</p>" : "") +
    "<p>For a reply draft as well, forward the brand's own email to pitch@ with your note on top.</p>";
  const text = "Your lists are ready. Nobody outside DFT was in this email, so no reply draft was made.\n\n" + lists.map(l => l.title + " (" + l.placements + " placements): " + l.url).join("\n");
  return { ok: true, listsOnly: true, draftMade: true, lists, listUrl: lists[0].url, title: lists.map(l => l.title).join(" + "), placements: lists.reduce((a, l) => a + l.placements, 0), to: "", cc: "", search: "", subject: "Lists ready: " + subj, html, text };
}
async function splitCampaigns(f) {
  const prompt = [
    "A DFT teammate forwarded a brand email to a creator talent agency and asked for a separate pitch for each campaign in it.",
    "TEAMMATE'S NOTE: " + String(f.note || ""),
    "SUBJECT: " + String(f.subject || ""),
    "THE EMAIL (newest message first, then the earlier thread):",
    String(f.body || "").slice(0, 9000),
    f.thread ? "THE WHOLE GMAIL THREAD (oldest first):\n" + String(f.thread).slice(-9000) : "",
    "",
    "List each distinct campaign, product or game the brand wants creators for, as the brand describes it in its newest message (use the earlier thread only to fill in details). At most 4. For each give name (the game, product or brand as people say it, e.g. War Thunder) and brief (one to three plain sentences of what the brand says it wants for that campaign: formats, audience, markets, timing, numbers; empty if it says nothing).",
    "Return ONLY JSON: {\"campaigns\":[{\"name\":\"\",\"brief\":\"\"}]}"
  ].join("\n");
  const o = await askClaude(prompt).catch(() => null);
  const seen = new Set();
  return ((o && Array.isArray(o.campaigns)) ? o.campaigns : []).map(c => ({ name: noDash(String((c && c.name) || "").trim()).slice(0, 80), brief: noDash(String((c && c.brief) || "").replace(/\s+/g, " ").trim()).slice(0, 900) }))
    .filter(c => c.name && !seen.has(c.name.toLowerCase()) && seen.add(c.name.toLowerCase())).slice(0, 4);
}

// A forward of the pipeline's own "No pitch draft" notice (Tom, 19 Oct 2026, Nanoleaf: he replied "Yes, please include
// more creators" by forwarding the notice, and the draft went to theteam@ as "Hi The,"). The notice carries no brand
// email, so the original forward to pitch@ is found in the forwarder's mailbox and used, with the new note on top.
const NOTICE_RE = /^\s*((re|fwd?|fw)\s*:\s*)*no pitch draft\s*:/i;
function gmailPart(p, mime) {
  if (!p) return "";
  if (p.mimeType === mime && p.body && p.body.data) return Buffer.from(String(p.body.data), "base64url").toString("utf8");
  for (const c of p.parts || []) { const t = gmailPart(c, mime); if (t) return t; }
  return "";
}
async function recoverNotice(b, f, fromEmail) {
  const orig = String(f.subject || "").replace(NOTICE_RE, "").trim(), w = subjectWords(orig);
  if (!w) return null;
  const tok = await gmailToken(fromEmail); if (!tok) return null;
  const G = path => fetch("https://gmail.googleapis.com/gmail/v1/users/me" + path, { headers: { Authorization: "Bearer " + tok } }).then(r => r.ok ? r.json() : {}).catch(() => ({}));
  // The forward is usually in the bin by now (it leaves the brand thread once the draft is made), so search everywhere.
  const q = "in:anywhere from:me {to:pitch@digitalfoxtalent.com to:press@digitalfoxtalent.com} subject:(" + w + ") -subject:(\"No pitch draft\") newer_than:14d";
  const hit = ((await G("/messages?maxResults=1&includeSpamTrash=true&q=" + encodeURIComponent(q))).messages || [])[0];
  if (!hit) return null;
  const m = await G("/messages/" + hit.id + "?format=full");
  const text = gmailPart(m.payload, "text/plain"), html = gmailPart(m.payload, "text/html");
  const at = text.search(/-{3,}\s*Forwarded message\s*-{3,}|Begin forwarded message:/i);
  if (at < 0) return null;
  const subj = (((m.payload || {}).headers || []).find(h => /^subject$/i.test(h.name)) || {}).value || orig;
  return Object.assign({}, b, { subject: subj, text: (f.note ? f.note + "\n\n" : "") + text.slice(at), html });
}

// The whole Gmail thread (Tom, 19 Oct 2026: "We need a system that looks at the whole thread and prepares it based on
// that"). A forward only carries what Gmail quoted, which often misses earlier replies from DFT or the brand. The forward
// to pitch@ sits in the brand's thread, so that thread is read from the forwarder's mailbox, oldest message first, each
// message without its own quoted history. Any failure simply means the forward alone is used.
async function fetchThread(fromEmail, f) {
  const tok = await gmailToken(fromEmail); if (!tok) return "";
  const G = path => fetch("https://gmail.googleapis.com/gmail/v1/users/me" + path, { headers: { Authorization: "Bearer " + tok } }).then(r => r.ok ? r.json() : {}).catch(() => ({}));
  const w = subjectWords(f.subject);
  const qs = [pitchSearch(f).replace(/^in:sent /, "in:anywhere from:me "), w && f.contactEmail ? "in:anywhere from:" + f.contactEmail + " subject:(" + w + ") newer_than:180d" : ""].filter(Boolean);
  let threadId = "";
  for (const q of qs) { const hit = ((await G("/messages?maxResults=1&includeSpamTrash=true&q=" + encodeURIComponent(q))).messages || [])[0]; if (hit) { threadId = hit.threadId; break; } }
  if (!threadId) return "";
  const t = await G("/threads/" + threadId + "?format=full");
  const hdr = (m, n) => ((((m.payload || {}).headers || []).find(h => h.name.toLowerCase() === n)) || {}).value || "";
  const msgs = (t.messages || []).filter(m => !(m.labelIds || []).includes("DRAFT") && !/(pitch|press)@digitalfoxtalent\.com/i.test(hdr(m, "to")));
  const parts = msgs.map(m => {
    let body = gmailPart(m.payload, "text/plain") || htmlToText(gmailPart(m.payload, "text/html"));
    const cut = body.search(/\n[ \t>]*On [^\n]{6,200}(\n[^\n]{0,80})?wrote:|\n-{3,}\s*(Forwarded|Original) message|\nFrom:[^\n]*\n(Sent|Date):/i);
    if (cut > 0) body = body.slice(0, cut);
    body = body.replace(/\n{3,}/g, "\n\n").trim().slice(0, 2500);
    return body ? "FROM: " + hdr(m, "from") + " | TO: " + hdr(m, "to") + " | DATE: " + hdr(m, "date") + "\n" + body : "";
  }).filter(Boolean);
  let out = parts.join("\n\n-----\n\n");
  if (out.length > 14000) out = "(earlier messages cut for length)\n\n" + out.slice(out.length - 14000);
  return parts.length > 1 ? out : ""; // a single message adds nothing to what the forward already holds
}

// One reply draft for several pitches: a line and a link per campaign, then one ask (Tom's template shape).
function composeMulti(subs, fwdName) {
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const n = subs.length, s0 = subs[0];
  const intro = pick(n === 2 ? ["Thanks for clarifying the two campaigns, I've put a separate list together for each.", "Thanks for explaining, here's a separate list for each of the two campaigns.", "Thanks for clarifying, I've pulled together a list for each campaign."] : ["Thanks for clarifying, here's a separate list for each campaign.", "Thanks for explaining, I've put a list together for each campaign."]);
  const lines = [p => "For " + p.product + ", here's a shortlist of creators" + (p.mix ? " across " + p.mix : "") + " who'd suit it well.", p => "For " + p.product + ", I've put together creators" + (p.mix ? " across " + p.mix : "") + " who'd be a great fit.", p => "And for " + p.product + ", here are creators" + (p.mix ? " across " + p.mix : "") + " who I think would work really well."];
  const off = Math.floor(Math.random() * lines.length); // a different sentence for each campaign, so the email does not repeat itself
  const blocks = subs.map((s, i) => ({ line: lines[(off + i) % lines.length](s).replace(/^And for/, i === 0 ? "For" : "And for"), url: s.listUrl, linkText: s.linkText }));
  // One availability line however many campaigns said it (19 Oct 2026: the first combined draft said it twice).
  let availSaid = false;
  const answers = [...new Set([].concat(...subs.map(s => String(s.answer || "").split(/(?<=[.!?])\s+/))).map(x => x.trim()).filter(Boolean))].filter(x => { if (!/availab|posting dates/i.test(x)) return true; if (availSaid) return false; availSaid = true; return true; }).join(" ");
  const ask = "Who would you like to book for each campaign?"; // the standing close for two campaigns (Standing lessons item, 19 Oct 2026)
  const sig = ["Warm regards", fwdName, "Digital Fox Talent", "\u{1F98A}"];
  const html = "<div dir=\"ltr\">Hi " + escH(s0.first) + ",<br><br>" + escH(intro) + "<br><br>" + blocks.map(x => escH(x.line) + "<br><br><a href=\"" + x.url + "\">" + escH(x.linkText) + "</a>").join("<br><br>") + (answers ? "<br><br>" + escH(answers) : "") + "<br><br>" + escH(ask) + "<br><br>" + sig.map(escH).join("<br>") + "</div>";
  const text = "Hi " + s0.first + ",\n\n" + intro + "\n\n" + blocks.map(x => x.line + "\n\n" + x.url).join("\n\n") + (answers ? "\n\n" + answers : "") + "\n\n" + ask + "\n\n" + sig.join("\n");
  return { html: html + s0.quoteHtml, text: text + s0.quoteText };
}

async function pitchFromEmail(b) {
  const fromEmail = String(b.fromEmail || "").trim().toLowerCase();
  routedSearch(b); // a bad routed search fails here, before any list is made
  if (!b.sub) await pitchItem(b.item, fromEmail);
  try {
    let f = parseForward(b);
    if (!b.sub && !b.outreach && NOTICE_RE.test(f.subject)) {
      const rb = await recoverNotice(b, f, fromEmail).catch(() => null);
      if (!rb) throw new Error("No list made: that was the system's own notice, and the brand's original email could not be found from it. Forward the brand's own email to pitch@ with your note above it.");
      b = rb; f = parseForward(b);
    }
    // Mail to a DFT Google Group (Tom, 19 Oct 2026, Frogge via brands@): the forward only shows "'Grant' via Brands
    // <brands@...>", so the draft was addressed to our own group. The real sender is in the original's Reply-To.
    let groupWhy = ""; if (DFT_DOMAIN.test(f.contactEmail || "")) { const real = await groupSender(f, fromEmail).catch(e => { groupWhy = String((e && e.message) || e).slice(0, 160); return ""; }); if (!real && !groupWhy) groupWhy = "no outside sender in the original's headers"; if (real) { f.contactEmail = real; f.quoteEmail = f.quoteEmail && DFT_DOMAIN.test(f.quoteEmail) ? real : f.quoteEmail; } }
    // Lists only (Tom, 19 Oct 2026, after Margot's IZEA forward: three briefs she wrote to herself, "there's nobody to
    // draft the email for"). When nobody outside DFT wrote the email (nothing forwarded, only DFT addresses, or the
    // sender's own personal address), the lists are made, one per brief, and their links go back to the sender. No draft.
    if (!b.outreach && !b.sub && !b.listsOnly) {
      const nm = x => String(x || "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
      const me = nm(b.fromName).split(" ").filter(w => w.length >= 2);
      const local = String(f.contactEmail || "").split("@")[0].toLowerCase().replace(/[^a-z]/g, "");
      const mine = me.length >= 2 && (nm(f.quoteName || f.contactName) === me.join(" ") || me.every(w => local.includes(w)));
      if (!f.contactEmail || DFT_DOMAIN.test(f.contactEmail) || mine) b = Object.assign({}, b, { listsOnly: true });
    }
    if (b.listsOnly) f = Object.assign({}, f, { contactEmail: "", contactName: "" });
    // Never a draft to ourselves: a DFT address is never the brand (Tom, 19 Oct 2026, "Hi The,").
    if (!b.listsOnly && DFT_DOMAIN.test(f.contactEmail || "")) throw new Error("No list made: no brand email address was found in the forward. Forward the brand's own email to pitch@ with your note above it." + (groupWhy ? " (Group lookup: " + groupWhy + ")" : ""));
    if (!b.outreach && b.thread === undefined) b = Object.assign({}, b, { thread: await fetchThread(fromEmail, f).catch(() => "") });
    f = Object.assign({}, f, { thread: String(b.thread || "") });
    if (!b.sub && !b.outreach && (wantsSeveral(f.note) || b.listsOnly)) {
      const camps = await splitCampaigns(f);
      if (camps.length >= 2) {
        const settled = await Promise.allSettled(camps.map(c => pitchFromEmail(Object.assign({}, b, { sub: c }))));
        const subs = settled.filter(x => x.status === "fulfilled").map(x => x.value);
        const failed = camps.map((c, i) => ({ c, s: settled[i] })).filter(x => x.s.status !== "fulfilled").map(x => x.c.name + " (" + String((x.s.reason && x.s.reason.message) || "failed").slice(0, 160) + ")");
        if (!subs.length) { b = Object.assign({}, b, { multiFailed: failed.join("; ") }); } else {
        if (b.listsOnly) {
          await pitchMark(b.item, "Lists only (no brand to reply to): " + subs.map(s => s.title + ", " + s.placements + " placements").join("; ") + " (" + subs[0].model + ")" + (failed.length ? ". Not made: " + failed.join("; ") : ""), subs[0].listUrl);
          return listsOnlyResult(f, subs.map(s => ({ title: s.title, url: s.listUrl, placements: s.placements })), failed);
        }
        const fwdName0 = String(b.fromName || "").replace(/["<>]/g, "").trim() || fromEmail.split("@")[0];
        const mail = subs.length >= 2 ? composeMulti(subs, fwdName0) : { html: subs[0].html, text: subs[0].text };
        const todo = [...new Set([].concat(...subs.map(s => s.unanswered || [])))];
        await pitchMark(b.item, "Ready: " + subs.length + " pitches. " + subs.map(s => s.title + ", " + s.placements + " placements").join("; ") + " (" + subs[0].model + ")" + (failed.length ? ". Not made: " + failed.join("; ") : "") + subs.filter(s => s.headsUp).map(s => ". Heads-up on " + s.title + ": " + s.headsUp).join("") + (todo.length ? ". Brand also asked (not answered in the draft): " + todo.join("; ") : ""), subs[0].listUrl);
        const s0 = subs[0];
        const resultObj = { ok: true, listUrl: s0.listUrl, lists: subs.map(s => ({ title: s.title, url: s.listUrl, placements: s.placements })), title: subs.map(s => s.title).join(" + "), placements: subs.reduce((a, s) => a + s.placements, 0), to: s0.to, cc: s0.cc, subject: s0.subject, search: s0.search, html: mail.html, text: mail.text, model: s0.model, picks: [].concat(...subs.map(s => s.picks || [])), research: null, stage: "new", closing: false, questions: [].concat(...subs.map(s => s.questions || [])), reviewed: subs.map(s => s.reviewed).filter(Boolean).join("; "), reused: "", press: !!s0.press, unanswered: todo, notMade: failed };
        resultObj.unansweredHtml = todo.length ? "<p>Your pitch draft to " + escH(s0.to) + " is ready (subject: " + escH(s0.subject) + ").</p><p>The brand also asked these, which the standing facts do not cover. Reply on these yourself, or add your answers to the draft before you send:</p><ul>" + todo.map(q => "<li>" + escH(q) + "</li>").join("") + "</ul>" : "";
        // Kept for the nightly learner (api/pitch-learn.js), as for a single pitch.
        await monday("mutation($b:ID!,$i:ID!,$v:JSON!){change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id}}", { b: String(PITCH_BOARD), i: String(b.item), v: JSON.stringify({ [PB.draft]: { text: String(mail.text).slice(0, 9000) }, [PB.check]: [fromEmail, s0.to, new Date().toISOString()].join("|") }) }).catch(() => null);
        resultObj.draftMade = await teamDraft(fromEmail, resultObj).catch(e => "failed: " + String((e && e.message) || e).slice(0, 200));
        await draftLogUpdate(b.item, resultObj, resultObj.draftMade).catch(() => null);
        delete resultObj.draftLog;
        if (resultObj.draftMade && resultObj.draftMade !== true) await pitchMark(b.item, "Lists ready but " + draftNote(resultObj.draftMade) + ". " + subs.map(s => s.title + ": " + s.listUrl).join("; "), s0.listUrl).catch(() => null);
        return resultObj;
        } // every campaign pass failed: carry on as one combined pitch below
      }
    }
    // Press packages from the pipeline (Tom, 16 Oct 2026): a note above the forward that says "press"
    // (or "earned media") makes a press package, with no prices, and a draft worded for one.
    // Or forwarded to press@ (Tom, 16 Oct 2026: "Press and Pitch are different"): Make passes the To and Cc addresses as sentTo.
    const press = (/\bpress (package|pitch|list|junket|kit)\b|earned media|^\s*press\b(?!\s+release)/i.test(f.note || "") && !/\bno press\b|\bnot (a )?press\b/i.test(f.note || "")) || /(^|[\s,<])press@digitalfoxtalent\.com/i.test(String(b.sentTo || "")); // audit 19 Oct 2026
    // Tom's pointers (13 Oct 2026): the note above each forward is kept on the Pitch Requests board and fed into later pitches, so the system learns from them.
    // One campaign of several (Tom, 19 Oct 2026): this pass pitches that campaign alone. The wording avoids "only these",
    // "more creators" and "new list", which mean something else further down.
    if (b.sub) f = Object.assign({}, f, { note: "This pitch is for the " + b.sub.name + " campaign alone; leave the other campaign in the email aside." + (b.sub.brief ? " What the brand says it wants for " + b.sub.name + ": " + b.sub.brief : "") + (String(f.note || "").replace(SEVERAL_RE, "").replace(/\s+/g, " ").trim().length > 12 ? " The teammate's note: " + String(f.note).replace(/\s+/g, " ").trim().slice(0, 600) : "") });
    if (f.note && !b.outreach && !b.sub) await monday(`mutation{change_multiple_column_values(board_id:${PITCH_BOARD},item_id:${Number(b.item)},column_values:${JSON.stringify(JSON.stringify({ long_text_mm83jwpf: { text: f.note } }))}){id}}`).catch(() => null);
    const pastQ = await monday(`query{boards(ids:[${PITCH_BOARD}]){items_page(limit:200){items{id column_values(ids:["long_text_mm83jwpf"]){text}}}}}`).catch(() => null);
    const pointers = (((((pastQ || {}).boards || [])[0] || {}).items_page || {}).items || []).filter(it => String(it.id) !== String(b.item) && String(it.id) !== String(FACTS_ITEM) && String(it.id) !== String(PLAYBOOK_ITEM) && String(it.id) !== String(RECRUIT_LESSONS_ITEM) && String(it.id) !== String(PITCH_LESSONS_ITEM)).map(it => String(((it.column_values || [])[0] || {}).text || "").trim()).filter(p => p && !/^(warm|kind|best) regards/i.test(p) && !/^\s*(press|press (package|list|pitch|junket)|earned media)[\s.!]*$/i.test(p) && !wantsSeveral(p)).filter((p, i, a) => a.indexOf(p) === i).slice(-30);
    if ((!f.contactEmail && !b.listsOnly) || f.body.length < 40) throw new Error("No forwarded enquiry found. Forward the brand's own email.");
    const factsQ = await monday(`query{items(ids:[${FACTS_ITEM}]){column_values(ids:["long_text_mm83jwpf"]){text}}}`).catch(() => null);
    const facts = String(((((factsQ || {}).items || [])[0] || {}).column_values || [{}])[0].text || "").trim();
    const lessonsQ = await monday(`query{items(ids:[${PITCH_LESSONS_ITEM}]){column_values(ids:["long_text_mm83jwpf"]){text}}}`).catch(() => null);
    const lessons = String(((((lessonsQ || {}).items || [])[0] || {}).column_values || [{}])[0].text || "").split("\n").map(x => x.replace(/^[-\s]+/, "").trim()).filter(Boolean).slice(0, 25);
    const data = await loadBoard();
    const cat = pitchCatalogue(data, press);
    // Brand fit notes (Rates board column, Tom 14 Oct 2026): DFT's own judgement on who each creator suits, applied to all of that creator's formats.
    const fitQ = await monday(`query{boards(ids:[${BOARD}]){items_page(limit:500){items{id name column_values(ids:["long_text_mm84rm3j","text_mm49w81b"]){id text}}}}}`).catch(() => null);
    const fitKey = k => String(k || "").replace(/\s*-\s*(Shorts|Instagram|TikTok|Snapchat|Dedicated)\b.*$/i, "").replace(/^@/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const fitBy = {};
    (((((fitQ || {}).boards || [])[0] || {}).items_page || {}).items || []).forEach(it => { const cv = {}; (it.column_values || []).forEach(c => { cv[c.id] = c.text || ""; }); const t = String(cv.long_text_mm84rm3j || "").replace(/\s+/g, " ").trim(); if (!t) return; [it.name, cv.text_mm49w81b].forEach(k => { const n = fitKey(k); if (n.length >= 4) fitBy[n] = t; }); });
    const fitOf = id => { const c = cat.byId[id] || {}; for (const k of [fitKey(c.name), fitKey(c.handle)]) if (k && fitBy[k]) return fitBy[k]; return ""; };
    const fitLines = cat.lines.map(l => { const n = fitOf(l.split(" | ")[0]); return n ? l + " | DFT FIT NOTE: " + n : l; });
    // AI campaigns (Tom, 13 Oct 2026): only creators on the AI_LIST saved list are open to AI brands.
    // Read twice before giving up (audit 19 Oct 2026): a failed read silently switched the AI-only rule off.
    let aiL = (await freshList(AI_LIST).catch(() => ({}))).list;
    if (!aiL || aiL.bad) aiL = (await new Promise(r => setTimeout(r, 800)).then(() => freshList(AI_LIST)).catch(() => ({}))).list;
    const aiIds = new Set(((aiL && aiL.body && aiL.body.ids) || []).map(String));
    const aiKey = id => String((cat.byId[id] || {}).name || "").toLowerCase().trim();
    const aiNameSet = new Set([...aiIds].map(aiKey).filter(Boolean));
    const aiOk = id => aiIds.has(String(id)) || aiNameSet.has(aiKey(id));
    const aiNames = [...new Set([...aiIds].map(id => (cat.byId[id] || {}).name).filter(Boolean))];
    // Creators the enquiry names (or was sent to) are always on the list, even on AI campaigns (Tom, 13 Oct 2026).
    const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""), base = s => String(s || "").replace(/\s*-\s*(Shorts|Instagram|TikTok|Snapchat|Dedicated).*$/i, "");
    // The newest message only (Tom, 14 Oct 2026, NETA AI): quoted history below it is context, and a creator inbox in the To line only names that creator on a first enquiry.
    const fwdHead0 = String(f.body).split(/\n[ \t]*\n/)[0] || "", afterHead = String(f.body).slice(fwdHead0.length);
    const hm = afterHead.search(/\n[ \t>*\-]*(on \d{4}-\d\d-\d\d[^\n]{0,80}wrote|On [^\n]{6,160}(\n[^\n]{0,80})?wrote:|-{3,}\s*Original Message|From:[^\n]*\n[ \t>*\-]*(Sent|Date):)/i);
    const hasHistory = hm >= 0, latest = hasHistory ? afterHead.slice(0, hm) : afterHead;
    const hay = norm(latest + (hasHistory ? "" : " " + f.to)); // names in the pointer are left to the model, so "leave out X" never forces X in
    // Names count on word boundaries, or as a whole @handle (audit 19 Oct 2026: "a better gaming experience" named Better Gaming).
    // In a campaign pass only names in that campaign's own brief count, so one campaign's creator is not forced onto the other.
    const esc0 = x => String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const spaced = s => " " + String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";
    const nameTxt = b.sub ? String(b.sub.brief || "") + " " + String(b.sub.name || "") : latest + (hasHistory ? "" : " " + f.to);
    const haySp = spaced(nameTxt), hayTok = new Set(String(nameTxt).toLowerCase().split(/[^a-z0-9_.]+/).map(t => t.replace(/[^a-z0-9]/g, "")).filter(t => t.length >= 5));
    // A multi-word name made of ordinary words counts only when written as a name: each word capitalised, as on the roster, or in capitals.
    const asName = (raw, nm) => { const ws = String(nm).replace(/^@/, "").split(/[^A-Za-z0-9]+/).filter(Boolean); if (ws.length < 2) return true; const re = new RegExp("(^|[^A-Za-z0-9])" + ws.map(w => esc0(w)).join("[^A-Za-z0-9]+") + "(?=$|[^A-Za-z0-9])", "gi"); let m; while ((m = re.exec(raw))) { const hit = m[0].replace(/^[^A-Za-z0-9]/, ""); if (hit.split(/[^A-Za-z0-9]+/).filter(Boolean).every(w => /^[A-Z0-9]/.test(w))) return true; } return false; };
    const namedPl = Object.keys(cat.byId).filter(id => { const nm = base(cat.byId[id].name), n = spaced(nm), h = norm(cat.byId[id].handle); return (n.trim().length >= 5 && haySp.includes(n) && asName(nameTxt, nm)) || (h.length >= 5 && hayTok.has(h)) || (norm(nm).length >= 8 && [norm(nm), norm(nm).replace(/s$/, ""), norm(nm) + "s"].some(t => hayTok.has(t))); }); // singular or plural run together too (Tom, 20 Oct 2026: "Hi Reelreject & Team!" missed The Reel Rejects)
    const namedNames = []; namedPl.map(id => base(cat.byId[id].name).replace(/^@/, "")).sort((a, b) => b.length - a.length).forEach(nm => { const k = norm(nm); if (!namedNames.some(x => norm(x).startsWith(k) || k.startsWith(norm(x)))) namedNames.push(nm); });
    const nameOf = id => { const k = norm(base(cat.byId[id].name).replace(/^@/, "")); return namedNames.find(x => norm(x).startsWith(k) || k.startsWith(norm(x))) || ""; };
    const fwdName = String(b.fromName || "").replace(/["<>]/g, "").trim() || fromEmail.split("@")[0];
    // Brand research first (Tom, 14 Oct 2026): the brand's own site and the creators it has partnered with before.
    const research = await brandResearch(f, latest).catch(() => null);
    const researchTxt = research ? JSON.stringify(research).slice(0, 2500) : "";
    const prompt = pitchPrompt(f, fitLines, fwdName, aiNames, namedNames, pointers, facts, researchTxt, press);
    let out = await askClaude(prompt);
    // Likely scams get a warning back, not a list or a draft (Tom, 19 Oct 2026, a fake Filmora sponsorship: "Just send a
    // warning back please on those in the future"). A note saying it is genuine ("pitch anyway") overrides.
    if (out && out.scam === true && !b.listsOnly && !/pitch (it )?anyway|genuine|legit|not a scam|real (brand|offer|deal)|verified/i.test(f.note || "")) throw new Error("No list made: this looks like a scam. " + noDash(String(out.scam_reason || "It shows the usual signs of a fake sponsorship").trim()).replace(/[.\s]+$/, "") + ". Please do not download anything or reply with details. If you know it is genuine, forward it again with \"pitch anyway\" above it.");
    const firstWhy = String(out.no_pitch_reason || "").trim(); // kept as a heads-up even when the retry picks (audit 19 Oct 2026)
    // No picks and no reason is never the answer to an enquiry (Tom, 19 Oct 2026, Nanoleaf): ask once more, firmly.
    const usable = o => (o.picks || []).some(p => p && (p.named === true || !(Number(p.fit) < 3)));
    if (!usable(out)) {
      const again = await askClaude(prompt + "\n\nYour first answer picked no creators. That is never the right answer: this enquiry is an opportunity to recommend creators: pick every creator on the roster who would genuinely suit it (fit 3 or above), aiming for at least 10. If nobody is an obvious fit, still return the 10 closest creators with honest fit scores (2 is fine). Return the same JSON.").catch(() => null);
      if (again && usable(again)) out = again;
      else if (again && (again.picks || []).length && !(out.picks || []).length) out = again;
    }
    // Still nobody at fit 3 (Tom, 19 Oct 2026, Nanoleaf, refused twice): the closest creators go on the list anyway, best first,
    // and the row says the fit is weak. Refusing is never the answer to a forward.
    const lowFit = !usable(out) && (out.picks || []).length > 0;
    if (lowFit) out.picks = (out.picks || []).filter(p => p && p.id).sort((a, b) => (Number(b.fit) || 0) - (Number(a.fit) || 0)).slice(0, 20).map(p => Object.assign({}, p, { fit: Math.max(3, Number(p.fit) || 0) }));
    const order = GROUPS.map(g => g.id);
    // AI campaigns are the model's call on the product, not any mention of "AI" in the email (Tom, 15 Oct 2026: RayNeo AR glasses
    // "touches on AI but isn't a completely AI focussed product", and got an AI-only list).
    const aiCamp = aiIds.size > 0 && out.ai_product === true;
    const namedIds = new Set((out.picks || []).filter(p => p && p.named === true).map(p => String(p.id)));
    // A creator the model marks named counts as named even when the email spells them differently (Tom, 20 Oct 2026: a brand
    // that asked for The Reel Rejects specifically got a generic reply with no Reel Rejects rates in it). Their rates then go in
    // the email itself, as for any creator the brand asks about.
    namedIds.forEach(id => { if (!cat.byId[id] || nameOf(id)) return; const nm = base(cat.byId[id].name).replace(/^@/, ""), k = norm(nm); if (k.length < 4) return; namedNames.push(nm); Object.keys(cat.byId).forEach(x => { if (norm(base(cat.byId[x].name).replace(/^@/, "")) === k && !namedPl.includes(x)) namedPl.push(x); }); });
    const ids = [...new Set((out.picks || []).filter(p => p && (p.named === true || !(Number(p.fit) < 3))).map(p => String(p && p.id)).filter(id => cat.byId[id] && (!aiCamp || aiOk(id) || namedIds.has(id))))];
    const picked0 = ids.slice(); // the model's picks before the format, market and pointer checks (for the fallback below)
    // Only formats the enquiry asks for: dedicated and social placements need to be named; integrations and Shorts are the default.
    const wantF = { dedicated: /dedicated|full video|standalone video/i, live: /live ?stream|\blive\b|twitch/i, group_mm4a1fe0: /instagram|\binsta\b|\bIG\b|\breels?\b/i, group_mm4bd5tk: /tik ?tok/i, group_mm7yw8cy: /snap ?chat/i };
    // Formats strictly as the brand states them; nothing stated means YouTube, integration plus Shorts (Tom, 14 Oct 2026).
    const FMAP = { integration: "topics", youtube: "topics", youtubeintegration: "topics", dedicated: "dedicated", live: "live", livestream: "live", youtubelive: "live", twitch: "live", shorts: "group_mm4av3kr", youtubeshorts: "group_mm4av3kr", instagram: "group_mm4a1fe0", reels: "group_mm4a1fe0", ig: "group_mm4a1fe0", tiktok: "group_mm4bd5tk", snapchat: "group_mm7yw8cy" };
    const askedG = new Set((Array.isArray(out.formats) ? out.formats : []).map(x => FMAP[String(x || "").toLowerCase().replace(/[^a-z]/g, "")]).filter(Boolean));
    if (press && askedG.delete("live")) askedG.add("topics");
    if (press && askedG.delete("dedicated")) askedG.add("topics"); // press packages have no dedicated videos: the channel itself stands in
    if (!askedG.size) { askedG.add("topics"); askedG.add("group_mm4av3kr"); }
    for (let k = ids.length - 1; k >= 0; k--) if (!askedG.has(cat.byId[ids[k]].gid)) ids.splice(k, 1);
    const bt = (f.body + " " + f.note).replace(/https?:\/\/\S+|<[^>\s]+>/g, " "), socialOnly = [wantF.group_mm4a1fe0, wantF.group_mm4bd5tk, wantF.group_mm7yw8cy].some(re => re.test(bt)) && !/youtube|\byt\b|integration|\bshorts?\b|dedicated/i.test(bt);
    if (false && socialOnly) for (let k = ids.length - 1; k >= 0; k--) if (["topics", "dedicated", "group_mm4av3kr"].includes(cat.byId[ids[k]].gid)) ids.splice(k, 1);
    const groupsUsed = new Set(ids.map(id => cat.byId[id].gid)); if (!groupsUsed.size) { groupsUsed.add("topics"); groupsUsed.add("group_mm4av3kr"); }
    // A pointer that says to leave a creator out wins over everything else.
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // The exclusion word must sit right before the name (audit 19 Oct 2026: "No rush, but please include X" removed X).
    const leftOut = nm => !!f.note && (new RegExp("\\b(not|no|without|leave out|leave off|exclude|excluding|skip|drop|remove|minus|except)\\s+(the\\s+|@)?" + esc(nm), "i").test(f.note) || new RegExp("\\b(don'?t|do not)\\s+(include|add|use|pitch|put)\\s+(the\\s+|@)?" + esc(nm), "i").test(f.note) || new RegExp(esc(nm) + "[^.\\n]{0,40}\\b(not|isn'?t|aren'?t|doesn'?t|don'?t)\\b[^.\\n]{0,20}\\b(fit|suit|right|work)", "i").test(f.note));
    for (let k = ids.length - 1; k >= 0; k--) if (leftOut(base(cat.byId[ids[k]].name))) ids.splice(k, 1);
    // Past pointers that rule a creator out for a kind of brief are enforced too (Tom, 13 Oct 2026: Badd Medicine is not a fit for family/toy briefs). Creators the enquiry names stay.
    const FIT_TOPICS = ["family", "toy", "kids", "children", "lifestyle", "beauty", "fashion", "finance", "crypto", "tech", "food", "fitness", "horror", "sports", "betting", "gambling", "alcohol"];
    const topicIn = (t, txt) => new RegExp("\\b" + t + "s?\\b", "i").test(String(txt || ""));
    const fitRules = pointers.filter(p => /not (a )?(good |great |right )?fit|(isn'?t|aren'?t) a (good |great |right )?fit|(doesn'?t|don'?t) suit|not suitable|not right for/i.test(p)).filter(p => { const ts = FIT_TOPICS.filter(t => topicIn(t, p)); return ts.length > 0 && ts.some(t => topicIn(t, f.body)); }); // audit 19 Oct 2026: a one-off "X isn't a fit for this one" no longer bans X forever
    const ruledOut = nm => hay.indexOf(norm(nm)) < 0 && fitRules.some(p => new RegExp(esc(nm) + "[^.\\n]{0,40}\\b(not|isn'?t|aren'?t|doesn'?t|don'?t)\\b", "i").test(p));
    for (let k = ids.length - 1; k >= 0; k--) if (ruledOut(base(cat.byId[ids[k]].name))) ids.splice(k, 1);
    // Market limits are enforced here, not left to the model (Tom, 13 Oct 2026: "only available to the Australian market").
    const MARKETS = [["australia", /\baustralia(n)?\b|\baus\b/i], ["new zealand", /new zealand|\bnz\b|kiwi/i], ["united kingdom", /\b(uk|united kingdom|british|britain|england)\b/i], ["canada", /\bcanad(a|ian)\b/i], ["ireland", /\bireland|irish\b/i], ["united states", /\b(us only|usa|united states|american market)\b/i]];
    // A market limit only when the words say so together, e.g. "only available in Australia" or "UK only" (Tom, 19 Oct 2026,
    // Nanoleaf): "only" in the agency's confidentiality footer and "Canada" in its office address made a Canada-only list,
    // which left nobody, so the forward was refused. Read from the note and the newest message, never from quoted history.
    const LIMIT = "(?:only|exclusively|solely|limited to|restricted to)";
    // Footers and signatures are not briefs (audit 19 Oct 2026: "for the named recipient only, Northpeak Media, Vancouver, Canada").
    const briefOnly = txt => String(txt || "").split(/\n/).filter(l => !/confidential|intended (only )?for|recipient|unsubscribe|privacy|registered|office|address|©|copyright|all rights/i.test(l)).join("\n");
    const marketIn = txt0 => { const txt = briefOnly(txt0); return (MARKETS.find(m => /only/i.test((txt.match(m[1]) || [""])[0]) || new RegExp("\\b" + LIMIT + "\\s+(?:to\\s+|in\\s+|for\\s+|available\\s+(?:in|to)\\s+|the\\s+){0,3}(?:" + m[1].source + ")|(?:" + m[1].source + ")[\\s-]{0,3}(?:market\\s+|audiences?\\s+|creators?\\s+)?(?:only|exclusively)\\b", "i").test(txt)) || [])[0] || ""; };
    const market = marketIn(f.note) || marketIn(latest);
    const inMarket = id => { const loc = String(cat.byId[id].location || "").toLowerCase(); return market === "united kingdom" ? /united kingdom|\buk\b|england|scotland|wales/.test(loc) : market === "united states" ? /united states|\busa?\b/.test(loc) : loc.includes(market); };
    if (market) for (let k = ids.length - 1; k >= 0; k--) if (!inMarket(ids[k])) ids.splice(k, 1);
    const aiDeclined = []; // named creators who do not take AI work (unless the enquiry says DFT already confirmed them)
    namedNames.forEach(nm => { if (leftOut(nm)) return; if (market && !namedPl.filter(id => nameOf(id) === nm).some(inMarket)) return; const mine = namedPl.filter(id => nameOf(id) === nm); if (aiCamp && !mine.some(aiOk) && !/confirm/i.test(f.body)) { aiDeclined.push(nm); mine.forEach(id => { const k = ids.indexOf(id); if (k >= 0) ids.splice(k, 1); }); return; } const inG = mine.filter(id => groupsUsed.has(cat.byId[id].gid)); (inG.length ? inG : mine).forEach(id => { if (!ids.includes(id)) ids.push(id); }); });
    // A brand that has already chosen creators gets exactly those back (Tom, 14 Oct 2026, NETA AI).
    // ...unless the forwarder's note asks to widen it (Tom, 14 Oct 2026, NETA AI: "expand the roster on this one").
    const expandAsk = /expand|widen|broaden|broader|more creators|add (some )?more|whole roster|others? too|a lot more/i.test(f.note || "");
    const onlyAsk = /\b(only|just) (these|those|the ones|them)\b/i.test(f.note || "");
    const shortOnly = out.stage === "shortlist" && !expandAsk && (onlyAsk || out.closing === true), expanded = out.stage === "shortlist" && !shortOnly;
    if (shortOnly) { const keep = ids.filter(id => nameOf(id) || namedIds.has(id)); if (keep.length) ids.splice(0, ids.length, ...keep); }
    // Same campaign, same list (Tom, 14 Oct 2026, Dawn Gods): a later enquiry for a product DFT has
    // already pitched gets the list made for it, with any changes the team made since, unless the
    // email asks for something that list does not have: a creator it names who is not on it, a
    // format it has no tab for, a creator the note leaves out, a market limit, an AI brief, or a
    // note asking to widen it or start a new list.
    const ckey = s => String(s || "").replace(/\s*\(.*$/, "").toLowerCase().replace(/\b(the|of|a|an|and)\b/g, " ").replace(/[^a-z0-9]/g, "");
    // A campaign split out of a multi-pitch forward matches an earlier list by its own name only (Tom, 19 Oct 2026, Mediacube:
    // the PixAI pass matched the Fishing Clash list because the email names both, and wrote over it).
    const pKeys = (b.sub ? [ckey(b.sub.name)] : [ckey(out.product), ckey(out.brand), ckey(out.title)]).filter(k => k.length >= 5);
    const mailKey = b.sub ? "" : ckey(f.subject + " " + latest).slice(0, 4000);
    const lastDay = l => ((String(l.by || "") + " " + String(l.updated || "")).match(/\d{4}-\d\d-\d\d/g) || [""]).sort().pop();
    const recent = l => { const d = (String(l.by || "") + " " + String(l.updated || "")).match(/\d{4}-\d\d-\d\d/g) || []; return d.some(x => Date.now() - Date.parse(x) < 120 * 864e5); };
    // Only ever a list made for the same company (Tom, 16 Oct 2026): StarAce's Transformers list went to Dorun Media and
    // Blossom & Wood because the product matched. A list with no record of who it was made for is never reused.
    const org = orgOf(f.contactEmail);
    const prevL = data.lists.filter(l => l.slug && l.slug !== AI_LIST && /\(pitch\)/.test(String(l.by || "")) && recent(l) && !!(l.body && l.body.press) === press && !!org && Array.isArray(l.body && l.body.for) && l.body.for.some(o => sameCo(o, org))).map(l => ({ l, k: ckey(l.name) })).filter(x => x.k.length >= 5 && pKeys.some(k => k === x.k)) // exact campaign name only (audit 19 Oct 2026: "Call of Duty" vs "Black Ops 7", an earlier campaign named in passing)
      .sort((a, b) => lastDay(b.l).localeCompare(lastDay(a.l)))[0];
    let reuse = null, hiddenKeep = [];
    // One list per campaign (Tom, 15 Oct 2026: "update the one we had rather than creating a new version").
    // When the earlier list cannot simply be reused, the new picks go onto THAT list instead of a new one:
    // added to what it already holds (team edits, prices and stages kept), or, for a brand shortlist, a
    // market limit or an AI brief, the list is set to the new picks. Only a note asking for a new list makes one.
    let update = null;
    if (prevL && !/new list|fresh list|start (again|over)|from scratch|different list/i.test(f.note || "")) {
      const pl = (await freshList(prevL.l.slug).catch(() => ({}))).list;
      const pIds = ((pl && !pl.bad && pl.body && pl.body.ids) || []).map(String).filter(id => cat.byId[id]);
      hiddenKeep = ((pl && !pl.bad && pl.body && pl.body.ids) || []).map(String).filter(id => !cat.byId[id]); // team additions the rate card hides
      const pG = new Set(pIds.map(id => cat.byId[id].gid));
      const fmtOk = !(Array.isArray(out.formats) && out.formats.length) || [...askedG].every(g => pG.has(g));
      const namesOk = namedNames.every(nm => pIds.some(id => nameOf(id) === nm));
      const outOk = !pIds.some(id => leftOut(base(cat.byId[id].name)));
      // A campaign split out of a multi-pitch forward always gets fresh picks onto its list: the brand has just set out new criteria for it.
      if (!b.sub && !shortOnly && !expandAsk && !market && !aiCamp && pIds.length && fmtOk && namesOk && outOk) reuse = { slug: pl.slug, title: pl.name, ids: pIds };
      else if (pl && pl.slug && !pl.bad) update = { slug: pl.slug, title: pl.name, ids: pIds, replace: !!(shortOnly || market || aiCamp) };
    }
    if (reuse) ids.splice(0, ids.length, ...reuse.ids);
    // Second pass (Tom, 14 Oct 2026): the list is checked the way Tom would before it is saved. Creators the brand's newest message names always stay.
    let reviewed = "";
    // A note asking to widen the list wins over the review pass (Tom, 19 Oct 2026, Nanoleaf StoryBub: "Let's expand the
    // creators on this one - a lot more could work"). The model picked 31, the review cut 17 for male-skewed audiences and
    // left 14. With an expand note the review is skipped and Tom trims the list himself.
    if (!reuse && !shortOnly && !expandAsk && ids.length > 1) {
      const lineOf = {}; fitLines.forEach(l => { lineOf[l.split(" | ")[0]] = l; });
      const rv = await askClaude(reviewPrompt(f, ids.map(id => lineOf[id] || id), pointers, researchTxt)).catch(() => null);
      const ck = id => norm(base((cat.byId[id] || {}).name || ""));
      const drop = new Set(((rv && rv.remove) || []).map(r => String(r && r.id)).filter(id => cat.byId[id] && !nameOf(id) && !namedIds.has(id)).map(ck)); // never one the note asked for (audit 19 Oct 2026)
      // Never below 10 creators (Tom, 13 Oct 2026): removals apply worst first until the floor is reached, unless a removal is a DFT fit note or pointer.
      const creators = () => new Set(ids.filter(id => !drop.has(ck(id)) || nameOf(id)).map(ck)).size;
      const order = [...drop]; while (order.length && creators() < Math.min(10, new Set(ids.map(ck)).size)) { const last = order.pop(); const why = ((rv && rv.remove) || []).filter(r => cat.byId[String(r && r.id)] && ck(String(r.id)) === last).map(r => String(r.reason || "")).join(" "); if (/fit note|pointer|said|thread/i.test(why)) continue; drop.delete(last); }
      const kept = ids.filter(id => !drop.has(ck(id)) || nameOf(id));
      if (kept.length) { reviewed = ((rv && rv.remove) || []).map(r => (cat.byId[String(r && r.id)] || {}).name + ": " + String((r && r.reason) || "")).join("; "); ids.splice(0, ids.length, ...kept); }
    }
    // Nothing to pitch (Tom, 14 Oct 2026, Alex's Gamesight forward): say why in plain words, and how to get a list anyway.
    const whyNone = noDash(String(out.no_pitch_reason || firstWhy || "").trim()).replace(/[.\s]+$/, "");
    // Never refuse a real enquiry because the checks left nobody (Tom, 19 Oct 2026, Nanoleaf: "We need to make sure this system is
    // robust and flawless"). Fall back, in order, to: the model's picks and the named creators in the formats asked for, then
    // as YouTube integrations and Shorts, then any of their rows, then one more ask for the closest fits. The row says so.
    let fellBack = "";
    if (!ids.length) {
      const keep = id => cat.byId[id] && !leftOut(base(cat.byId[id].name)) && !ruledOut(base(cat.byId[id].name)) && !aiDeclined.includes(nameOf(id)) && (!aiCamp || aiOk(id) || !!nameOf(id));
      const choose = pool => { const p = [...new Set(pool)].filter(keep); const inAsk = p.filter(id => askedG.has(cat.byId[id].gid)), yt = p.filter(id => ["topics", "group_mm4av3kr"].includes(cat.byId[id].gid)); return inAsk.length ? inAsk : yt.length ? yt : p; };
      let alt = choose(picked0.concat(namedPl));
      if (!alt.length) {
        const wide = await askClaude(prompt + "\n\nNo creator came through the checks. Pick the 10 to 15 creators on the roster who come closest to suiting this enquiry, even if the fit is only adjacent (family friendly channels first for a family or kids product), with honest fit scores. Return the same JSON.").catch(() => null);
        alt = choose(((wide && wide.picks) || []).map(p => String(p && p.id)).filter(id => cat.byId[id])).slice(0, 15);
      }
      if (alt.length) {
        ids.push(...alt);
        fellBack = "the format, market and fit checks left no creators" + (market ? " (it read the email as " + market + " only)" : "") + ", so this list is the closest fits" + (alt.some(id => !askedG.has(cat.byId[id].gid)) ? " in the nearest format to the one asked for" : "") + ". Check it before you send";
      }
    }
    // Last resort (audit 19 Oct 2026, Tom: "The system should be robust enough to cope with this"): if the model still picked nobody,
    // the strongest creators on the roster in the formats asked for (AI-open creators only on an AI brief) go on the list, and the row says so.
    if (!ids.length) {
      const keep2 = id => cat.byId[id] && !leftOut(base(cat.byId[id].name)) && (!aiCamp || aiOk(id));
      const pool = Object.keys(cat.byId).filter(keep2), byG = g => pool.filter(id => cat.byId[id].gid === g).sort((x, y) => (Number(cat.byId[y].vg) || 0) - (Number(cat.byId[x].vg) || 0));
      const gs = [...askedG].filter(g => byG(g).length); const top = [].concat(...(gs.length ? gs : ["topics"]).map(g => byG(g).slice(0, 10)));
      if (top.length) { ids.push(...top); fellBack = "nobody was picked for this email, so this is a general shortlist of the strongest creators in the formats asked for. Check it before you send"; }
    }
    if (!ids.length) throw new Error("No list made: " + (whyNone ? whyNone + "." : (out.picks || []).length ? "no creator passed the fit, format and market checks for this brief." : "no creators were picked for this email.") + " To get a list anyway, forward it again with a note above it saying what you want, e.g. 'pitch more creators for this'.");
    if (update && !update.replace) { const keep = update.ids.filter(id => !leftOut(base(cat.byId[id].name))); const had = new Set(keep); ids.splice(0, ids.length, ...keep, ...ids.filter(id => !had.has(id))); }
    if (!reuse) ids.sort((x, y) => order.indexOf(cat.byId[x].gid) - order.indexOf(cat.byId[y].gid));
    // List names focus on the IP or release, never the agency (Tom, 16 Oct 2026, after "Transformers (StarAce)" went to
    // other agencies: "focus on the IP / release"). A bracket naming the sender's company is dropped as a backstop.
    const orgStem = String(org.split("@").pop() || "").split(".")[0].replace(/[^a-z0-9]/g, "");
    const noAgency = t => String(t || "").replace(/\s*\(([^)]*)\)/g, (m, x) => { const k = x.toLowerCase().replace(/[^a-z0-9]/g, ""); return k.length >= 4 && orgStem.length >= 4 && (orgStem.includes(k) || k.includes(orgStem)) ? "" : m; }).trim();
    const title = (reuse ? reuse.title : update ? update.title : noDash(noAgency(out.title) || out.product || f.subject || "Pitch").slice(0, 70)).replace(/[\[\]{}<>]/g, "").trim() || "Pitch";
    // Libsyn Ads pitches (Tom, 16 Oct 2026): YouTube integrations at a $28 CPM, and the Libsyn sub report in the draft.
    const libsyn = isLibsyn(f) && !press;
    const saved = reuse ? { ok: true, slug: reuse.slug, url: "https://" + HOST + "/r/" + reuse.slug } : await saveList(update ? { title, ids: ids.concat(hiddenKeep.filter(id => !ids.includes(id))), slug: update.slug } : { title, ids, press, for: org ? [org] : [] }, fromEmail + " (pitch)");
    if (libsyn) await setListCpm(saved.slug, LIBSYN_CPM, fromEmail + " (pitch)").catch(() => null);
    // The brand asks for ideas (Tom, 16 Oct 2026, Ghost Soldier): the list gets a Campaign ideas column, drafted for
    // each creator by the roster-warm cron within a few minutes, from the brief.
    const wantsIdeas = press || /\b(ideas?|concepts?|creative (?:direction|angles?|treatments?)|how (?:\w+ ){0,4}(?:promote|feature|integrate))\b/i.test(String(f.note || "") + " " + String(f.body || ""));
    if (wantsIdeas) { const { list: il } = await freshList(saved.slug).catch(() => ({})); if (il && !il.bad) await writeList(il.id, Object.assign({}, il.body, press ? {} : { ideasOn: true }, { ideasPending: true, brief: (String(f.note || "") + "\n" + String(f.body || "")).trim().slice(0, 4000) }), {}).catch(() => null); }
    const reportUrl = libsyn ? await libsynReportUrl().catch(() => "") : "";
    const first = noDash(out.contact_first_name || String(f.contactName).split(/\s+/)[0] || "there").replace(/[\[\]{}<>"]/g, "").trim() || "there"; // no "Hi [Name]," (audit 19 Oct 2026)
    const product = noDash(out.product || out.brand || f.subject || "your campaign").replace(/[.\s]+$/, "");
    const mix = noDash(out.mix || "").replace(/[.\s]+$/, "").replace(/\s*\/\s*/g, " and ");
    // Tom's own edit of the first live pitch (Catch Flex, 13 Oct 2026): one-line thanks, what the list is and how to use it, the link, then the ask. No pricing notes.
    // Tom's voice (13 Oct 2026): short and warm, wording varied from his own sent replies so drafts do not read as a template. Facts only, never model-written.
    const pick = a => a[Math.floor(Math.random() * a.length)];
    const joinN = a => a.length > 1 ? a.slice(0, -1).join(", ") + " and " + a[a.length - 1] : a[0];
    const listNames = namedNames.filter(nm => ids.some(id => nameOf(id) === nm));
    const followUp = !b.outreach && /following up|thanks again|thank you again|coming back|earlier conversation|as discussed/i.test(f.body);
    const across = mix ? " across " + mix : "", who = aiCamp ? " who are open to working with brands on AI campaigns" : "";
    // The opening line (Tom, 19 Oct 2026: "Holiday Tech Deals looks like a fun one" made no sense and read as robotic).
    // The model writes one thank-you line naming something concrete from the brand's own email; pitchOpener checks it.
    // Otherwise a plain thank-you: no stock opinions about the product ("looks like a fun one", "sounds like a great one").
    let thanks = followUp ? pick(["Thanks for coming back to me. :)", "Thanks for following up on " + product + ".", "Thanks for coming back to me on " + product + "."])
      : (pitchOpener(out.opener) || pick(["Thanks for reaching out about " + product + ".", "Thanks for getting in touch about " + product + ".", "Great to hear from you about " + product + ".", "Thanks so much for thinking of us for " + product + ".", "Thanks for sending over the details on " + product + "."]));
    const intro = pick(["I've put together a shortlist of creators" + across + (who || " for you") + ".", "Here's a shortlist of creators" + across + (who || " who'd be happy to take this on") + ".", "Please find below a list of creators" + across + (who || " who would be happy to promote " + product) + ".", "I've pulled together some creators" + across + (who || " who'd be a great fit") + ".", "We've got some great creators" + across + (who || " for this") + ", so I've put them together for you below.", "I've lined up a few creators" + across + (who || " who I think would really suit " + product) + "."]);
    const solo = [...new Set(ids.map(id => base(cat.byId[id].name).replace(/^@/, "")))]; // one creator: say so plainly
    const soloFirst = solo.length === 1 ? solo[0] : ""; // full name: first word alone gave "Mr.'s rates" (Mr. Know-It-All, 15 Oct 2026)
    const pressLine = press ? " For each one you'll see their audience and the kind of press access that would suit them, such as interviews, early screenings or early play." : "";
    let lead = press && solo.length === 1 ? "I've put " + soloFirst + " on a list for you, with their audience and the kind of press access that would suit them." : (expanded ? pick(["I've put the creators you shortlisted on one list, along with some others" + (who ? who + " and would suit " : " who'd suit ") + product + " really well.", "Here are the creators you shortlisted, plus a few more" + (who ? who + " and would be great for " : " who I think would be great for ") + product + "."]) : shortOnly && solo.length > 1 ? pick(["I've put the creators you shortlisted together on one list.", "Here are the creators you shortlisted, all on one list."]) : solo.length === 1 ? pick(["Please find " + soloFirst + "'s rates below.", "Here are " + soloFirst + "'s rates for this.", "I've put " + soloFirst + "'s rates together for you below."]) : intro) + (solo.length === 1 ? "" : pressLine);
    // No "tick Approve?" instructions in the email (Tom, 16 Oct 2026: "It's explained well in the actual dashboard anyway").
    const howTo = "";
    // A brand asking about a specific creator (Tom, 15 Oct 2026, Gidues and CyberGhost): thank them for reaching out to
    // that creator, put that creator's rates in the email itself, then offer the wider list (the creator is on it too).
    const FMT = { topics: "YouTube integration", dedicated: "YouTube dedicated video", live: "YouTube livestream", group_mm4av3kr: "YouTube Short", group_mm4a1fe0: "Instagram Reel", group_mm4bd5tk: "TikTok", group_mm7yw8cy: "Snapchat" };
    const usd = n => "$" + Number(n).toLocaleString("en-US");
    const rateLine = id => { const c = cat.byId[id] || {}; const ll = libsyn && c.gid === "topics" ? (data.rows.find(x => x.id === id) || {}).libsyn : null; const lv = ll ? ll.reach : libsyn && c.gid === "topics" && c.vg ? Math.round(c.vg / PRICE.long.mult * LIBSYN_VIEWS) : 0; const price = lv ? Math.round(lv * LIBSYN_CPM / 1000) : typeof c.total === "number" ? c.total : c.rate; if (!price || !FMT[c.gid]) return ""; const lm = String(c.adLength || "").match(/^(\d+)\s*-\s*(\d+)\s*s/i); const len = c.gid === "topics" && lm ? " (" + lm[1] + " to " + lm[2] + " sec)" : ""; const vg = c.gid === "topics" && c.vg ? " with a " + Number(lv || c.vg).toLocaleString("en-US") + " view guarantee" : ""; return FMT[c.gid] + len + ": " + usd(price) + vg; };
    const askedFor = !b.outreach && out.stage !== "shortlist" && !expanded && !shortOnly && solo.length > 1 ? listNames : [];
    const gOrder = Object.keys(FMT);
    const baseOf = id => base(cat.byId[id].name).replace(/^@/, "");
    // One creator on the list: the draft says "Please find X's rates below", so the rates must actually be there.
    const details = press ? [] : (askedFor.length ? askedFor : solo.length === 1 ? solo : []).map(nm => [nm].concat(ids.filter(id => nameOf(id) === nm || baseOf(id) === nm).sort((x, y) => gOrder.indexOf(cat.byId[x].gid) - gOrder.indexOf(cat.byId[y].gid)).map(rateLine).filter(Boolean)).join("\n")).filter(d => d.indexOf("\n") > 0);
    const withRates = !press && /\b(rates?|pric\w*|cost|budget)\b/i.test(f.body) ? " with current rates." : ".";
    const ans = [];
    if (wantsIdeas && !press) ans.push(pick(["I've added campaign ideas for each creator to the list.", "You'll find campaign ideas for each creator on the list.", "Each creator on the list has a couple of campaign ideas next to them."]));
    const qs = !b.outreach && Array.isArray(out.questions) ? out.questions.filter(q => q && q.q) : [];
    if (aiDeclined.length) ans.push("Sadly, " + joinN(aiDeclined) + " won't take on AI projects, but these creators would.");
    if (out.stage !== "shortlist" && solo.length > 1 && listNames.length && !details.length && (/\?/.test(f.body) || withRates !== ".")) ans.push(pick([joinN(listNames) + (listNames.length > 1 ? " are" : " is") + " on the list" + withRates, "You'll find " + joinN(listNames) + " on there" + withRates]));
    // No stock availability line (Tom, 19 Oct 2026: he deleted it from nearly every draft he edited). When the brand asks about
    // availability or dates, the answer to its question covers it.
    // The brand's questions: answered only from the Standing facts item.
    // NEVER put a note for DFT inside the draft (Tom, 14 Oct 2026: two drafts went to brands with
    // "[TOM TO ANSWER: ...]" in them). The draft must always be safe to send exactly as it is: an
    // unanswered question gets a plain holding line for the brand, and the questions themselves go
    // to the sender in a separate internal email (Make route "Before you send") and onto the monday row.
    qs.forEach(q => { const a = noDash(String(q.answer || "").replace(/\[[^\]]*\]/g, "").trim()); if (a) ans.push(a); });
    const todo = qs.filter(q => !noDash(String(q.answer || "").replace(/\[[^\]]*\]/g, "").trim())).map(q => noDash(String(q.q).trim().replace(/[.?\s]+$/, "")));
    // No holding line for unanswered questions (Tom, 16 Oct 2026: "Can we stop putting this in the email drafts please?").
    // They still reach the sender in the separate internal email and on the monday row.
    // A thin brief still gets a list (Tom, 19 Oct 2026, Elida: refusing was "not helpful"); the draft asks for what is missing.
    const needs = noDash(String(out.needs_details || "").trim()).replace(/[.\s]+$/, "").replace(/^([A-Z])(?=[a-z])/, m => m.toLowerCase());
    if (needs && !b.outreach) ans.push("If you can share " + needs + ", I'll tailor the list further.");
    const answer = ans.join(" ");
    const ask = press ? pick(["Could you let me know who you'd like to work with?", "Who would you like to go ahead with?", "Could you confirm who you'd like to work with on this?"]) : pick(["Could you confirm who you would like to book?", "Could you confirm who you would like to book please?", "Who would you like to book?", "Could you confirm who you'd like to book for this?", "Let me know who you'd like to go ahead with and we'll get it booked in.", "Have a look and let me know who stands out."]);
    const options = /option\s*\d|both options|\boptions\b/i.test(f.body);
    const how = solo.length === 1 ? "" : " " + howTo;
    let ask2 = solo.length === 1 ? pick(["Could you confirm if you'd like to go ahead?", "Let me know if you'd like to go ahead and we'll get it booked in.", "Could you confirm if you'd like to book " + soloFirst + "?"]) : ask; // one placement: never "which option" (Tom, 13 Oct 2026)
    // Last line of defence: nothing in square brackets ever reaches a brand (placeholders, notes to DFT).
    const named = askedFor.length > 0 && details.length > 0;
    // A touch of variety so drafts read naturally (Tom, 16 Oct 2026), keeping the shape of his template.
    // Outreach from a Sales Desk alert (Tom, 16 Oct 2026): DFT writes first, so the opener comes from the alert, not a thank-you.
    if (b.outreach) { thanks = String(b.outreach.opener || thanks);
      if (solo.length > 1) lead = press ? pick(["I've put together a press package of creators" + across + " who'd love to cover " + product + ".", "Here are some of our creators" + across + " whose audiences would be right for " + product + "."]) + pressLine : pick(["I've put together a shortlist of creators" + across + " who'd be a great fit for " + product + ".", "Here are some of our creators" + across + " who I think would suit " + product + " really well.", "I've pulled together a few creators" + across + " whose audiences line up well with " + product + "."]); }
    const thanksN = named ? pick(["Thanks for reaching out to " + joinN(askedFor) + " about " + product + ". We'd be very keen to explore this.", "Thanks for getting in touch with " + joinN(askedFor) + " about " + product + ". We'd love to explore this with you.", "Thanks for thinking of " + joinN(askedFor) + " for " + product + ". This sounds like a great fit and we'd be keen to explore it.", "Great to hear you're interested in " + joinN(askedFor) + " for " + product + ". We'd be really keen to make this happen."]) : thanks;
    const leadN = named ? pick(["Also, here's a shortlist of creators" + across + (who || " who'd be happy to take this on") + ".", "I've also put together a shortlist of other creators" + across + (who || " who'd suit this well") + ".", "If you'd like to widen it, here are some more creators" + across + (who || " who'd be a great fit") + ".", "Alongside " + joinN(askedFor) + ", here are a few other creators" + across + (who || " who I think would work really well") + "."]) : lead;
    // The tick instruction is its own paragraph (Tom, 15 Oct 2026, Mucinex: "It just makes the email a bit clearer").
    // The tick instruction was dropped on 16 Oct 2026 (Tom: the list page explains it).
    const howN = "";
    if (b.outreach) ask2 = pick(press ? ["Would any of them be a good fit for your coverage? Happy to set up interviews or early access.", "Let me know who you'd like to work with and I'll set it up.", "Would you like to work with any of them on this?"] : ["Would you be open to a quick chat about a campaign with any of them?", "Is there anything coming up where these creators could help?", "Let me know who stands out and I'll put together the details.", "Would any of them suit your next campaign?"]);
    const askN = named ? pick(["Could you confirm who you would like to book please?", "Let me know who you'd like to book and we'll get things moving.", "Who would you like to go ahead with?", "Could you let me know who you'd like to book?"]) : ask2;
    const paras = [thanksN].concat(named ? details : [], [leadN], howN ? [howN] : [], !named && solo.length === 1 ? details : [], ["[[LIST_LINK]]"]).concat(answer ? [answer] : [], [askN]).map(p => p === "[[LIST_LINK]]" ? p : p.replace(/\s*\[[^\]]*\]/g, "").trim()).filter(Boolean);
    if (!paras.some(p => p.indexOf("[[LIST_LINK]]") >= 0)) paras.splice(Math.min(2, paras.length), 0, "[[LIST_LINK]]");
    if (reportUrl) paras.splice(paras.length - 1, 0, "[[REPORT_LINK]]");
    // Tom's standing lessons from his own sent edits, applied as a last careful pass (prices, numbers and links untouched).
    const polished = lessons.length && !b.outreach && !b.sub && !b.listsOnly ? await polishPitch(paras, lessons, first, f, latest).catch(() => null) : null;
    if (polished) paras.splice(0, paras.length, ...polished);
    const REPORT_LEAD = "You can also see how our recent Libsyn campaigns have performed here: ";
    const bullets = [];
    const sig = ["Warm regards", fwdName, "Digital Fox Talent", "\u{1F98A}"];
    const linkText = title + pick([" creator list", " creator list", " shortlist", " creators"]);
    const html = "<div dir=\"ltr\">Hi " + escH(first) + ",<br><br>" + paras.map(p => p === "[[REPORT_LINK]]" ? escH(REPORT_LEAD) + "<a href=\"" + escH(reportUrl) + "\">Libsyn campaign report</a>" : p.indexOf("[[LIST_LINK]]") >= 0 ? "<a href=\"" + saved.url + "\">" + escH(linkText) + "</a>" : escH(p).replace(/\n/g, "<br>")).join("<br><br>") + (bullets.length ? "<br><br>" + bullets.map(x => "- " + escH(x)).join("<br>") : "") + "<br><br>" + sig.map(escH).join("<br>") + "</div>";
    const text = "Hi " + first + ",\n\n" + paras.map(p => p === "[[REPORT_LINK]]" ? REPORT_LEAD + reportUrl : p.indexOf("[[LIST_LINK]]") >= 0 ? saved.url : p).join("\n\n") + (bullets.length ? "\n\n" + bullets.map(x => "- " + x).join("\n") : "") + "\n\n" + sig.join("\n");
    // Quote the brand's original email under the reply, like a normal Gmail reply (Tom, 13 Oct 2026).
    const fwdHead = (String(f.body).split(/\n[ \t]*\n/)[0] || ""), dateM = fwdHead.match(/\nDate:\s*([^\n]+)/i);
    const attr = "On " + (dateM ? dateM[1].trim() + " " : "") + (f.quoteName ? f.quoteName + " " : "") + "<" + (f.quoteEmail || f.contactEmail) + "> wrote:";
    const origText = String(f.body).slice(fwdHead.length).trim();
    const fh = String(b.html || ""), fi = fh.search(/Forwarded message/i); let origHtml = "";
    if (fi >= 0) { const close = fh.indexOf("</div>", fi); if (close > 0) origHtml = fh.slice(close + 6).replace(/^(\s|<br\s*\/?>)+/i, ""); }
    if (!origHtml) origHtml = escH(origText).replace(/\n/g, "<br>");
    const quoteHtml = '<br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">' + escH(attr) + '<br></div><blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">' + origHtml + "</blockquote></div>";
    const quoteText = "\n\n" + attr + "\n\n" + origText.split("\n").map(l => "> " + l).join("\n");
    const subject = b.outreach ? String(b.outreach.subject || f.subject) : /^re:/i.test(f.subject) ? f.subject : "Re: " + f.subject;
    // One campaign of several: hand the pieces back for the combined draft; the parent marks the row and makes the draft.
    if (b.sub) {
      const FREE0 = /^(gmail|googlemail|icloud|me|mac|yahoo|ymail|rocketmail|hotmail|outlook|live|msn|aol|proton|protonmail|pm|gmx|mail|zoho|yandex|qq|163|126|hey|fastmail)\./i;
      const dom0 = x => { const p = String(String(x || "").split("@")[1] || "").toLowerCase().split("."); return p.slice(p.length > 2 && p[p.length - 1].length === 2 && p[p.length - 2].length <= 3 ? -3 : -2).join("."); };
      const cd0 = dom0(f.contactEmail), side0 = x => !!cd0 && !FREE0.test(cd0) && dom0(x) === cd0;
      const cc0 = [...new Set((f.others || []).filter(x => x !== f.contactEmail && (side0(x) || /^(alex|margot|george)@digitalfoxtalent\.com$/i.test(x))).concat(["tom@digitalfoxtalent.com", "alex@digitalfoxtalent.com", "margot@digitalfoxtalent.com"]))].filter(x => x !== fromEmail).join(", ");
      return { ok: true, listUrl: saved.url, title, linkText, placements: ids.length, product: noDash(b.sub.name), mix, first, answer, to: f.contactEmail, cc: cc0, subject, search: routedSearch(b) || pitchSearch(f), html: html + quoteHtml, text: text + quoteText, quoteHtml, quoteText, model: out.model, picks: out.picks, questions: out.questions || [], reviewed, press, unanswered: todo, headsUp: [fellBack, whyNone].filter(Boolean).join(". ") };
    }
    if (b.listsOnly) {
      await pitchMark(b.item, "Lists only (no brand to reply to): " + title + ", " + ids.length + " placements (" + out.model + ")" + (fellBack ? ". Heads-up: " + fellBack : ""), saved.url);
      return listsOnlyResult(f, [{ title, url: saved.url, placements: ids.length }], []);
    }
    await pitchMark(b.item, (press ? "Press package. " : "") + (reuse ? "Ready: same list as before, " : "Ready: ") + ids.length + " placements (" + out.model + ")" + (todo.length ? ". Brand also asked (not answered in the draft): " + todo.join("; ") : "") + (fellBack ? ". Heads-up: " + fellBack : "") + (b.multiFailed ? ". Heads-up: the separate campaign pitches failed (" + String(b.multiFailed).slice(0, 200) + "), so this is one combined pitch" : "") + (whyNone ? ". Heads-up: " + whyNone : "") + (lowFit ? ". Heads-up: no creator was a strong fit, so these are the closest" : ""), saved.url).catch(() => null); // never "Failed" once the list is saved (audit 19 Oct 2026)
    // Who gets copied (Tom, 14 Oct 2026, after a creator's personal email was copied on Margot's Base44 draft):
    // never a creator. Besides Tom, Alex and Margot, the only addresses kept from the forwarded email are
    // colleagues of the brand contact at the same company domain. A free mail domain (gmail, icloud...) is
    // never treated as a company, so nobody else on those is copied.
    const FREE_MAIL = /^(gmail|googlemail|icloud|me|mac|yahoo|ymail|rocketmail|hotmail|outlook|live|msn|aol|proton|protonmail|pm|gmx|mail|zoho|yandex|qq|163|126|hey|fastmail)\./i;
    const domOf = x => { const p = String(String(x || "").split("@")[1] || "").toLowerCase().split("."); return p.slice(p.length > 2 && p[p.length - 1].length === 2 && p[p.length - 2].length <= 3 ? -3 : -2).join("."); }; // company domain, e.g. creator.noxinfluencer.com and noxinfluencer.com match
    const cDom = domOf(f.contactEmail);
    const brandSide = x => !!cDom && !FREE_MAIL.test(cDom) && domOf(x) === cDom;
    const cc = [...new Set((f.others || []).filter(x => x !== f.contactEmail && (brandSide(x) || /^(alex|margot|george)@digitalfoxtalent\.com$/i.test(x))).concat(["tom@digitalfoxtalent.com", "alex@digitalfoxtalent.com", "margot@digitalfoxtalent.com"]))].filter(x => x !== fromEmail).join(", ");
    const resultObj = { ok: true, listUrl: saved.url, title, placements: ids.length, to: f.contactEmail, cc, subject, search: routedSearch(b) || pitchSearch(f), html: b.outreach ? html : html + quoteHtml, text: b.outreach ? text : text + quoteText, model: out.model, picks: out.picks, research, stage: out.stage || "new", closing: out.closing === true, questions: out.questions || [], reviewed, reused: reuse ? reuse.slug : "", press };
    // For the sender only, never the brand: the questions the draft holds over (Make route "Before you send").
    resultObj.unanswered = todo;
    resultObj.polished = !!polished;
    // Kept for the nightly learner (api/pitch-learn.js): the email as written, the visible list link text in place of the URL.
    if (!b.outreach) await monday("mutation($b:ID!,$i:ID!,$v:JSON!){change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id}}", { b: String(PITCH_BOARD), i: String(b.item), v: JSON.stringify({ [PB.draft]: { text: ("Hi " + first + ",\n\n" + paras.map(p => p === "[[REPORT_LINK]]" ? REPORT_LEAD + "Libsyn campaign report" : p.indexOf("[[LIST_LINK]]") >= 0 ? linkText : p).join("\n\n")).slice(0, 9000) }, [PB.check]: [fromEmail, f.contactEmail, new Date().toISOString()].join("|") }) }).catch(() => null);
    resultObj.unansweredHtml = todo.length ? "<p>Your pitch draft to " + escH(f.contactEmail) + " is ready (subject: " + escH(subject) + ").</p><p>The brand also asked these, which the standing facts do not cover. The draft tells them you will come back to them shortly, so it is safe to send as it is. Reply on these yourself, or add your answers to the draft before you send:</p><ul>" + todo.map(q => "<li>" + escH(q) + "</li>").join("") + "</ul><p>To have the system answer a question like this next time, add the answer to the Standing facts item on the Roster - Pitch Requests board.</p>" : "";
    // Teammates get the draft in their own Gmail (Tom, 14 Oct 2026); Tom's drafts still come from Make.
    resultObj.draftMade = await teamDraft(fromEmail, resultObj).catch(e => "failed: " + String((e && e.message) || e).slice(0, 200));
    await draftLogUpdate(b.item, resultObj, resultObj.draftMade).catch(() => null);
    delete resultObj.draftLog;
    if (resultObj.draftMade && resultObj.draftMade !== true) await pitchMark(b.item, "List ready but " + draftNote(resultObj.draftMade) + ". List: " + saved.url, saved.url).catch(() => null);
    return resultObj;
  } catch (e) {
    if (!b.sub) { try { await pitchMark(b.item, (/^No list made/.test(String(e && e.message)) ? "" : "Failed: ") + String(e && e.message || e).slice(0, 500)); } catch (_) {} }
    throw e;
  }
}

// Libsyn Ads (Tom, 16 Oct 2026): every pitch to Libsyn or AdvertiseCast prices YouTube integrations at 1x average views and $28 CPM on
// the saved list (shows too), and the draft links Libsyn's own sub report. The link lives on the API Keys board.
const LIBSYN_CPM = 28;
const LIBSYN_VIEWS = 1; // x the quarter's average views, for Libsyn long-form integrations (Tom, 16 Oct 2026)
const LIBSYN_REPORT_ITEM = 13312527118;
const isLibsyn = f => /@(libsyn|advertisecast)\.com$/i.test(String(f.contactEmail || "")) || /libsyn ads/i.test(String(f.subject || ""));
async function libsynReportUrl() {
  const d = await monday(`query{items(ids:[${LIBSYN_REPORT_ITEM}]){column_values(ids:["text_mm5bcxe7"]){text}}}`);
  const u = String(((((d || {}).items || [])[0] || {}).column_values || [{}])[0].text || "").trim();
  return /^https:\/\/reports\.digitalfoxtalent\.com\/\S+$/.test(u) ? u : "";
}
async function setListCpm(slug, cpm, by) {
  const { data, list } = await freshList(slug);
  if (!list || list.bad) return;
  const ids = new Set((list.body.ids || []).map(String)), prices = Object.assign({}, list.body.prices || {});
  const set = (id, own) => {
    if (!own || !(own.vg > 0)) return;
    // Views at 1x the quarter's average, not the usual 1.5x guarantee (Tom, 16 Oct 2026).
    // Never above the guarantee the team already set on the rate card (some are capped by hand, e.g. New Rockstars).
    const cur = prices[id] || {}, vg = Math.round(Math.min(own.vg, own.basis > 0 ? own.basis * LIBSYN_VIEWS : own.vg / PRICE.long.mult * LIBSYN_VIEWS));
    prices[id] = Object.assign({ vg, cpm }, cur.videos ? { videos: cur.videos } : {}, cur.disc ? { disc: true, discFrom: cur.discFrom } : {});
  };
  data.rows.forEach(r => {
    if (r.group !== "topics" || !ids.has(r.id)) return;
    // A creator with a Libsyn Ads listing uses the listing's reach as the views, for one video (Tom, 16 Oct 2026,
    // "so every Libsyn rep sees one number"), at the Libsyn CPM of $28 for every creator (Tom, same day: "all
    // Libsyn plans ... the CPM is $28"), not the listing's own price. Reach lives on the Supplier register.
    if (r.libsyn) prices[r.id] = { vg: Math.round(r.libsyn.reach), cpm, videos: 1 };
    else set(r.id, brandNumbers(r.cv, C, "long"));
    r.shows.forEach(s => set(s.id, brandNumbers(s.cv, SC, "long")));
  });
  await writeList(list.id, Object.assign({}, list.body, { prices }), { [L.updated]: by + " " + stamp() });
}
// One-off and for the team: put a list's YouTube integrations at the Libsyn CPM.
async function listLibsyn(b, email) { await setListCpm(b.slug, LIBSYN_CPM, email); const { data, list } = await freshList(b.slug); return brandPayload(data, list, true); }

// The raw Gmail draft for Make: a reply in the brand's thread, HTML and plain text, UTF-8.
// Drafts in a teammate's own Gmail (Tom, 14 Oct 2026): Google domain-wide delegation for the service account
// pitch-drafts@dft-pitch-drafts.iam.gserviceaccount.com (Cloud project dft-pitch-drafts), scope gmail.modify.
// The key lives only in the Vercel env var GMAIL_DELEGATE_KEY. Key added by Tom, 14 Oct 2026. Brand and creator email is
// only ever drafted. The one send is sendInternal: the brand-feedback alert from theteam@ to Tom, Alex and Margot.
async function gmailToken(subject) {
  const raw = process.env.GMAIL_DELEGATE_KEY; if (!raw) return null;
  const key = JSON.parse(raw), now = Math.floor(Date.now() / 1000);
  const b64u = o => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = b64u({ alg: "RS256", typ: "JWT" }) + "." + b64u({ iss: key.client_email, scope: "https://www.googleapis.com/auth/gmail.modify", aud: "https://oauth2.googleapis.com/token", sub: subject, iat: now, exp: now + 3000 });
  const sig = crypto.createSign("RSA-SHA256").update(unsigned).sign(key.private_key).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + unsigned + "." + sig });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error("Gmail token: " + (d.error_description || d.error || r.status));
  return d.access_token;
}
// Keeping the reply in the brand's thread (Tom, 15 Oct 2026: "None of the emails we're sending out are appearing in
// the thread"). The old search looked for the brand's email by sender and exact subject, and Gmail finds nothing
// when the subject has a "|" in it (JuJuBit, Meshy AI, Ulike) or when the brand's email is not searchable at all
// (Ulike came Bcc from a Feishu sender). So the search now finds the forward to pitch@ instead: it always sits in
// the brand's thread, and its words are cleaned of punctuation. The reply headers then point at the brand's own
// latest message in that thread (brandMsgId), not at our forward.
// Underscores stay inside a word: Gmail indexes "tugboat_spenny_official" as one word, so splitting it found nothing
// (Tom's Facemoji forward, 16 Oct 2026).
const subjectWords = s => String(s || "").replace(/^\s*((re|fwd?|fw|aw|wg|tr)\s*:\s*)+/i, "").replace(/[^\p{L}\p{N}_]+/gu, " ").replace(/(^|\s)_+|_+(?=\s|$)/g, "$1").trim().slice(0, 200);
// The real sender of mail that reached us through a DFT Google Group: the original message's Reply-To (or X-Original-Sender).
async function groupSender(f, fromEmail) {
  const tok = await gmailToken(/@digitalfoxtalent\.com$/i.test(fromEmail) ? fromEmail : "tom@digitalfoxtalent.com");
  const subj = String(f.subject || "").replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "").replace(/["]/g, "").trim();
  if (!tok) throw new Error("Gmail is not connected");
  if (!subj) throw new Error("no subject in the forward");
  const G = p => fetch("https://gmail.googleapis.com/gmail/v1/users/me" + p, { headers: { Authorization: "Bearer " + tok } }).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error("Gmail " + r.status + " " + ((j.error || {}).message || "")); return j; });
  const w = subjectWords(subj);
  const list = (await G("/messages?maxResults=5&q=" + encodeURIComponent((w ? "subject:(" + w + ")" : 'subject:"' + subj + '"') + " -from:me newer_than:60d"))).messages || [];
  if (!list.length) throw new Error("the original was not found in " + (/@digitalfoxtalent\.com$/i.test(fromEmail) ? fromEmail : "tom@") + "'s mail");
  for (const m of list) {
    const d = await G("/messages/" + m.id + "?format=metadata&metadataHeaders=Reply-To&metadataHeaders=X-Original-Sender&metadataHeaders=X-Original-From");
    for (const h of ((d.payload || {}).headers || [])) {
      const em = (String(h.value || "").match(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) || [])[0];
      if (em && !DFT_DOMAIN.test(em)) return em.toLowerCase();
    }
  }
  return "";
}
// The last pass over a pitch draft (Tom, 19 Oct 2026): rewrite it the way Tom's standing lessons say, from his own sent
// edits. Strictly checked: every paragraph with a price stays word for word, no number that was not there appears, the
// list and report links stay as their own paragraphs, no dashes. Anything that fails a check keeps the template draft.
async function polishPitch(paras, lessons, first, f, latest) {
  const tokens = paras.filter(p => /^\[\[(LIST|REPORT)_LINK\]\]$/.test(p));
  const priced = paras.filter(p => /\$\s?\d/.test(p));
  const prompt = [
    "You are Tom James at Digital Fox Talent, a creator talent agency, tidying a reply to a brand before it is sent. Apply Tom's standing lessons below to this draft. Keep it short, warm and natural, in Tom's voice.",
    "Rules: keep the meaning and every fact. Do not add facts, prices, numbers, dates, promises or creator names that are not in the draft. Keep these placeholder paragraphs exactly as they are, each on its own: " + (tokens.join(", ") || "(none)") + ". Keep every paragraph that contains a $ price exactly word for word. You may cut a sentence the lessons say to cut, reword the opening thank-you, the line introducing the list and the closing question. No em dashes or en dashes. Do not write the greeting (Hi " + first + ",) or the sign-off.",
    "TOM'S STANDING LESSONS:\n- " + lessons.join("\n- "),
    "THE BRAND'S EMAIL (for context only):\n" + String(latest || f.body || "").slice(0, 2500),
    "THE DRAFT (one paragraph per item):\n" + JSON.stringify(paras),
    'Reply with ONLY JSON: {"paragraphs":["..."]}'
  ].join("\n\n");
  const out = await askClaude(prompt);
  const ps = Array.isArray(out && out.paragraphs) ? out.paragraphs.map(p => String(p || "").trim()).filter(Boolean) : [];
  if (ps.length < 2 || ps.length > paras.length + 2) return null;
  const all = paras.join("\n"), got = ps.join("\n");
  if (tokens.some(t => ps.filter(p => p === t).length !== 1) || ps.some(p => /\[\[/.test(p) && !tokens.includes(p))) return null;
  if (priced.some(p => !ps.includes(p))) return null;
  const nums = s => (s.match(/\d[\d,.]*/g) || []).map(n => n.replace(/[,.]+$/, ""));
  const had = new Set(nums(all));
  if (nums(got).some(n => !had.has(n))) return null;
  if (/[\u2013\u2014]|\[(?!\[)|^(hi|hello|dear)\b|warm regards/im.test(got.replace(/\[\[(LIST|REPORT)_LINK\]\]/g, ""))) return null;
  if (got.length > all.length * 1.4 + 200) return null;
  return ps;
}
// The enquiry router (api/route-drafts.js, Tom, 22 Oct 2026) copies the brand's own email into a salesperson's inbox,
// so there is no forward to pitch@ to find: it passes the brand email's Message-ID and the draft joins that thread.
// Only an rfc822msgid query is accepted, as this op is open.
const routedSearch = b => {
  if (!b.search) return "";
  if (!/^rfc822msgid:[^\s"()]+$/.test(String(b.search))) throw new Error("Bad routed search");
  return String(b.search);
};
function pitchSearch(f) {
  const w = subjectWords(f.subject);
  // subject:(...) matches all the words; the quoted phrase it replaced missed subjects with "&", "|" or a date
  // such as 10/19 in them (Tom's Motrin forward, 16 Oct 2026), so the draft was saved outside the brand's thread.
  return w ? "in:sent {to:pitch@digitalfoxtalent.com to:press@digitalfoxtalent.com} subject:(" + w + ") -subject:(\"No pitch draft\") newer_than:7d" : "from:" + f.contactEmail + " newer_than:90d";
}
function brandMsgId(thread, fallbackId) {
  const ms = (thread && thread.messages) || [];
  const m = ms.filter(x => !(x.labelIds || []).some(l => l === "SENT" || l === "DRAFT")).pop() || ms.find(x => x.id === fallbackId) || {};
  return (((m.payload || {}).headers || []).find(h => /^message-id$/i.test(h.name)) || {}).value || "";
}
// Tom's drafts are saved by Make (op pitch-mime). Make passes the thread it found; the reply headers are pointed at
// the brand's message in it from Tom's mailbox. If that look-up fails, Make's own headers stand.
async function pitchReplyTo(b) {
  if (!b) return b;
  // Make found no thread (its subject search missed): look for the brand's email in Tom's mailbox here, so the draft
  // still lands in the brand's thread (Tom, 16 Oct 2026: "This one doesn't seem to have come back with a pitch").
  // First by sender and subject words; then by sender alone, only when that sender has a single thread.
  if (!b.threadId && b.to) {
    try {
      const tok0 = await gmailToken("tom@digitalfoxtalent.com");
      const from = String(b.to).split(/[,\s]+/).find(x => /@/.test(x)) || "", w = subjectWords(b.subject);
      const look = async q => { const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/threads?maxResults=2&q=" + encodeURIComponent(q), { headers: { Authorization: "Bearer " + tok0 } }); return r.ok ? ((await r.json()).threads || []) : []; };
      if (tok0 && from) {
        let t = w ? await look("from:" + from + " subject:(" + w + ") newer_than:30d") : [];
        if (!t.length) { const all = await look("from:" + from + " newer_than:30d"); if (all.length === 1) t = all; }
        if (t.length) b = Object.assign({}, b, { threadId: t[0].id });
      }
    } catch (e) {}
  }
  if (!b.threadId) return b;
  try {
    const tok = await gmailToken("tom@digitalfoxtalent.com"); if (!tok) return b;
    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/threads/" + encodeURIComponent(String(b.threadId)) + "?format=metadata&metadataHeaders=Message-ID", { headers: { Authorization: "Bearer " + tok } });
    if (!r.ok) return b;
    const mid = brandMsgId(await r.json(), "");
    return mid ? Object.assign({}, b, { inReplyTo: mid, references: "" }) : b;
  } catch (e) { return b; }
}
async function teamDraft(fromEmail, o) {
  if (!/@digitalfoxtalent\.com$/i.test(fromEmail) || /^tom@/i.test(fromEmail)) return false;
  const tok = await gmailToken(fromEmail); if (!tok) return false;
  const G = (path, opt = {}) => fetch("https://gmail.googleapis.com/gmail/v1/users/me" + path, Object.assign({}, opt, { headers: Object.assign({ Authorization: "Bearer " + tok }, opt.headers || {}) })).then(async r => { const t = await r.text(); let j = {}; try { j = t ? JSON.parse(t) : {}; } catch (_) {} if (!r.ok) throw new Error("Gmail " + r.status + " " + ((j.error && j.error.message) || "")); return j; });
  const q = encodeURIComponent;
  // What happened, step by step, for the row's update (Tom, 20 Oct 2026: Margot's Displate pitch said "Ready" five times
  // but no draft showed in the thread, and nothing on the row said why). Headers and ids only, never the email itself.
  const log = o.draftLog = [];
  const found = ((await G("/messages?maxResults=1&q=" + q(o.search)).catch(e => { log.push("forward search failed: " + e.message); return {}; })).messages || [])[0];
  let threadId = "", thread = {};
  if (found) { threadId = found.threadId; thread = await G("/threads/" + threadId + "?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=In-Reply-To&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To").catch(() => ({})); }
  log.push(found ? "forward found, thread " + threadId + " (" + ((thread.messages || []).length) + " messages: " + (thread.messages || []).map(m => (m.labelIds || []).filter(l => /^(INBOX|SENT|DRAFT|TRASH)$/.test(l)).join("+") || "other").join(", ") + "). Last 4: " + (thread.messages || []).slice(-4).map(m => { const hv = n => (((m.payload || {}).headers || []).find(h => h.name.toLowerCase() === n) || {}).value || ""; const at = x => (String(x).match(/[\w.+-]+@[\w.-]+/g) || []).join("/"); return at(hv("from")) + ">" + at(hv("to")); }).join("; ") : "forward NOT found with: " + o.search);
  // The previous draft to this brand in the same thread goes (Tom, 13 Oct 2026). Every draft to the brand is checked,
  // not only the first 20 the search returns, and a stray from an earlier attempt that never joined the thread goes too.
  if (threadId) {
    const dr = (await G("/drafts?maxResults=100&q=" + q("to:" + o.to)).catch(() => ({}))).drafts || [];
    let gone = 0;
    for (const d of dr) {
      const inThread = d.message && d.message.threadId === threadId;
      let stray = false;
      if (!inThread) { const full = await G("/drafts/" + d.id + "?format=full").catch(() => null); stray = !!(full && isPitchStray(full, o.subject)); }
      if (inThread || stray) { await G("/drafts/" + d.id, { method: "DELETE" }).then(() => gone++).catch(() => null); }
    }
    if (gone) log.push("removed " + gone + " older draft(s) to " + o.to);
  }
  // The draft must land IN the brand's thread (Tom, 20 Oct 2026). Gmail only joins a draft to the thread when it
  // accepts the reply headers, and otherwise files it as a conversation of its own. The reply to the create call is
  // not proof of where it went, so each draft is read back from Gmail: the draft itself and the thread, which must now
  // list it. If it is not there, it is deleted and the next set of reply headers is tried.
  const opts = threadId ? replyHeaderOptions(thread, found.id, o.subject) : [{ subject: o.subject }];
  let ok = !threadId, kept = null;
  for (let i = 0; i < opts.length && !ok; i++) {
    const h = opts[i];
    const made = await G("/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: pitchMime({ to: o.to, cc: o.cc, subject: h.subject, html: o.html, text: o.text, threadId, inReplyTo: h.inReplyTo, references: h.references }).draft });
    if (!threadId) { kept = made; break; }
    const v = await draftInThread(G, made, threadId);
    log.push("try " + (i + 1) + " (" + h.label + "): Gmail said thread " + (((made || {}).message || {}).threadId || "?") + ", read back " + (v.ok ? "IN the thread" : "NOT in the thread (draft's thread " + (v.tid || "?") + ")"));
    if (v.ok) { ok = true; kept = made; break; }
    if (i < opts.length - 1) await G("/drafts/" + made.id, { method: "DELETE" }).catch(() => null);
    else kept = made; // every option split: keep the last one so the work is not lost, and say so on the board
  }
  if (!threadId) log.push("no thread to reply in: draft saved on its own");
  // Their forward to pitch@ leaves the brand thread (Tom, 13 Oct 2026), only once the draft is safely in the thread,
  // so a failed run never makes the forward look as if it had been dealt with.
  if (threadId && ok) { const sent = (await G("/messages?maxResults=25&q=" + q("in:sent {to:pitch@digitalfoxtalent.com to:press@digitalfoxtalent.com} newer_than:7d")).catch(() => ({}))).messages || []; let binned = 0, elsewhere = 0; for (const m of sent) { if (m.threadId === threadId) { await G("/messages/" + m.id + "/trash", { method: "POST" }).then(() => binned++).catch(() => null); } else elsewhere++; } log.push("forward(s) to pitch@ binned from this thread: " + binned + " (the forward the search found was " + found.id + "; " + elsewhere + " other recent pitch@ forward(s) left in other threads)"); }
  o.draftId = kept && kept.id;
  // What Gmail actually stored (Tom, 20 Oct 2026: Margot's draft landed in the thread but opened blank).
  if (kept) {
    const st = await G("/drafts/" + kept.id + "?format=full").catch(e => ({ err: e.message }));
    const parts = []; const walk = p => { if (!p) return; if (p.body && p.body.data) parts.push(p.mimeType + " " + Buffer.from(p.body.data, "base64url").length + "b"); (p.parts || []).forEach(walk); };
    walk(((st || {}).message || {}).payload);
    log.push("sent to Gmail: html " + String(o.html || "").length + " chars, text " + String(o.text || "").length + " chars. Gmail stored: " + (st.err ? "read failed " + st.err : (parts.join(", ") || "NO BODY") + ", size " + ((st.message || {}).sizeEstimate || "?") + ", snippet \"" + String((st.message || {}).snippet || "").slice(0, 90) + "\""));
  }
  return threadId && !ok ? DRAFT_OUTSIDE : true;
}
// Read a new draft back: Gmail must report it in the thread, and the thread must list its message.
async function draftInThread(G, made, threadId) {
  let tid = "", listed = false;
  for (let k = 0; k < 3; k++) {
    if (k) await new Promise(r => setTimeout(r, 1500));
    const d = await G("/drafts/" + made.id + "?format=minimal").catch(() => null);
    const mid = (d && d.message && d.message.id) || ((made || {}).message || {}).id;
    tid = (d && d.message && d.message.threadId) || "";
    const t = await G("/threads/" + threadId + "?format=minimal").catch(() => null);
    listed = !!(t && (t.messages || []).some(m => m.id === mid));
    if (tid === threadId && listed) return { ok: true, tid };
    if (tid && tid !== threadId) break; // Gmail has filed it elsewhere: waiting will not change that
  }
  return { ok: false, tid, listed };
}
// An earlier pitch draft to the same brand that never made it into the thread: same subject (ignoring Re:) and it
// carries one of our saved list links, so a draft the person wrote themselves is never touched.
function isPitchStray(d, subject) {
  const m = (d || {}).message || {}, payload = m.payload || {};
  const sub = (payload.headers || []).find(h => /^subject$/i.test(h.name));
  const norm = s => String(s || "").replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!sub || !norm(subject) || norm(sub.value) !== norm(subject)) return false;
  const bodies = []; const walk = p => { if (!p) return; if (p.body && p.body.data) bodies.push(Buffer.from(p.body.data, "base64url").toString("utf8")); (p.parts || []).forEach(walk); }; walk(payload);
  return /roster-viewguarantee\.digitalfoxtalent\.com\/r\//i.test(bodies.join("\n"));
}
// Post what teamDraft did as an update on the pitch row, so a missing draft can be explained without guessing.
async function draftLogUpdate(item, o, r) {
  if (!item || !o || !(o.draftLog || []).length) return;
  const head = r === true ? "Draft check: saved in the brand's thread." : r === DRAFT_OUTSIDE ? "Draft check: Gmail would not put the draft in the brand's thread. It is in the Drafts folder." : "Draft check: " + String(r);
  await audit(String(item), head + "<br>" + o.draftLog.map(escH).join("<br>"));
}
const DRAFT_OUTSIDE = "outside the thread";
// Reply headers to try, best first. 1: the brand's latest message, with that message's own References chain (what
// the "draft" op uses). 2: the same message alone (what Tom's Make drafts use). 3: every message in the thread,
// with the thread's own subject. Messages the person sent themselves and drafts are never the one replied to.
function replyHeaderOptions(thread, fallbackId, subject) {
  const ms = ((thread && thread.messages) || []).filter(m => !(m.labelIds || []).some(l => l === "DRAFT" || l === "TRASH"));
  const hd = (m, n) => ((((m || {}).payload || {}).headers || []).find(h => h.name.toLowerCase() === n) || {}).value || "";
  const brand = ms.filter(m => !(m.labelIds || []).includes("SENT")).pop() || ms.find(m => m.id === fallbackId) || ms[ms.length - 1];
  const bid = hd(brand, "message-id");
  const ids = ms.map(m => hd(m, "message-id")).filter(Boolean);
  const strip = s => String(s || "").replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "").trim();
  const first = strip(hd(ms[0], "subject")), bsub = strip(hd(brand, "subject"));
  const out = [];
  if (bid) {
    const chain = String(hd(brand, "references")).split(/\s+/).filter(x => x && x !== bid).join(" ");
    out.push({ label: "brand's latest message and its chain", subject, inReplyTo: bid, references: chain });
    if (chain) out.push({ label: "brand's latest message alone", subject, inReplyTo: bid, references: "" });
    // Gmail also needs the subject to match the thread's: use the brand message's own subject, exactly as it is stored.
    if (bsub && strip(subject).toLowerCase() !== bsub.toLowerCase()) out.push({ label: "brand's own subject", subject: "Re: " + bsub, inReplyTo: bid, references: chain });
  }
  if (ids.length) out.push({ label: "whole thread, thread subject", subject: first ? "Re: " + first : subject, inReplyTo: ids[ids.length - 1], references: ids.slice(-20, -1).join(" ") });
  return out.length ? out : [{ label: "no headers", subject }];
}
// What the board says when a teammate's draft could not be made where it belongs.
function draftNote(r) {
  return r === DRAFT_OUTSIDE ? "the draft is in your Gmail Drafts folder, but Gmail would not put it in the brand's thread" : "the draft was not made (" + String(r).slice(0, 160) + ")";
}

// Clean Gmail drafts for anything Claude writes by hand (Tom, 19 Oct 2026: "really annoying that the links here get
// garbled. We need a robust rule that stops this from happening"). Drafts made through the Gmail connector come back with
// every link wrapped in a google.com/url redirect, and Tati's Mediacube reply went out like that. This saves the draft
// straight through the Gmail API instead, in the signed-in person's own mailbox: links unwrapped (cleanLinks), threaded
// under the brand's latest message with its quote, older drafts on that thread removed, then read back. If any wrapped
// link survives, the draft is deleted again and the call fails, so a garbled draft can never be left behind.
async function makeDraft(b, email) {
  const tok = await gmailToken(email); if (!tok) throw new Error("Gmail is not connected for " + email);
  const G = (path, opt = {}) => fetch("https://gmail.googleapis.com/gmail/v1/users/me" + path, Object.assign({}, opt, { headers: Object.assign({ Authorization: "Bearer " + tok }, opt.headers || {}) })).then(async r => { const t = await r.text(); let j = {}; try { j = t ? JSON.parse(t) : {}; } catch (_) {} if (!r.ok) throw new Error("Gmail " + r.status + " " + ((j.error || {}).message || "")); return j; });
  const to = String(b.to || "").trim(), subject = String(b.subject || "").trim(), body = String(b.html || "").trim();
  if (!/@/.test(to) || !subject || !body) throw new Error("to, subject and html are needed");
  if (/@digitalfoxtalent\.com\b/i.test(to) && !b.internal) throw new Error("The draft is addressed to a DFT address (" + to + "). Pass internal:true if that is meant.");
  const hdr = (m, n) => ((((m || {}).payload || {}).headers || []).find(h => h.name.toLowerCase() === n) || {}).value || "";
  let threadId = String(b.threadId || ""), inReplyTo = "", refs = "", quoteHtml = "", quoteText = "";
  if (threadId) {
    const th = await G("/threads/" + threadId + "?format=full");
    const brand = (th.messages || []).filter(x => !(x.labelIds || []).some(l => l === "SENT" || l === "DRAFT")).pop() || (th.messages || []).filter(x => !(x.labelIds || []).includes("DRAFT")).pop();
    if (brand) {
      inReplyTo = hdr(brand, "message-id"); refs = hdr(brand, "references");
      let h = "", t = "";
      const walk = x => { if (!x) return; if (x.body && x.body.data) { const d = Buffer.from(x.body.data, "base64url").toString("utf8"); if (/text\/html/.test(x.mimeType || "") && !h) h = d; else if (/text\/plain/.test(x.mimeType || "") && !t) t = d; } (x.parts || []).forEach(walk); };
      walk(brand.payload);
      if (b.quote !== false) {
        const attr = "On " + hdr(brand, "date") + " " + hdr(brand, "from") + " wrote:";
        const inner = h ? h.replace(/^[\s\S]*?<body[^>]*>/i, "").replace(/<\/body>[\s\S]*$/i, "") : escH(t).replace(/\n/g, "<br>");
        quoteHtml = '<br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">' + escH(attr) + '<br></div><blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">' + inner + "</blockquote></div>";
        quoteText = "\n\n" + attr + "\n\n" + String(t || htmlToText(h)).split("\n").map(l => "> " + l).join("\n");
      }
    }
  }
  const html = (/^\s*<div/i.test(body) ? body : '<div dir="ltr">' + body + "</div>") + quoteHtml;
  const text = String(b.text || htmlToText(body.replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 \u0001$1\u0002")).replace(/\u0001/g, "<").replace(/\u0002/g, ">")) + quoteText; // the plain-text part keeps each link's address
  // One draft per thread (Tom, 15 Oct 2026): any older draft on this thread goes.
  let removed = 0;
  if (threadId) { const dr = (await G("/drafts?maxResults=50").catch(() => ({}))).drafts || []; for (const d of dr) if (d.message && d.message.threadId === threadId) { await G("/drafts/" + d.id, { method: "DELETE" }).catch(() => null); removed++; } }
  const made = await G("/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: pitchMime({ to, cc: b.cc || "", subject, html, text, threadId, inReplyTo, references: refs }).draft });
  // Read it back exactly as Gmail stored it.
  const back = await G("/drafts/" + made.id + "?format=raw");
  const raw = Buffer.from(String(((back.message || {}).raw) || ""), "base64url").toString("utf8");
  let decoded = raw; for (const m of raw.matchAll(/Content-Transfer-Encoding: base64\r?\n\r?\n([A-Za-z0-9+\/=\r\n]+)/g)) decoded += "\n" + Buffer.from(m[1].replace(/\s+/g, ""), "base64").toString("utf8");
  const hrefs = [...decoded.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  const bad = hrefs.filter(h => /google\.[a-z.]+\/url\?/i.test(h));
  if (bad.length) { await G("/drafts/" + made.id, { method: "DELETE" }).catch(() => null); throw new Error("Draft deleted again: " + bad.length + " link(s) were still wrapped"); }
  return { ok: true, draftId: made.id, threadId: (back.message || {}).threadId || threadId, removed, links: [...new Set(hrefs.filter(h => !/^mailto:/i.test(h)))].filter(h => body.includes(h) || cleanLinks(body).includes(h)) };
}
// Clean links in every draft (Tom, 14 Oct 2026): a link copied from Gmail or a quoted thread can
// arrive wrapped as https://www.google.com/url?q=<real url>&sa=...; unwrap it to the real URL.
function cleanLinks(s) {
  return String(s || "").replace(/https?:\/\/(?:www\.)?google\.[a-z.]+\/url\?[^\s"'<>]*/gi, m => {
    const q = /[?&](?:amp;)?(?:q|url)=([^&\s"'<>]+)/i.exec(m);
    if (!q) return m;
    try { const u = decodeURIComponent(q[1]); return /^https?:\/\//i.test(u) ? u.replace(/&/g, m.includes("&amp;") ? "&amp;" : "&") : m; } catch (_) { return m; }
  });
}
function pitchMime(b) {
  b = Object.assign({}, b, { html: cleanLinks(b.html), text: cleanLinks(b.text) });
  const enc = s => /[^\x20-\x7e]/.test(s) ? "=?UTF-8?B?" + Buffer.from(s, "utf8").toString("base64") + "?=" : s;
  const b64 = s => Buffer.from(String(s || ""), "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  const bound = "dftpitch" + crypto.randomBytes(8).toString("hex");
  const head = ["To: " + String(b.to || ""), "Subject: " + enc(String(b.subject || ""))];
  if (b.cc) head.push("Cc: " + b.cc);
  if (b.inReplyTo) head.push("In-Reply-To: " + b.inReplyTo, "References: " + (b.references ? b.references + " " : "") + b.inReplyTo);
  head.push("MIME-Version: 1.0", "Content-Type: multipart/alternative; boundary=\"" + bound + "\"");
  const parts = ["--" + bound, "Content-Type: text/plain; charset=\"UTF-8\"", "Content-Transfer-Encoding: base64", "", b64(b.text), "--" + bound, "Content-Type: text/html; charset=\"UTF-8\"", "Content-Transfer-Encoding: base64", "", b64(b.html), "--" + bound + "--", ""];
  const message = { raw: Buffer.from(head.join("\r\n") + "\r\n\r\n" + parts.join("\r\n"), "utf8").toString("base64url") };
  if (b.threadId) message.threadId = String(b.threadId);
  return { ok: true, draft: JSON.stringify({ message }) };
}

export { teamDraft, replyHeaderOptions }; // for test/team-draft-thread.mjs
export { contractAsks }; // for test/contract-asks.mjs

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
      const nx = decodeURIComponent((String(req.headers.cookie || "").match(/(?:^|;\s*)dft_next=([^;]+)/) || [])[1] || "");
      res.setHeader("Set-Cookie", [setTeamCookie(res, secret, who), "dft_next=; Path=/; Max-Age=0; Secure; SameSite=Lax"]);
      res.setHeader("Location", /^\/api\/roster\?op=(?:outreach|recruit|contract)&/.test(nx) ? nx : "/");
      return res.status(302).end();
    }
    // The Sales Desk Draft button (Tom, 16 Oct 2026). Signed out, it goes to sign in first and comes back here.
    if (q.op === "recruit") {
      res.setHeader("Cache-Control", "private, no-store");
      if (!email) { res.setHeader("Set-Cookie", "dft_next=" + encodeURIComponent(req.url) + "; Path=/; Max-Age=900; Secure; SameSite=Lax"); res.setHeader("Location", "/signin"); return res.status(302).end(); }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(recruitPage(q));
    }
    // The contract amendment Draft button (Tom, 23 Oct 2026). Signed out, it signs in first and comes back.
    if (q.op === "contract") {
      res.setHeader("Cache-Control", "private, no-store");
      if (!email) { res.setHeader("Set-Cookie", "dft_next=" + encodeURIComponent(req.url) + "; Path=/; Max-Age=900; Secure; SameSite=Lax"); res.setHeader("Location", "/signin"); return res.status(302).end(); }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(contractPage(q));
    }
    if (q.op === "outreach") {
      res.setHeader("Cache-Control", "private, no-store");
      if (!email) { res.setHeader("Set-Cookie", "dft_next=" + encodeURIComponent(req.url) + "; Path=/; Max-Age=900; Secure; SameSite=Lax"); res.setHeader("Location", "/signin"); return res.status(302).end(); }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(outreachPage(q));
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
        try { return res.status(200).json(await brandFeedback(b, email)); }
        catch (e) { return res.status(400).json({ error: String(e && e.message || e) }); }
      }
      if (b && b.op === "list-seen") {
        if (!origin) return res.status(403).json({ error: "Bad origin" });
        try { return res.status(200).json(await listSeen(b)); }
        catch (e) { return res.status(400).json({ error: String(e && e.message || e) }); }
      }
      if (b && b.op === "list-claim") {
        if (!origin) return res.status(403).json({ error: "Bad origin" });
        try { return res.status(200).json(await listClaim(b)); }
        catch (e) { return res.status(400).json({ error: String(e && e.message || e) }); }
      }
      if (b && b.op === "creator-videos") {
        try { return res.status(200).json(await creatorVideos(b)); }
        catch (e) { return res.status(400).json({ error: String(e && e.message || e) }); }
      }
      if (b && b.op === "brand-submit") {
        if (!origin) return res.status(403).json({ error: "Bad origin" });
        try { return res.status(200).json(await brandSubmit(b)); }
        catch (e) { return res.status(400).json({ error: String(e && e.message || e) }); }
      }
      // Pitch pipeline (Tom, 13 Oct 2026): Make, with a fresh Roster - Pitch Requests item as proof.
    if (b && b.op === "pitch-mime") { try { return res.status(200).json(pitchMime(await pitchReplyTo(b))); } catch (e) { return res.status(400).json({ error: String(e && e.message || e) }); } }
    // sub, thread and multiFailed are internal to a multi-campaign run; never accept them from a request (audit 19 Oct 2026:
    // sending "sub" skipped the fresh Pitch Requests item check).
    if (b && b.op === "pitch") { try { const { sub: _s, thread: _t, multiFailed: _m, ...clean } = b; return res.status(200).json(await pitchFromEmail(clean)); } catch (e) { return res.status(400).json({ error: String(e && e.message || e) }); } }
    if (!email) return res.status(401).json({ error: "Sign in with your DFT Google account" });
      try {
        if (b.op === "draft") return res.status(200).json(await makeDraft(b, email));
        if (b.op === "edit") return res.status(200).json(await editRow(b, email));
        if (b.op === "undo-edit") return res.status(200).json(await undoEdit(b, email));
        if (b.op === "save-list") return res.status(200).json(await saveList(b, email));
        if (b.op === "delete-list") return res.status(200).json(await deleteList(b));
        if (b.op === "columns") return res.status(200).json(await saveColumns(b, email));
        if (b.op === "list-price") return res.status(200).json(await listPrice(b, email));
        if (b.op === "list-price-all") return res.status(200).json(await listPriceAll(b, email));
        if (b.op === "list-lock") return res.status(200).json(await listLock(b, email));
        if (b.op === "list-confirm") return res.status(200).json(await listConfirm(b, email));
        if (b.op === "creator-response") return res.status(200).json(await creatorResponse(b, email));
        if (b.op === "list-label") return res.status(200).json(await listLabel(b, email));
        if (b.op === "list-type") return res.status(200).json(await listType(b, email));
        if (b.op === "list-ideas-on") return res.status(200).json(await listIdeasOn(b, email));
        if (b.op === "list-ai-view") return res.status(200).json(await listAiView(b, email));
        if (b.op === "campaign-ideas") return res.status(200).json(await listCampaignIdeas(b, email));
        if (b.op === "list-libsyn") return res.status(200).json(await listLibsyn(b, email));
        if (b.op === "libsyn-report-url") return res.status(200).json({ url: await libsynReportUrl() });
        // Make the confirmation draft for a list now, without waiting for the next brand tick (team only).
        if (b.op === "confirm-draft") { const { data, list } = await freshList(b.slug); if (!list || list.bad) throw new Error("list not found"); const th = await listThread(list); if (!th) throw new Error("No email thread found for this list"); const { ok } = feedbackEmail(data, list); const c = await confirmDraft(list, ok, th); if (c) await writeList(list.id, Object.assign({}, list.body, { thread: { id: th.id }, confirm: c }), {}); return res.status(200).json({ made: !!c, to: c ? c.to : "", approved: ok.length, subject: th.subject }); }
        // Which email thread a list's brand-feedback alert will go into (read only, for checking).
        if (b.op === "list-thread") { const { list } = await freshList(b.slug); if (!list) throw new Error("list not found"); const t = await listThread(list); return res.status(200).json({ found: !!t, subject: t ? t.subject : "", thread: t ? t.id : "" }); }
        if (b.op === "outreach-draft") return res.status(200).json(await outreachDraft(b, email));
        if (b.op === "recruit-draft") return res.status(200).json(await recruitDraft(b, email));
        if (b.op === "contract-draft") return res.status(200).json(await contractDraft(b, email));
        if (b.op === "pitch-audit") return res.status(200).json(await pitchAudit(b));
        if (b.op === "list-idea") return res.status(200).json(await listIdea(b, email));
        if (b.op === "ideas-draft") return res.status(200).json(await ideasDraft(b, email));
        if (b.op === "list-show") return res.status(200).json(await listShow(b, email));
        if (b.op === "list-order") return res.status(200).json(await listOrder(b, email));
        if (b.op === "list-preview") return res.status(200).json(await listPreview(b));
        if (b.op === "list-remove") return res.status(200).json(await listRemove(b, email));
        if (b.op === "list-rename") return res.status(200).json(await listRename(b, email));
      } catch (e) {
        return res.status(400).json({ error: String(e && e.message || e) });
      }
      return res.status(400).json({ error: "unknown op" });
    }

    if (q.view === "team") {
      res.setHeader("Cache-Control", "private, no-store");
      if (!email) return res.status(401).json({ error: "signin" });
      // "fresh" no longer throws the copy away: loadBoard checks monday for changes anyway.
      const data = await loadBoard();
      res.setHeader("Set-Cookie", setTeamCookie(res, secret, email)); // keep the session alive while used
      return res.status(200).json(teamPayload(data, email));
    }

    // Warm-up (roster-warm cron): loads the board into this server copy so the first list
    // page or signed-in view after a quiet spell does not wait for a cold start.
    if (q.warm) { res.setHeader("Cache-Control", "no-store"); await loadBoard(); const alerts = await feedbackAlerts().catch(e => "failed: " + String((e && e.message) || e).slice(0, 200)); const ideas = await pendingIdeas().catch(e => "failed: " + String((e && e.message) || e).slice(0, 200)); const nw = new Date(); const audit = nw.getUTCHours() % 6 === 0 && nw.getUTCMinutes() < 5 ? await pitchAudit({ days: 3, write: true }).then(r => r.flagged + " shared").catch(e => "failed: " + String((e && e.message) || e).slice(0, 200)) : ""; const stale = nw.getUTCHours() === 10 && nw.getUTCMinutes() < 5 ? await archiveStaleLists().catch(e => "failed: " + String((e && e.message) || e).slice(0, 200)) : ""; return res.status(200).json({ ok: true, alerts, ideas, audit, stale }); }
    if (q.list) {
      // The list itself is read fresh every time (one small call), so a page never shows, or
      // later saves over, an older copy of it.
      const { data, list } = await freshList(q.list);
      if (!list) { res.setHeader("Cache-Control", "s-maxage=30"); return res.status(404).json({ error: "This list is no longer available" }); }
      if (email) { // the team sees which prices are list-only; never cache that copy
        res.setHeader("Cache-Control", "private, no-store");
        return res.status(200).json(brandPayload(data, list, true));
      }
      // Not edge-cached: a brand's own approvals and notes must show as soon as they reload.
      res.setHeader("Cache-Control", "private, no-store");
      return res.status(200).json(brandPayload(data, list, false));
    }
    const data = await loadBoard();
    // Signed in: always the latest, never an edge copy (so Brand preview matches an edit
    // straight away). Brands: a short edge copy, refreshed in the background, so the page
    // stays instant and an edit reaches brands within a few minutes at most.
    if (email) { res.setHeader("Cache-Control", "private, no-store"); return res.status(200).json(brandPayload(data, null)); }
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=600");
    return res.status(200).json(brandPayload(data, null));
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
