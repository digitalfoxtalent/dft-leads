// Cron (vercel.json, every 30 minutes): copies monday into the Ecosystem database, one way, read only on
// monday. See api/_reports/mirror/sync.js for what a run does and the limits that keep it gentle on the
// shared monday account. Scheduler only, production only; the reply holds counts, never data.

import { isCron } from "./_reports/cron.js";
import { mondayToken } from "./_reports/monday.js";
import { runSync } from "./_reports/mirror/sync.js";
import { hasDatabase } from "./_reports/mirror/db.js";

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!isCron(req)) return res.status(404).json({ error: "Not found" });
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return res.status(404).json({ error: "Not found" });
  const token = mondayToken();
  if (!token) return res.status(500).json({ error: "monday token missing" });
  if (!hasDatabase()) return res.status(500).json({ error: "database not connected" });
  try { return res.status(200).json(await runSync(token)); }
  catch (e) { return res.status(500).json({ ok: false, error: String(e && e.message || e).slice(0, 300) }); }
}
