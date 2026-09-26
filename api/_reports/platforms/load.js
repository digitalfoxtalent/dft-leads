// Platform monetization: how each platform performs, per creator and per month. READ ONLY.
//
// SOURCES (all monday, read with the server's token)
//   Platform Invoices 18427544285       one row per platform-month: the statement total. When a
//                                       month has a statement, that is the platform's figure.
//   Platform Revenue - Money In 18427528293   creator x platform x month, MSN split by type
//                                       (article/gallery, embedded video, watch video, adjustment).
//   Platform Creator Payments 18427503091     creator x platform x month, gross revenue share.
//   Legacy deal boards: MSN 7238495643 (also content published + page views),
//                       Facebook Meta 7580684343, Snapchat 6711851296.
//   Articles - Review Queue 18429270496 articles published per brand (reliable from 2 Sep 2026).
//
// RULES
//   - For each platform-month, creator figures come from ONE board: Money In, else Creator
//     Payments, else the legacy board. Boards are never added together, so nothing is counted twice.
//   - The platform-month total is the statement (Platform Invoices) when there is one, else the
//     sum of the creator rows. Any difference is shown as "Not attributed to a creator".
//   - A month with no statement and no creator rows is "not reported", never zero.
//   - MSN is split into video and articles only where Money In has the split (from July 2026).
//     Earlier MSN months are shown under Video as "MSN (video and articles)", because the
//     statement did not separate them (in July 2026 articles were about 7% of MSN).

import { monday } from "../monday.js";
import { loadAvatars } from "../campaigns/load.js";

const CACHE_MS = 10 * 60 * 1000;
let cache = null, lastGood = null, lastError = null;

