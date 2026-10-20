// Engaged views, all creators at once (Tom, 20 Oct 2026): one row per connected creator with their
// average and median engaged views, plus a roster average. Shown as "All creators" on
// ecosystem.digitalfoxtalent.com/reporting/engaged-views.
//
// HOW. Once a night (cron /api/engaged-build, 12:40 UTC, after kit-sync has updated who is
// connected) every connected creator's figures are read from Channel Connect, the same call the
// single-creator panel makes, and one JSON copy is saved to the Apify key-value store
// "dft-engaged-views", record "summary". The page only reads that copy, so it opens instantly and
// YouTube is asked once a night, not on every visit. A team member can rebuild it from the page.
//
// ROSTER AVERAGE. The average of each creator's own average, so every creator counts once however
// often they post. A very big channel still pulls it up, so the middle creator (median) sits beside it.
// Each creator's figures cover their latest 12 long-form videos at least a week old (Channel Connect,
// ?mature=1). A creator whose figures could not
// be read is listed with the reason and left out of the averages.
//
// READ ONLY on monday and YouTube. The only write is the saved copy in the Apify store.

import { monday } from "../monday.js";
import { connectedChannels, allCreators, engagedData } from "./load.js";

export const STORE_NAME = "dft-engaged-views";
export const RECORD = "summary";
const KEY_ITEM = 12634208127; // API Keys (Private): "Apify", the same token the Slot board uses
const KEY_COL = "text_mm5bcxe7";
const PARALLEL = 4;

const num = v => (typeof v === "number" && isFinite(v) ? v : null);
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
export function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// One creator's row from a Channel Connect answer. Pure, so it can be tested.
export function creatorRow(c, d) {
  const row = { name: c.name, channel: c.channel };
  if (!d || d.unavailable || d.error) return Object.assign(row, { unavailable: (d && (d.unavailable || d.error)) || "No answer from Channel Connect." });
  const S = d.summary || {};
  // Share over the same videos the averages use (at least 7 days old), engaged / public views.
  const old = (d.videos || []).filter(v => !(v.ageDays < 7) && num(v.engagedViews) != null && num(v.views));
  const views = old.reduce((s, v) => s + v.views, 0);
  Object.assign(row, {
    title: d.title || c.name,
    avgEngaged: num(S.avgEngagedViews),
    medianEngaged: num(S.medianEngagedViews),
    avgViews: num(S.avgViews),
    share: views ? old.reduce((s, v) => s + v.engagedViews, 0) / views : null,
    videos: num(S.videos) || 0,
    asOf: d.asOf || "",
  });
  if (row.avgEngaged == null || !row.videos) row.unavailable = d.note || "No long-form videos at least a week old found.";
  return row;
}

// The whole copy from the creator rows. Pure.
export function summarise(rows, notConnected, builtAt) {
  const ok = rows.filter(r => !r.unavailable);
  const pick = k => ok.map(r => r[k]).filter(v => v != null);
  return {
    builtAt,
    roster: {
      creators: ok.length,
      connected: rows.length,
      avgEngaged: mean(pick("avgEngaged")),
      medianEngaged: median(pick("avgEngaged")),
      avgViews: mean(pick("avgViews")),
      share: mean(pick("share")),
    },
    creators: [...rows].sort((a, b) => (!!a.unavailable - !!b.unavailable) || ((b.avgEngaged || 0) - (a.avgEngaged || 0))),
    notConnected: notConnected.map(c => c.name),
  };
}

export async function buildSummary(tok) {
  const [connected, all] = await Promise.all([connectedChannels(tok), allCreators(tok)]);
  const rows = new Array(connected.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PARALLEL, connected.length) }, async () => {
    while (next < connected.length) {
      const i = next++, c = connected[i];
      let d;
      try { d = await engagedData(tok, c.channel); } catch (e) { d = { error: "Could not read: " + String(e && e.message || e).slice(0, 120) }; }
      rows[i] = creatorRow(c, d);
    }
  }));
  return summarise(rows, all.filter(c => !c.connected), new Date().toISOString());
}

// ---- the saved copy (Apify key-value store, opened by name; token read from monday at run time) ----
let storeId = null;
async function apifyToken(tok) {
  const d = await monday(tok, "query { items(ids:[" + KEY_ITEM + "]) { column_values(ids:[\"" + KEY_COL + "\"]) { text } } }");
  const t = String((d && d.items && d.items[0] && d.items[0].column_values[0] && d.items[0].column_values[0].text) || "").trim();
  if (t.length < 10) throw new Error("Apify key missing on monday");
  return t;
}
async function store(key) {
  if (storeId) return storeId;
  const r = await fetch("https://api.apify.com/v2/key-value-stores?name=" + STORE_NAME, { method: "POST", headers: { Authorization: "Bearer " + key } });
  const j = await r.json();
  const id = j && j.data && j.data.id;
  if (!id) throw new Error("could not open the store (" + r.status + ")");
  return (storeId = id);
}

// Never throws: null when there is no copy yet, { error } when the store could not be read.
export async function readSummary(tok) {
  try {
    const key = await apifyToken(tok);
    const r = await fetch("https://api.apify.com/v2/key-value-stores/" + await store(key) + "/records/" + RECORD, { headers: { Authorization: "Bearer " + key } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error("store answered " + r.status);
    return await r.json();
  } catch (e) {
    return { error: String(e && e.message || e).slice(0, 160) };
  }
}

export async function writeSummary(tok, value) {
  const key = await apifyToken(tok);
  const r = await fetch("https://api.apify.com/v2/key-value-stores/" + await store(key) + "/records/" + RECORD, {
    method: "PUT", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify(value) });
  if (!r.ok) throw new Error("store write answered " + r.status);
  return true;
}
