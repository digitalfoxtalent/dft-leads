// Slot board page: reads the nightly copy (store.js) and renders it. READ ONLY.
// If the copy cannot be read, the page shows the last good copy this instance holds and says so.

import { readSnapshot } from "./store.js";
import { TEMPLATE } from "./page.js";

const CACHE_MS = 10 * 60 * 1000;
let cache = null, lastGood = null;

export async function slotsData(token) {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const snap = await readSnapshot(token);
  let data;
  if (snap && !snap.error && snap.weeks) { data = Object.assign({ source: "store" }, snap); lastGood = data; }
  else if (lastGood) data = Object.assign({}, lastGood, { stale: snap && snap.error ? "The saved copy could not be read just now (" + snap.error + "). Showing the last copy this server read." : "Showing the last copy this server read." });
  else data = { empty: true, error: snap && snap.error ? snap.error : "No copy has been built yet. The first build runs tonight at 05:40 UTC." };
  cache = { at: Date.now(), data };
  return data;
}

export async function renderSlots(token) {
  const data = await slotsData(token);
  const json = JSON.stringify(data).replace(/</g, "\\u003c").split(String.fromCharCode(8232)).join(" ").split(String.fromCharCode(8233)).join(" ");
  return TEMPLATE.replace("__DATA__", () => json);
}
