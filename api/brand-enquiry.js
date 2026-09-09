// Brand enquiry endpoint. Takes a shortlist sent from the Brand Partnership Roster
// page on digitalfoxtalent.com (or any brand-side form that posts the same shape)
// and writes one row to the Brand Enquiries board (monday 18430423439).
//
// Email to the team and the auto-reply to the brand are monday automations on that
// board, so this file only has to get the row in. Keeping the notification logic in
// monday means Tom can change who gets told, and what the brand is told, without a deploy.
const BOARD = 18430423439;
const COL = {
  contact: "text_mm71bmkm", email: "email_mm71btg0", budget: "text_mm713bk9",
  creators: "long_text_mm714m1b", message: "long_text_mm71nh8r", plan: "link_mm71zqqj",
  received: "date_mm71mnz5", status: "color_mm71ejc3", source: "color_mm71stz1",
};
const SOURCES = { roster: "Roster shortlist", brief: "Brief form", email: "Email to brands@" };
const ALLOWED_ORIGINS = ["https://digitalfoxtalent.com", "https://www.digitalfoxtalent.com", "https://dev.digitalfoxtalent.com"];

function cors(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}
function readBody(req) {
  return new Promise(resolve => {
    if (req.body && typeof req.body === "object") return resolve(req.body);
    let s = ""; req.on("data", c => s += c); req.on("end", () => { try { resolve(JSON.parse(s || "{}")); } catch { resolve({}); } });
  });
}
const clean = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);

export default async function handler(req, res) {
  cors(req, res);
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const b = await readBody(req);
  if (b.website) return res.status(200).json({ ok: true });                       // honeypot: silently accept bots

  const brand = clean(b.brand, 120);
  const name = clean(b.name, 120);
  const email = clean(b.email, 200);
  const budget = clean(b.budget, 60);
  const message = String(b.message || "").trim().slice(0, 2000);
  const creators = (Array.isArray(b.creators) ? b.creators : []).map(c => clean(c, 80)).filter(Boolean).slice(0, 60);
  const plan = clean(b.planLink, 1500);
  const source = SOURCES[String(b.source || "").toLowerCase()] || "Other";

  if (!brand || !name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return res.status(400).json({ error: "brand, name and a valid email are required" });
  if (source === "Roster shortlist" && !creators.length)
    return res.status(400).json({ error: "pick at least one creator" });

  const token = process.env.MONDAY_API_KEY || process.env.MONDAY_API_TOKEN;
  if (!token) return res.status(500).json({ error: "MONDAY_API_KEY env var not set" });

  const values = {
    [COL.contact]: name,
    [COL.email]: { email, text: email },
    [COL.budget]: budget,
    [COL.creators]: { text: creators.join("\n") },
    [COL.message]: { text: message },
    [COL.received]: { date: new Date().toISOString().slice(0, 10) },
    [COL.status]: { label: "New" },
    [COL.source]: { label: source },
  };
  if (/^https:\/\/(www\.)?digitalfoxtalent\.com\//.test(plan)) values[COL.plan] = { url: plan, text: "Open shortlist" };

  const itemName = creators.length ? `${brand} · ${creators.length} creator${creators.length === 1 ? "" : "s"}` : brand;
  const query = `mutation($b: ID!, $n: String!, $v: JSON!) { create_item(board_id: $b, item_name: $n, column_values: $v) { id } }`;
  const r = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" },
    body: JSON.stringify({ query, variables: { b: String(BOARD), n: itemName, v: JSON.stringify(values) } }),
  });
  const out = await r.json();
  if (out.errors) return res.status(502).json({ error: out.errors });
  return res.status(200).json({ ok: true, id: out.data.create_item.id });
}
