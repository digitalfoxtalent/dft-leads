// DFT Reports - reports.digitalfoxtalent.com. One entry point for every team report.
//
// STRUCTURE (api/_reports/)
//   access.js         team link + 90-day cookie, shared by every report
//   monday.js         read-only monday helper
//   megaphone.js      Megaphone access (token read from the monday API Keys board) + health probe
//   home.js           the front page listing every report
//   campaigns/        Campaign reach: load.js (data), page.js (page), podcast.js, snapshot.js, avatars.js, videos.js
//   platforms/        Platform monetization: load.js (data), page.js (page)
//   distribution/     Video distribution (DFT's own MSN video pipeline): load.js (data), page.js (page)
//   coverage/         Creator distribution (every creator against every platform): load.js (data), page.js (page)
//
// ROUTES (vercel.json rewrites send each path here with ?r=)
//   /  and /campaigns -> Campaign reach     /platforms -> Platform monetization (?tier=written)
//   /distribution -> Video distribution (rejected MSN videos, repair feeds)
//   /coverage -> Creator distribution (platform coverage, rejection rates, back catalogue)
//   /campaigns/<partner> -> a partner's own view (rows on the monday Report Partners board, see _reports/partners.js)
//   /status -> source health (JSON)   /videos?ids= -> per-video detail   /platforms-data -> raw JSON
// Every route needs a signed-in @digitalfoxtalent.com Google account (see _reports/auth.js). To add a report: a folder under _reports, a card in
// home.js, a case below, and a rewrite in vercel.json.
//
// READ ONLY. Nothing here writes to monday or Megaphone.

import { hostOf, isPreview, cookieOk, teamEmail, setTeamCookie, cleanUrl, gatePage, partnerKey, setPartnerCookie, partnerCookie, partnerGate, handoffToken, ROSTER_ORIGIN } from "./_reports/access.js";
import { handleAuth } from "./_reports/auth.js";
import { PARTNERS, loadPartners } from "./_reports/partners.js";
import { mondayToken } from "./_reports/monday.js";
import { renderCampaigns, campaignsHealth, renderPartner, campaignPayload } from "./_reports/campaigns/load.js";
import { timestampProbe, timestampCheck, timestampApply } from "./_reports/timestamps.js";
import { probe } from "./_reports/megaphone.js";
import { backfill, missingRows } from "./_reports/backfill.js";
import { platformsData, renderPlatforms } from "./_reports/platforms/load.js";
import { renderDistribution } from "./_reports/distribution/load.js";
import { renderCoverage } from "./_reports/coverage/load.js";
import { videoDetails } from "./_reports/campaigns/videos.js";
import { applyLinks } from "./_reports/apply-links.js";
import { scanUploads } from "./_reports/scan.js";
import { reachApply, reachApplyEpisodes } from "./_reports/reach-apply.js";
import { REFRESH_PAGE } from "./_reports/refresh-page.js";
import { socialScan, socialSync } from "./_reports/social.js";

