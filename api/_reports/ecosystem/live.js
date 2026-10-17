// Reads the monday board "Ecosystem Register" (18435883510) for the Ecosystem map: one row per system
// (Systems group) and per gap (Gaps group), matched to the map by the Map id column. The page merges these
// over its built-in lists, so a new row appears on the map and a gap set to Fixed drops off.
// Read only. Cached for five minutes. If monday cannot be read, the page keeps its built-in lists.
import { monday } from "../monday.js";

const BOARD = 18435883510;
const COL = { dept: "text_mm871vcw", line: "long_text_mm873s76", build: "long_text_mm87x8dd", runs: "text_mm87tf8z", cad: "text_mm87e6sv", url: "link_mm8772qr", impact: "text_mm87r1qk", status: "color_mm87rzb5", id: "text_mm8784jf", pri: "numeric_mm87926e" };
let cache = null;

export async function ecoLive(token) {
  if (cache && Date.now() - cache.at < 5 * 60 * 1000) return cache.data;
  const d = await monday(token, `{ boards(ids: [${BOARD}]) { items_page(limit: 500) { items { name group { title } column_values(ids: ${JSON.stringify(Object.values(COL))}) { id text value } } } } }`);
  const items = (((d.boards || [])[0] || {}).items_page || {}).items || [];
  const out = { systems: [], gaps: [] };
  for (const it of items) {
    const v = {};
    for (const c of it.column_values || []) {
      const k = Object.keys(COL).find(x => COL[x] === c.id);
      if (k === "url") { try { v.url = (JSON.parse(c.value || "null") || {}).url || ""; } catch { v.url = ""; } }
      else if (k) v[k] = c.text || "";
    }
    const row = Object.assign({ name: it.name }, v);
    const g = String(it.group && it.group.title || "").toLowerCase();
    if (g === "systems") out.systems.push(row);
    else if (g === "gaps") out.gaps.push(row);
  }
  cache = { at: Date.now(), data: out };
  return out;
}

// The page with the live rows swapped in. Any failure returns the page unchanged.
export async function ecosystemWithLive(page, token) {
  try {
    const live = await ecoLive(token);
    if (!live.gaps.length && !live.systems.length) return page;
    const json = JSON.stringify(live).replace(/</g, "\\u003c").split(String.fromCharCode(8232)).join(" ").split(String.fromCharCode(8233)).join(" ");
    return page.replace("const LIVE=null;/*ECO_LIVE*/", () => "const LIVE=" + json + ";");
  } catch (e) { return page; }
}
