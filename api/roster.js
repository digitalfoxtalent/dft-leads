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
const GTR = { country: "dup__of_state6", state: "dup__of_email", yt: "text_mm6nqp7b", ig: "text_mm5pkgn1", tt: "text_mm5pqpaf", full: "dup__of_state" };
const GTR_LIVE = new Set(["Youtube Long Form", "Short Form", "Need to set up with Suppliers", "Creator Applied", "To be let go"]);
const COUNTRY_FIX = { "usa": "United States", "us": "United States", "u.s.": "United States", "united states of america": "United States", "uk": "United Kingdom", "u.k.": "United Kingdom" };
const NAME_ALIAS = { normiesanime: "thenormies" }; // secondary channel with no roster row of its own
const normCountry = c => { const t = String(c || "").trim(); return COUNTRY_FIX[t.toLowerCase()] || t; };
const hkey = h => String(h || "").toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_.]/g, "");
const nkey = n => String(n || "").toLowerCase().replace(/\s*[-\u2013]\s*shorts\s*$/, "").replace(/[^a-z0-9]/g, "");
const REGISTER_BOARD = 18430229380;
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
};
const SC = {
  rate: "numeric_mm495xbb", vg: "numeric_mm49tej8", cpm: "numeric_mm49fe4b", avg: "numeric_mm4957y3", url: "text_mm49bb5z",
  bvg: "numeric_mm7vzc0y", bcpm: "numeric_mm7vjh1a", brate: "numeric_mm7vm5z8", bbasis: "numeric_mm7vhe7f",
  bq: "text_mm7v1hhz", bnote: "text_mm7vjp1y", vis: "color_mm7vvvfz",
};
const L = { slug: "text_mm7vgrr5", items: "long_text_mm7vtnkw", by: "text_mm7v2v06", link: "link_mm7vwxw0", updated: "text_mm7vj42p" };
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
// get there, up to 4, at the normal CPM, with the view guarantee covering the whole
// bundle. YouTube tab only (channels and their shows); Shorts and socials are untouched.
// Past 4 videos the row stays hidden as before.
const MAX_BUNDLE = 4;
export function bundle(b, kind) {
  if (!b) return b;
  const out = Object.assign({}, b, { videos: 1, vgPer: b.vg, ratePer: b.rate });
  // A rate rounded to the dollar can leave $25.01; show the CPM it was priced at.
  if (Math.abs(out.cpm - Math.round(out.cpm)) < 0.02) out.cpm = Math.round(out.cpm);
  if (kind !== "long" || b.rate > FLOOR + 1) return out;
  const base = b.askCpm && b.askCpm < b.cpm - 0.01 ? b.askCpm : PRICE.long.cpm;
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
  if (!b) return { show: false, why: "No figures yet" };
  // Shorts, Instagram and TikTok are never hidden by a rule (Tom, 6 Oct 2026): brands see
  // a rate and a View Estimate there, never the CPM, so the $1,500 minimum simply applies.
  if (kind !== "long") return { show: true, why: "" };
  if (/^No uploads in/i.test(note || "")) return { show: false, why: String(note).split(";")[0] };
  if (b.needs) return { show: false, why: "Needs " + b.needs + " videos to reach $" + FLOOR.toLocaleString("en-US") + " (bundles go up to " + MAX_BUNDLE + ")" };
  if (b.cpm > CAP[kind] + 0.005) return { show: false, why: "CPM $" + b.cpm + " is over the $" + CAP[kind] + " cap" };
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
  const stateQ = `query{boards(ids:[${CREATOR_BOARD}]){items_page(limit:500){items{id name group{title} column_values(ids:${JSON.stringify(Object.values(GTR))}){id text}}}}}`;
  const listsQ = `query{boards(ids:[${LISTS_BOARD}]){items_page(limit:500){items{id name column_values(ids:${JSON.stringify(Object.values(L))}){id text}}}}}`;
  const regQ = `query{boards(ids:[${REGISTER_BOARD}]){items_page(limit:500){items{column_values(ids:${JSON.stringify(Object.values(REG))}){id text}}}}}`;
  const [groups, state, lists, register] = await Promise.all([
    Promise.all(GROUPS.map(g => monday(groupQ(g.id)))),
    monday(stateQ).catch(() => null),
    monday(listsQ).catch(() => null),
    monday(regQ).catch(() => null),
  ]);
  const simulcast = new Set();
  ((((register || {}).boards || [])[0] || {}).items_page || { items: [] }).items.forEach(it => {
    const v = {}; (it.column_values || []).forEach(c => { v[c.id] = c.text || ""; });
    if (v[REG.supplier] === "Libsyn" && v[REG.type] === "Simulcast" && v[REG.state] === "Live" && v[REG.handle])
      simulcast.add(v[REG.handle].replace(/^@/, "").toLowerCase());
  });
  const geoById = {}, geoByHandle = {}, geoByName = {};
  ((((state || {}).boards || [])[0] || {}).items_page || { items: [] }).items.forEach(it => {
    const v = {}; (it.column_values || []).forEach(c => { v[c.id] = (c.text || "").trim(); });
    const country = normCountry(v[GTR.country]);
    let region = v[GTR.state];
    if (region && region.toLowerCase() === country.toLowerCase()) region = ""; // "Sweden / Sweden"
    const geo = { country, region };
    geoById[String(it.id)] = geo;
    const live = GTR_LIVE.has((it.group || {}).title);
    const put = (map, k) => { if (k && (live || !map[k])) map[k] = geo; };
    [GTR.yt, GTR.ig, GTR.tt].forEach(k => put(geoByHandle, hkey(v[k])));
    put(geoByName, nkey(it.name)); put(geoByName, nkey(v[GTR.full]));
  });
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
      const sim = kind === "long" && simulcast.has(String(cv[C.handle] || "").replace(/^@/, "").toLowerCase());
      const geo = geoFor(creator, cv[C.handle], it.name, cv[C.location]);
      rows.push({ id: String(it.id), name: it.name, group: GROUPS[gi].id, kind, cv, creator, adEx, state: geo.region, country: geo.country, shows, simulcast: sim });
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
    let body = {}; try { body = JSON.parse(cv[L.items] || "{}"); } catch (e) {}
    return { id: String(it.id), name: it.name, slug: cv[L.slug], body, by: cv[L.by], updated: cv[L.updated] };
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
    subs: pos(cv[C.subs]), adLength: AD_LENGTH, adEx: r.adEx, state: r.state,
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
function listNumbers(b, p, kind) {
  if (!p) return null;
  if (kind === "long" && p.vg > 0 && p.cpm > 0) {
    const rate = Math.max(FLOOR, Math.round(p.vg * p.cpm / 1000));
    return Object.assign({}, b || {}, { vg: Math.round(p.vg), rate, cpm: r2(rate * 1000 / p.vg), askCpm: p.cpm, custom: true });
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
function addFee(b, kind) {
  if (!b) return b;
  const fee = kind === "long" ? 0 : (b.fee != null ? b.fee : FEE);
  return Object.assign({}, b, { fee: kind === "long" ? null : fee, total: (b.rate || 0) + fee });
}

function brandRow(r, includeHiddenByRule, prices, team) {
  prices = prices || {};
  const own = brandNumbers(r.cv, C, r.kind);
  const b = addFee(bundle(listNumbers(own, prices[r.id], r.kind) || own, r.kind), r.kind);
  const v = visibility(b, r.cv[C.vis], r.cv[C.bnote], r.kind);
  const allowed = v.show || (includeHiddenByRule && b && r.cv[C.vis] !== "Hide");
  if (!allowed) return null;
  const o = baseFields(r);
  o.rate = b.rate; o.total = b.total;
  if (r.kind === "long") { o.vg = b.vg; o.cpm = b.cpm; o.minVideos = b.videos; o.vgPer = b.vgPer; }
  // Shorts, Instagram, TikTok and Snapchat: brands see the views figure as a View Estimate
  // (not a guarantee) and never the CPM (Tom, 6 Oct 2026). The team, on a list's page, gets
  // the CPM so it can be changed for that list.
  else { o.vg = b.vg || null; o.fee = b.fee; o.rights = RIGHTS; if (team) o.cpm = b.cpm; }
  if (team && b.custom) o.custom = true; // only the team sees which prices are list-only
  o.shows = r.kind !== "long" ? [] : r.shows.map(s => {
    const sown = brandNumbers(s.cv, SC, "long");
    const sb = bundle(listNumbers(sown, prices[s.id], "long") || sown, "long");
    const sv = visibility(sb, s.cv[SC.vis], s.cv[SC.bnote], "long");
    if (!(sv.show || (includeHiddenByRule && sb && s.cv[SC.vis] !== "Hide"))) return null;
    return { id: s.id, name: s.name, url: s.cv[SC.url] || "", rate: sb.rate, total: sb.rate, vg: sb.vg, cpm: sb.cpm, minVideos: sb.videos, vgPer: sb.vgPer, custom: team && sb.custom ? true : undefined };
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
  if (r.kind !== "long") Object.assign(o, { fee: b ? b.fee : FEE, total: b ? b.total : null, rights: RIGHTS });
  else o.total = b ? b.rate : null;
  Object.assign(o, {
    brand: b, override: r.cv[C.vis] || "Auto", show: v.show, why: v.why,
    live: liveFor(r),
    rate: b ? b.rate : null, vg: b ? b.vg : null, cpm: b ? b.cpm : null,
    minVideos: b && r.kind === "long" ? b.videos : null, vgPer: b ? b.vgPer : null,
  });
  o.shows = r.shows.map(s => {
    const sb = bundle(brandNumbers(s.cv, SC, "long"), "long");
    const sv = visibility(sb, s.cv[SC.vis], s.cv[SC.bnote], "long");
    return { id: s.id, name: s.name, url: s.cv[SC.url] || "", brand: sb, total: sb ? sb.rate : null, override: s.cv[SC.vis] || "Auto", show: sv.show, why: sv.why,
      rate: sb ? sb.rate : null, vg: sb ? sb.vg : null, cpm: sb ? sb.cpm : null,
      minVideos: sb ? sb.videos : null, vgPer: sb ? sb.vgPer : null,
      live: { avg: pos(s.cv[SC.avg]), vg: pos(s.cv[SC.vg]), rate: pos(s.cv[SC.rate]), cpm: pos(s.cv[SC.cpm]) } };
  }).sort((a, b) => (b.vgPer || 0) - (a.vgPer || 0));
  return o;
}

// Campaign lock (Tom, 6 Oct 2026). Lists follow the quarter by default. Locking a list
// for a campaign keeps every price on it as it was when locked, past the quarter reset,
// until it is unlocked. Stored as { lock: { on, by, quarter, rows: { id: numbers } } }.
const LOCK_FIELDS = ["rate", "vg", "cpm", "minVideos", "vgPer", "fee", "total"];
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
  const groups = {};
  GROUPS.forEach(g => { groups[g.id] = []; });
  data.rows.forEach(r => {
    if (ids && !ids.has(r.id)) return;
    const o = brandRow(r, !!ids, prices, team);
    if (o && lock && !noLock) applyLock(o, lock);
    if (o) groups[r.group].push(o);
  });
  if (ids) { // keep the order the list was saved in
    const order = {}; (list.body.ids || []).forEach((id, i) => { order[String(id)] = i; });
    Object.values(groups).forEach(a => a.sort((x, y) => order[x.id] - order[y.id]));
  } else Object.values(groups).forEach(a => a.sort((x, y) => (y.vgPer || y.vg || y.rate || 0) - (x.vgPer || x.vg || x.rate || 0)));
  return { view: "brand", quarter: quarterLabel(), columns: data.columns, widths: data.widths, rows: ids ? {} : data.rowOrder, list: list ? { title: list.name, slug: list.slug, manual: !!list.body.manual,
    lock: list.body.lock ? { on: list.body.lock.on, quarter: list.body.lock.quarter } : null } : null, groups };
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

async function editRow(b, email) {
  const isShow = !!b.show;
  const board = isShow ? SUB_BOARD : BOARD, K = isShow ? SC : C;
  const id = String(b.id || "");
  if (!/^\d+$/.test(id)) throw new Error("bad id");
  const data = await loadBoard();
  let row = null, kind = "long";
  data.rows.forEach(r => {
    if (!isShow && r.id === id) { row = r; kind = r.kind; }
    if (isShow) r.shows.forEach(s => { if (s.id === id) { row = s; kind = "long"; } });
  });
  if (!row) throw new Error("row not found");
  const values = {};
  if (b.override != null) {
    if (!["Auto", "Always show", "Hide"].includes(b.override)) throw new Error("bad override");
    values[K.vis] = { label: b.override };
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
  await monday("mutation($b:ID!,$i:ID!,$v:JSON!){change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id}}",
    { b: String(board), i: id, v: JSON.stringify(values) });
  cache = null;
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
  const nextBody = Object.assign({}, existing ? existing.body : {}, { ids });
  if (existing && nextBody.lock) { // creators added to a locked list are locked at today's prices
    const fresh = new Set(ids.filter(id => !(nextBody.lock.rows || {})[id]));
    if (fresh.size) nextBody.lock = Object.assign({}, nextBody.lock, { rows: Object.assign({}, nextBody.lock.rows, lockSnapshot(data, { name: title, slug: existing.slug, body: nextBody }, fresh)) });
  }
  const items = JSON.stringify(nextBody);
  if (existing) {
    await monday("mutation($b:ID!,$i:ID!,$v:JSON!){change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id}}",
      { b: String(LISTS_BOARD), i: existing.id, v: JSON.stringify({ name: title, [L.items]: { text: items }, [L.updated]: email + " " + stamp() }) });
    cache = null;
    return { ok: true, slug: existing.slug, url: "https://" + HOST + "/r/" + existing.slug };
  }
  // A random tail so one brand cannot guess another brand's list from its name.
  const slug = listSlug(title, email);
  const url = "https://" + HOST + "/r/" + slug;
  await monday("mutation($b:ID!,$n:String!,$v:JSON!){create_item(board_id:$b,item_name:$n,column_values:$v){id}}",
    { b: String(LISTS_BOARD), n: title, v: JSON.stringify({ [L.slug]: slug, [L.items]: { text: items }, [L.by]: email + " " + stamp(), [L.link]: { url, text: "Open list" } }) });
  cache = null;
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
  const prices = Object.assign({}, list.body.prices || {});
  if (b.clear) delete prices[id];
  else if (kind === "long") {
    const cur = prices[id] || {};
    const vg = Math.round(num(b.vg != null ? b.vg : (cur.vg || b.curVg)) || 0), cpm = num(b.cpm != null ? b.cpm : (cur.cpm || b.curCpm)) || 0;
    if (!(vg > 0) || !(cpm > 0) || cpm > 10000 || vg > 1e9) throw new Error("View guarantee and CPM must be positive numbers");
    prices[id] = { vg, cpm: r2(cpm) };
  } else {
    // Short form on a list: View Estimate, CPM and the content production fee.
    const cur = prices[id] || {};
    const pick = (k, curK) => num(b[k] != null ? b[k] : (cur[k] != null ? cur[k] : b[curK]));
    const vg = Math.round(pick("vg", "curVg") || 0), cpm = pick("cpm", "curCpm") || 0, fee = pick("fee", "curFee");
    if (!(vg > 0) || !(cpm > 0) || cpm > 10000 || vg > 1e9) throw new Error("View estimate and CPM must be positive numbers");
    if (fee == null || fee < 0 || fee > 1e6) throw new Error("Production fee must be zero or more");
    prices[id] = { vg, cpm: r2(cpm), fee: Math.round(fee) };
  }
  const body = Object.assign({}, list.body, { prices });
  if (body.lock) { // a price changed on a locked list is locked at its new value
    const snap = lockSnapshot(data, Object.assign({}, list, { body }), new Set([id]));
    const rows = Object.assign({}, body.lock.rows); delete rows[id]; Object.assign(rows, snap);
    body.lock = Object.assign({}, body.lock, { rows });
  }
  await monday("mutation($b:ID!,$i:ID!,$v:JSON!){change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id}}",
    { b: String(LISTS_BOARD), i: list.id, v: JSON.stringify({ [L.items]: { text: JSON.stringify(body) }, [L.updated]: email + " " + stamp() }) });
  cache = null;
  const fresh = await loadBoard();
  return brandPayload(fresh, fresh.lists.find(x => x.slug === list.slug) || Object.assign({}, list, { body }), true);
}

async function listLock(b, email) {
  const data = await loadBoard();
  const list = data.lists.find(x => x.slug === String(b.slug || ""));
  if (!list) throw new Error("list not found");
  const body = Object.assign({}, list.body);
  if (b.lock) body.lock = { on: stamp(), by: email, quarter: quarterLabel(), rows: lockSnapshot(data, list) };
  else delete body.lock;
  await monday("mutation($b:ID!,$i:ID!,$v:JSON!){change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id}}",
    { b: String(LISTS_BOARD), i: list.id, v: JSON.stringify({ [L.items]: { text: JSON.stringify(body) }, [L.updated]: email + " " + stamp() }) });
  cache = null;
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
  const v = { [L.items]: { text: JSON.stringify({ columns: cols, rows, widths }) }, [L.updated]: email + " " + stamp() };
  if (data.settingsId) {
    await monday("mutation($b:ID!,$i:ID!,$v:JSON!){change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id}}",
      { b: String(LISTS_BOARD), i: data.settingsId, v: JSON.stringify(v) });
  } else {
    await monday("mutation($b:ID!,$n:String!,$v:JSON!){create_item(board_id:$b,item_name:$n,column_values:$v){id}}",
      { b: String(LISTS_BOARD), n: "__settings", v: JSON.stringify(v) });
  }
  cache = null;
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
      if (!email) return res.status(401).json({ error: "Sign in with your DFT Google account" });
      if (origin && origin !== "https://" + host) return res.status(403).json({ error: "Bad origin" });
      const b = await readBody(req);
      try {
        if (b.op === "edit") return res.status(200).json(await editRow(b, email));
        if (b.op === "save-list") return res.status(200).json(await saveList(b, email));
        if (b.op === "delete-list") return res.status(200).json(await deleteList(b));
        if (b.op === "columns") return res.status(200).json(await saveColumns(b, email));
        if (b.op === "list-price") return res.status(200).json(await listPrice(b, email));
        if (b.op === "list-lock") return res.status(200).json(await listLock(b, email));
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
      res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=600");
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
