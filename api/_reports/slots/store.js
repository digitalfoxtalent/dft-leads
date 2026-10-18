// Where the Slot board keeps its nightly copy: Apify key-value store "dft-slot-board", record "board".
// The store is opened by name (created on first use), so no store id lives in code. The Apify token is
// read at run time from the monday board "API Keys (Private)", item "Apify" 12634208127, the same way
// the Video distribution report reads it. It is never logged or returned.
//
// RULES (as every report): reading never throws (null or { error } comes back); writing is only ever
// done by the cron handler api/slots-build.js (nightly build and the 10-minute quick refresh).

import { monday } from "../monday.js";

export const STORE_NAME = "dft-slot-board";
export const RECORD = "board";
const KEY_ITEM = 12634208127;
const KEY_COL = "text_mm5bcxe7";
let storeId = null;

async function apifyToken(mondayTok) {
  const d = await monday(mondayTok, "query { items(ids:[" + KEY_ITEM + "]) { column_values(ids:[\"" + KEY_COL + "\"]) { text } } }");
  const t = d && d.items && d.items[0] && d.items[0].column_values[0] && d.items[0].column_values[0].text;
  const tok = String(t || "").trim();
  if (tok.length < 10) throw new Error("Apify key missing on monday");
  return tok;
}

async function store(tok) {
  if (storeId) return storeId;
  const r = await fetch("https://api.apify.com/v2/key-value-stores?name=" + STORE_NAME, { method: "POST", headers: { Authorization: "Bearer " + tok } });
  const j = await r.json();
  const id = j && j.data && j.data.id;
  if (!id) throw new Error("could not open the store (" + r.status + ")");
  storeId = id;
  return id;
}

export async function readSnapshot(mondayTok) {
  try {
    const tok = await apifyToken(mondayTok);
    const r = await fetch("https://api.apify.com/v2/key-value-stores/" + await store(tok) + "/records/" + RECORD, { headers: { Authorization: "Bearer " + tok } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error("store answered " + r.status);
    return await r.json();
  } catch (e) {
    return { error: String(e && e.message || e).slice(0, 160) };
  }
}

export async function writeSnapshot(mondayTok, value) {
  const tok = await apifyToken(mondayTok);
  const r = await fetch("https://api.apify.com/v2/key-value-stores/" + await store(tok) + "/records/" + RECORD, {
    method: "PUT", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(value) });
  if (!r.ok) throw new Error("store write answered " + r.status);
  return true;
}
