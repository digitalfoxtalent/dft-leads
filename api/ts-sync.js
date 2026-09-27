// Hourly: fill AD READ TIMES for the next 15 campaign videos that have none (Vercel cron).
// Works through the backlog, then keeps up with new campaign videos. See _reports/timestamps.js.
import { timestampApply } from "./_reports/timestamps.js";
import { campaignPayload } from "./_reports/campaigns/load.js";
import { mondayToken } from "./_reports/monday.js";

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const secret = process.env.CRON_SECRET;
  const fromCron = req.headers["x-vercel-cron"] || /^vercel-cron\//.test(String(req.headers["user-agent"] || "")) || (secret && req.headers.authorization === "Bearer " + secret);
  if (!fromCron) return res.status(401).json({ error: "Unauthorized" });
  try { const t = mondayToken(); return res.status(200).json(await timestampApply(t, await campaignPayload(t), null, { dry: false, max: 15 })); }
  catch (e) { return res.status(500).json({ error: String(e && e.message || e).slice(0, 300) }); }
}
