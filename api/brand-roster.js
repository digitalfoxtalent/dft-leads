// Vercel serverless function: the public slice of the rates board that the brand
// partnership page on digitalfoxtalent.com shows under each creator, and nothing else.
//
// Its sibling, /api/roster, returns the whole board (rates, CPMs, exclusivity,
// audience data) and is deliberately locked to its own host with no CORS, because
// none of that is public. This endpoint exists so the website never needs to touch
// that one. It returns exactly three things per creator, all of which are already
// printed on the public brand page: the channel handle, the channel's view
// guarantee, and the name and guarantee of each bookable show. No rates, no CPMs,
// no audience columns, and only the live YouTube group, never Dormant or Left.
//
// Shape, keyed by lower-cased handle without the @:
//   { "heavyspoilers": { "g": 364608, "shows": [["Ending Explained", 366358], ...] }, ... }
//
// The page carries the same figures baked in as a fallback, refreshed by hand from
// time to time, so if this endpoint is ever unreachable the cards still render.
const BOARD = 18417663127;
const GROUP = "topics";                       // "Youtube Shows / Channels"
const HANDLE = "text_mm49w81b";
const GUARANTEE = "numeric_mm49rr3n";         // View Guarantee, 1.5x avg of last 10 long-form uploads
const SHOW_GUARANTEE = "numeric_mm49tej8";    // the same, per show subitem

// Answer only on the roster host, like the sibling. The Host header is the URL the
// page fetched, so a request from digitalfoxtalent.com still carries this host.
const ROSTER_HOSTS = new Set(["roster-viewguarantee.digitalfoxtalent.com"]);
const hostOf = req => String(
  (req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0]
).toLowerCase().trim().replace(/^www\./, "").split(":")[0];

// The one site allowed to read this cross-origin.
const ORIGINS = new Set(["https://digitalfoxtalent.com", "https://www.digitalfoxtalent.com"]);

const num = t => {
  const raw = t == null ? "" : String(t).replace(/[^0-9.]/g, "");
  const n = raw === "" ? NaN : parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
};

export default async function handler(req, res) {
  try {
    if (!ROSTER_HOSTS.has(hostOf(req))) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(404).json({ error: "Not found" });
    }
    const origin = String(req.headers.origin || "");
    if (ORIGINS.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") return res.status(204).end();

    const token = process.env.MONDAY_API_KEY || process.env.MONDAY_API_TOKEN;
    if (!token) return res.status(500).json({ error: "MONDAY_API_KEY env var not set" });

    const query =
      "query{boards(ids:[" + BOARD + "]){groups(ids:[\"" + GROUP + "\"]){items_page(limit:120){items{" +
      "column_values(ids:[\"" + HANDLE + "\",\"" + GUARANTEE + "\"]){id text} " +
      "subitems{name column_values(ids:[\"" + SHOW_GUARANTEE + "\"]){text}}}}}}}";
    const r = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({ query })
    });
    const body = await r.json();
    if (body.errors) return res.status(502).json({ error: body.errors });

    const groups = (body.data && body.data.boards && body.data.boards[0] && body.data.boards[0].groups) || [];
    const items = (groups[0] && groups[0].items_page && groups[0].items_page.items) || [];
    const out = {};
    items.forEach(it => {
      const cvs = it.column_values || [];
      const col = id => (cvs.find(c => c && c.id === id) || {}).text;
      const handle = String(col(HANDLE) || "").replace(/^@/, "").trim().toLowerCase();
      const g = num(col(GUARANTEE));
      // A row with no guarantee is either brand new or dead; the roster page hides
      // those too, so the brand page shows no figure rather than a zero.
      if (!handle || g <= 0) return;
      const shows = (it.subitems || [])
        .map(s => [s.name, num(((s.column_values || [])[0] || {}).text)])
        .filter(s => s[1] > 0);
      out[handle] = { g, shows };
    });

    // The board is rewritten once a day by the sync, so serve from the edge cache
    // and refresh behind the visitor, the same as the sibling endpoint.
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=86400");
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