const squash = s => String(s || "").toLowerCase().replace(/^@/, "").replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const num = t => { const n = parseFloat(String(t == null ? "" : t).replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : 0; };
const has = t => String(t == null ? "" : t).trim() !== "";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
const ym = d => String(d || "").slice(0, 7);

// Legacy rows are named like "The Normies June" with a date near that month. Month from the
// name, year from the date (a December row dated January belongs to the year before).
function legacyMonth(name, date) {
  const m = String(name).match(MONTH_RE);
  if (!date) return "";
  const y = Number(date.slice(0, 4)), dm = Number(date.slice(5, 7));
  if (!m) return ym(date);
  const nm = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
  const year = nm > dm + 1 ? y - 1 : (nm < dm - 10 ? y + 1 : y);
  return year + "-" + String(nm).padStart(2, "0");
}
const legacyName = name => String(name).replace(MONTH_RE, "").replace(/\b(20\d\d|stars|reels|payout|revenue)\b/gi, "").replace(/\s{2,}/g, " ").trim();

async function allItems(token, board, cols, extra) {
  const fields = "cursor items { id name " + (extra || "") + " column_values(ids:" + JSON.stringify(cols) + ") { id text ... on BoardRelationValue { display_value } } }";
  let d = await monday(token, "query { boards(ids:[" + board + "]) { items_page(limit:500) { " + fields + " } } }");
  let page = d.boards[0].items_page, items = page.items.slice(), guard = 0;
  while (page.cursor && guard++ < 20) {
    d = await monday(token, "query { next_items_page(limit:500, cursor:\"" + page.cursor + "\") { " + fields + " } }");
    page = d.next_items_page; items = items.concat(page.items);
  }
  return items.map(it => { const cv = {}; for (const c of it.column_values) cv[c.id] = (c.display_value != null && c.display_value !== "") ? c.display_value : (c.text || ""); return { id: it.id, name: it.name, group: it.group && it.group.title, cv }; });
}

const PLAT_OF = { "MSN / Start": "msn", "MSN": "msn", "Meta": "meta", "Meta / Facebook": "meta", "Snap": "snap", "Snapchat": "snap", "Spotify / Podcasts": "spotify", "Spotify": "spotify" };

async function build(token) {
  const [inv, money, pay, msnL, metaL, snapL, queue, gtr] = await Promise.all([
    allItems(token, 18427544285, ["color_mm6eg19h", "date_mm6ezsh9", "numeric_mm6e8tmm"]),
    allItems(token, 18427528293, ["text_mm6dvz37", "color_mm6dh8fr", "date_mm6dk5y1", "numeric_mm6dqy5c", "numeric_mm6d9zd7", "numeric_mm6dtzxt", "numeric_mm6dvhnn", "numeric_mm6d5zmn"]),
    allItems(token, 18427503091, ["color_mm6d7cwg", "date_mm6dak13", "numeric_mm6dxxb8"]),
    allItems(token, 7238495643, ["deal_value", "date0__1", "text_mkvw5d8h", "text_mkxt7spa"]),
    allItems(token, 7580684343, ["deal_value", "date_mktcwthf", "board_relation4__1"]),
    allItems(token, 6711851296, ["deal_value", "date_1__1", "board_relation07__1"]),
    allItems(token, 18429270496, ["text_mm6tj0ky", "color_mm6tha4g", "date_mm6tvgcs"]),
    allItems(token, 6160485039, ["text_mm6nqp7b", "color_mm6cgavk"], "group { title }"),
  ]);

  // Statements: platform-month totals. Rows flagged NOT RAISED with no amount mean "not reported".
  const stmt = {}; // "msn|2026-07" -> amount
  for (const r of inv) {
    const p = PLAT_OF[r.cv.color_mm6eg19h]; const m = ym(r.cv.date_mm6ezsh9);
    if (!p || !m || !has(r.cv.numeric_mm6e8tmm) || num(r.cv.numeric_mm6e8tmm) <= 0) continue;
    stmt[p + "|" + m] = (stmt[p + "|" + m] || 0) + num(r.cv.numeric_mm6e8tmm);
  }

  // Creator rows by source, keyed platform|month.
  const src = { money: {}, pay: {}, legacy: {} };
  const add = (bucket, p, m, row) => { if (!p || !m) return; (bucket[p + "|" + m] = bucket[p + "|" + m] || []).push(row); };
  for (const r of money) {
    const p = PLAT_OF[r.cv.color_mm6dh8fr]; const m = ym(r.cv.date_mm6dk5y1);
    const total = has(r.cv.numeric_mm6d5zmn) ? num(r.cv.numeric_mm6d5zmn) : num(r.cv.numeric_mm6dqy5c) + num(r.cv.numeric_mm6d9zd7) + num(r.cv.numeric_mm6dtzxt) + num(r.cv.numeric_mm6dvhnn);
    const row = { n: r.cv.text_mm6dvz37 || String(r.name).split(" — ")[0], g: total };
    if (p === "msn") { row.art = num(r.cv.numeric_mm6dqy5c); row.vid = num(r.cv.numeric_mm6d9zd7) + num(r.cv.numeric_mm6dtzxt); row.adj = num(r.cv.numeric_mm6dvhnn); }
    add(src.money, p, m, row);
  }
  for (const r of pay) {
    if (!has(r.cv.numeric_mm6dxxb8)) continue; // no gross recorded on this payout row
    add(src.pay, PLAT_OF[r.cv.color_mm6d7cwg], ym(r.cv.date_mm6dak13), { n: String(r.name).split(" — ")[0], g: num(r.cv.numeric_mm6dxxb8) });
  }
  for (const r of msnL) if (has(r.cv.deal_value)) add(src.legacy, "msn", legacyMonth(r.name, r.cv.date0__1), { n: legacyName(r.name), g: num(r.cv.deal_value), pub: has(r.cv.text_mkvw5d8h) ? num(r.cv.text_mkvw5d8h) : null, pv: has(r.cv.text_mkxt7spa) ? num(r.cv.text_mkxt7spa) : null });
  for (const r of metaL) if (has(r.cv.deal_value)) add(src.legacy, "meta", legacyMonth(r.name, r.cv.date_mktcwthf), { n: r.cv.board_relation4__1 || legacyName(r.name), g: num(r.cv.deal_value) });
  for (const r of snapL) if (has(r.cv.deal_value)) add(src.legacy, "snap", legacyMonth(r.name, r.cv.date_1__1), { n: r.cv.board_relation07__1 || legacyName(r.name), g: num(r.cv.deal_value) });

  // Roster: display names and handles. GTR row names are handles ("@thenormies").
  const roster = {};
  for (const r of gtr) {
    const signed = ["youtube long form", "short form", "need to set up with suppliers"].includes(String(r.group || "").toLowerCase()) || r.cv.color_mm6cgavk === "Signed";
    for (const k of [r.name, r.cv.text_mm6nqp7b]) if (k) roster[squash(k)] = roster[squash(k)] || { h: String(r.name).startsWith("@") ? r.name : (r.cv.text_mm6nqp7b || ""), signed };
  }

  // One set of creator figures per platform-month, then the statement total on top.
  const SRC_NAME = { money: "Platform Revenue - Money In", pay: "Platform Creator Payments", legacy: { msn: "MSN deals board", meta: "Facebook Meta deals board", snap: "Snapchat deals board" } };
  const keys = new Set([...Object.keys(stmt), ...Object.keys(src.money), ...Object.keys(src.pay), ...Object.keys(src.legacy)]);
  const cells = []; // { p, m, src, stmt, rows:[{k,n,g,art,vid,adj,pub,pv}] }
  for (const key of keys) {
    const [p, m] = key.split("|");
    const which = src.money[key] ? "money" : src.pay[key] ? "pay" : src.legacy[key] ? "legacy" : null;
    const rows = which ? src[which][key] : [];
    const merged = {};
    for (const r of rows) {
      const k = squash(r.n); if (!k) continue;
      const o = merged[k] = merged[k] || { k, n: r.n, g: 0 };
      if (String(o.n).startsWith("@") && !String(r.n).startsWith("@")) o.n = r.n;
      o.g += r.g;
      for (const f of ["art", "vid", "adj", "pub", "pv"]) if (r[f] != null) o[f] = (o[f] || 0) + r[f];
    }
    cells.push({ p, m, src: which === "legacy" ? SRC_NAME.legacy[p] : which ? SRC_NAME[which] : "", stmt: stmt[key] != null ? Math.round(stmt[key] * 100) / 100 : null, rows: Object.values(merged).map(o => { for (const f in o) if (typeof o[f] === "number") o[f] = Math.round(o[f] * 100) / 100; return o; }) });
  }

  // Articles published per brand per month (Review Queue, Published only, from 2 Sep 2026).
  const arts = {};
  for (const r of queue) {
    if (r.cv.color_mm6tha4g !== "Published") continue;
    const d = r.cv.date_mm6tvgcs; if (!d || d < "2026-09-02") continue;
    const k = squash(r.cv.text_mm6tj0ky); if (!k) continue;
    const key = k + "|" + ym(d);
    arts[key] = arts[key] || { k, n: r.cv.text_mm6tj0ky, m: ym(d), a: 0 }; arts[key].a++;
  }

  // Creator directory: every creator seen, with a handle and roster flag where known.
  const people = {};
  for (const c of cells) for (const r of c.rows) people[r.k] = people[r.k] || { n: r.n };
  for (const a of Object.values(arts)) people[a.k] = people[a.k] || { n: a.n };
  for (const k in people) { const g = roster[k]; if (g) { people[k].h = g.h; people[k].s = g.signed; } if (String(people[k].n).startsWith("@") && g && g.h) people[k].n = g.h; }

  return { cells, arts: Object.values(arts), people };
}

export async function getPlatforms(token) {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.payload;
  const now = new Date();
  try {
    const data = await build(token);
    const payload = Object.assign(data, { fetchedAt: now.toISOString(), source: "live" });
    lastGood = payload; lastError = null; cache = { at: Date.now(), payload };
    return payload;
  } catch (e) {
    lastError = { at: now.toISOString(), message: String(e && e.message || e).slice(0, 200) };
    if (lastGood) { const p = Object.assign({}, lastGood, { source: "stale" }); cache = { at: Date.now() - CACHE_MS + 60000, payload: p }; return p; }
    throw e;
  }
}

export function platformsHealth() { return { lastError, cached: !!cache, fetchedAt: lastGood && lastGood.fetchedAt }; }

export async function platformsData(token) {
  const payload = await getPlatforms(token);
  const handles = [...new Set(Object.values(payload.people).map(p => p.h).filter(h => h && h.startsWith("@")))];
  const avatars = await loadAvatars(handles).catch(() => ({}));
  return Object.assign({}, payload, { avatars });
}
