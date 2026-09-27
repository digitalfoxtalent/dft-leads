// Daily TikTok and Instagram views for campaign creator rows (Vercel cron). See _reports/social.js.
// Cron only; the team can run it by hand from the reports site at /social-sync (?dry=1 to check).
import { socialSync } from "./_reports/social.js";
import { mondayToken } from "./_reports/monday.js";

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const secret = process.env.CRON_SECRET;
  const fromCron = req.headers["x-vercel-cron"] || /^vercel-cron\//.test(String(req.headers["user-agent"] || "")) || (secret && req.headers.authorization === "Bearer " + secret);
  if (!fromCron) return res.status(401).json({ error: "Unauthorized" });
  try { return res.status(200).json(await socialSync(mondayToken(), { dry: false })); }
  catch (e) { return res.status(500).json({ error: String(e && e.message || e).slice(0, 300) }); }
}