export const config = { maxDuration: 300 }; // the Reporting refresh write step can take over a minute

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
  await loadPartners(token); // partner pages come from the monday "Report Partners" board
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
  // Sign-in for the roster site (see handoffToken in access.js). Signed in here already ->
  // straight back to the roster, signed in there too. Not yet -> Google first, then back here.
  if (route === "roster-signin") {
    if (!authed) { res.setHeader("Location", "/auth/login?next=" + encodeURIComponent("/roster-signin")); return res.status(302).end(); }
    res.setHeader("Location", ROSTER_ORIGIN + "/auth/handoff?t=" + encodeURIComponent(handoffToken(token, teamEmail(req, token))));
    return res.status(302).end();
  }
  const partner = authed ? null : partnerCookie(req, token);
  // Keep access alive: every page visit renews the visitor's cookie to its full length.
  const isPage = route === "home" || route === "campaigns" || route === "platforms" || route === "distribution" || route === "coverage" || !!pid;
  if (isPage && authed) res.setHeader("Set-Cookie", setTeamCookie(res, token, teamEmail(req, token)));
  else if (isPage && partner) setPartnerCookie(res, token, partner);
  if (pid && (authed || partner === pid)) return html(res, 200, await renderPartner(token, pid));
  if (partner && route === "videos") { try { return res.status(200).json(await videoDetails(req.query && req.query.ids)); } catch (e) { return res.status(500).json({ error: "unavailable" }); } }
  if (partner) { res.setHeader("Location", "/campaigns/" + partner); return res.status(302).end(); } // a partner link only opens its own page
  if (!authed) {
    if (pid) return html(res, 401, partnerGate(PARTNERS[pid].name, "/campaigns/" + pid));
    if (route !== "home" && !/^(campaigns|platforms|distribution|coverage|refresh)$/.test(route)) return res.status(401).json({ error: "Sign in required" });
    const next = "/" + (route === "home" ? "" : route) + (req.query && req.query.tier ? "?tier=" + encodeURIComponent(String(req.query.tier)) : "");
    return html(res, 401, gatePage(next));
  }

  if (route === "campaigns") return html(res, 200, await renderCampaigns(token));
  if (route === "platforms") return html(res, 200, await renderPlatforms(token));
  if (route === "distribution") return html(res, 200, await renderDistribution(token));
  if (route === "coverage") return html(res, 200, await renderCoverage(token));
  if (route === "videos") {
    try { return res.status(200).json(await videoDetails(req.query && req.query.ids)); }
    catch (e) { return res.status(500).json({ error: String(e && e.message || e).slice(0, 300) }); }
  }
  if (route === "platforms-data") {
    try { return res.status(200).json(await platformsData(token)); }
    catch (e) { return res.status(500).json({ error: String(e && e.message || e).slice(0, 300) }); }
  }
  if (route === "apply-links") { // team only: write a checked list of video links (see _reports/apply-links.js)
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    try { const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body; return res.status(200).json(await applyLinks(token, b, String(req.query && req.query.dry || "") === "1")); }
    catch (e) { return res.status(500).json({ error: String(e && e.message || e).slice(0, 300) }); }
  }
  if (route === "refresh") return html(res, 200, REFRESH_PAGE); // team only: Reporting refresh page (see _reports/refresh-page.js)
  if (route === "reach-apply-file") { // team only: the refresh page posts one line per episode from an uploaded platform report
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    try { const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body; return res.status(200).json(await reachApplyEpisodes(token, b, String(req.query && req.query.dry || "") === "1")); }
    catch (e) { return res.status(500).json({ error: String(e && e.message || e).slice(0, 300) }); }
  }
  if (route === "reach-apply") { // team only: Reporting refresh write step, Spotify and apps listens per row (see _reports/reach-apply.js)
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    try { const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body; return res.status(200).json(await reachApply(token, b, String(req.query && req.query.dry || "") === "1")); }
    catch (e) { return res.status(500).json({ error: String(e && e.message || e).slice(0, 300) }); }
  }
  if (route === "partner-gaps") { // team only: a partner's creator rows that still have no video link
    try {
      const P = PARTNERS[String(req.query && req.query.p || "")]; if (!P) return res.status(404).json({ error: "unknown partner" });
      const rows = (await missingRows(token)).filter(r => P.match.test(r.client || ""));
      return res.status(200).json({ partner: P.name, count: rows.length, rows: rows.map(r => ({ id: r.id, deal: r.deal, row: r.row, h: r.h, brand: r.brand, anchor: r.pub || r.live || r.closed, stage: r.stage })) });
    } catch (e) { return res.status(500).json({ error: String(e && e.message || e).slice(0, 300) }); }
  }
  if (route === "gaps") { // team only: every creator row that still has no video link (for the backfill)
    try { const rows = await missingRows(token); return res.status(200).json({ count: rows.length, rows }); }
    catch (e) { return res.status(500).json({ error: String(e && e.message || e).slice(0, 300) }); }
  }
  if (route === "social-scan") { // team only: match a scraped TikTok profile (Apify dataset) to a creator's unlinked rows. Read only
    try { const q = req.query || {}; return res.status(200).json(await socialScan(token, String(q.dataset || ""), String(q.h || ""))); }
    catch (e) { return res.status(500).json({ error: String(e && e.message || e).slice(0, 300) }); }
  }
  if (route === "social-sync") { // team only: TikTok and Instagram views onto creator rows (?dry=1 checks, ?dataset= uses an existing scrape)
    try { const q = req.query || {}; return res.status(200).json(await socialSync(token, { dry: String(q.dry || "") === "1", dataset: q.dataset ? String(q.dataset) : "" })); }
    catch (e) { return res.status(500).json({ error: String(e && e.message || e).slice(0, 300) }); }
  }
  if (route === "ts-probe") { // team only: how many of a partner's videos already have a SponsorBlock sponsor segment. Read only
    try { const P = PARTNERS[String(req.query && req.query.p || "rhapsody")]; if (!P) return res.status(404).json({ error: "unknown partner" }); return res.status(200).json(await timestampProbe(await campaignPayload(token), P.match)); }
    catch (e) { return res.status(500).json({ error: String(e && e.message || e).slice(0, 300) }); }
  }
  if (route === "ts-check") { // team only: one video's SponsorBlock segments and the caption times that name the brand. Read only
    try { const q = req.query || {}; return res.status(200).json(await timestampCheck(String(q.v || ""), String(q.b || ""), q.at)); }
    catch (e) { return res.status(500).json({ error: String(e && e.message || e).slice(0, 300) }); }
  }
  if (route === "ts-apply") { // team only: fill AD READ TIMES for the next batch of videos (?p=rhapsody or all, ?dry=1 checks, ?max= videos per run)
    try { const q = req.query || {}; const P = q.p === "all" ? null : PARTNERS[String(q.p || "rhapsody")]; if (q.p !== "all" && !P) return res.status(404).json({ error: "unknown partner" });
      return res.status(200).json(await timestampApply(token, await campaignPayload(token), P && P.match, { dry: String(q.dry || "") === "1", max: q.max })); }
    catch (e) { return res.status(500).json({ error: String(e && e.message || e).slice(0, 300) }); }
  }
  if (route === "scan") { // team only: one creator's uploads, compact, for matching rows to videos (see _reports/scan.js)
    try { const q = req.query || {}; return res.status(200).json(await scanUploads(token, String(q.h || ""), q.since, q.brands, q.pages)); }
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
