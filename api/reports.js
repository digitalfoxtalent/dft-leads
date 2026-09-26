// DFT Reports - reports.digitalfoxtalent.com. One entry point for every team report.
//
// STRUCTURE (api/_reports/)
//   access.js         team link + 90-day cookie, shared by every report
//   monday.js         read-only monday helper
//   megaphone.js      Megaphone access (token read from the monday API Keys board) + health probe
//   home.js           the front page listing every report
//   campaigns/        Campaign reach: load.js (data), page.js (page), podcast.js, snapshot.js
//
// ROUTES (vercel.json rewrites send each path here with ?r=)
//   /           -> home       /campaigns -> campaign reach       /status -> source health (JSON)
// Every route is behind the team link. To add a report: a folder under _reports, a card in
// home.js, a case below, and a rewrite in vercel.json.
//
// READ ONLY. Nothing here writes to monday or Megaphone.

import { hostOf, isPreview, cookieOk, keyOk, setCookie, cleanUrl, gatePage } from "./_reports/access.js";
import { mondayToken } from "./_reports/monday.js";
import { homePage } from "./_reports/home.js";
import { renderCampaigns } from "./_reports/campaigns/load.js";
import { probe } from "./_reports/megaphone.js";

export const config = { maxDuration: 60 };

const HOSTS = new Set([
  "reports.digitalfoxtalent.com",
  "roster-viewguarantee.digitalfoxtalent.com", // first home of /campaigns, kept so old links work
  "dft-leads.vercel.app",
]);
let probeCache = null;

const html = (res, code, body) => { res.setHeader("Content-Type", "text/html; charset=utf-8"); return res.status(code).send(body); };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  const host = hostOf(req);
  const preview = isPreview(host);
  if (!HOSTS.has(host) && !preview) return res.status(404).json({ error: "Not found" });
  const token = mondayToken();
  if (!token) return res.status(500).send("Setup error: monday token missing.");
  const route = String((req.query && req.query.r) || "home");

  const k = req.query && req.query.k;
  if (k) {
    if (!keyOk(k)) return html(res, 403, gatePage());
    setCookie(res, token);
    res.setHeader("Location", cleanUrl(req.url));
    return res.status(303).end();
  }

  // The health check returns only status codes and counts, so preview builds answer it
  // without the cookie. That lets a new build be checked before it goes live.
  const authed = cookieOk(req, token);
  if (route === "status" && (authed || preview)) {
    if (!probeCache || Date.now() - probeCache.at > 5 * 60 * 1000) probeCache = { at: Date.now(), data: { megaphone: await probe(token) } };
    return res.status(200).json(probeCache.data);
  }
  if (!authed) return html(res, 401, gatePage());

  if (route === "campaigns") return html(res, 200, await renderCampaigns(token));
  if (route === "home" && host !== "roster-viewguarantee.digitalfoxtalent.com") return html(res, 200, homePage());
  return res.status(404).json({ error: "Not found" });
}
