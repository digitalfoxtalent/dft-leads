// SUBPLOT page templates. Pure functions: (data, base) -> HTML string.
import { CSS } from "./css.js";
import { CATS, slug, slugFor } from "./data.js";
import { brand, brandCss, member, joinCta, mail, siteUrl, hasCast, audience, fontHref, hasShareCard } from "./brand.js";
import { design } from "./design.js";
import { promoRail, promoCss, joinBlock } from "./promo.js";
import { CSS2, FONTS2 } from "./design2.js";
import { ch, CAST_META } from "./cast.js";
import { headTag as adHead, unit as adUnit } from "./ads.js";
import { FORMATS, formatCss } from "./formats.js";
import { homePage3, snippetsPage as snippetsBody, card3, wire3Deps, CSS3 } from "./home3.js";

// Brand-dependent strings resolve per request; see brand.js.
const BRAND_ = () => brand().name;
const TAG_ = () => brand().tagline;
// Cast art is SUBPLOT-only. Wordie is typographic, so every character call sites through here.
const art = (name, px) => hasCast() ? ch(name, px) : "";

export const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Article URLs carry the creator's handle: /a/<handle>/<videoId>. The handle segment is what
// AdSense URL channels key on, so every article's earnings land under exactly one creator.
export const artPath = a => "/a/" + slugFor(a.c) + "/" + a.id;
const fmt = p => new Date(p).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const dayLabel = p => new Date(p).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const dayKey = p => String(p).slice(0, 10);
const initials = n => n.replace(/[^A-Za-z ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
// Creator mark: their YouTube profile picture when we have it, initials when we don't.
const mark = (name, url) => url
  ? `<span class="mono av"><img src="${esc(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>`
  : `<span class="mono">${esc(initials(name))}</span>`;
const slugH = h => h.replace(/^@/, "");

// ---- Ad slots. Placeholders for now; each becomes one network tag at launch.
// Names are stable so reports (and the per-creator attribution by page) can key on them.
export function adSlot(name, desktop, mobile = desktop, extraClass = "") {
  const live = adUnit(name, extraClass);
  if (live) return live;
  return `<div class="ad ${extraClass}" data-slot="${name}" data-desktop="${desktop}" data-mobile="${mobile}">
    <span class="ad-lbl">Ad</span><span class="ad-meta">${name} · ${desktop}${mobile !== desktop ? " / " + mobile : ""}</span></div>`;
}
// Insert an in-article slot after every `every` paragraphs, never right after a heading, never in the last 2.
function withInArticleAds(bodyHtml, every = 5) {
  const parts = bodyHtml.split(/(?<=<\/p>)/);
  const paras = parts.filter(p => /<p>/.test(p)).length;
  if (paras < every + 2) return bodyHtml;
  let out = "", count = 0, n = 0;
  for (let i = 0; i < parts.length; i++) {
    out += parts[i];
    if (!/<p>/.test(parts[i])) continue;
    count++;
    const next = parts[i + 1] || "";
    const remaining = paras - count;
    if (count % every === 0 && remaining >= 2 && !/^\s*<h2/.test(next)) {
      n++; out += adSlot("in-article-" + n, "300×250", "300×250", "ad-inline");
    }
  }
  return out;
}

const EXTRA_CSS = String.raw`
.card{text-decoration:none;color:inherit}
a.lead,a.card,.takes a,.wire a,.roster a{text-decoration:none;color:inherit}
.wire a{width:100%;display:grid;grid-template-columns:auto 1fr auto;gap:0 1.1rem;align-items:start;cursor:pointer;transition:background .15s}
.wire .wthumb{display:block;width:124px;aspect-ratio:16/9;margin:1.05rem 0;border-radius:10px;overflow:hidden;background:var(--paper-2);border:1.5px solid var(--ink)}
.wire .wthumb img{display:block;width:100%;height:100%;object-fit:cover}
@media (max-width:34rem){.wire a{grid-template-columns:auto 1fr}.wire .wthumb{width:88px;margin:.9rem 0}}
.wire a:hover{background:var(--paper-2)}
.wire a:hover .txt h3{color:var(--blue)}
.takes a{display:grid;width:100%;grid-template-columns:2px 1fr;gap:0 .7rem;cursor:pointer;align-items:stretch}
.takes a:hover .tk span{color:var(--blue)}
.nav a{cursor:pointer;white-space:nowrap;font-family:var(--disp);font-weight:700;font-size:.74rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-2);padding:1.05rem 1.2rem;border-bottom:3px solid transparent;margin-bottom:-1px;text-decoration:none;transition:color .15s,border-color .15s}
.nav a:hover{color:var(--blue)}
.nav a[aria-current="true"]{color:var(--blue);border-bottom-color:var(--blue)}
.nav a.about-link{margin-left:auto;color:var(--ink-3)}
.nav a.join{color:var(--orange-ink)}
.nav a.join:hover{border-bottom-color:var(--orange)}
.top-meta a.joinlink{color:var(--blue);font-weight:500;font-family:var(--disp);font-size:.74rem;letter-spacing:.06em;text-transform:uppercase;text-decoration:none}
.top-meta a.joinlink:hover{color:var(--orange-ink)}
.mobile-only{display:none}
@media (max-width:48rem){.mobile-only{display:inline}.nav a.join{display:none}}
.nav-in{-webkit-mask-image:linear-gradient(to right,#000 92%,transparent);mask-image:linear-gradient(to right,#000 92%,transparent)}
@media (min-width:48rem){.nav-in{-webkit-mask-image:none;mask-image:none}}
.ad{display:grid;place-items:center;gap:.15rem;border:2px dashed var(--rule-2);background:var(--paper-2);color:var(--ink-3);min-height:90px;position:relative}
.ad-lbl{font-family:var(--disp);font-weight:800;font-size:.66rem;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-3)}
.ad-meta{font-family:var(--mono);font-size:.68rem}
.ad-leader{max-width:970px;height:90px;margin:1.4rem auto 0}
.ad-inline{height:250px;max-width:336px;margin:1.6rem auto}
.ad-rail{width:300px;height:600px;position:sticky;top:1.2rem}
.ad-frontrail{width:auto}
.rail{align-self:stretch}
@media (max-width:62rem){.ad-frontrail{display:none}}
.ad-infeed{height:250px;max-width:336px;margin:.6rem auto 1.2rem}
.ad-anchor{position:fixed;left:0;right:0;bottom:0;height:50px;min-height:0;z-index:20;border-width:2px 0 0;background:var(--paper);box-shadow:0 -4px 16px rgba(14,14,22,.08)}
.ad-anchor .close{position:absolute;right:.5rem;top:-1.4rem;font-family:var(--mono);font-size:.68rem;background:var(--paper);border:1px solid var(--rule-2);padding:.1rem .45rem;cursor:pointer}
body.has-anchor{padding-bottom:56px}
.artwrap{display:grid;grid-template-columns:minmax(0,43rem) 300px;gap:clamp(2rem,5vw,4rem);justify-content:center;align-items:start}
.artwrap .artmain{margin:0}
.artrail{position:sticky;top:1.2rem;display:flex;flex-direction:column;gap:1.8rem;width:300px}
.artrail .ad-rail{position:static}
@media (max-width:72rem){.artwrap{grid-template-columns:minmax(0,43rem)}.artrail{display:none}}
@media (min-width:48rem){.ad-anchor{display:none}body.has-anchor{padding-bottom:0}}
@media (max-width:48rem){.ad-leader{height:50px;max-width:320px}}
body[data-ads="off"] .ad{display:none}
.ad.live{display:block;border:0;background:none;min-height:0;height:auto;place-items:initial}
.ad.live::before{content:"Advertisement";display:none;font-family:var(--mono);font-size:.6rem;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3);text-align:center;margin:0 0 .4rem}
.ad.live.ad-leader{height:auto}
.ad.live.ad-inline{height:auto;max-width:100%;margin:2rem auto}
.ad.live.ad-infeed{height:auto;max-width:100%}
.ad.live.ad-rail{height:auto;width:300px;position:sticky;top:1.2rem}
.ad.live.ad-anchor{height:auto;padding:.2rem 0 .1rem}
.ad.live.ad-anchor::before{display:none}
.ad.live:has(ins[data-ad-status="unfilled"]){display:none}
.ad.live:has(ins[data-ad-status="filled"])::before{display:block}
/* cast-influenced: soft corners, thin ink line, pill buttons */
.thumb,.lead .plate,.player,.thread,.box,.ad,.honest,.terms,.done,.source,.field input,.field select,.field .handle span,.band,.step{border-radius:14px}
.thumb,.player{overflow:hidden}
.field .handle span{border-radius:14px 0 0 14px}.field .handle input{border-radius:0 14px 14px 0}
.box,.thread{border:1.5px solid var(--ink)}
.thread{border-top-width:1.5px}
.box h2{border-bottom:1.5px solid var(--ink)}
.band .cta,.joinhero .cta,.submit,.nav a.join{border-radius:999px}
.nav a.join{border:1.5px solid var(--orange);padding:.45rem 1rem;margin:.55rem 0 .55rem auto;border-bottom-width:1.5px}
.nav a.join:hover{background:var(--orange);color:#fff}
.evlist{list-style:none;margin:0;padding:0}
.evlist li{border-top:1px solid var(--rule)}
.evlist li:first-child{border-top:0}
.evlist a{display:block;padding:1rem 1.3rem;text-decoration:none;color:inherit}
.evlist a:hover b{color:var(--blue)}
.evtx{min-width:0;display:flex;flex-direction:column;gap:.35rem}
.evtx b{font-family:var(--disp);font-weight:600;font-size:.84rem;line-height:1.32;letter-spacing:-.01em}
.evtx span{font-family:var(--mono);font-size:.68rem;color:var(--ink-3)}
.ad.live{border:0;background:none;min-height:0;display:block}
.mono{border-radius:8px;overflow:hidden}
.mono.av{background:var(--paper-2)}
.mono.av img{width:100%;height:100%;object-fit:cover;display:block}
.tags span{border-radius:999px;padding:.22rem .7rem}
.cast{display:block;overflow:visible}
.joinhero{position:relative;grid-template-columns:1.2fr 1fr auto}
.joinhero .mascot{align-self:end;margin-bottom:-6px}
.joinhero .mascot .cast{height:220px;width:auto}
.band{position:relative;grid-template-columns:auto 1fr;align-items:center}
.band-top{display:flex;align-items:center;justify-content:space-between;gap:1.5rem;flex-wrap:wrap}
.band p{max-width:none;margin-top:.7rem}
@media (max-width:64rem){.band p br{display:none}}
.band .mascot .cast{height:120px;width:auto;margin:-1.2rem 0 -1.4rem}
.notfound{display:grid;grid-template-columns:auto 1fr;gap:2rem;align-items:center;padding:3rem 0 4rem}
.notfound .cast{height:200px;width:auto}
.notfound h1{font-family:var(--disp);font-weight:800;font-size:clamp(1.8rem,4vw,2.6rem);letter-spacing:-.03em;margin:0;line-height:1.05}
.notfound p{color:var(--ink-2);margin:.5rem 0 1rem}
.notfound a{color:var(--blue);font-weight:700}
.emptystate{display:grid;grid-template-columns:auto 1fr;gap:1.5rem;align-items:center;padding:3rem 0}
.emptystate .cast{height:150px;width:auto}
.abouthead{display:grid;grid-template-columns:1fr auto;gap:2rem;align-items:end}
.abouthead .cast{height:220px;width:auto}
.castgrid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:1.4rem .9rem;margin-top:1.2rem}
@media (max-width:60rem){.castgrid{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media (max-width:36rem){.castgrid{grid-template-columns:repeat(2,minmax(0,1fr))}}
.castgrid figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:.5rem;text-align:center}
.castgrid .cast{height:130px;width:auto}
.castgrid b{font-family:var(--disp);font-weight:800;font-size:.95rem}
.castgrid span{font-size:.78rem;color:var(--ink-2);line-height:1.4}
.done{display:grid;grid-template-columns:auto 1fr;gap:1rem;align-items:center}
.done .cast{height:110px;width:auto}
.foot .fm{display:flex;align-items:center;gap:.6rem}
.foot .fm .cast{height:44px;width:auto}
@media (max-width:52rem){.joinhero{grid-template-columns:1fr}.joinhero .mascot{display:none}.band{grid-template-columns:1fr}.band .mascot{display:none}.notfound,.emptystate,.abouthead{grid-template-columns:1fr}}
.homeview > .wrap{padding-bottom:4rem}
.about{padding-top:1rem}
.castgrid{margin-bottom:1.5rem}
.notfound{padding:4rem 0 5rem}
.emptystate{padding:3.5rem 0 4.5rem}
.aboutcols{display:grid;grid-template-columns:minmax(0,1fr) 19rem;gap:clamp(2.5rem,6vw,5rem);align-items:start}
.aboutrail{display:flex;flex-direction:column;gap:1.6rem;position:sticky;top:4.5rem}
.aboutrail .cta{display:inline-block;background:var(--blue);color:#fff;font-family:var(--disp);font-weight:700;font-size:.78rem;letter-spacing:.08em;text-transform:uppercase;padding:.75rem 1.2rem;border-radius:999px;text-decoration:none}
.aboutrail .cta:hover{background:var(--blue-ink)}
@media (max-width:60rem){.aboutcols{grid-template-columns:1fr}.aboutrail{position:static}}
.plotline{position:relative}
.castline{position:absolute;right:6px;bottom:11px;display:flex;align-items:flex-end;gap:10px;pointer-events:none}
.castline .cast{height:62px;width:auto;display:block}
@media (max-width:64rem){.castline{gap:6px}.castline .cast{height:48px}}
@media (max-width:48rem){.castline{display:none}}
.pager{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:1rem;padding:1.4rem 0 0;border-top:2px solid var(--ink);margin-top:.5rem}
.pager a{font-family:var(--disp);font-weight:700;font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;color:var(--blue);text-decoration:none}
.pager span:last-child{text-align:right}
.pager a:hover{color:var(--orange-ink)}
.trend{border-bottom:1px solid var(--rule);background:var(--paper)}
.trend-in{display:flex;align-items:center;gap:.6rem;padding:.6rem 0;overflow-x:auto;scrollbar-width:none}
.trend-in::-webkit-scrollbar{display:none}
.trend-lbl{font-family:var(--disp);font-weight:800;font-size:.66rem;letter-spacing:.15em;text-transform:uppercase;color:var(--pink);margin-right:.3rem;white-space:nowrap}
.chip{display:inline-flex;align-items:baseline;gap:.5rem;border:1.5px solid var(--ink);border-radius:999px;padding:.35rem .85rem;text-decoration:none;color:var(--ink);white-space:nowrap;transition:background .15s,color .15s}
.chip b{font-family:var(--disp);font-weight:700;font-size:.8rem}
.chip span{font-family:var(--mono);font-size:.66rem;color:var(--ink-3)}
.chip:hover{background:var(--ink);color:#fff}.chip:hover span{color:#cfcfda}
.thead{padding:2.4rem 0 1.4rem;border-bottom:1px solid var(--ink)}
.thead h1{font-family:var(--disp);font-weight:800;font-size:clamp(1.9rem,4.4vw,3rem);letter-spacing:-.03em;margin:.3rem 0 0;line-height:1.05}
.thead .kicker{color:var(--pink)}
.thead p{margin:.5rem 0 0;color:var(--ink-2)}
.next{margin-top:3rem}
.next .grid3{padding-top:1.2rem}
.about h2{font-family:var(--disp);font-weight:800;font-size:1.3rem;letter-spacing:-.02em;margin:2.4rem 0 .6rem}
.about p{max-width:42rem;color:var(--ink-2)}
.about p b{color:var(--ink)}
.brandblock{text-decoration:none;color:inherit}
.back{text-decoration:none}
.band a.cta,.joinhero a.cta{text-decoration:none;display:inline-block}
.foot a{color:inherit;text-decoration:none}
.foot a:hover{color:var(--blue)}
.roster a{display:flex;align-items:center;gap:.7rem;width:100%}
.roster li{padding:0}
.roster a{padding:.55rem 1.3rem}
.roster a:hover{background:var(--paper-2)}
.chead{display:grid;grid-template-columns:auto 1fr;gap:1.4rem;align-items:center;padding:2.4rem 0 1.8rem;border-bottom:1px solid var(--ink)}
.chead .mono{width:64px;height:64px;font-size:1.2rem}
.chead h1{font-family:var(--disp);font-weight:800;font-size:clamp(1.8rem,4vw,2.8rem);letter-spacing:-.025em;margin:0;line-height:1.05}
.chead p{margin:.3rem 0 0;color:var(--ink-2)}
.chead .meta{margin-top:.5rem;display:block}
.chead a.yt{color:var(--blue);font-weight:700;text-decoration:none;border-bottom:1.5px solid currentColor}
.empty{padding:3rem 0;color:var(--ink-2)}
.wire .sub a{color:var(--blue-ink);font-weight:600;text-decoration:none}
.wire .sub a:hover{text-decoration:underline}
`;

function shell({ base, title, desc, body, current = "all", bodyClass = "", rule = "", trending = [], jsonld = "" }) {
  const nav = [["all", "All"], ...Object.entries(CATS)].map(([k, n]) =>
    `<a href="${base}/${k === "all" ? "" : "s/" + k}" ${k === current ? 'aria-current="true"' : ""}>${esc(n)}</a>`).join("")
    + (design() === 3 ? `<a href="${base}/snippets" ${current === "snippets" ? 'aria-current="true"' : ""}>Snippets</a>` : "");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,noarchive">
${brand().gsc ? `<meta name="google-site-verification" content="${brand().gsc}">` : ""}
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="icon" type="image/svg+xml" href="${base}/favicon.svg">
<link rel="apple-touch-icon" href="${base}/apple-touch-icon.png">
<meta property="og:site_name" content="${BRAND_()}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
${hasShareCard() ? `<meta property="og:image" content="https://${brand().domain}/og.png">
<meta name="twitter:card" content="summary_large_image">` : ""}
<link rel="alternate" type="application/rss+xml" title="${BRAND_()}" href="${base}/feed.xml">
${jsonld}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${design() >= 2 ? FONTS2 : fontHref()}">
<style>${CSS}${EXTRA_CSS}${promoCss}${brandCss()}${design() >= 2 ? CSS2 : ""}${design() === 3 ? formatCss() + CSS3 : ""}</style>
<script defer src="/_vercel/insights/script.js"></script>
${adHead()}
</head>
<body class="${bodyClass}">
<header class="top">
  <div class="wrap top-in">
    <a class="brandblock" href="${base}/">
      <span class="wordmark">${BRAND_()}</span>
      <span class="plotline">${hasCast() ? `<span class="castline">${["lorekeeper","goblin","theorist","critic","speedrunner","reactor","subplot"].map(n => ch(n, 62)).join("")}</span>` : ""}</span>
      <span class="tagline">${esc(TAG_())}</span>
    </a>
    <div class="top-meta">
      <b>${esc(new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }))}</b>
      <span id="panelcount-slot"></span>
      <a class="joinlink mobile-only" href="${base}/join">${joinCta()} &rarr;</a>
    </div>
  </div>
  <nav class="nav"><div class="wrap nav-in">${nav}<a class="about-link" href="${base}/about" ${current === "about" ? 'aria-current="true"' : ""}>About</a><a class="join" href="${base}/join">${joinCta()}</a></div></nav>
  ${trending.length ? `<div class="trend"><div class="wrap trend-in"><span class="trend-lbl">Trending</span>${trending.map(t => `<a class="chip" href="${base}/t/${esc(t.slug)}"><b>${esc(t.t)}</b><span>${t.c} creators · ${t.n} takes</span></a>`).join("")}</div></div>` : ""}
</header>
${rule ? `<div class="artrule" style="background:${rule}"></div>` : ""}
<div class="wrap">${adSlot("leaderboard", "970×90", "320×50", "ad-leader")}</div>
${body}
<footer class="foot">
  <div class="wrap foot-in">
    <div><p class="fm">${art("subplot", 44)}${BRAND_()}</p><p>${esc(TAG_())}</p></div>
    <div><h3>About</h3><ul><li><a href="${base}/join">${joinCta()}</a></li><li><a href="${base}/about">Who we are</a></li><li><a href="${base}/about#standards">Editorial standards</a></li><li><a href="${base}/about#ai">How we use AI</a></li></ul></div>
    <div><h3>Sections</h3><ul>${Object.entries(CATS).map(([k, n]) => `<li><a href="${base}/s/${k}">${esc(n)}</a></li>`).join("")}</ul></div>
    <div><h3>Contact</h3><p>${mail("hello")}</p><p>${mail("corrections")}</p><p class="legal"><a href="${base}/contact">Contact</a> &middot; <a href="${base}/terms">Terms</a> &middot; <a href="${base}/privacy">Privacy</a> &middot; <a href="${base}/creators">Creator agreement</a></p></div>
  </div>
  <div class="protolabel"><div class="wrap">Private preview &middot; not indexed &middot; articles read live from the production feed</div></div>
</footer>
${adSlot("mobile-anchor", "320×50", "320×50", "ad-anchor")}
<script>
document.body.classList.add('has-anchor');
if (/[?&]ads=0/.test(location.search)) document.body.dataset.ads = 'off';
document.addEventListener('click', e => {
  const play = e.target.closest('.player .play');
  if (!play) return;
  const p = play.closest('.player'); const v = p.dataset.v;
  const ifr = document.createElement('iframe');
  ifr.src = 'https://www.youtube-nocookie.com/embed/' + v + '?autoplay=1&rel=0';
  ifr.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  ifr.allowFullscreen = true; ifr.title = 'Original video';
  p.appendChild(ifr); play.remove();
});
</script>
</body>
</html>`;
}

const card = (a, base) => `
  <a class="card" href="${base}${artPath(a)}">
    <span class="thumb"><img alt="" loading="lazy" src="${esc(a.thumbSmall)}"></span>
    <span class="kicker">${esc(CATS[a.k])}</span>
    <span class="headline">${esc(a.h)}</span>
    <span class="who"><b>${esc(a.c)}</b> · ${a.rt} min</span>
  </a>`;

function wire(list, base) {
  const groups = [];
  for (const a of list) {
    const g = groups[groups.length - 1];
    if (g && g.k === dayKey(a.p)) g.items.push(a); else groups.push({ k: dayKey(a.p), p: a.p, items: [a] });
  }
  return groups.map((g, gi) => (gi === 1 ? adSlot("in-feed", "336×280", "300×250", "ad-infeed") : "") + `
    <section class="daygroup"><div class="daylabel">${esc(dayLabel(g.p))}</div><ul class="wire">
    ${g.items.map(a => `
      <li><a href="${base}${artPath(a)}">
        <span class="wthumb"><img src="${esc(a.thumbSmall)}" alt="" loading="lazy" decoding="async"></span>
        <span class="txt"><h3>${esc(a.h)}</h3>
          <span class="sub"><b>${esc(a.c)}</b><span>${esc(CATS[a.k])}</span></span></span>
        <span class="rt">${a.rt} min</span>
      </a></li>`).join("")}
    </ul></section>`).join("");
}

function evergreenBox(data, base) {
  const list = (data.evergreen || []).map(id => data.arts.find(a => a.id === id)).filter(Boolean);
  if (list.length < 3) return "";
  return `
      <div class="box evbox">
        <h2>Always worth reading</h2>
        <p class="note">Lore, trivia and explainers that don&rsquo;t date. Rotates through the day.</p>
        <ul class="evlist">${list.map(a => `
          <li><a href="${base}${artPath(a)}">
            <span class="evtx"><b>${esc(a.h)}</b><span>${esc(a.c)}</span></span></a></li>`).join("")}
        </ul>
      </div>`;
}

function rail(panel, base, data) {
  return `
    <aside class="rail" id="panel">
      ${promoRail(base)}
      <div class="box">
        <h2>The Panel</h2>
        <p class="note">Every article is adapted from one creator&rsquo;s own video and runs under their name. No anonymous bylines. <a href="${base}/about" style="color:var(--blue);font-weight:700;text-decoration:none">How it works &rarr;</a></p>
        <ul class="roster">${panel.map(p => `
          <li><a href="${base}/c/${esc(slugH(p.handle))}">${mark(p.name, p.av)}
            <span class="rn">${esc(p.handle)}</span>
            <span class="rc">${p.n}</span></a></li>`).join("")}
        </ul>
      </div>
      ${data ? evergreenBox(data, base) : ""}
      <div class="box">
        <h2>Editorial standards</h2>
        <ul class="stdlist">
          <li>Each article names the creator it came from and links the source video.</li>
          <li>Claims keep the strength the creator gave them - a rumour stays a rumour.</li>
          <li>AI assistance is disclosed on every article.</li>
          <li>Corrections: <span style="color:var(--ink)">${mail("corrections")}</span></li>
        </ul>
      </div>
      ${adSlot("front-rail", "300×600", "-", "ad-rail ad-frontrail")}
    </aside>`;
}

const band = base => `
    <section class="band">
      ${hasCast() ? `<div class="mascot">${ch("reactor", 120)}</div>` : ""}
      <div class="band-body">
        <div class="band-top"><h2>Make videos? Get read.</h2><a class="cta" href="${base}/join">${joinCta()}</a></div>
        <p>${BRAND_()} turns the videos you already make into articles, under your name, with a link back to every one.<br>You keep 60% of what they earn. Apply with your YouTube handle.</p>
      </div>
    </section>`;

const PAGE = 40;
// Front-page lead. Until the site has its own read data: the strongest recent video by YouTube
// views per day since upload (last 14 days, proper article length). Without view data: the newest
// long article that sits in a trending thread. Last resort: the newest long article.
const LEAD_WINDOW = 14 * 864e5;
function pickLead(list, data) {
  const recent = list.filter(a => a.w >= 600 && Date.now() - new Date(a.p) < LEAD_WINDOW);
  const withViews = recent.filter(a => a.views > 0);
  if (withViews.length) return withViews.reduce((b, a) => (a.views / a.ageDays > b.views / b.ageDays ? a : b));
  const inThread = new Set(data.threads.flatMap(t => t.items));
  return recent.find(a => inThread.has(a.id)) || list.find(a => a.w >= 600) || list[0];
}
const fmtViews = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : String(n);
export function homePage(data, base, section = "all", page = 1) {
  const list = data.arts.filter(a => section === "all" || a.k === section);
  if (!list.length) return shell({ base, title: `${BRAND_()} - ${CATS[section] || "Front Page"}`, desc: TAG_(), current: section,
    body: `<main class="homeview"><div class="wrap"><div class="emptystate">${ch("reactor", 150)}<p class="empty">Nothing in this section yet - the Reactor is as surprised as you are.</p></div></div></main>` });
  const lead = pickLead(list, data); const rest = list.filter(a => a !== lead);
  const seconds = page === 1 ? rest.filter(a => a.w >= 400).slice(0, 3) : [];
  const wireAll = rest.filter(a => !seconds.includes(a));
  const pages = Math.max(1, Math.ceil(wireAll.length / PAGE));
  page = Math.min(Math.max(1, page), pages);
  const wireList = wireAll.slice((page - 1) * PAGE, page * PAGE);
  const sectionPath = section === "all" ? "" : "s/" + section;
  const pageHref = n => `${base}/${sectionPath}${n > 1 ? "?p=" + n : ""}`;
  const pager = pages > 1 ? `<nav class="pager"><span>${page < pages ? `<a href="${pageHref(page + 1)}">Older stories &rarr;</a>` : ""}</span><span class="meta">Page ${page} of ${pages}</span><span>${page > 1 ? `<a href="${pageHref(page - 1)}">&larr; Newer stories</a>` : ""}</span></nav>` : "";
  const threads = data.threads.filter(t => section === "all" || t.k === section);
  const byId = id => data.arts.find(a => a.id === id);
  if (design() === 3) {
    wire3Deps({ esc, artPath, dayKey, dayLabel, adSlot, fmt, fmtViews, rail, band, avatars: data.avatars || {} });
    const body3 = homePage3(data, base, section, page, { list, lead, rest, pages, wireList: page === 1 ? wireAll.slice(0, PAGE) : wireList, pager, threads });
    return shell({ base, title: section === "all" ? `${BRAND_()}` : `${CATS[section]} - ${BRAND_()}`, desc: TAG_(), current: section, body: body3, trending: data.threads })
      .replace('<span id="panelcount-slot"></span>', `<span>${data.panel.length} creators writing here</span>`);
  }
  const body = `
<main class="homeview">
  <div class="wrap">
    ${page > 1 ? `<div class="rule-h" style="margin-top:2rem"><h2>${section === "all" ? "Older stories" : "Older in " + esc(CATS[section])}</h2><span class="note">page ${page} of ${pages}</span></div>` : `
    <a class="lead" href="${base}${artPath(lead)}">
      <span class="plate"><img alt="" src="${esc(lead.thumb)}" onerror="this.onerror=null;this.src='${esc(lead.thumbSmall.replace("mqdefault","hqdefault"))}'"></span>
      <span class="leadgrid">
        <span><span class="kicker">${esc(CATS[lead.k])}</span>
          <h2 class="headline" style="margin-top:.45rem">${esc(lead.h)}</h2></span>
        <span class="leadside"><span class="dek">${esc(lead.s)}</span>
          <span class="leadmeta"><span class="who"><b>${esc(lead.c)}</b></span>
            <span class="meta">${esc(fmt(lead.p))} · ${lead.w.toLocaleString("en-GB")} words · ${lead.rt} min read${lead.views ? ` · ${fmtViews(lead.views)} views on YouTube` : ""}</span></span></span>
      </span>
    </a>
    ${threads.length ? `
    <section>
      <div class="rule-h"><h2>Threads</h2><span class="note">one subject, several creators</span></div>
      <div class="threads">${threads.map(t => `
        <section class="thread">
          <div class="thread-top"><span class="kicker">Thread</span><h3><a href="${base}/t/${esc(t.slug)}" style="color:inherit;text-decoration:none">${esc(t.t)}</a></h3>
            <span class="count">${t.n} articles · ${t.c} creators</span></div>
          <ul class="takes">${t.items.map(byId).filter(Boolean).map(a => `
            <li><a href="${base}${artPath(a)}"><span class="stripe"></span>
              <span class="tk"><b>${esc(a.b)}</b><span>${esc(a.h)}</span></span></a></li>`).join("")}
          </ul>
        </section>`).join("")}
      </div>
    </section>` : ""}
    <div class="rule-h"><h2>Latest${section === "all" ? " across the network" : " in " + esc(CATS[section])}</h2><span class="note">${list.length} stories</span></div>
    <section class="grid3">${seconds.map(a => card(a, base)).join("")}</section>`}
    <div class="cols">
      <div>${wire(wireList, base)}${pager}</div>
      ${rail(data.panel, base, data)}
    </div>
    ${band(base)}
  </div>
</main>`;
  return shell({ base, title: section === "all" ? `${BRAND_()}` : `${CATS[section]} - ${BRAND_()}`, desc: TAG_(), current: section, body, trending: data.threads })
    .replace('<span id="panelcount-slot"></span>', `<span>${data.panel.length} creators writing here</span>`);
}

export function articlePage(a, data, base) {
  wire3Deps({ esc, artPath, dayKey, dayLabel, adSlot, fmt, fmtViews, rail, band, avatars: data.avatars || {} });
  const more = data.arts.filter(x => x.c === a.c && x.id !== a.id).slice(0, 3);
  const inThread = Object.values(data.subjects || {}).filter(s => s.items.includes(a.id)).sort((x, y) => y.n - x.n)[0];
  const thr = inThread ? inThread.items.filter(id => id !== a.id).map(id => data.arts.find(x => x.id === id)).filter(Boolean).filter(x => x.c !== a.c).slice(0, 3) : [];
  const jsonld = `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org", "@type": "Article", headline: a.h, description: a.s,
    datePublished: a.p, dateModified: a.p, image: [a.thumb], wordCount: a.w, articleSection: CATS[a.k], keywords: a.t.join(", "),
    author: { "@type": "Person", name: a.b, alternateName: a.c, url: "https://www.youtube.com/" + a.c },
    publisher: { "@type": "Organization", name: BRAND_() },
    isBasedOn: "https://www.youtube.com/watch?v=" + a.v,
    mainEntityOfPage: siteUrl() + base + artPath(a),
  }).replace(/</g, "\\u003c")}</script>`;
  const body = `
