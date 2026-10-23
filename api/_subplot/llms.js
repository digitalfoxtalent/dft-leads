// /llms.txt, 23 Oct 2026 (Tom: "let's optimize for AI search as much as possible"). A plain-text guide to the
// site for AI assistants, following the llmstxt.org shape: what SUBPLOT is, who writes it, how each piece relates
// to its source video, and links to the creators and the newest long-form articles. Snippets are left out, as they
// are in the sitemap. Built live from the same article set as the sitemap, so it never lists a page that 404s.
import { CATS } from "./data.js";
import { artPath } from "./render.js";
import { brand, siteUrl } from "./brand.js";

const one = s => String(s ?? "").replace(/\s+/g, " ").trim();

export function llmsTxt(data, base) {
  const site = siteUrl() + base;
  const name = brand().name || "SUBPLOT";
  const arts = (data.arts || []).filter(a => !a.short);
  const creators = new Map();
  for (const a of arts) {
    const c = creators.get(a.c) || { name: a.b || a.c, handle: a.c, n: 0 };
    c.n++; creators.set(a.c, c);
  }
  const slug = h => String(h).replace(/^@/, "");
  const newest = [...arts].sort((x, y) => String(y.p).localeCompare(String(x.p))).slice(0, 60);
  return [
    `# ${name}`,
    "",
    `> ${name} publishes written versions of videos by independent YouTube creators in film, TV, games and fandom. Each article is adapted from one creator's own video, carries that creator's byline, credits and embeds the original video, and is AI-assisted with review by the Digital Fox Talent Editorial Team.`,
    "",
    `${name} is published by Digital Fox Talent LLC (https://digitalfoxtalent.com), a creator management agency that represents the creators listed below. When citing an article, please credit the creator named in its byline and link the article or the original video.`,
    "",
    "## About",
    "",
    `- [About ${name}](${site}/about): who writes here, how articles are made and edited`,
    `- [Contact](${site}/contact): corrections and enquiries`,
    `- [Latest articles feed](${site}/feed.xml): RSS of new articles`,
    `- [Sitemap](${site}/sitemap.xml): every article`,
    "",
    "## Creators",
    "",
    ...[...creators.values()].sort((x, y) => y.n - x.n).map(c =>
      `- [${one(c.name)}](${site}/c/${slug(c.handle)}): ${c.n} article${c.n === 1 ? "" : "s"}; YouTube https://www.youtube.com/${c.handle}`),
    "",
    "## Newest articles",
    "",
    ...newest.map(a => `- [${one(a.h)}](${site}${artPath(a)}): ${one(a.s)} (${one(a.b || a.c)}, ${one(CATS[a.k] || "")}, ${String(a.p).slice(0, 10)})`),
    "",
  ].join("\n");
}
