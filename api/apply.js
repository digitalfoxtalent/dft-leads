// SUBPLOT — "Become a SubPlotter" application endpoint.
// Writes one row to the SubPlotter Applications board (monday 18429286879).
const BOARD = 18429286879;
const COL = {
  handle: "text_mm6t9jjy", email: "email_mm6t41gr", kind: "text_mm6tgjz2", size: "text_mm6t93zz",
  terms: "text_mm6t49ja", submitted: "date_mm6twsvn", status: "color_mm6tjxz0", youtube: "link_mm6tgavj",
};

function readBody(req) {
  return new Promise(resolve => {
    if (req.body && typeof req.body === "object") return resolve(req.body);
    let s = ""; req.on("data", c => s += c); req.on("end", () => { try { resolve(JSON.parse(s || "{}")); } catch { resolve({}); } });
  });
}

export default async function handler(req, res) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const b = await readBody(req);
  if (b.website) return res.status(200).json({ ok: true });                       // honeypot: silently accept bots
  const handle = "@" + String(b.handle || "").trim().replace(/^https?:\/\/(www\.)?youtube\.com\//i, "").replace(/^@+/, "").replace(/[^\w.-]/g, "");
  const name = String(b.name || "").trim().slice(0, 120);
  const email = String(b.email || "").trim().slice(0, 200);
  if (handle.length < 3 || !name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || b.consent !== "yes")
    return res.status(400).json({ error: "handle, name, email and consent are required" });

  const token = process.env.MONDAY_API_KEY || process.env.MONDAY_API_TOKEN;
  if (!token) return res.status(500).json({ error: "MONDAY_API_KEY env var not set" });

  const values = {
    [COL.handle]: handle,
    [COL.email]: { email, text: email },
    [COL.kind]: String(b.kind || "").slice(0, 80),
    [COL.size]: String(b.size || "").slice(0, 40),
    // Where the application came from, so the rail promo variants can be compared on the
    // number that actually matters: applications, not clicks.
    [COL.terms]: "60/40 to the creator · $50 monthly publishing fee off the creator share, floored at zero · non-exclusive · payout from $50 · licence granted on application (v3, 28 Sep 2026) · source: "
      + (String(b.source || "direct").replace(/[^\w-]/g, "").slice(0, 40) || "direct"),
    [COL.submitted]: { date: new Date().toISOString().slice(0, 10) },
    [COL.status]: { label: "New" },
    [COL.youtube]: { url: "https://www.youtube.com/" + handle, text: handle },
  };
  const query = `mutation($b: ID!, $n: String!, $v: JSON!) { create_item(board_id: $b, item_name: $n, column_values: $v) { id } }`;
  const r = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" },
    body: JSON.stringify({ query, variables: { b: String(BOARD), n: `${name} (${handle})`, v: JSON.stringify(values) } }),
  });
  const out = await r.json();
  if (out.errors) return res.status(502).json({ error: out.errors });
  return res.status(200).json({ ok: true, id: out.data.create_item.id });
}
