// Vercel serverless function: the public slice of the rates board that
// digitalfoxtalent.com shows about each creator - on the brand partnership roster
// and on the per-creator booking pages (/brands/creators/<slug>) - and nothing else.
//
// Its sibling, /api/roster, returns the whole board (rates, exclusivity, notes) and is
// deliberately locked to its own host with no CORS. This endpoint exists so the
// website never needs to touch that one.
//
// WHAT IS PUBLIC, and why. Tom decided on 23 Sep 2026 that the creator pages show a
// CPM rather than a rate ("a rate on the creators page might be a bit heavy handed.
// Could we show a CPM?") and a headline audience summary, as long as both update in
// line with the roster. So per creator this returns: handle, channel view guarantee,
// subscribers, the base CPM, the rate floor where it applies, the audience split, the
// ad formats offered, and each bookable show's name and guarantee. Never the
// suggested rate, never the effective CPM of a floored row (a $212 CPM on a small
// channel is a rate in disguise), never Dormant or Left rows.
//
// Shape, keyed by lower-cased handle without the @:
//   { "heavyspoilers": { "g": 364608, "subs": 1680000, "cpm": 25, "min": null,
//       "aud": { "m": 87, "f": 12, "age": [["18-24",9],["25-34",30],...], "us": 56, "uk": 11 },
//       "ads": "Dedicated video, pre-roll, ...", "shows": [["Ending Explained", 366358], ...] }, ... }
//
// The pages carry figures baked in as a fallback, so if this endpoint is ever
// unreachable they still render.
const BOARD = 18417663127;
const GROUP = "topics";                       // "Youtube Shows / Channels"
const HANDLE = "text_mm49w81b";
const GUARANTEE = "numeric_mm49rr3n";         // View Guarantee, 1.5x avg of last 10 long-form uploads
const SHOW_GUARANTEE = "numeric_mm49tej8";    // the same, per show subitem
const SUBS = "numeric_mm49cx8f";
const CPM = "numeric_mm49bb66";
const RATE = "numeric_mm497vsg";              // used ONLY to report the floor on floored rows
const ADS = "long_text_mm5n8f4t";             // Ad Type Available
const AUD = { m: "text_mm5nkdfn", f: "text_mm5nb2t7", us: "text_mm5nsagz", uk: "text_mm5n7ybc" };
const AGES = [["13-17", "text_mm5n6m90"], ["18-24", "text_mm5n69hv"], ["25-34", "text_mm5nbatb"],
  ["35-44", "text_mm5n7syq"], ["45-54", "text_mm5n5cc8"], ["55-64", "text_mm5nzj3n"]];
const COLS = [HANDLE, GUARANTEE, SUBS, CPM, RATE, ADS, AUD.m, AUD.f, AUD.us, AUD.uk].concat(AGES.map(a => a[1]));

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
      "column_values(ids:[" + COLS.map(c => '"' + c + '"').join(",") + "]){id text} " +
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
    const rows = items.map(it => {
      const cvs = it.column_values || [];
      const col = id => (cvs.find(c => c && c.id === id) || {}).text;
      return { it, col };
    });

    // The base CPM is the one most channels carry (flat $25 in the sync as of Sep
    // 2026). A row above it is a small channel lifted by the $1,500 rate floor; for
    // those we publish the base CPM plus the floor, not the inflated figure.
    const counts = {};
    rows.forEach(({ col }) => { const c = num(col(CPM)); if (c > 0) counts[c] = (counts[c] || 0) + 1; });
    const base = Number(Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || 25);

    const pct = t => { const n = num(t); return n > 0 && n <= 100 ? Math.round(n) : null; };
    const out = {};
    rows.forEach(({ it, col }) => {
      const handle = String(col(HANDLE) || "").replace(/^@/, "").trim().toLowerCase();
      const g = num(col(GUARANTEE));
      // A row with no guarantee is either brand new or dead; the roster page hides
      // those too, so the brand page shows no figure rather than a zero.
      if (!handle || g <= 0) return;
      const shows = (it.subitems || [])
        .map(s => [s.name, num(((s.column_values || [])[0] || {}).text)])
        .filter(s => s[1] > 0);
      const cpm = num(col(CPM));
      const floored = cpm > base + 0.5;
      const age = AGES.map(([k, id]) => [k, pct(col(id))]).filter(a => a[1] != null);
      const aud = { m: pct(col(AUD.m)), f: pct(col(AUD.f)), age, us: pct(col(AUD.us)), uk: pct(col(AUD.uk)) };
      const hasAud = aud.m != null || age.length || aud.us != null;
      out[handle] = {
        g, shows,
        subs: num(col(SUBS)) || null,
        cpm: base,
        min: floored ? (num(col(RATE)) || null) : null,
        aud: hasAud ? aud : null,
        ads: String(col(ADS) || "").trim() || null,
      };
    });

    // The board is rewritten once a day by the sync, so serve from the edge cache
    // and refresh behind the visitor, the same as the sibling endpoint.
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=86400");
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