<article class="artview" style="display:block">
  <div class="wrap">
    <a class="back" href="${base}/">&larr; Back to the front page</a>
    <div class="artwrap">
    <div class="artmain">
      ${design() === 3 ? `<span class="tagrow" style="justify-content:flex-start;gap:1rem"><span class="fmt" style="color:${(FORMATS[a.f] || FORMATS.breakdown).ink}"><i style="background:${(FORMATS[a.f] || FORMATS.breakdown).col}"></i>${(FORMATS[a.f] || FORMATS.breakdown).name}${a.short ? " · Snippet" : ""}</span><span class="kicker" style="color:var(--ink-3)">${esc(CATS[a.k])}</span></span>` : `<span class="kicker">${esc(CATS[a.k])}</span>`}
      <h1 class="headline">${esc(a.h)}</h1>
      <p class="dek">${esc(a.s)}</p>
      <div class="authorbar">${mark(a.b, data.avatars && data.avatars[a.c])}
        <span class="nm"><b><a href="${base}/c/${esc(slugH(a.c))}" style="color:inherit;text-decoration:none">${esc(a.c)}</a></b><span>${esc(fmt(a.p))}</span></span>
        <span class="meta">${a.w.toLocaleString("en-GB")} words · ${a.rt} min read</span></div>
      <div class="prose">${withInArticleAds(a.body)}</div>
      ${a.short ? `<p class="deckacts" style="margin:1.2rem 0 0"><a href="https://www.youtube.com/shorts/${esc(a.v)}" target="_blank" rel="noopener" style="color:${(FORMATS[a.f] || FORMATS.breakdown).ink}">Watch the Short</a><a class="ghost" href="${base}/snippets#s-${esc(a.id)}">More Snippets</a></p>` : ""}
      <div class="rule-h" style="margin-top:2.6rem"><h2>Watch the original</h2><span class="note">${esc(a.c)} · YouTube</span></div>
      <div class="player" data-v="${esc(a.v)}" style="margin-top:1rem">
        <img alt="" src="${esc(a.thumb)}" onerror="this.onerror=null;this.src='${esc(a.thumbSmall.replace("mqdefault","hqdefault"))}'">
        <button class="play" aria-label="Play the original video"></button>
      </div>
      <p class="disclose">Adapted from ${esc(a.b)}&rsquo;s original video. Written with the help of AI from that video&rsquo;s transcript; the views and analysis are ${esc(a.b)}&rsquo;s own.</p>
      <div class="tags">${a.t.map(t => `<span>${esc(t)}</span>`).join("")}</div>
      ${thr.length ? `<section class="next"><div class="rule-h"><h2>Also on ${esc(inThread.t)}</h2><span class="note"><a href="${base}/t/${esc(inThread.slug)}" style="color:var(--blue)">${inThread.c} creators, ${inThread.n} takes &rarr;</a></span></div><div class="grid3">${thr.map(x => (design() === 3 ? card3 : card)(x, base)).join("")}</div></section>` : ""}
      ${more.length ? `<section class="next"><div class="rule-h"><h2>More from ${esc(a.c)}</h2><span class="note"><a href="${base}/c/${esc(slugH(a.c))}" style="color:var(--blue)">All &rarr;</a></span></div><div class="grid3">${more.map(x => (design() === 3 ? card3 : card)(x, base)).join("")}</div></section>` : ""}
      ${joinBlock(base)}
    </div>
    <aside class="artrail">
      ${promoRail(base)}
      ${adSlot("article-rail", "300×600", "-", "ad-rail")}
      ${evergreenBox(data, base)}
    </aside>
    </div>
  </div>
