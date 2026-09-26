// DFT Reports - reports.digitalfoxtalent.com. One entry point for every team report.
//
// STRUCTURE (api/_reports/)
//   access.js         team link + 90-day cookie, shared by every report
//   monday.js         read-only monday helper
//   megaphone.js      Megaphone access (token read from the monday API Keys board) + health probe
//   home.js           the front page listing every report
//   campaigns/        Campaign reach: load.js (data), page.js (page), podcast.js, snapshot.js, avatars.js, videos.js
//   platforms/        Platform monetization: load.js (data), page.js (page)
//
// ROUTES (vercel.json rewrites send each path here with ?r=)
//   /  and /campaigns -> Campaign reach     /platforms -> Platform monetization (?tier=written)
//   /campaigns/rhapsody -> a partner's own view (partner link, see _reports/partners.js)
//   /status -> source health (JSON)   /videos?ids= -> per-video detail   /platforms-data -> raw JSON
// Every route needs a signed-in @digitalfoxtalent.com Google account (see _reports/auth.js). To add a report: a folder under _reports, a card in
// home.js, a case below, and a rewrite in vercel.json.
//
// READ ONLY. Nothing here writes to monday or Megaphone.

import { hostOf, isPreview, cookieOk, cleanUrl, gatePage, partnerKey, setPartnerCookie, partnerCookie, partnerGate } from "./_reports/access.js";
import { handleAuth } from "./_reports/auth.js";
import { PARTNERS } from "./_reports/partners.js";
import { mondayToken } from "./_reports/monday.js";
import { renderCampaigns, campaignsHealth, renderPartner } from "./_reports/campaigns/load.js";
import { probe } from "./_reports/megaphone.js";
import { backfill } from "./_reports/backfill.js";
import { platformsData, renderPlatforms } from "./_reports/platforms/load.js";
import { videoDetails } from "./_reports/campaigns/videos.js";

export const config = { maxDuration: 60 };

const HOSTS = new Set([
  "reports.digitalfoxtalent.com",
  "roster-viewguarantee.digitalfoxtalent.com", // first home of /campaigns, now redirects here
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

  // The first home of Campaign reach. Send visitors to the reports address, carrying the
  // team key if the link had one, so old links keep working and sign people in there.
  if (host === "roster-viewguarantee.digitalfoxtalent.com") {
    const k0 = req.query && req.query.k;
    res.setHeader("Location", "https://reports.digitalfoxtalent.com/" + (k0 ? "?k=" + encodeURIComponent(String(k0)) : ""));
    return res.status(302).end();
  }

  // Partner pages: /campaigns/<partner>. A partner key opens only its own page.
  const pm = route.match(/^campaigns\/([a-z0-9-]+)$/);
  const pid = pm && PARTNERS[pm[1]] ? pm[1] : null;

  // Team sign-in (Google, @digitalfoxtalent.com only).
  if (route.startsWith("auth/")) { const done = await handleAuth(req, res, route, token); if (done !== null) return done; }

  // Only partner links carry a key now. The old team link no longer opens anything:
  // it just shows the sign-in page.
  const k = req.query && req.query.k;
  if (k) {
    const pk = partnerKey(k);
    if (pk) { setPartnerCookie(res, token, pk); res.setHeader("Location", "/campaigns/" + pk); return res.status(303).end(); }
    res.setHeader("Location", cleanUrl(req.url));
    return res.status(303).end();
  }

  // The health check returns only status codes and counts, so preview builds answer it
  // without the cookie. That lets a new build be checked before it goes live.
  const authed = cookieOk(req, token);
  if (route === "status" && (authed || preview)) {
    if (!probeCache || Date.now() - probeCache.at > 5 * 60 * 1000) probeCache = { at: Date.now(), data: { monday: await campaignsHealth(token), megaphone: await probe(token) } };
    return res.status(200).json(probeCache.data);
  }
  const partner = authed ? null : partnerCookie(req, token);
  if (pid && (authed || partner === pid)) return html(res, 200, await renderPartner(token, pid));
  if (partner && route === "videos") { try { return res.status(200).json(await videoDetails(req.query && req.query.ids)); } catch (e) { return res.status(500).json({ error: "unavailable" }); } }
  if (partner) { res.setHeader("Location", "/campaigns/" + partner); return res.status(302).end(); } // a partner link only opens its own page
  if (!authed) {
    if (pid) return html(res, 401, partnerGate(PARTNERS[pid].name));
    if (route !== "home" && !/^(campaigns|platforms)$/.test(route)) return res.status(401).json({ error: "Sign in required" });
    const next = "/" + (route === "home" ? "" : route) + (req.query && req.query.tier ? "?tier=" + encodeURIComponent(String(req.query.tier)) : "");
    return html(res, 401, gatePage(next));
  }

  if (route === "campaigns") return html(res, 200, await renderCampaigns(token));
  if (route === "platforms") return html(res, 200, await renderPlatforms(token));
  if (route === "videos") {
    try { return res.status(200).json(await videoDetails(req.query && req.query.ids)); }
    catch (e) { return res.status(500).json({ error: String(e && e.message || e).slice(0, 300) }); }
  }
  if (route === "platforms-data") {
    try { return res.status(200).json(await platformsData(token)); }
    catch (e) { return res.status(500).json({ error: String(e && e.message || e).slice(0, 300) }); }
  }
  if (route === "backfill") {
    try { return res.status(200).json(await backfill(token, req.query && req.query.h, req.query && req.query.pages)); }
    catch (e) { return res.status(500).json({ error: String(e && e.message || e).slice(0, 300) }); }
  }
  if (route === "home") {
    // The front door is Campaign reach; tabs at the top of every report switch between them.
    return html(res, 200, await renderCampaigns(token));
  }
  return res.status(404).json({ error: "Not found" });
}
