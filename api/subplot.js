// SUBPLOT — server-rendered site. Routed here by vercel.json for the SUBPLOT
// host (and, for preview, the /subplot path on the roster host).
// Private preview: every response is noindex, and robots.txt lets Google crawl but nobody else.
// Optional gate: set SUBPLOT_PASS in Vercel env to require a password (user "subplot").
import { getData } from "./_subplot/data.js";
import { brandFor, setBrand, siteUrl } from "./_subplot/brand.js";
import { runHealth } from "./_subplot/health.js";
import { setDesign } from "./_subplot/design.js";
import { listMonths, readMonth } from "./_subplot/archive.js";
import { homePage, articlePage, creatorPage, joinPage, aboutPage, threadPage, rssFeed, notFound, legalPage, artPath, revenuePage, sitemap } from "./_subplot/render.js";
import { CAST } from "./_subplot/cast.js";
import { faviconSvg, assetKey } from "./_subplot/brand.js";
import { adsTxt } from "./_subplot/ads.js";
import { OG_PNG, APPLE_PNG } from "./_subplot/images.js";
// Share-card assets per brand. A brand with no entry here serves no og.png and no touch icon
// - better than serving another brand's. Wordie joins this map when it has artwork of its own.
const OG = { subplot: OG_PNG };
const TOUCH = { subplot: APPLE_PNG };

const CATS = new Set(["marvel", "dc", "scifi", "gaming", "anime", "screen"]);

function unauthorised(res) {
  res.setHeader("WWW-Authenticate", 'Basic realm="SUBPLOT preview"');
  res.setHeader("Cache-Control", "no-store");
  return res.status(401).send("Private preview.");
}