</article>`;
  return shell({ base, title: `${a.h} - ${BRAND_()}`, desc: a.s, current: a.k, body, rule: design() === 3 ? (FORMATS[a.f] || FORMATS.breakdown).col : "var(--blue)", trending: data.threads, jsonld })
    .replace('<span id="panelcount-slot"></span>', `<span>${data.panel.length} creators writing here</span>`);
}

export function snippetsPage(data, base) {
  wire3Deps({ esc, artPath, dayKey, dayLabel, adSlot, fmt, fmtViews, rail, band, avatars: data.avatars || {} });
  const body = snippetsBody(data, base);
  if (!body) return null;
  return shell({ base, title: `Snippets - ${BRAND_()}`, desc: "Every Short the creators post, in writing. Twenty-second reads, newest first.", current: "snippets", body, trending: data.threads })
    .replace('<span id="panelcount-slot"></span>', `<span>${data.panel.length} creators writing here</span>`);
}

export function creatorPage(handle, data, base) {
  const list = data.arts.filter(a => slugH(a.c).toLowerCase() === handle.toLowerCase());
  if (!list.length) return null;
  const name = list[0].b; const h = list[0].c;
  const body = `
<main class="homeview">
  <div class="wrap">
    <div class="chead">
      ${mark(name, data.avatars && data.avatars[h])}
      <div><h1>${esc(h)}</h1>
        <p>${list.length} article${list.length === 1 ? "" : "s"} on ${BRAND_()} &middot; <a class="yt" href="https://www.youtube.com/${esc(h)}" target="_blank" rel="noopener">Channel on YouTube</a></p>
        <span class="meta">Every piece below is adapted from one of ${esc(name)}&rsquo;s own videos, with the video at the end.</span></div>
    </div>
    <section class="grid3">${list.slice(0, 3).map(a => card(a, base)).join("")}</section>
    <div class="cols">
      <div>${wire(list.slice(3), base)}</div>
      ${rail(data.panel, base, data)}
    </div>
  </div>
