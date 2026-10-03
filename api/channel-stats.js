// Channel Connect link for the digitalfoxtalent.com /sign-up form.
//
// Applicants can press "Connect YouTube" on the form instead of uploading a Media Kit PDF.
// That grants Digital Fox Talent read-only YouTube Analytics access (dft-connect) and gives
// the form a signed link to a live stats page. After sign-up the form posts that link here
// with the applicant's email. Like media-kit.js, this finds the Creator Applications row
// (monday 18429940671) by email, retrying because Make creates it asynchronously, and writes
// the link to the "Channel stats (live)" column. It never creates rows.
//
// It also reads the stats page's ?format=json once and writes a text snapshot plus the
// average long-form views onto the row. Connect replaced the Media Kit PDF on the form, so
// this snapshot is what stays on file if the creator later removes access.
//
// Only signed dft-connect stats links are accepted, and an existing link is never
// overwritten, so this cannot be used to point someone else's row somewhere else.
export const config = { maxDuration: 60 };

const BOARD = 18429940671;
const EMAIL_COL = "email_mm6z87as";
const STATS_COL = "link_mm7sak1n";
const AVG_COL = "numeric_mm7sxx55"; // Avg long-form views
const SNAPSHOT_COL = "long_text_mm7se2f4"; // Channel stats snapshot
const ELIGIBILITY_AVG_VIEWS = 100000; // DFT's bar to apply (long-form average)
const ALLOWED_ORIGINS = ["https://digitalfoxtalent.com", "https://www.digitalfoxtalent.com", "https://dev.digitalfoxtalent.com"];
const STATS_RE = /^https:\/\/connect\.digitalfoxtalent\.com\/api\/stats\?k=(UC[A-Za-z0-9_-]{22})&t=[A-Za-z0-9_-]{32}$/;

function cors(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function monday(token, query, variables) {
  const r = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" },
    body: JSON.stringify({ query, variables }),
  });
  const out = await r.json();
  if (out.errors) throw new Error(JSON.stringify(out.errors));
  return out.data;
}

async function findRowByEmail(token, email) {
  const q = `query($b: ID!, $c: [ItemsPageByColumnValuesQuery!], $cols: [String!]) {
    items_page_by_column_values(board_id: $b, limit: 5, columns: $c) {
      items { id name column_values(ids: $cols) { id text } } } }`;
  const d = await monday(token, q, {
    b: String(BOARD),
    c: [{ column_id: EMAIL_COL, column_values: [email] }],
    cols: [STATS_COL],
  });
  return d.items_page_by_column_values.items[0] || null;
}

// The stats page's ?format=json answer: the same figures the page shows, as data.
async function fetchSummary(statsUrl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(statsUrl + "&format=json", { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const n = (x) => (x == null || isNaN(x) ? "n/a" : Math.round(x).toLocaleString("en-US"));
const list = (rows, key) => (rows || []).map((r) => `${r[key]} ${r.pct}%`).join(", ") || "not shared by YouTube";

function snapshotText(s, statsUrl) {
  const meets = s.avgLongformViews == null ? "unknown" : s.avgLongformViews >= ELIGIBILITY_AVG_VIEWS ? "yes" : "no";
  return [
    `${s.title || s.channelId}${s.handle ? " (" + s.handle + ")" : ""}${s.country ? ", " + s.country : ""}`,
    `Snapshot taken ${String(s.generatedAt || "").slice(0, 10)} when they connected YouTube on the sign-up form.`,
    "",
    `Avg views per long-form video: ${n(s.avgLongformViews)} (median ${n(s.medianLongformViews)}, last ${s.longformCounted} uploads). Meets the 100k bar: ${meets}`,
    `Subscribers: ${s.subscribers == null ? "hidden" : n(s.subscribers)}`,
    `Views: ${n(s.views28)} last 28 days, ${n(s.views90)} last 90 days`,
    `Watch time, last 28 days: ${n(s.watchHours28)} hrs`,
    `Net subscribers, last 28 days: ${s.netSubs28 == null ? "n/a" : (s.netSubs28 >= 0 ? "+" : "") + n(s.netSubs28)}`,
    `Lifetime views: ${n(s.lifetimeViews)}`,
    "",
    `Age: ${list(s.ages, "group")}`,
    `Gender: ${list(s.genders, "gender")}`,
    `Top countries: ${list(s.topCountries, "country")}`,
    `Devices: ${list(s.devices, "device")}`,
    `Content mix: ${list(s.contentTypes, "type")}`,
    s.errors && s.errors.length ? `Not loaded at the time: ${s.errors.join(", ")}` : null,
    "",
    `Live page: ${statsUrl}`,
  ].filter((line) => line !== null).join("\n").trim();
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch (e) { return {}; }
}

export default async function handler(req, res) {
  cors(req, res);
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const token = process.env.MONDAY_API_KEY || process.env.MONDAY_API_TOKEN;
  if (!token) return res.status(500).json({ error: "MONDAY_API_KEY env var not set" });

  const body = readBody(req);
  const email = String(body.email || "").trim().toLowerCase().slice(0, 200);
  const statsUrl = String(body.stats_url || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "A valid email is required" });
  const m = STATS_RE.exec(statsUrl);
  if (!m) return res.status(400).json({ error: "Not a Channel Connect stats link" });
  if (body.channel_id && body.channel_id !== m[1]) return res.status(400).json({ error: "Channel does not match the link" });

  // Start reading the stats now; the row search below takes a few seconds anyway.
  const summaryPromise = fetchSummary(statsUrl);

  // Make creates the row asynchronously; poll for up to ~30s.
  let row = null;
  for (let i = 0; i < 11 && !row; i++) {
    if (i) await sleep(3000);
    try { row = await findRowByEmail(token, email); } catch (e) { /* transient, retry */ }
  }
  if (!row) return res.status(404).json({ error: "Application row not found yet" });

  const existing = (row.column_values || []).find((c) => c.id === STATS_COL);
  if (existing && existing.text) return res.status(200).json({ ok: true, itemId: row.id, unchanged: true });

  try {
    const cols = { [STATS_COL]: { url: statsUrl, text: "Open live stats" } };
    const s = await summaryPromise;
    if (s) {
      cols[SNAPSHOT_COL] = { text: snapshotText(s, statsUrl) };
      if (s.avgLongformViews != null) cols[AVG_COL] = String(s.avgLongformViews);
    }
    const value = JSON.stringify(cols);
    await monday(
      token,
      `mutation($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id: $b, item_id: $i, column_values: $v) { id } }`,
      { b: String(BOARD), i: String(row.id), v: value }
    );
    return res.status(200).json({ ok: true, itemId: row.id, snapshot: !!s });
  } catch (e) {
    return res.status(502).json({ error: "Could not save the link to the row" });
  }
}