export default async function handler(req, res) {
  // NOINDEX keeps SUBPLOT out of search results and is the only part that matters for that.
  // NOFOLLOW was dropped 6 Sep 2026: it tells a crawler not to follow links out of the page,
  // which would leave an AdSense reviewer looking at the home page and nothing else. Under
  // noindex nothing gets indexed however far it crawls, so following links costs nothing.
  res.setHeader("X-Robots-Tag", "noindex, noarchive, nosnippet");

  // Which publication is this? Resolved from the host before anything renders.
  setBrand(brandFor(req.headers["x-forwarded-host"] || req.headers.host || ""));

  const pass = process.env.SUBPLOT_PASS;
  if (pass) {
    const h = req.headers.authorization || "";
    const ok = h.startsWith("Basic ") && Buffer.from(h.slice(6), "base64").toString() === "subplot:" + pass;
    if (!ok) return unauthorised(res);
  }

  const path = "/" + String(req.query.path || "").replace(/^\/+|\/+$/g, "");
  const base = req.query.base === "subplot" ? "/subplot" : "";

  // Design preview. ?d=2 switches on the new look, ?d=1 switches it off, and the choice is
  // remembered in a cookie so links keep it while you click around. Nobody who has not asked
  // for it ever sees it, and the page is identical to production without the flag.
  const dq = String(req.query.d || "");
  if (dq === "1" || dq === "2") {
    res.setHeader("Set-Cookie", `subplot_design=${dq}; Path=/; Max-Age=${dq === "2" ? 604800 : 0}; SameSite=Lax`);
  }
  const cookieDesign = /(?:^|;\s*)subplot_design=2\b/.test(req.headers.cookie || "") ? 2 : 1;
  const activeDesign = dq === "2" ? 2 : dq === "1" ? 1 : cookieDesign;
  setDesign(activeDesign);

  // Daily health check, run by cron as /api/subplot?path=__health. Not a page: it is refused
  // unless it comes from Vercel's scheduler or carries CRON_SECRET, and it is never reachable
  // from the public site path because the host rewrite strips nothing else onto this route.
  if (path === "/__health") {
    const secret = process.env.CRON_SECRET;
    const fromCron = req.headers["x-vercel-cron"] || (secret && req.headers.authorization === "Bearer " + secret);
    // Fails closed: with no CRON_SECRET set there is no way to authorise, so the route does
    // not exist. (An earlier version compared undefined to undefined and let anyone through.)
    if (!fromCron && !(secret && req.query.key === secret)) return res.status(404).send("Not found");
    res.setHeader("Cache-Control", "no-store");
    return runHealth(req, res);
  }

  // The revenue archive is money data: its own gate, and it FAILS CLOSED. No password set in
  // the environment means the page does not exist, whatever the rest of the site is doing.
  if (path === "/revenue") {
    const rp = process.env.SUBPLOT_REVENUE_PASS;
    if (!rp) return res.status(404).send("Not found");
    const h = req.headers.authorization || "";
    if (!(h.startsWith("Basic ") && Buffer.from(h.slice(6), "base64").toString() === "revenue:" + rp)) {
      res.setHeader("WWW-Authenticate", 'Basic realm="SUBPLOT revenue"');
      return res.status(401).send("Authentication required");
    }
    try {
      const months = await listMonths();
      const want = months.includes(String(req.query.month)) ? String(req.query.month) : months[0];
      const month = want ? await readMonth(want) : null;
      const d = await getData();
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).send(revenuePage(months, month, d, base));
    } catch (e) {
      return res.status(500).send("Revenue archive unavailable: " + String(e.message || e));
    }
  }

  if (path === "/favicon.svg") { res.setHeader("Content-Type", "image/svg+xml"); res.setHeader("Cache-Control", "public, max-age=86400"); return res.status(200).send(faviconSvg() || CAST.favicon); }
  if (path === "/apple-touch-icon.png") { res.setHeader("Content-Type", "image/png"); res.setHeader("Cache-Control", "public, max-age=86400"); const b = TOUCH[assetKey()]; if (!b) return res.status(404).end(); return res.status(200).send(Buffer.from(b, "base64")); }
  if (path === "/og.png") { res.setHeader("Content-Type", "image/png"); res.setHeader("Cache-Control", "public, max-age=86400"); const b = OG[assetKey()]; if (!b) return res.status(404).end(); return res.status(200).send(Buffer.from(b, "base64")); }
  if (path === "/ads.txt") {
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Cache-Control", "public, max-age=3600");
    const t = adsTxt();
    if (!t) return res.status(404).send("");
    return res.status(200).send(t);
  }
  if (path === "/robots.txt") {
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Cache-Control", "public, max-age=3600");
    // CRAWLABLE BY GOOGLE, STILL NOT INDEXED. These are different things and the distinction
    // is the whole point of this block.
    //
    // Every page also sends X-Robots-Tag "noindex, noarchive, nosnippet" (see above),
    // and that is what keeps SUBPLOT out of search results. robots.txt only decides who may
    // FETCH a page. Until 6 Sep 2026 this file said "User-agent: * / Disallow: /" with
    // exceptions only for the ad crawlers, so Googlebot itself could not read a single page -
    // and an AdSense site review that cannot read the site cannot pass it. The review sat at
    // "Getting ready" for three days with the site's "last updated" stamp frozen, which is
    // what prompted the change.
    //
    // So: Google's crawlers may fetch everything, and the noindex header still keeps every
    // page out of Search. Everyone else stays blocked, because opening the review is the
    // only thing this is meant to achieve - it is not a launch.
    //
    // WHEN THE SITE ACTUALLY LAUNCHES the change is to DROP the noindex header, not to touch
    // this file. If you find yourself adding indexers here while the header still says
    // noindex, you are solving the wrong half.
    //
    // /ads.txt stays open to everyone: it is a public declaration by design and carries
    // nothing private. Blocking Google-Adstxt is what made AdSense report it as "Not found",
    // which caps what buyers pay for the inventory.
    const googleAgents = [
      "Googlebot",              // the site reviewer and general crawler
      "Googlebot-Image",        // thumbnails
      "Google-InspectionTool",  // Search Console / review tooling
      "Mediapartners-Google",   // reads pages so ads can be matched
      "AdsBot-Google",          // ad landing-page quality
      "AdsBot-Google-Mobile",
      "Google-Adstxt",          // fetches /ads.txt
    ];
    return res.status(200).send([
      ...googleAgents.flatMap(a => ["User-agent: " + a, "Allow: /", ""]),
      "User-agent: *", "Allow: /ads.txt", "Disallow: /", "",
      // Absolute by spec, and it names the sitemap even to crawlers that never see
      // Search Console. This is the line that says "the site is here".
      "Sitemap: " + siteUrl() + base + "/sitemap.xml", "",
    ].join("\n"));
  }

  let data;
  try { data = await getData(); }
  catch (e) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).send("The article feed isn't reachable right now: " + e.message);
  }

  if (path === "/sitemap.xml") {
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=3600");
    return res.status(200).send(sitemap(data, base));
  }
  if (path === "/feed.xml") { res.setHeader("Content-Type", "application/rss+xml; charset=utf-8"); res.setHeader("Cache-Control", "public, s-maxage=600"); return res.status(200).send(rssFeed(data, base)); }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", pass || activeDesign === 2 ? "private, no-store" : "public, s-maxage=300, stale-while-revalidate=3600");

  let html = null; let status = 200;
  const pg = Math.max(1, parseInt(req.query.p, 10) || 1);
  if (path === "/") html = homePage(data, base, "all", pg);
  else if (path.startsWith("/s/") && CATS.has(path.slice(3))) html = homePage(data, base, path.slice(3), pg);
  else if (path.startsWith("/a/")) {
    // /a/<handle>/<videoId> is canonical; the old /a/<videoId> form 301s to it, as does a
    // stale handle, so an article's earnings only ever accrue under one URL channel.
    const seg = path.slice(3).split("/");
    const a = data.arts.find(x => x.id === seg[seg.length - 1]);
    if (!a) html = null;
    else {
      const want = base + artPath(a);
      if (path === artPath(a)) html = articlePage(a, data, base);
      else { res.setHeader("Location", want); return res.status(301).end(); }
    }
  }
  else if (path.startsWith("/c/")) html = creatorPage(decodeURIComponent(path.slice(3)), data, base);
  else if (path.startsWith("/t/")) html = threadPage(path.slice(3), data, base);
  else if (path === "/join") html = joinPage(data, base);
  else if (path === "/about") html = aboutPage(data, base);
  else if (["/contact", "/privacy", "/terms", "/creators"].includes(path)) html = legalPage(path.slice(1), data, base);
  if (!html) { html = notFound(base); status = 404; res.setHeader("Cache-Control", "no-store"); }
  return res.status(status).send(html);
}