</main>`;
  return shell({ base, title: `${name} - ${BRAND_()}`, desc: `${name}'s videos, in writing.`, body, trending: data.threads })
    .replace('<span id="panelcount-slot"></span>', `<span>${data.panel.length} creators writing here</span>`);
}

export function joinPage(data, base) {
  const body = `
<section class="joinview" style="display:block">
  <div class="wrap">
    <a class="back" href="${base}/">&larr; Back to the front page</a>
    <div class="joinhero">
      <div><span class="kicker">${joinCta()}</span>
        <h1>Your videos, <em>in writing.</em> Under your name.</h1></div>
      <div><p>You make the video. We turn it into an article that people find on Google and Discover, bylined to you, linking back to your channel. You don&rsquo;t write a word.</p>
        <a class="cta" href="#apply">Apply with your handle</a></div>
      ${hasCast() ? `<div class="mascot">${ch("subplot", 220)}</div>` : ""}
    </div>
    <div class="rule-h"><h2>How it works</h2><span class="note">three steps, one of them yours</span></div>
    <div class="steps">
      <div class="step"><span class="n">01</span><h3>You keep making videos.</h3><p>Nothing changes on your channel. You upload as normal; we pick up each new video from your public captions.</p></div>
      <div class="step"><span class="n">02</span><h3>We turn each one into an article.</h3><p>Our system drafts it from your transcript, then checks it line by line against what you actually said. Your claims stay your claims - a rumour stays a rumour. Nothing gets invented.</p></div>
      <div class="step"><span class="n">03</span><h3>It runs under your name.</h3><p>Your byline, your channel link on every piece, your audience. Pull any article at any time. Leave whenever you like.</p></div>
    </div>
    <div class="honest"><span class="lbl">The honest bit</span>
      <div><p>The first draft is written by AI, from your YouTube video transcript. A fidelity check then compares it with the video and holds anything that drifts. Every article says so in a short note at the end - readers don&rsquo;t mind how something was made; they mind being lied to about it.</p>
        <p>What&rsquo;s never AI: the ideas, the takes, the jokes, the reporting, the personality. Those are yours, which is the whole point.</p></div>
    </div>
    <div class="twocol">
      <div><h3>What you get</h3><ul>
        <li><b>An audience on top of your views, not instead of them.</b> Google and Discover surface articles, so these are readers your video wasn&rsquo;t going to reach - and every article points them at the video.</li>
        <li><b>A link back on every piece.</b> Each article points at the video it came from.</li>
        <li><b>60% of what your articles earn.</b> Sixty to you, forty to us. No fees, no minimum term, no exclusivity. Paid monthly once your balance clears $50.</li>
        <li><b>Company.</b> Your take sits alongside other creators covering the same thing - see Threads on the front page.</li></ul></div>
      <div><h3>What we ask</h3><ul>
        <li><b>The videos are yours.</b> You own them, or hold the rights to have them adapted.</li>
        <li><b>Captions on.</b> We work from your public transcript; auto-captions are fine.</li>
        <li><b>A real name and a real channel.</b> No anonymous bylines here.</li>
        <li><b>Patience with the odd hold.</b> If the check flags an article, it waits for a human. That&rsquo;s a feature.</li></ul></div>
    </div>
    <div class="apply" id="apply">
      <div class="aside"><h2>Apply with your YouTube handle.</h2>
        <p>That&rsquo;s all we really need - we look at the channel, the captions and the kind of videos you make, and if it&rsquo;s a fit we start.</p>
        <p>The terms are the same for everyone and they&rsquo;re on the form. Applying is the agreement, so there&rsquo;s nothing to negotiate, nothing to sign later, and nothing hidden.</p>
        <p>We&rsquo;re taking film, TV, games, comics, anime and everything adjacent. Long-form, reactions, breakdowns, lore, interviews.</p></div>
      <form class="form" id="applyform" method="post" action="${base}/api/apply">
        <div class="field"><label for="f-handle">YouTube handle</label>
          <div class="handle"><span>youtube.com/</span><input id="f-handle" name="handle" placeholder="@yourchannel" required autocomplete="off"></div></div>
        <div class="row2">
          <div class="field"><label for="f-name">Your name</label><input id="f-name" name="name" placeholder="As it should appear on your byline" required></div>
          <div class="field"><label for="f-email">Email</label><input id="f-email" name="email" type="email" placeholder="you@example.com" required></div>
        </div>
        <div class="row2">
          <div class="field"><label for="f-kind">What you make</label>
            <select id="f-kind" name="kind"><option>Breakdowns &amp; theories</option><option>Reviews &amp; reactions</option><option>Lore &amp; explainers</option><option>News &amp; leaks</option><option>Gaming</option><option>Anime</option><option>Interviews</option><option>Something else</option></select></div>
          <div class="field"><label for="f-size">Channel size <small>(optional)</small></label>
            <select id="f-size" name="size"><option value="">Rather not say</option><option>Under 10k</option><option>10k &ndash; 100k</option><option>100k &ndash; 500k</option><option>500k &ndash; 1M</option><option>Over 1M</option></select></div>
        </div>
        <div class="terms"><span class="lbl">Standard terms</span>
          <p><b>60% to you</b> on everything your articles earn &middot; non-exclusive, so run them anywhere else you like &middot; no fees, no minimum term &middot; leave any time and we take the articles down &middot; paid monthly from $50.</p></div>
        <label class="consent"><input type="checkbox" name="consent" value="yes" required><span>I own these videos, or hold the rights to have them adapted. <b>By applying I give ${BRAND_()} permission to turn my public videos into articles, drafted with AI from my transcripts, and publish them under my handle on the standard terms above and the <a href="${base}/creators" target="_blank" style="color:var(--blue)">Creator Agreement</a>.</b> I can withdraw at any time and the articles come down.</span></label>
        <input type="text" name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
        <input type="hidden" name="source" id="f-source" value="direct">
        <script>(function(){var v=new URLSearchParams(location.search).get("v");if(v)document.getElementById("f-source").value=String(v).slice(0,40);})();</script>
        <button class="submit" type="submit" id="f-submit">Send application</button>
        <p class="formnote" id="formnote">Applying is the agreement - there&rsquo;s no second contract. We check the channel and captions first; if it&rsquo;s a fit, your first articles appear within a week and we email you the links.</p>
      </form>
      <div class="done" id="applydone" hidden>${ch("reactor", 110)}<div><b>Got it - you&rsquo;re in the queue.</b><p>We&rsquo;ll check the channel and captions. If it&rsquo;s a fit, your first articles appear within a week and we&rsquo;ll email you the links. Change your mind at any point and they come down.</p></div></div>
    </div>
  </div>
</section>
<script>
(function(){
  const form = document.getElementById('applyform');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('f-submit'); btn.disabled = true; btn.textContent = 'Sending…';
    const fd = new FormData(form); const rec = Object.fromEntries(fd.entries());
    try {
      const r = await fetch(form.action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rec) });
      if (!r.ok) throw new Error(String(r.status));
      form.hidden = true; document.getElementById('applydone').hidden = false;
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Send application';
      document.getElementById('formnote').textContent = 'That didn’t go through - try again, or email ${mail("hello")} with your handle.';
    }
  });
})();
</script>`;
  return shell({ base, title: `${joinCta()} - ${BRAND_()}`, desc: "Your videos, in writing. Under your name.", body, rule: "var(--orange)" })
    .replace('<span id="panelcount-slot"></span>', `<span>${data.panel.length} creators writing here</span>`);
}

