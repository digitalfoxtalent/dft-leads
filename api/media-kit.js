// Media kit upload for the digitalfoxtalent.com /sign-up form.
//
// The site form registers the creator with Django first; Django posts the sign-up to a Make
// webhook which creates the row on Creator Applications (monday 18429940671). The form then
// posts the applicant's YouTube Studio Media Kit PDF here, with their email. This function
// finds that row by email (retrying, because Make is asynchronous and usually lands within a
// few seconds) and attaches the PDF to the "Media kit" files column. It never creates rows;
// Make stays the sole writer of rows on that board.
export const config = { maxDuration: 60, api: { bodyParser: false } };

const BOARD = 18429940671;
const EMAIL_COL = "email_mm6z87as";
const FILE_COL = "file_mm71q9ej";
const MAX_BYTES = 4 * 1024 * 1024; // Vercel's request body limit is 4.5MB
const ALLOWED_ORIGINS = ["https://digitalfoxtalent.com", "https://www.digitalfoxtalent.com", "https://dev.digitalfoxtalent.com"];

function cors(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", c => { size += c.length; if (size > MAX_BYTES + 65536) { reject(new Error("too_large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Minimal multipart/form-data parser: enough for a few text fields and one file.
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!m) return null;
  const boundary = Buffer.from("--" + (m[1] || m[2]).trim());
  const fields = {}; let file = null;
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    let start = pos + boundary.length;
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break; // closing "--"
    if (buf[start] === 0x0d) start += 2;
    const headEnd = buf.indexOf("\r\n\r\n", start);
    if (headEnd === -1) break;
    const head = buf.slice(start, headEnd).toString("utf8");
    const next = buf.indexOf(boundary, headEnd + 4);
    if (next === -1) break;
    const body = buf.slice(headEnd + 4, next - 2); // strip trailing CRLF
    const name = (/name="([^"]*)"/i.exec(head) || [])[1];
    const filename = (/filename="([^"]*)"/i.exec(head) || [])[1];
    const ctype = (/content-type:\s*([^\r\n]+)/i.exec(head) || [])[1];
    if (filename !== undefined) file = { name, filename, contentType: (ctype || "").trim(), data: body };
    else if (name) fields[name] = body.toString("utf8");
    pos = next;
  }
  return { fields, file };
}

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
  const q = `query($b: ID!, $c: [ItemsPageByColumnValuesQuery!]) {
    items_page_by_column_values(board_id: $b, limit: 5, columns: $c) { items { id name } } }`;
  const d = await monday(token, q, { b: String(BOARD), c: [{ column_id: EMAIL_COL, column_values: [email] }] });
  return d.items_page_by_column_values.items[0] || null;
}

async function attachFile(token, itemId, file) {
  const fd = new FormData();
  fd.append("query", `mutation($file: File!) { add_file_to_column(item_id: ${itemId}, column_id: "${FILE_COL}", file: $file) { id } }`);
  fd.append("variables[file]", new Blob([file.data], { type: "application/pdf" }), file.filename);
  const r = await fetch("https://api.monday.com/v2/file", {
    method: "POST", headers: { Authorization: token, "API-Version": "2024-10" }, body: fd,
  });
  const out = await r.json();
  if (out.errors || !out.data) throw new Error(JSON.stringify(out.errors || out));
  return out.data.add_file_to_column.id;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export default async function handler(req, res) {
  cors(req, res);
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const token = process.env.MONDAY_API_KEY || process.env.MONDAY_API_TOKEN;
  if (!token) return res.status(500).json({ error: "MONDAY_API_KEY env var not set" });

  let raw;
  try { raw = await readRaw(req); } catch (e) {
    return res.status(413).json({ error: "The PDF is too large. Please keep it under 4MB." });
  }
  const parsed = parseMultipart(raw, req.headers["content-type"]);
  if (!parsed || !parsed.file) return res.status(400).json({ error: "Send multipart/form-data with fields email and file" });
  const email = String(parsed.fields.email || "").trim().toLowerCase().slice(0, 200);
  const file = parsed.file;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "A valid email is required" });
  if (file.data.length > MAX_BYTES) return res.status(413).json({ error: "The PDF is too large. Please keep it under 4MB." });
  if (file.data.length < 100 || file.data.slice(0, 5).toString() !== "%PDF-")
    return res.status(400).json({ error: "The file must be a PDF" });
  const safeName = (file.filename || "media-kit.pdf").replace(/[^\w. -]/g, "_").replace(/\.pdf$/i, "") .slice(0, 80) + ".pdf";
  file.filename = safeName;

  // Make creates the row asynchronously; poll for up to ~40s.
  let row = null;
  for (let i = 0; i < 14 && !row; i++) {
    if (i) await sleep(3000);
    try { row = await findRowByEmail(token, email); } catch (e) { /* transient, retry */ }
  }
  if (!row) return res.status(404).json({ error: "We could not find your application yet. Please email your Media Kit to us instead." });

  try {
    const assetId = await attachFile(token, row.id, file);
    return res.status(200).json({ ok: true, item: row.id, asset: assetId });
  } catch (e) {
    return res.status(502).json({ error: "Upload failed. Please email your Media Kit to us instead.", detail: String(e.message).slice(0, 300) });
  }
}
