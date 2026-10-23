// The Ecosystem API: ecosystem.digitalfoxtalent.com/api/v1/<path> (rewritten here with ?p=<path>, vercel.json).
// For Make and other systems; keys are made by Tom at /data/api-keys. See api/_reports/mirror/apikeys.js.

import { serveApi } from "./_reports/mirror/apikeys.js";
import { ensureSchema } from "./_reports/mirror/schema.js";
import { hasDatabase } from "./_reports/mirror/db.js";
import { mondayToken } from "./_reports/monday.js";

export const config = { maxDuration: 300 }; // gateway calls wait for monday; Make jobs can take a few minutes

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (String(req.headers.host || "") !== "ecosystem.digitalfoxtalent.com") return res.status(404).send(JSON.stringify({ error: "Not found" }));
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return res.status(404).send(JSON.stringify({ error: "Not found" }));
  if (!hasDatabase()) return res.status(503).send(JSON.stringify({ error: "Database not connected" }));
  const path = String(Array.isArray(req.query.p) ? req.query.p.join("/") : req.query.p || "").replace(/^\/+|\/+$/g, "").slice(0, 200);
  try {
    await ensureSchema();
    const q = Object.assign({}, req.query); delete q.p;
    const out = await serveApi({ method: req.method, headers: req.headers, query: q, body: req.body }, path, mondayToken());
    return res.status(out.status).send(out.raw != null ? out.raw : JSON.stringify(out.body));
  } catch (e) {
    console.error("eco-api", e);
    return res.status(500).send(JSON.stringify({ error: "Something went wrong." }));
  }
}