export function threadPage(sl, data, base) {
  const s = (data.subjects || {})[sl]; if (!s) return null;
  const list = s.items.map(id => data.arts.find(a => a.id === id)).filter(Boolean);
  const creators = [...new Set(list.map(a => a.c))];
  const body = `
<main class="homeview">
  <div class="wrap">
    <div class="thead"><span class="kicker">Thread</span><h1>${esc(s.t)}</h1>
      <p>${list.length} take${list.length === 1 ? "" : "s"} from ${creators.length} creator${creators.length === 1 ? "" : "s"}: ${creators.map(c => `<a href="${base}/c/${esc(slugH(c))}" style="color:var(--blue);text-decoration:none;font-weight:700">${esc(c)}</a>`).join(", ")}.</p></div>
    <section class="grid3">${list.filter(a => a.w >= 400).slice(0, 3).map(a => card(a, base)).join("")}</section>
    <div class="cols">
      <div>${wire(list.filter(a => !(list.filter(x => x.w >= 400).slice(0, 3)).includes(a)), base)}</div>
      ${rail(data.panel, base, data)}
    </div>
  </div>
</main>`;
  return shell({ base, title: `${s.t} - ${BRAND_()}`, desc: `${list.length} takes on ${s.t} from ${creators.length} creators.`, body, trending: data.threads })
    .replace('<span id="panelcount-slot"></span>', `<span>${data.panel.length} creators writing here</span>`);
}

