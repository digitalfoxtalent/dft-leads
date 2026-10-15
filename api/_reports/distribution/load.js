// Video distribution: DFT's own MSN video pipeline (rejection import, repair feeds), plus breaks on every
// channel (breaks.js: MSN, Megaphone, Facebook planned). READ ONLY.
//
// SOURCE
//   Apify key-value store "dft-msn-rejections" (EyrrhXh9rjPUAQ7ee), record "distribution-status".
//   One JSON document: { summary, feeds[], videos[] }. Claude writes it after each import and after
//   each check of the repair feeds; this page only reads it.
//   The Apify token is read at run time from the monday board "API Keys (Private)" 18422548864,
//   item "Apify" 12634208127, column "Key (paste here)", the same way the Megaphone token is.
//   It is never logged or returned.
//
// RULES (as every report): it always renders; if the store cannot be read, show the last good
// figures and say so; an empty or short read is a fault, never the truth.

import { monday } from "../monday.js";
import { TEMPLATE } from "./page.js";
import { breaksData } from "./breaks.js";
import { breaksSection } from "./breaks-section.js";

const KEY_ITEM = 12634208127;
const KEY_COL = "text_mm5bcxe7";
const STORE = "EyrrhXh9rjPUAQ7ee";
const RECORD = "distribution-status";
const CACHE_MS = 10 * 60 * 1000;
let cache = null, lastGood = null;

async function apifyToken(mondayTok) {
  const d = await monday(mondayTok, "query { items(ids:[" + KEY_ITEM + "]) { column_values(ids:[\"" + KEY_COL + "\"]) { text } } }");
  const t = d && d.items && d.items[0] && d.items[0].column_values[0] && d.items[0].column_values[0].text;
  return String(t || "").trim();
}

async function readStatus(mondayTok) {
  const tok = await apifyToken(mondayTok);
  if (tok.length < 10) throw new Error("Apify key missing on monday");
  const r = await fetch("https://api.apify.com/v2/key-value-stores/" + STORE + "/records/" + RECORD, { headers: { Authorization: "Bearer " + tok } });
  if (!r.ok) throw new Error("store answered " + r.status);
  const d = await r.json();
  if (!d || !d.summary || !Array.isArray(d.feeds) || !Array.isArray(d.videos)) throw new Error("record is incomplete");
  return d;
}

export async function distributionData(mondayTok) {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  try {
    const d = await readStatus(mondayTok);
    lastGood = d;
    cache = { at: Date.now(), data: Object.assign({}, d, { fetchedAt: new Date().toISOString() }) };
    return cache.data;
  } catch (e) {
    const error = String(e && e.message || e).slice(0, 160);
    if (lastGood) return Object.assign({}, lastGood, { stale: true, error });
    return { stale: true, error, summary: null, feeds: [], videos: [] };
  }
}

// The multi-channel breaks section (breaks.js, breaks-section.js) goes under the MSN headline figures.
// If it fails for any reason the MSN page still renders, with a note in place of the section.
const BREAKS_ANCHOR = '<section class="kpis" id="kpis" aria-live="polite"></section>';

// The page never waits more than BREAKS_WAIT_MS for the breaks section (15 Oct 2026: after a deploy the
// first Megaphone read can run past the server's time limit and the whole page answered 504). Requests
// that arrive while one read is running share it instead of each starting their own, so Megaphone is
// not asked the same thing several times at once; the next visit shows the section once it is ready.
const BREAKS_WAIT_MS = 40000;
let breaksWork = null;
function breaksOnce(mondayTok, payload) {
  if (!breaksWork) breaksWork = breaksData(mondayTok, payload).finally(() => { breaksWork = null; });
  return breaksWork;
}

export async function renderDistribution(mondayTok) {
  const payload = await distributionData(mondayTok);
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  const page = TEMPLATE.replace("__DATA__", () => json);
  let section;
  try {
    const d = await Promise.race([breaksOnce(mondayTok, payload), new Promise(res => setTimeout(() => res(null), BREAKS_WAIT_MS))]);
    section = d ? breaksSection(d) : '<div class="notice">The breaks section is still gathering figures from Megaphone. Refresh in a minute. The MSN figures above are unaffected.</div>';
  }
  catch (e) { section = '<div class="notice">The breaks section could not load just now. The MSN figures below are unaffected.</div>'; }
  return page.includes(BREAKS_ANCHOR) ? page.replace(BREAKS_ANCHOR, () => BREAKS_ANCHOR + section) : page.replace("</body>", () => section + "</body>");
}
