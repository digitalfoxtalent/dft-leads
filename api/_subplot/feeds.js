// Distribution feeds for SUBPLOT, 19 Oct 2026 (Tom: "Let's do it" - Flipboard and Google News).
//
// FLIPBOARD (/flipboard.xml). A publisher adds a magazine at flipboard.com/publishers and submits
// this feed as its source; a Flipboard person reviews it. Their rules: full posts, not extracts;
// at least one image per post whose shortest side is 400px or more; at least 30 items. So this
// carries the newest 100 articles in full (content:encoded), the site's own lead image as
// media:content (YouTube hq720, 1280 x 720), the creator as dc:creator and the topics as
// categories. Same article set and same contact swap as the SmartNews feed (smartnews.js), so
// the two never disagree with the site.
//
// GOOGLE NEWS (/news-sitemap.xml). There is nothing to sign up for any more: since March 2025
// Google builds publication pages itself and ignores feeds submitted in Publisher Center, and new
// publications cannot be added there. What still helps is a Google News sitemap: articles
// published in the last two days (the format's limit), at most 1,000, with the publication name,
// language, date and title. It is named in robots.txt and submitted in Search Console.
import { brand, mail, siteUrl } from "./brand.js";
import { esc, artPath } from "./render.js";

const FB_MAX_ITEMS = 100;
const FB_MAX_BYTES = 4 * 1024 * 1024; // keep the file a sensible size for a feed fetcher
const NEWS_WINDOW_MS = 48 * 3600 * 1000; // Google News sitemaps list only the last two days
const NEWS_MAX = 1000;

const contacts = html => String(html || "")
  .replace(/https?:\/\/(?:www\.)?digitalfoxtalent\.com\/editorial-standards\/?/gi, `https://${brand().domain}/about#standards`)
  .replace(/corrections@digitalfoxtalent\.com/gi, mail("corrections"));
const cdata = s => "<![CDATA[" + String(s).replace(/]]>/g, "]]]]><![CDATA[>") + "]]>";
const rfc822 = p => new Date(p).toUTCString();
const leadImage = a => a.thumb || `https://i.ytimg.com/vi/${a.v}/hq720.jpg`; // the site's own lead image

export function flipboardFeed(data, base) {
  const site = siteUrl() + base;
  const items = [];
  let bytes = 0;
  for (const a of (data.arts || []).slice(0, FB_MAX_ITEMS)) {
    const url = site + artPath(a);
    const lead = leadImage(a);
    const body = `<figure><img src="${esc(lead)}" alt="${esc(a.h)}"/></figure>`
      + (a.s ? `<p><strong>${esc(a.s)}</strong></p>` : "")
      + contacts(a.body)
      + `<p><a href="https://www.youtube.com/watch?v=${esc(a.v)}">Watch the original video by ${esc(a.b)} on YouTube.</a></p>`;
    const cats = (a.t || []).filter(Boolean).map(t => `<category>${esc(t)}</category>`).join("");
    const item = `<item><title>${esc(a.h)}</title><link>${esc(url)}</link><guid isPermaLink="true">${esc(url)}</guid>`
      + `<pubDate>${rfc822(a.p)}</pubDate><dc:creator>${esc(a.b)}</dc:creator>`
      + (a.s ? `<description>${esc(a.s)}</description>` : "")
      + cats
      + `<media:content url="${esc(lead)}" medium="image" type="image/jpeg"/>`
      + `<content:encoded>${cdata(body)}</content:encoded></item>`;
    if (bytes + item.length > FB_MAX_BYTES) break;
    bytes += item.length; items.push(item);
  }
  const newest = (data.arts || [])[0] ? rfc822(data.arts[0].p) : new Date().toUTCString();
  return `<?xml version="1.0" encoding="UTF-8"?>`
    + `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/" xmlns:atom="http://www.w3.org/2005/Atom">`
    + `<channel><title>${esc(brand().name)}</title><link>${esc(site)}/</link>`
    + `<atom:link href="${esc(site)}/flipboard.xml" rel="self" type="application/rss+xml"/>`
    + `<description>Film, TV and game breakdowns from the creators who make them</description>`
    + `<language>en</language><copyright>Digital Fox Talent LLC</copyright><lastBuildDate>${newest}</lastBuildDate><ttl>30</ttl>`
    + `<image><url>${esc(site)}/apple-touch-icon.png</url><title>${esc(brand().name)}</title><link>${esc(site)}/</link></image>`
    + items.join("") + `</channel></rss>`;
}

export function newsSitemap(data, base, now = Date.now()) {
  const site = siteUrl() + base;
  const name = brand().name;
  const urls = (data.arts || [])
    .filter(a => { const t = +new Date(a.p); return t && now - t <= NEWS_WINDOW_MS && t <= now + 3600 * 1000; })
    .slice(0, NEWS_MAX)
    .map(a => `<url><loc>${esc(site + artPath(a))}</loc><news:news><news:publication><news:name>${esc(name)}</news:name><news:language>en</news:language></news:publication>`
      + `<news:publication_date>${new Date(a.p).toISOString()}</news:publication_date><news:title>${esc(a.h)}</news:title></news:news></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>`
    + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">`
    + urls.join("") + `</urlset>`;
}