export function rssFeed(data, base) {
  const site = siteUrl() + base;
  const items = data.arts.slice(0, 50).map(a => `<item><title>${esc(a.h)}</title><link>${site}${artPath(a)}</link><guid isPermaLink="true">${site}${artPath(a)}</guid><pubDate>${new Date(a.p).toUTCString()}</pubDate><dc:creator>${esc(a.c)}</dc:creator><category>${esc(CATS[a.k])}</category><description>${esc(a.s)}</description><enclosure url="${esc(a.thumb)}" type="image/jpeg" length="0"/></item>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${BRAND_()}</title><link>${site}/</link><description>${esc(TAG_())}</description><language>en</language><atom:link href="${site}/feed.xml" rel="self" type="application/rss+xml"/>${items}</channel></rss>`;
}

export function aboutPage(data, base) {
  const body = `
<main class="homeview">
  <div class="wrap about">
    <a class="back" href="${base}/">&larr; Back to the front page</a>
    <div class="aboutcols">
    <div class="abouttext">
    <h1 class="headline" style="font-size:clamp(1.9rem,4vw,2.8rem);margin-top:1rem">Who we are</h1>
    <p>${BRAND_()} is a publication written by the people who actually watch the things it covers. Every article here started life as a video by one of the ${data.panel.length} creators on <a href="${base}/#panel" style="color:var(--blue)">The Panel</a>, and runs under that creator&rsquo;s name with a link to the video it came from. We don&rsquo;t have staff writers. We don&rsquo;t have anonymous bylines.</p>
    <p>The name is the idea: the story under the story. Breakdowns, theories, reactions, opinions, reviews and lore - the second layer that people who love this stuff actually talk about.</p>

    <h2 id="standards">Editorial standards</h2>
    <p><b>One creator, one byline.</b> Each article is adapted from a single creator&rsquo;s own video and published under their handle. If it isn&rsquo;t theirs, it isn&rsquo;t here.</p>
    <p><b>Claims keep their strength.</b> A rumour stays a rumour, a theory stays a theory, and a creator&rsquo;s opinion is presented as their opinion. Nothing is upgraded to fact on the way from video to page.</p>
    <p><b>The source is always one click away.</b> Every article ends with the original video. If you want the full argument, the tone, the jokes - it&rsquo;s right there.</p>
    <p><b>Corrections.</b> If we&rsquo;ve got something wrong, tell us at ${mail("corrections")} and we&rsquo;ll fix it and say so.</p>

    <h2 id="ai">How we use AI</h2>
    <p>The first draft of every article is written by AI, from the creator&rsquo;s own transcript. A fidelity check then compares the draft with the video and holds back anything that drifts from what was actually said. Every article carries a short note saying so.</p>
    <p>What&rsquo;s never AI: the ideas, the takes, the jokes, the reporting, the personality. Those belong to the creator, which is the whole point.</p>
    <p>Creators join by applying with their handle and agreeing to the same standard terms as everyone else; nothing publishes under a creator&rsquo;s name without that agreement, and any creator can pull any article at any time.</p>

    </div>
    <aside class="aboutrail">
      <div class="box">
        <h2>Want in?</h2>
        <p class="note">Make videos ${audience()}? Your videos, in writing, under your name - and 60% of what they earn.</p>
        <div style="padding:0 1.3rem 1.2rem"><a class="cta" href="${base}/join">${joinCta()}</a></div>
      </div>
      <div class="box">
        <h2>By the numbers</h2>
        <ul class="stdlist">
          <li>${data.panel.length} creators writing here</li>
          <li>${data.arts.length} articles, every one from a real video</li>
          <li>0 anonymous bylines</li>
        </ul>
      </div>
      <div class="box">
        <h2>Corrections</h2>
        <p class="note" style="border-bottom:0">Got something wrong? <span style="color:var(--ink)">${mail("corrections")}</span> - we fix it and say so.</p>
      </div>
    </aside>
    </div>
    ${hasCast() ? `<h2 id="cast">The cast</h2>
    <p>Seven of our own. None of them belongs to anyone else&rsquo;s franchise, which is the point.</p>
    <div class="castgrid">${Object.entries(CAST_META).map(([k, m]) => `<figure>${ch(k, 150)}<b>${esc(m.name)}</b><span>${esc(m.line)}</span></figure>`).join("")}</div>` : ""}
  </div>
</main>`;
  return shell({ base, title: `About - ${BRAND_()}`, desc: "Who we are, our editorial standards, and how we use AI.", body, current: "about" })
    .replace('<span id="panelcount-slot"></span>', `<span>${data.panel.length} creators writing here</span>`);
}

export function notFound(base) {
  return shell({ base, title: `Not found - ${BRAND_()}`, desc: "", body: `<main class="homeview"><div class="wrap"><div class="notfound">${art("goblin", 200)}<div><h1>That page isn&rsquo;t here.</h1><p>${hasCast() ? "The goblin already knows how it ends, and isn&rsquo;t telling." : "Nothing lives at this address."}</p><a href="${base}/">Back to the front page &rarr;</a></div></div></div></main>` })
    .replace('<span id="panelcount-slot"></span>', "");
}

// Legal + contact pages (copy lives in legal.js)
import { contactBody, privacyBody, termsBody, creatorsBody } from "./legal.js";
const LEGAL = {
  contact:  ["Contact", () => `How to reach ${BRAND_()}.`, contactBody],
  privacy:  ["Privacy", () => `How ${BRAND_()} handles your data.`, privacyBody],
  terms:    ["Terms of use", () => `The rules for using ${BRAND_()}.`, termsBody],
  creators: ["Creator Agreement", () => `The deal for ${member()}s, in full.`, creatorsBody],
};
export function legalPage(kind, data, base) {
  const d = LEGAL[kind]; if (!d) return null;
  return shell({ base, title: `${d[0]} - ${BRAND_()}`, desc: d[1](), body: d[2](base), current: kind === "contact" ? "about" : "" });
}

// ---- Revenue archive (private). Reads the append-only archive, not monday, so this page and
// the finance board can be compared against each other rather than sharing one source.
export function revenuePage(months, month, data, base) {
  const m = month;
  const row = (label, val, cls = "") => `<td class="${cls}">${val}</td>`;
  const cash = n => "$" + Number(n || 0).toFixed(2);
  const body = `
<main class="homeview">
  <div class="wrap about">
    <a class="back" href="${base}/">&larr; Back to the front page</a>
    <h1 class="headline" style="font-size:clamp(1.7rem,3.5vw,2.4rem);margin:1rem 0 .3rem">Revenue</h1>
    <p class="meta" style="margin:0 0 1.6rem">What Google reported, month by month. The finance board is worked from the same figures; this is the independent copy.</p>
    ${months.length ? `<p class="meta" style="margin:0 0 1.4rem">${months.map(x => x === (m && m.month)
      ? `<b>${esc(x)}</b>` : `<a href="${base}/revenue?month=${esc(x)}">${esc(x)}</a>`).join(" &nbsp;·&nbsp; ")}</p>` : ""}
    ${!m ? `<div class="box" style="padding:1.3rem"><p class="note" style="border:0;padding:0;margin:0">No months archived yet. The first statement is written after the account is approved and the monthly job has run.</p></div>` : `
    <div class="box" style="padding:1.3rem;margin-bottom:1.4rem">
      <p class="note" style="border:0;padding:0;margin:0">
        Site total <b>${cash(m.siteTotal)}</b> &nbsp;·&nbsp; attributed to creators <b>${cash(m.attributed)}</b>
        &nbsp;·&nbsp; house <b>${cash(m.house)}</b> &nbsp;·&nbsp;
        ${m.warnings && m.warnings.reconciles ? "reconciles" : `<span style="color:var(--red,#c0392b)">DOES NOT RECONCILE</span>`}
      </p>
      ${m.warnings && (m.warnings.creatorsWithNoChannel || []).length ? `<p class="note" style="border:0;padding:.6rem 0 0;margin:0;color:var(--red,#c0392b)">No URL channel, earnings unattributed: ${esc((m.warnings.creatorsWithNoChannel || []).join(", "))}</p>` : ""}
      ${m.warnings && (m.warnings.unrecognisedChannels || []).length ? `<p class="note" style="border:0;padding:.6rem 0 0;margin:0;color:var(--red,#c0392b)">Channels not matched to a creator: ${esc((m.warnings.unrecognisedChannels || []).map(u => u.channel).join(", "))}</p>` : ""}
    </div>
    <div style="overflow-x:auto"><table class="revtbl">
      <thead><tr><th>Creator</th><th>Revenue</th><th>Creator payout</th><th>DFT net</th><th>Page views</th></tr></thead>
      <tbody>${(m.statements || []).map(s => `<tr>
        <td><b>${esc(s.creator)}</b><span class="meta"> @${esc(s.slug)}</span></td>
        ${row("", cash(s.revenue), "num")}${row("", cash(s.payout), "num")}${row("", cash(s.dftNet), "num")}
        ${row("", (s.pageViews || 0).toLocaleString("en-GB"), "num")}</tr>`).join("")}
        <tr class="house"><td><b>House</b><span class="meta"> home, sections, threads, join</span></td>
        ${row("", cash(m.house), "num")}${row("", "$0.00", "num")}${row("", cash(m.house), "num")}${row("", "", "num")}</tr>
      </tbody>
    </table></div>
    <p class="meta" style="margin-top:1.2rem">Archived ${esc(String(m.archivedAt || "").slice(0, 10))}. Records are written once and never rewritten.</p>`}
  </div>
</main>`;
  return shell({ base, title: `Revenue - ${BRAND_()}`, body: `<style>
.revtbl{width:100%;border-collapse:collapse;font-size:.92rem}
.revtbl th{text-align:left;font-family:var(--disp);font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-2);padding:.7rem 1rem;border-bottom:1.5px solid var(--ink)}
.revtbl td{padding:.85rem 1rem;border-bottom:1px solid var(--rule)}
.revtbl td.num{text-align:right;font-family:var(--mono)}
.revtbl tr.house td{background:var(--paper-2)}
.revtbl .meta{font-size:.78rem}
</style>` + body, trending: data.threads });
}

// A sitemap exists to tell Google the site is here at all. Search Console proved on 6 Sep 2026
// that Googlebot had NEVER fetched subplot.tv - "URL is unknown to Google", last crawl N/A -
// with no referring sitemaps and no inbound links. Lifting the robots block opened the door;
// this is what tells Google the door exists.
//
// Every page still carries noindex, so Search Console will report these as "Discovered -
// excluded by noindex". THAT IS THE INTENDED STATE while the site is closed, not a fault:
// the point is to get pages CRAWLED so the AdSense reviewer has something to read. When the
// site launches, drop the noindex header and these same URLs start indexing with no change here.
export function sitemap(data, base) {
  const site = siteUrl() + base;
  const seen = new Set();
  const url = (loc, lastmod, priority) => {
    if (seen.has(loc)) return "";                                   // a URL twice is a defect, not a hint
    seen.add(loc);
    return `<url><loc>${esc(site + loc)}</loc>` +
      (lastmod ? `<lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>` : "") +
      `<priority>${priority}</priority></url>`;
  };

  const newest = data.arts.length ? Math.max(...data.arts.map(a => +new Date(a.p) || 0)) : Date.now();
  const out = [url("/", newest, "1.0"), url("/about", null, "0.5"), url("/join", null, "0.8")];

  for (const k of Object.keys(CATS)) {
    const inSection = data.arts.filter(a => a.k === k);
    if (inSection.length) out.push(url("/s/" + k, Math.max(...inSection.map(a => +new Date(a.p) || 0)), "0.6"));
  }
  // Creator pages: derive from the articles actually on the site, so a creator with nothing
  // published never appears as a URL that would 404 the moment Google follows it.
  for (const h of [...new Set(data.arts.map(a => a.c))]) {
    const theirs = data.arts.filter(a => a.c === h);
    out.push(url("/c/" + slugH(h), Math.max(...theirs.map(a => +new Date(a.p) || 0)), "0.7"));
  }
  for (const t of (data.threads || [])) out.push(url("/t/" + t.slug, null, "0.5"));
  for (const a of data.arts) out.push(url(artPath(a), a.p, "0.9"));
  if ((data.snippets || []).length) {
    out.push(url("/snippets", Math.max(...data.snippets.map(a => +new Date(a.p) || 0)), "0.7"));
    for (const a of data.snippets) out.push(url(artPath(a), a.p, "0.6"));
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${out.join("")}</urlset>`;
}
