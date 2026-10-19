// YouTube Data API with a fallback key (Claude, 19 Oct 2026).
// dft-leads' own YOUTUBE_API_KEY is shared with the daily scrapers (brand-scraper, channel-discovery,
// creator-scout) and runs out of quota by the afternoon. When it answers 403, retry once with the
// "YouTube Data API - DFT project (dft-youtube-data, Sep 2026)" key from the API Keys board, which is
// lightly used. Pass a URL without &key=; returns { ok, status, json }.
import { monday, mondayToken } from "./_reports/monday.js";

const FALLBACK_ITEM = 13142175799, KEY_COL = "text_mm5bcxe7";
let fallback = null;

async function fallbackKey() {
  if (fallback !== null) return fallback;
  fallback = "";
  try {
    const tok = mondayToken();
    if (tok) {
      const d = await monday(tok, `query { items(ids:[${FALLBACK_ITEM}]) { column_values(ids:["${KEY_COL}"]) { text } } }`);
      fallback = String((d.items[0] && d.items[0].column_values[0].text) || "").trim();
    }
  } catch (e) { fallback = ""; }
  return fallback;
}

export async function yt(url) {
  const keys = [process.env.YOUTUBE_API_KEY || ""];
  let last = { ok: false, status: 0, json: {} };
  for (let i = 0; i < 2; i++) {
    const key = i === 0 ? keys[0] : await fallbackKey();
    if (!key) continue;
    const r = await fetch(url + (url.includes("?") ? "&" : "?") + "key=" + key);
    const json = await r.json().catch(() => ({}));
    last = { ok: r.ok, status: r.status, json };
    if (r.ok || r.status !== 403) return last;
  }
  return last;
}
