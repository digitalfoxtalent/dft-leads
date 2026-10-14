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
  // YouTube Dedicated (Tom, 13 Oct 2026): a whole video about the brand. Not a monday group:
  // each YouTube channel row is shown again here, priced from its own numbers (see dedNumbers).
  { id: "dedicated", kind: "long", virtual: true },
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
const isDedId = id => /^d\d+$/.test(String(id));
const ROW_ID = /^d?\d+$/; // monday item ids, or d<item id> for a channel's Dedicated row
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
    if (o.vg > 0) o.rate = Math.round(o.vg * o.cpm / 1000);
    if (o.vgPer != null) o.ratePer = Math.round(o.vgPer * o.cpm / 1000);
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
  const listsQ = `query{boards(ids:[${LISTS_BOARD}]){items_page(limit:500){items{id name column_values(ids:${JSON.stringify([...new Set(Object.values(L).concat(ITEM_COLS))])}){id text}}}}}`;
  const regQ = `query{boards(ids:[${REGISTER_BOARD}]){items_page(limit:500){items{column_values(ids:${JSON.stringify(Object.values(REG))}){id text}}}}}`;
  const megaQ = `query{boards(ids:[${MEGA_BOARD}]){items_page(limit:500){items{column_values(ids:${JSON.stringify(Object.values(MEGA))}){id text}}}}}`;
  const [groups, state, lists, register, mega] = await Promise.all([
    Promise.all(REAL_GROUPS().map(g => monday(groupQ(g.id)))),
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
      rows.push({ id: String(it.id), name: it.name, group: REAL_GROUPS()[gi].id, kind, cv, creator, adEx, state: geo.region, country: geo.country, kit: kitFor(creator, cv[C.handle], it.name), shows, simulcast: sim });
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

  const listItems = ((((lists || {}).boards || [])[0] || {}).items_page || { items: [] }).items.map(it => {
    const cv = {}; (it.column_values || []).forEach(c => { cv[c.id] = c.text || ""; });
    const { body, bad } = readListBody(cv);
    return { id: String(it.id), name: it.name, slug: cv[L.slug], body, bad, by: cv[L.by], updated: cv[L.updated] };
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
  Object.assign(l, { name: it.name, slug: cv[L.slug] || l.slug, body, bad, by: cv[L.by], updated: cv[L.updated] });
  return { data, list: l };
}

// ---------------------------------------------------------------- shaping

function baseFields(r) {
  const cv = r.cv, o = {
    id: r.id, name: r.name, handle: cv[C.handle] || "", url: cv[C.url] || "", logo: r.logo, kind: r.kind, group: r.group,
    subs: pos(cv[C.subs]), adLength: r.dedicated ? "Full video" : AD_LENGTH, adEx: r.adEx, kit: r.kit || "", state: r.state,
    simulcast: r.simulcast ? "Included" : "",
  };
  if (r.dedicated) o.parentId = r.parentId;
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
function discountFor(own, p, kind, now, isShow) {
  if (!isDisc(p) || !now) return null;
  const was = priced(own, Object.assign({}, p, { cpm: p.discFrom }), kind, isShow);
  if (!was || !(was.rate > now.rate)) return null;
  return { wasRate: was.rate, wasTotal: isShow ? was.rate : was.total, discPct: Math.round((1 - now.rate / was.rate) * 100) };
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
  const groups = {};
  GROUPS.forEach(g => { groups[g.id] = []; });
  data.rows.forEach(r => {
    if (ids && !ids.has(r.id)) return;
    const o = brandRow(r, !!ids, prices, team, list ? (list.body.showVis || {}) : null);
    if (o && list) {
      // Brands see the whole Stage too (Tom, 10 Oct 2026), read only apart from Brand approved.
      o.confirmed = confirmed.has(r.id); o.stage = o.confirmed ? "confirmed" : approached.has(r.id) ? "approached" : "";
      const f = feedback[r.id]; if (f && (f.ok || f.no || f.note)) o.fb = { ok: !!f.ok, no: !f.ok && !!f.no, note: String(f.note || "") };
      const cr = creatorRes[r.id]; if (cr && (cr.ok || cr.no || cr.note)) o.cr = { ok: !!cr.ok, no: !cr.ok && !!cr.no, note: String(cr.note || "") };
    }
    if (o && lock && !noLock) applyLock(o, lock);
    if (o) groups[r.group].push(o);
  });
  if (ids) { // keep the order the list was saved in
    const order = {}; (list.body.ids || []).forEach((id, i) => { order[String(id)] = i; });
    Object.values(groups).forEach(a => a.sort((x, y) => order[x.id] - order[y.id]));
  } else Object.values(groups).forEach(a => a.sort((x, y) => (y.vgPer || y.vg || y.rate || 0) - (x.vgPer || x.vg || x.rate || 0)));
  return { view: "brand", quarter: quarterLabel(), columns: data.columns, widths: data.widths, rows: ids ? {} : data.rowOrder, list: list ? { title: list.name, slug: list.slug, manual: !!list.body.manual,
    ids: team ? (list.body.ids || []).map(String) : undefined, // the team's copy: every creator, shown or not
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
    // Short form: store the publishing rate the roster shows (to the $100) beside its
    // production fee and the total, so the board reads the same as the page.
    if (kind !== "long") rate = r100(rate);
    // Brand CPM keeps the CPM that was asked for (not rate / views), so a small row lifted
    // by the floor is bundled at the CPM DFT chose rather than the house $25.
    Object.assign(values, {
      [K.bvg]: String(vg), [K.bcpm]: String(r2(cpm)), [K.brate]: String(rate), [K.bq]: quarterLabel(),
      [K.bnote]: "Edited by " + email + " on " + stamp() + " (was VG " + (cur.vg || "-") + ", CPM $" + (cur.cpm || "-") + "); resets next quarter",
    });
    if (kind !== "long" && K.bfee) Object.assign(values, { [K.bfee]: String(feeFor(vg)), [K.btotal]: String(rate + feeFor(vg)) });
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
  return brandPayload(data, Object.assign({}, list, { body }), true);
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
  const body = Object.assign({}, list.body, { feedback });
  await writeList(list.id, body, {});
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
    if (g.id === "dedicated") { dedViews += c.vg || 0; videos += c.minVideos || 1; }
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
export const config = { maxDuration: 120 };
const PITCH_BOARD = 18435316650;
const AI_LIST = "ai-campaigns-tj-50001f"; // Tom's saved list of creators open to AI brands (13 Oct 2026). Edit the list, not the code.
const PB = { by: "text_mm83t28h", contact: "text_mm83nbr6", result: "text_mm83dzmw", list: "link_mm832b9j" };
const PITCH_MODELS = ["claude-opus-5-5", "claude-sonnet-4-5", "claude-haiku-4-5-20251001"]; // strongest first (Tom, 14 Oct 2026), older models only as a fallback
const FACTS_ITEM = 13283766377; // Pitch Requests item "Standing facts for pitch replies": the only facts a reply may state
const PITCH_LABEL = { topics: "YouTube integration", dedicated: "YouTube dedicated video", group_mm4av3kr: "YouTube Shorts", group_mm4a1fe0: "Instagram", group_mm4bd5tk: "TikTok", group_mm7yw8cy: "Snapchat" };
const kfmt = n => !n ? "" : n >= 1e6 ? (Math.round(n / 1e5) / 10) + "M" : n >= 1000 ? Math.round(n / 1000) + "K" : String(n);
const escH = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const noDash = s => String(s == null ? "" : s).replace(/\s*\u2014\s*/g, ", ").replace(/\u2013/g, "-").trim();
const htmlToText = h => String(h || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/\n{3,}/g, "\n\n").trim();

function parseForward(b) {
  const text = String(b.text || "").trim() || htmlToText(b.html);
  const at = text.search(/-{3,}\s*Forwarded message\s*-{3,}|Begin forwarded message:/i);
  const fwd = at >= 0 ? text.slice(at) : text;
  const from = fwd.match(/From:\s*\*?\s*"?([^"<\n*]*?)"?\s*\*?\s*<([^>\s]+@[^>\s]+)>/i) || fwd.match(/From:\s*\*?\s*([^\s<>*]+@[^\s<>*]+)/i);
  const subj = fwd.match(/\nSubject:\s*\*?\s*(.+)/i);
  const to = fwd.match(/\nTo:\s*(.+)/i);
  const fromAt = Math.max(0, fwd.search(/From:/i)), hdrLen = fwd.slice(fromAt).search(/\n[ \t]*\n/);
  const hdr = fwd.slice(fromAt, hdrLen > 0 ? fromAt + hdrLen : fromAt + 800).replace(/^From:[^\n]*/i, "");
  const others = [...new Set((hdr.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).map(x => x.toLowerCase()))];
  return {
    contactName: from && from[2] ? from[1].trim() : "",
    contactEmail: from ? String(from[2] || from[1]).trim().toLowerCase() : "",
    subject: String(String(b.subject || "").replace(/^\s*((fwd?|fw):\s*)+/i, "").trim() || (subj ? subj[1] : "")).replace(/\*+/g, "").trim(),
    to: to ? to[1].replace(/\*+/g, "").trim() : "",
    others,
    note: at > 0 ? text.slice(0, at).split(/(?:^|\n)\s*(?:Warm regards|Kind regards|Best regards|Thanks,?\s*\n\s*Tom)/i)[0].trim().slice(0, 1500) : "",
    body: fwd.slice(0, 12000),
  };
}

// What brands can see today, one line per placement, for Claude to choose from.
function pitchCatalogue(data) {
  const p = brandPayload(data, null, false), lines = [], byId = {};
  GROUPS.forEach(g => (p.groups[g.id] || []).forEach(c => {
    byId[String(c.id)] = Object.assign({ gid: g.id }, c);
    const price = typeof c.total === "number" ? c.total : c.rate;
    const views = c.vg ? kfmt(c.vg) + (g.kind !== "long" ? " avg views" : g.id === "dedicated" ? " est views" : " guaranteed views") : "";
    lines.push([c.id, PITCH_LABEL[g.id], c.name, c.handle, c.category || "", c.subs ? kfmt(c.subs) + " subs" : "", views, price ? "$" + price : "", c.location ? "based in " + c.location : "", c.us ? "US audience " + c.us : "", c.uk ? "UK audience " + c.uk : "", c.male ? "male " + c.male : "", String(c.about || "").replace(/\s+/g, " ").slice(0, 140)].join(" | "));
  }));
  return { lines, byId };
}

async function askClaude(prompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  let last = "";
  for (const model of PITCH_MODELS) {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model, max_tokens: 9000, messages: [{ role: "user", content: prompt }] }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d && d.content) {
      const t = String((d.content.find(x => x.type === "text") || {}).text || "").split("```json").join("").split("```").join("");
      const a = t.indexOf("{"), z = t.lastIndexOf("}");
      if (a >= 0 && z > a) return Object.assign(JSON.parse(t.slice(a, z + 1)), { model });
      last = model + ": no JSON in the answer"; continue;
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
    const a = t.indexOf("{"), z = t.lastIndexOf("}");
    if (a >= 0 && z > a) { try { return JSON.parse(t.slice(a, z + 1)); } catch (_) { return null; } }
    return null;
  }
  return null;
}

function reviewPrompt(f, lines, pointers, researchTxt) {
  return [
    "You are Tom James, founder of Digital Fox Talent, checking a creator shortlist before it goes to a brand. Be a demanding, experienced talent agent who knows these creators.",
    "THE ENQUIRY (newest message first, then any earlier thread; DFT's own replies in the thread stand):",
    String(f.subject || ""),
    String(f.body || "").slice(0, 9000),
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

function pitchPrompt(f, lines, fwdName, aiNames, namedNames, pointers, facts, researchTxt) {
  return [
    "You help Digital Fox Talent (DFT), a creator management agency, answer a brand enquiry with a shortlist from its creator roster.",
    "",
    "THE ENQUIRY (forwarded by " + fwdName + " at DFT. Original sender: " + (f.contactName || "unknown") + " <" + f.contactEmail + ">. Sent to: " + (f.to || "unknown") + ")",
    f.note ? "POINTER FROM " + fwdName.toUpperCase() + " FOR THIS ENQUIRY (top priority, follow it exactly: creators to add or leave out, formats, angle, list size): " + f.note : "",
    pointers && pointers.length ? "PAST POINTERS FROM THE DFT TEAM (standing guidance learned from earlier pitches; apply wherever relevant):\n- " + pointers.join("\n- ") : "",
    "-----", f.body, "-----",
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
    "- AI campaigns: only these creators accept AI brands (AI tools, AI apps, generative AI): " + (aiNames || []).join(", ") + ". If the product or campaign is AI-related, set ai_product to true and pick ONLY from them (any of their formats), except creators the enquiry names or says DFT already confirmed, who are always included. Otherwise set ai_product to false.",
    "- First work out who would buy or love this product and what kind of video would sell it. Then name 4 to 6 different angles a creator could cover it from: the same-genre angle, plus adjacent ones such as reaction and commentary, pop culture, film and TV, comedy and group personalities, family, lifestyle, fitness or tech, whichever genuinely fit.",
    "- Big, engaged reaction and personality channels (group reaction shows, for example) often sell fun, social or entertainment products better than niche specialists. Consider them seriously.",
    "- Read each creator's about line, not just the category, to judge audience and tone.",
    "- Respect any market or territory limit (a pointer or brief saying a campaign is for one country only means only creators based in, or with a real audience in, that country). If that leaves one creator, return one.",
    "- Always include any creator the brand's newest message names, asks about, or says DFT already confirmed, and any creator it was sent to (a creator's DFT inbox in the To line counts only on a first enquiry with no earlier thread), plus any creator the note from " + fwdName + " asks for. Mark these picks named: true. A named creator who is not in the roster above has left DFT: leave them out and do not mention them.",
    namedNames && namedNames.length ? "- Named in this enquiry and on the roster: " + namedNames.join(", ") + ". They are always on the list, whatever else applies." : "",
    "- How many: every creator who genuinely fits, with no upper limit (the whole roster is fine if the brief truly suits everyone). Aim for at least 10 creators, topping up with the next-best real fits, unless a pointer, a market limit or the AI rule leaves fewer. Mix the closest fits with adjacent angles so the brand sees options it would not have thought of.",
    "- Be considerate about fit, creator by creator: leave out anyone whose audience, tone or content would jar with this brand or product, even if the category looks close (for example an edgy, mature or horror-led channel on a family or kids brief, a hardcore gaming channel on a beauty brief, an adult-skewing audience for a toy). Check age split, gender split and location against who the product is for. When unsure, leave them out.",
    "- Give each pick a fit score from 1 to 5 (5 = obvious fit, 4 = strong, 3 = solid adjacent fit). Do not pick anyone below 3. Named creators are always included whatever their fit.",
    "- Formats: strictly the ones the brand explicitly asks for in this campaign. A passing mention of a platform (e.g. 'as we grow on TikTok') is not a request. List them in formats using only: integration, dedicated, shorts, instagram, tiktok, snapchat (a general 'YouTube video' means integration). If the brand does not define formats, leave formats empty and DFT offers YouTube: integration plus Shorts. Integration = YouTube integration; dedicated or full video = YouTube dedicated video; Shorts = YouTube Shorts; TikTok, Instagram and Snapchat as named. Give each creator every requested format they have; skip formats they lack.",
    "- Leave out short-form placements under 5K avg views and YouTube placements under 20K views unless the creator is named.",
    "- Never invent ids.",
    "",
    "THE REPLY",
    "Do not write the email (it is built from a fixed template). Give only: product, the short brand or product name exactly as people would say it (e.g. Catch Flex, Higgsfield), never a description; mix, a short phrase for the kinds of channels on your list (e.g. gaming, reaction, and personality channels); and answer, one or two short plain sentences that directly answer any practical question the enquiry asks, otherwise empty. answer may only use these facts: the current rates are on the list; availability and posting dates are confirmed with each creator as soon as they approve, and we can move quickly; which of the named creators are on the list (only those given above as named and on the roster). Never say a creator is not on the roster, has left, or is unavailable: simply leave other names out. Never invent availability, dates, prices or numbers, never mention creators who left, and never refer to anything below or attached. No em dashes, no slashes.",
    "",
    "Return ONLY JSON, no prose:",
    "{\"brand\":\"\",\"ai_product\":false,\"product\":\"\",\"title\":\"short list name, e.g. EXT (Exterminauts)\",\"contact_first_name\":\"the sender's first name if known, else empty\",\"angles\":[\"\"],\"mix\":\"\",\"answer\":\"\",\"stage\":\"new\",\"closing\":false,\"formats\":[],\"questions\":[{\"q\":\"short paraphrase\",\"answer\":\"\"}],\"picks\":[{\"id\":\"\",\"named\":false,\"fit\":4,\"why\":\"max 6 words\"}]}"
  ].join("\n");
}

async function pitchItem(id, fromEmail) {
  const d = await monday("query($i:[ID!]){items(ids:$i){id name created_at board{id} column_values(ids:[\"" + PB.by + "\",\"" + PB.result + "\"]){id text}}}", { i: [String(id || "0")] });
  const it = d && d.items && d.items[0];
  if (!it || String(it.board && it.board.id) !== String(PITCH_BOARD)) throw new Error("Unknown pitch request");
  if (Date.now() - Date.parse(it.created_at) > 15 * 60 * 1000) throw new Error("Pitch request is too old");
  const cv = {}; (it.column_values || []).forEach(c => { cv[c.id] = String(c.text || ""); });
  if (cv[PB.result]) throw new Error("Pitch request already used");
  const by = cv[PB.by].trim().toLowerCase();
  if (!/@digitalfoxtalent\.com$/.test(by) || by !== String(fromEmail || "").trim().toLowerCase()) throw new Error("Pitch request does not match the forwarder");
  return it;
}
async function pitchMark(id, result, url) {
  const v = {}; v[PB.result] = result; if (url) v[PB.list] = { url, text: "Open list" };
  await monday("mutation($b:ID!,$i:ID!,$v:JSON!){change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id}}", { b: String(PITCH_BOARD), i: String(id), v: JSON.stringify(v) });
}

async function pitchFromEmail(b) {
  const fromEmail = String(b.fromEmail || "").trim().toLowerCase();
  await pitchItem(b.item, fromEmail);
  try {
    const f = parseForward(b);
    // Tom's pointers (13 Oct 2026): the note above each forward is kept on the Pitch Requests board and fed into later pitches, so the system learns from them.
    if (f.note) await monday(`mutation{change_multiple_column_values(board_id:${PITCH_BOARD},item_id:${Number(b.item)},column_values:${JSON.stringify(JSON.stringify({ long_text_mm83jwpf: { text: f.note } }))}){id}}`).catch(() => null);
    const pastQ = await monday(`query{boards(ids:[${PITCH_BOARD}]){items_page(limit:200){items{id column_values(ids:["long_text_mm83jwpf"]){text}}}}}`).catch(() => null);
    const pointers = (((((pastQ || {}).boards || [])[0] || {}).items_page || {}).items || []).filter(it => String(it.id) !== String(b.item) && String(it.id) !== String(FACTS_ITEM)).map(it => String(((it.column_values || [])[0] || {}).text || "").trim()).filter(p => p && !/^(warm|kind|best) regards/i.test(p)).filter((p, i, a) => a.indexOf(p) === i).slice(-30);
    if (!f.contactEmail || f.body.length < 40) throw new Error("No forwarded enquiry found. Forward the brand's own email.");
    const factsQ = await monday(`query{items(ids:[${FACTS_ITEM}]){column_values(ids:["long_text_mm83jwpf"]){text}}}`).catch(() => null);
    const facts = String(((((factsQ || {}).items || [])[0] || {}).column_values || [{}])[0].text || "").trim();
    const data = await loadBoard();
    const cat = pitchCatalogue(data);
    // Brand fit notes (Rates board column, Tom 14 Oct 2026): DFT's own judgement on who each creator suits, applied to all of that creator's formats.
    const fitQ = await monday(`query{boards(ids:[${BOARD}]){items_page(limit:500){items{id name column_values(ids:["long_text_mm84rm3j","text_mm49w81b"]){id text}}}}}`).catch(() => null);
    const fitKey = k => String(k || "").replace(/\s*-\s*(Shorts|Instagram|TikTok|Snapchat|Dedicated)\b.*$/i, "").replace(/^@/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const fitBy = {};
    (((((fitQ || {}).boards || [])[0] || {}).items_page || {}).items || []).forEach(it => { const cv = {}; (it.column_values || []).forEach(c => { cv[c.id] = c.text || ""; }); const t = String(cv.long_text_mm84rm3j || "").replace(/\s+/g, " ").trim(); if (!t) return; [it.name, cv.text_mm49w81b].forEach(k => { const n = fitKey(k); if (n.length >= 4) fitBy[n] = t; }); });
    const fitOf = id => { const c = cat.byId[id] || {}; for (const k of [fitKey(c.name), fitKey(c.handle)]) if (k && fitBy[k]) return fitBy[k]; return ""; };
    const fitLines = cat.lines.map(l => { const n = fitOf(l.split(" | ")[0]); return n ? l + " | DFT FIT NOTE: " + n : l; });
    // AI campaigns (Tom, 13 Oct 2026): only creators on the AI_LIST saved list are open to AI brands.
    const aiL = (await freshList(AI_LIST).catch(() => ({}))).list;
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
    const namedPl = Object.keys(cat.byId).filter(id => { const n = norm(base(cat.byId[id].name)), h = norm(cat.byId[id].handle); return (n.length >= 5 && hay.includes(n)) || (h.length >= 5 && hay.includes(h)); });
    const namedNames = []; namedPl.map(id => base(cat.byId[id].name).replace(/^@/, "")).sort((a, b) => b.length - a.length).forEach(nm => { const k = norm(nm); if (!namedNames.some(x => norm(x).startsWith(k) || k.startsWith(norm(x)))) namedNames.push(nm); });
    const nameOf = id => { const k = norm(base(cat.byId[id].name).replace(/^@/, "")); return namedNames.find(x => norm(x).startsWith(k) || k.startsWith(norm(x))) || ""; };
    const fwdName = String(b.fromName || "").replace(/["<>]/g, "").trim() || fromEmail.split("@")[0];
    // Brand research first (Tom, 14 Oct 2026): the brand's own site and the creators it has partnered with before.
    const research = await brandResearch(f, latest).catch(() => null);
    const researchTxt = research ? JSON.stringify(research).slice(0, 2500) : "";
    const out = await askClaude(pitchPrompt(f, fitLines, fwdName, aiNames, namedNames, pointers, facts, researchTxt));
    const order = GROUPS.map(g => g.id);
    const aiCamp = aiIds.size > 0 && (out.ai_product === true || /\bAI\b/.test(f.subject + " " + f.body));
    const namedIds = new Set((out.picks || []).filter(p => p && p.named === true).map(p => String(p.id)));
    const ids = [...new Set((out.picks || []).filter(p => p && (p.named === true || !(Number(p.fit) < 3))).map(p => String(p && p.id)).filter(id => cat.byId[id] && (!aiCamp || aiOk(id) || namedIds.has(id))))];
    // Only formats the enquiry asks for: dedicated and social placements need to be named; integrations and Shorts are the default.
    const wantF = { dedicated: /dedicated|full video|standalone video/i, group_mm4a1fe0: /instagram|\binsta\b|\bIG\b|\breels?\b/i, group_mm4bd5tk: /tik ?tok/i, group_mm7yw8cy: /snap ?chat/i };
    // Formats strictly as the brand states them; nothing stated means YouTube, integration plus Shorts (Tom, 14 Oct 2026).
    const FMAP = { integration: "topics", youtube: "topics", youtubeintegration: "topics", dedicated: "dedicated", shorts: "group_mm4av3kr", youtubeshorts: "group_mm4av3kr", instagram: "group_mm4a1fe0", reels: "group_mm4a1fe0", ig: "group_mm4a1fe0", tiktok: "group_mm4bd5tk", snapchat: "group_mm7yw8cy" };
    const askedG = new Set((Array.isArray(out.formats) ? out.formats : []).map(x => FMAP[String(x || "").toLowerCase().replace(/[^a-z]/g, "")]).filter(Boolean));
    if (!askedG.size) { askedG.add("topics"); askedG.add("group_mm4av3kr"); }
    for (let k = ids.length - 1; k >= 0; k--) if (!askedG.has(cat.byId[ids[k]].gid)) ids.splice(k, 1);
    const bt = (f.body + " " + f.note).replace(/https?:\/\/\S+|<[^>\s]+>/g, " "), socialOnly = [wantF.group_mm4a1fe0, wantF.group_mm4bd5tk, wantF.group_mm7yw8cy].some(re => re.test(bt)) && !/youtube|\byt\b|integration|\bshorts?\b|dedicated/i.test(bt);
    if (false && socialOnly) for (let k = ids.length - 1; k >= 0; k--) if (["topics", "dedicated", "group_mm4av3kr"].includes(cat.byId[ids[k]].gid)) ids.splice(k, 1);
    const groupsUsed = new Set(ids.map(id => cat.byId[id].gid)); if (!groupsUsed.size) { groupsUsed.add("topics"); groupsUsed.add("group_mm4av3kr"); }
    // A pointer that says to leave a creator out wins over everything else.
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const leftOut = nm => !!f.note && new RegExp("\\b(not|no|without|leave out|exclude|skip|don'?t|drop|remove)\\b[^.\\n]{0,40}" + esc(nm), "i").test(f.note) || (!!f.note && new RegExp(esc(nm) + "[^.\\n]{0,40}\\b(not|isn'?t|aren'?t|doesn'?t|don'?t)\\b[^.\\n]{0,20}\\b(fit|suit|right|work)", "i").test(f.note));
    for (let k = ids.length - 1; k >= 0; k--) if (leftOut(base(cat.byId[ids[k]].name))) ids.splice(k, 1);
    // Past pointers that rule a creator out for a kind of brief are enforced too (Tom, 13 Oct 2026: Badd Medicine is not a fit for family/toy briefs). Creators the enquiry names stay.
    const FIT_TOPICS = ["family", "toy", "kids", "children", "lifestyle", "beauty", "fashion", "finance", "crypto", "tech", "food", "fitness", "horror", "sports", "betting", "gambling", "alcohol"];
    const topicIn = (t, txt) => new RegExp("\\b" + t + "s?\\b", "i").test(String(txt || ""));
    const fitRules = pointers.filter(p => /not (a )?(good |great |right )?fit|(isn'?t|aren'?t) a (good |great |right )?fit|(doesn'?t|don'?t) suit|not suitable|not right for/i.test(p)).filter(p => { const ts = FIT_TOPICS.filter(t => topicIn(t, p)); return !ts.length || ts.some(t => topicIn(t, f.body)); });
    const ruledOut = nm => hay.indexOf(norm(nm)) < 0 && fitRules.some(p => new RegExp(esc(nm) + "[^.\\n]{0,40}\\b(not|isn'?t|aren'?t|doesn'?t|don'?t)\\b", "i").test(p));
    for (let k = ids.length - 1; k >= 0; k--) if (ruledOut(base(cat.byId[ids[k]].name))) ids.splice(k, 1);
    // Market limits are enforced here, not left to the model (Tom, 13 Oct 2026: "only available to the Australian market").
    const MARKETS = [["australia", /\baustralia(n)?\b|\baus\b/i], ["new zealand", /new zealand|\bnz\b|kiwi/i], ["united kingdom", /\b(uk|united kingdom|british|britain|england)\b/i], ["canada", /\bcanad(a|ian)\b/i], ["ireland", /\bireland|irish\b/i], ["united states", /\b(us only|usa|united states|american market)\b/i]];
    const limitTxt = f.note + " " + (/\bonly\b|exclusively|limited to/i.test(f.body) ? f.body : "");
    const market = /\bonly\b|exclusively|limited to/i.test(limitTxt) ? (MARKETS.find(m => m[1].test(limitTxt)) || [])[0] : "";
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
    // Second pass (Tom, 14 Oct 2026): the list is checked the way Tom would before it is saved. Creators the brand's newest message names always stay.
    let reviewed = "";
    if (!shortOnly && ids.length > 1) {
      const lineOf = {}; fitLines.forEach(l => { lineOf[l.split(" | ")[0]] = l; });
      const rv = await askClaude(reviewPrompt(f, ids.map(id => lineOf[id] || id), pointers, researchTxt)).catch(() => null);
      const ck = id => norm(base((cat.byId[id] || {}).name || ""));
      const drop = new Set(((rv && rv.remove) || []).map(r => String(r && r.id)).filter(id => cat.byId[id] && !nameOf(id)).map(ck));
      // Never below 10 creators (Tom, 13 Oct 2026): removals apply worst first until the floor is reached, unless a removal is a DFT fit note or pointer.
      const creators = () => new Set(ids.filter(id => !drop.has(ck(id)) || nameOf(id)).map(ck)).size;
      const order = [...drop]; while (order.length && creators() < Math.min(10, new Set(ids.map(ck)).size)) { const last = order.pop(); const why = ((rv && rv.remove) || []).filter(r => cat.byId[String(r && r.id)] && ck(String(r.id)) === last).map(r => String(r.reason || "")).join(" "); if (/fit note|pointer|said|thread/i.test(why)) continue; drop.delete(last); }
      const kept = ids.filter(id => !drop.has(ck(id)) || nameOf(id));
      if (kept.length) { reviewed = ((rv && rv.remove) || []).map(r => (cat.byId[String(r && r.id)] || {}).name + ": " + String((r && r.reason) || "")).join("; "); ids.splice(0, ids.length, ...kept); }
    }
    if (!ids.length) throw new Error("No creators were picked");
    ids.sort((x, y) => order.indexOf(cat.byId[x].gid) - order.indexOf(cat.byId[y].gid));
    const title = noDash(out.title || f.subject || "Pitch").slice(0, 70);
    const saved = await saveList({ title, ids }, fromEmail + " (pitch)");
    const first = noDash(out.contact_first_name || String(f.contactName).split(/\s+/)[0] || "there");
    const product = noDash(out.product || out.brand || f.subject || "your campaign").replace(/[.\s]+$/, "");
    const mix = noDash(out.mix || "").replace(/[.\s]+$/, "").replace(/\s*\/\s*/g, " and ");
    // Tom's own edit of the first live pitch (Catch Flex, 13 Oct 2026): one-line thanks, what the list is and how to use it, the link, then the ask. No pricing notes.
    // Tom's voice (13 Oct 2026): short and warm, wording varied from his own sent replies so drafts do not read as a template. Facts only, never model-written.
    const pick = a => a[Math.floor(Math.random() * a.length)];
    const joinN = a => a.length > 1 ? a.slice(0, -1).join(", ") + " and " + a[a.length - 1] : a[0];
    const listNames = namedNames.filter(nm => ids.some(id => nameOf(id) === nm));
    const followUp = /following up|thanks again|thank you again|coming back|earlier conversation|as discussed/i.test(f.body);
    const across = mix ? " across " + mix : "", who = aiCamp ? " who are open to working with brands on AI campaigns" : "";
    const thanks = followUp ? pick(["Thanks for coming back to me. :)", "Thanks for following up on " + product + ".", "Thanks for coming back to me on " + product + "."])
      : pick(["Thanks for reaching out about " + product + ".", "Thanks for getting in touch about " + product + ".", "Great to hear from you about " + product + ".", "Thanks for reaching out - " + product + " looks like a fun one."]);
    const intro = pick(["I've put together a shortlist of creators" + across + (who || " for you") + ".", "Here's a shortlist of creators" + across + (who || " who'd be happy to take this on") + ".", "Please find below a list of creators" + across + (who || " who would be happy to promote " + product) + ".", "I've pulled together some creators" + across + (who || " who'd be a great fit") + "."]);
    const solo = [...new Set(ids.map(id => base(cat.byId[id].name).replace(/^@/, "")))]; // one creator: say so plainly
    const soloFirst = solo.length === 1 ? solo[0].split(/\s+/)[0] : "";
    const lead = expanded ? pick(["I've put the creators you shortlisted on one list, along with some others" + (who ? who + " and would suit " : " who'd suit ") + product + " really well.", "Here are the creators you shortlisted, plus a few more" + (who ? who + " and would be great for " : " who I think would be great for ") + product + "."]) : shortOnly && solo.length > 1 ? pick(["I've put the creators you shortlisted together on one list.", "Here are the creators you shortlisted, all on one list."]) : solo.length === 1 ? pick(["Please find " + soloFirst + "'s rates below.", "Here are " + soloFirst + "'s rates for this.", "I've put " + soloFirst + "'s rates together for you below."]) : intro;
    const howTo = pick(["You can tick a creator to approve them, tick again to mark a 'no', or use the speech bubble to comment or ask questions.", "Just tick anyone you'd like to go ahead with (tick again for a no), and use the speech bubble for any questions.", "Tick the creators you'd like to book, tick again for a no, and leave any questions in the speech bubble."]);
    const withRates = /\b(rates?|pric\w*|cost|budget)\b/i.test(f.body) ? " with current rates." : ".";
    const ans = [];
    const qs = Array.isArray(out.questions) ? out.questions.filter(q => q && q.q) : [];
    if (aiDeclined.length) ans.push("Sadly, " + joinN(aiDeclined) + " won't take on AI projects, but these creators would.");
    if (out.stage !== "shortlist" && solo.length > 1 && listNames.length && (/\?/.test(f.body) || withRates !== ".")) ans.push(pick([joinN(listNames) + (listNames.length > 1 ? " are" : " is") + " on the list" + withRates, "You'll find " + joinN(listNames) + " on there" + withRates]));
    if (/availab|posting date|\bdates\b|schedule|timeline|timing|turnaround/i.test(f.body) && !qs.some(q => /availab|posting|\bdates?\b|timeline|timing/i.test(String(q.q)))) ans.push(pick(["We confirm availability and posting dates with each creator as soon as you approve, and can move quickly.", "Once you've picked, we'll confirm availability and posting dates with each creator straight away."]));
    // The brand's questions: answered only from the Standing facts item; anything else is left for Tom, clearly marked (14 Oct 2026).
    qs.forEach(q => { const a = noDash(String(q.answer || "").trim()); if (a) ans.push(a); });
    const todo = qs.filter(q => !String(q.answer || "").trim()).map(q => noDash(String(q.q).trim().replace(/[.?\s]+$/, "")));
    if (todo.length) ans.push("[TOM TO ANSWER: " + todo.join("; ") + "]");
    const answer = ans.join(" ");
    const ask = pick(["Could you confirm who you would like to book?", "Could you confirm who you would like to book please?", "Who would you like to book?", "Could you confirm who you'd like to book for this?"]);
    const options = /option\s*\d|both options|\boptions\b/i.test(f.body);
    const how = solo.length === 1 ? "" : " " + howTo;
    const ask2 = solo.length === 1 ? pick(["Could you confirm if you'd like to go ahead?", "Let me know if you'd like to go ahead and we'll get it booked in.", "Could you confirm if you'd like to book " + soloFirst + "?"]) : ask; // one placement: never "which option" (Tom, 13 Oct 2026)
    const paras = [thanks, lead + how, "[[LIST_LINK]]"].concat(answer ? [answer] : [], [ask2]);
    if (!paras.some(p => p.indexOf("[[LIST_LINK]]") >= 0)) paras.splice(Math.min(2, paras.length), 0, "[[LIST_LINK]]");
    const bullets = [];
    const sig = ["Warm regards", fwdName, "Digital Fox Talent", "\u{1F98A}"];
    const linkText = title + " creator list";
    const html = "<div dir=\"ltr\">Hi " + escH(first) + ",<br><br>" + paras.map(p => p.indexOf("[[LIST_LINK]]") >= 0 ? "<a href=\"" + saved.url + "\">" + escH(linkText) + "</a>" : escH(p)).join("<br><br>") + (bullets.length ? "<br><br>" + bullets.map(x => "- " + escH(x)).join("<br>") : "") + "<br><br>" + sig.map(escH).join("<br>") + "</div>";
    const text = "Hi " + first + ",\n\n" + paras.map(p => p.indexOf("[[LIST_LINK]]") >= 0 ? saved.url : p).join("\n\n") + (bullets.length ? "\n\n" + bullets.map(x => "- " + x).join("\n") : "") + "\n\n" + sig.join("\n");
    // Quote the brand's original email under the reply, like a normal Gmail reply (Tom, 13 Oct 2026).
    const fwdHead = (String(f.body).split(/\n[ \t]*\n/)[0] || ""), dateM = fwdHead.match(/\nDate:\s*([^\n]+)/i);
    const attr = "On " + (dateM ? dateM[1].trim() + " " : "") + (f.contactName ? f.contactName + " " : "") + "<" + f.contactEmail + "> wrote:";
    const origText = String(f.body).slice(fwdHead.length).trim();
    const fh = String(b.html || ""), fi = fh.search(/Forwarded message/i); let origHtml = "";
    if (fi >= 0) { const close = fh.indexOf("</div>", fi); if (close > 0) origHtml = fh.slice(close + 6).replace(/^(\s|<br\s*\/?>)+/i, ""); }
    if (!origHtml) origHtml = escH(origText).replace(/\n/g, "<br>");
    const quoteHtml = '<br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">' + escH(attr) + '<br></div><blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">' + origHtml + "</blockquote></div>";
    const quoteText = "\n\n" + attr + "\n\n" + origText.split("\n").map(l => "> " + l).join("\n");
    const subject = /^re:/i.test(f.subject) ? f.subject : "Re: " + f.subject;
    await pitchMark(b.item, "Ready: " + ids.length + " placements (" + out.model + ")", saved.url);
    const cc = [...new Set((f.others || []).filter(x => x !== f.contactEmail && (!/@digitalfoxtalent\.com$/.test(x) || /^(alex|margot|george)@/.test(x))).concat(["tom@digitalfoxtalent.com", "alex@digitalfoxtalent.com", "margot@digitalfoxtalent.com"]) /* Tom, 14 Oct 2026: Tom, Alex and Margot on every pitch draft */)].filter(x => x !== fromEmail).join(", "); // reply-all minus DFT group inboxes; Tom and Alex always see what goes out (13 Oct 2026)
    const resultObj = { ok: true, listUrl: saved.url, title, placements: ids.length, to: f.contactEmail, cc, subject, search: "from:" + f.contactEmail + " subject:\"" + f.subject.replace(/"/g, "") + "\" newer_than:90d", html: html + quoteHtml, text: text + quoteText, model: out.model, picks: out.picks, research, stage: out.stage || "new", closing: out.closing === true, questions: out.questions || [], reviewed };
    // Teammates get the draft in their own Gmail (Tom, 14 Oct 2026); Tom's drafts still come from Make.
    resultObj.draftMade = await teamDraft(fromEmail, resultObj).catch(e => "failed: " + String((e && e.message) || e).slice(0, 200));
    return resultObj;
  } catch (e) {
    try { await pitchMark(b.item, "Failed: " + String(e && e.message || e).slice(0, 200)); } catch (_) {}
    throw e;
  }
}

// The raw Gmail draft for Make: a reply in the brand's thread, HTML and plain text, UTF-8.
// Drafts in a teammate's own Gmail (Tom, 14 Oct 2026): Google domain-wide delegation for the service account
// pitch-drafts@dft-pitch-drafts.iam.gserviceaccount.com (Cloud project dft-pitch-drafts), scope gmail.modify.
// The key lives only in the Vercel env var GMAIL_DELEGATE_KEY. Drafts only: this code never sends. Key added by Tom, 14 Oct 2026.
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
async function teamDraft(fromEmail, o) {
  if (!/@digitalfoxtalent\.com$/i.test(fromEmail) || /^tom@/i.test(fromEmail)) return false;
  const tok = await gmailToken(fromEmail); if (!tok) return false;
  const G = (path, opt = {}) => fetch("https://gmail.googleapis.com/gmail/v1/users/me" + path, Object.assign({}, opt, { headers: Object.assign({ Authorization: "Bearer " + tok }, opt.headers || {}) })).then(async r => { const t = await r.text(); let j = {}; try { j = t ? JSON.parse(t) : {}; } catch (_) {} if (!r.ok) throw new Error("Gmail " + r.status + " " + ((j.error && j.error.message) || "")); return j; });
  const q = encodeURIComponent;
  const found = ((await G("/messages?maxResults=1&q=" + q(o.search)).catch(() => ({}))).messages || [])[0];
  let threadId = "", msgId = "";
  if (found) { threadId = found.threadId; const m = await G("/messages/" + found.id + "?format=metadata&metadataHeaders=Message-ID").catch(() => ({})); msgId = (((m.payload || {}).headers || []).find(h => /^message-id$/i.test(h.name)) || {}).value || ""; }
  // The previous draft to this brand in the same thread goes (Tom, 13 Oct 2026).
  if (threadId) { const dr = (await G("/drafts?maxResults=20&q=" + q("to:" + o.to)).catch(() => ({}))).drafts || []; for (const d of dr) if (d.message && d.message.threadId === threadId) await G("/drafts/" + d.id, { method: "DELETE" }).catch(() => null); }
  const draft = pitchMime({ to: o.to, cc: o.cc, subject: o.subject, html: o.html, text: o.text, threadId, inReplyTo: msgId, references: msgId }).draft;
  await G("/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: draft });
  // Their forward to pitch@ leaves the brand thread (Tom, 13 Oct 2026).
  if (threadId) { const sent = (await G("/messages?maxResults=25&q=" + q("in:sent to:pitch@digitalfoxtalent.com newer_than:7d")).catch(() => ({}))).messages || []; for (const m of sent) if (m.threadId === threadId) await G("/messages/" + m.id + "/trash", { method: "POST" }).catch(() => null); }
  return true;
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
        try { return res.status(200).json(await brandFeedback(b, email)); }
        catch (e) { return res.status(400).json({ error: String(e && e.message || e) }); }
      }
      // Pitch pipeline (Tom, 13 Oct 2026): Make, with a fresh Roster - Pitch Requests item as proof.
    if (b && b.op === "pitch-mime") { try { return res.status(200).json(pitchMime(b)); } catch (e) { return res.status(400).json({ error: String(e && e.message || e) }); } }
    if (b && b.op === "pitch") { try { return res.status(200).json(await pitchFromEmail(b)); } catch (e) { return res.status(400).json({ error: String(e && e.message || e) }); } }
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
        if (b.op === "creator-response") return res.status(200).json(await creatorResponse(b, email));
        if (b.op === "list-label") return res.status(200).json(await listLabel(b, email));
        if (b.op === "list-show") return res.status(200).json(await listShow(b, email));
        if (b.op === "list-order") return res.status(200).json(await listOrder(b, email));
        if (b.op === "list-preview") return res.status(200).json(await listPreview(b));
        if (b.op === "list-remove") return res.status(200).json(await listRemove(b, email));
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
    if (q.warm) { res.setHeader("Cache-Control", "no-store"); await loadBoard(); return res.status(200).json({ ok: true }); }
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
