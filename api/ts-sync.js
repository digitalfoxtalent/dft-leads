// Hourly: fill AD READ TIMES for the next 15 campaign videos that have none (Vercel cron).
// Works through the backlog, then keeps up with new campaign videos. See _reports/timestamps.js.
import { isCron } from "./_reports/cron.js";
import { timestampApply } from "./_reports/timestamps.js";
import { campaignPayload } from "./_reports/campaigns/load.js";
import { mondayToken } from "./_reports/monday.js";

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const fromCron = isCron(req); // shared check: CRON_SECRET once it is set, the scheduler's user agent until then
  if (!fromCron) return res.status(401).json({ error: "Unauthorized" });
  try { const t = mondayToken(); return res.status(200).json(await timestampApply(t, await campaignPayload(t), null, { dry: false, max: 15 })); }
  catch (e) { return res.status(500).json({ error: String(e && e.message || e).slice(0, 300) }); }
}
