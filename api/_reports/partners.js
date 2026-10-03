// Partner views: one partner's campaigns, shared outside DFT with its own link.
//
// THE LIST LIVES ON MONDAY: board "Report Partners" (18433852691), one row per partner.
// Adding a row adds a page at /campaigns/<slug>; unticking LIVE or changing the key hash turns
// it off. No code change or deploy is needed. The board is read at most every 5 minutes.
//
// Each partner has its own key (only the SHA-256 is kept). Opening /campaigns/<id>?k=<key>
// sets a partner cookie that opens THAT page only, plus the public per-video lookups it uses.
// It never opens Campaign reach, Platform monetization or any other report.
//
// A campaign belongs to a partner when the deal's CLIENTS, its CLIENT mirror (from CONTACTS)
// or its QB Customer mirror contains the partner's CLIENT MATCH words (spaces, dots and
// capitals ignored, several terms separated by |).
// The page data is stripped on the server: no brand price, deal value, creator cost, sales lead,
// monday links or other clients' deals ever reach a partner's browser.

import { monday } from "./monday.js";

export const PARTNERS_BOARD = 18433852691;
const COLS = { slug: "text_mm7s84aa", match: "text_mm7sppkd", sha: "text_mm7sm03g", live: "boolean_mm7sqv83" };
const TTL = 5 * 60 * 1000;

// "Power Play" -> /p\W*o\W*w\W*e\W*r\W*p\W*l\W*a\W*y/i, so it also matches "PowerPlayAds".
export function matcher(words) {
  const parts = String(words || "").split("|").map(w => w.toLowerCase().replace(/[^a-z0-9]/g, "")).filter(Boolean);
  if (!parts.length) return null;
  return new RegExp(parts.map(w => w.split("").join("[^a-z0-9]*")).join("|"), "i");
}

// Built in so partner links keep working even if monday cannot be read.
const BUILT_IN = {
  rhapsody: { name: "Rhapsody", match: /rhapsody/i, keySha: "ae376105a3428435a38819ca20c7c9058c2193f1b00688050b399d7ba1ec2894" },
};

// One shared object: every importer sees the latest list after loadPartners() runs.
export const PARTNERS = { ...BUILT_IN };
let loadedAt = 0;

export async function loadPartners(token) {
  if (Date.now() - loadedAt < TTL) return PARTNERS;
  try {
    const d = await monday(token, `{ boards(ids: [${PARTNERS_BOARD}]) { items_page(limit: 200) { items { name column_values(ids: ${JSON.stringify(Object.values(COLS))}) { id text } } } } }`);
    const items = (((d.boards || [])[0] || {}).items_page || {}).items || [];
    const next = {};
    for (const it of items) {
      const v = {}; for (const c of it.column_values || []) v[c.id] = c.text || "";
      const slug = v[COLS.slug].trim().toLowerCase(), sha = v[COLS.sha].trim().toLowerCase(), match = matcher(v[COLS.match]);
      if (v[COLS.live] !== "v" || !/^[a-z0-9-]+$/.test(slug) || !/^[0-9a-f]{64}$/.test(sha) || !match) continue;
      next[slug] = { name: it.name.trim(), match, keySha: sha };
    }
    // A read that drops every partner counts as a fault, never the truth: keep the last list.
    if (!Object.keys(next).length && items.length) throw new Error("no valid partner rows");
    for (const k of Object.keys(PARTNERS)) delete PARTNERS[k];
    Object.assign(PARTNERS, Object.keys(next).length ? next : BUILT_IN);
    loadedAt = Date.now();
  } catch (e) {
    loadedAt = Date.now() - TTL + 60 * 1000; // try again in a minute
  }
  return PARTNERS;
}
