// Where the breaks dashboard keeps what it learns overnight. Apify key-value store "dft-breaks-history"
// (FJjKkE3tbdBfyzUDI), created 4 Oct 2026 for this and nothing else.
//
// RECORDS
//   adgaps-0, adgaps-1, adgaps-2   one per nightly scan part (/api/breaks-scan?part=N): every LIVE
//                                  Megaphone episode with a missing pre-roll, post-roll or mid-roll.
//   history                        the open breaks seen each night, last 14 nights, so the page can
//                                  show what was fixed or cleared this week.
//
// The Apify token is read at run time from the monday board "API Keys (Private)", item "Apify"
// 12634208127, the same way load.js reads it. It is never logged or returned.
//
// RULES (as every report): reading never throws; a record that cannot be read comes back null and the
// page says so; writing is only ever done by the cron handler.

import { monday } from "../monday.js";

export const STORE = "FJjKkE3tbdBfyzUDI";
export const PARTS = 3;
const KEY_ITEM = 12634208127;
const KEY_COL = "text_mm5bcxe7";
const API = "https://api.apify.com/v2/key-value-stores/" + STORE + "/records/";

async function apifyToken(mondayTok) {
  const d = await monday(mondayTok, "query { items(ids:[" + KEY_ITEM + "]) { column_values(ids:[\"" + KEY_COL + "\"]) { text } } }");
  const t = d && d.items && d.items[0] && d.items[0].column_values[0] && d.items[0].column_values[0].text;
  const tok = String(t || "").trim();
  if (tok.length < 10) throw new Error("Apify key missing on monday");
  return tok;
}

export async function readRecord(mondayTok, key) {
  try {
    const tok = await apifyToken(mondayTok);
    const r = await fetch(API + encodeURIComponent(key), { headers: { Authorization: "Bearer " + tok } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error("store answered " + r.status);
    return await r.json();
  } catch (e) {
    return { error: String(e && e.message || e).slice(0, 160) };
  }
}

export async function writeRecord(mondayTok, key, value) {
  const tok = await apifyToken(mondayTok);
  const r = await fetch(API + encodeURIComponent(key), {
    method: "PUT", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(value)
  });
  if (!r.ok) throw new Error("store write answered " + r.status);
  return true;
}
