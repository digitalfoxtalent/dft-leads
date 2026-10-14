// Is this request Vercel's cron scheduler (or a caller holding CRON_SECRET)?
//
// Vercel's scheduler calls every cron path with the user agent "vercel-cron/1.0". It adds an
// "Authorization: Bearer <CRON_SECRET>" header only when CRON_SECRET is set on the project. Do not
// rely on an "x-vercel-cron" header: in this project it does not arrive. The overnight backfill hit
// that on 27 Sep 2026 (fixed in 7d7741a), and the nightly link finder, which checked only that
// header, was refused every night from 27 Sep to 2 Oct 2026 without anyone noticing.
//
// Every cron handler should use this one check, so the next job cannot copy the old one.
//
// Once CRON_SECRET is set on the project, Vercel sends it with every cron call and it is the ONLY thing
// accepted: a user agent can be typed by anyone, so without the secret anyone could start a scheduled
// job and read its summary. Set CRON_SECRET in Vercel (Settings, Environment Variables, Production)
// to close that; nothing else needs changing.
export function isCron(req) {
  const h = (req && req.headers) || {};
  const secret = process.env.CRON_SECRET;
  if (secret) return h.authorization === "Bearer " + secret;
  if (h["x-vercel-cron"]) return true;
  return /^vercel-cron\//.test(String(h["user-agent"] || ""));
}
