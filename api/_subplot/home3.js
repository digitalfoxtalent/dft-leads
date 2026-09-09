// SUBPLOT design 3, chosen 9 Sep 2026 ("B, Front Page" on the design canvas): the front page
// as a lead package (hero plus an "Also today" rail), then Snippets as a live column, then
// Threads, then a card grid and the wire. Every card carries its format colour as a mark (a
// 3px rule, a dot, the character beside the byline) and never as a fill. See formats.js.
//
// Built beside the existing templates rather than into them: homePage() in render.js delegates
// here when design() === 3, and everything else keeps working unchanged under ?d=1 and ?d=2.
import { CATS } from "./data.js";
import { FORMATS } from "./formats.js";
import { ch } from "./cast.js";
import { brand, hasCast } from "./brand.js";

// These come from render.js at call time so this file does not import render.js back.
let R = null;
export const wire3Deps = deps => { R = deps; };

const fmtOf = a => FORMATS[a.f] || FORMATS.breakdown;
const cast = (name, px) => hasCast() ? ch(name, px) : "";
const esc = s => R.esc(s);

// The format tag: dot plus name, in the format's ink. Optional subject after it.
// The format tag. `px` swaps the small colour dot for the format's CHARACTER at that size, on a
// chip in the format's wash: the cast belongs to the article (it says what kind of piece this
// is) rather than to the author, whose own channel logo sits on the byline. Tight rows (the
// wire) keep the dot, because a chip there would set the row height.
export const fmtTag = (a, subject = false, px = 0) => {
  const f = fmtOf(a);
  const art = px ? cast(f.cast, px) : "";
  const mark = art ? `<span class="fmc" style="--fmc:${px}px;background:${f.wash}">${art}</span>` : `<i style="background:${f.col}"></i>`;
  return `<span class="fmt" style="color:${f.ink}">${mark}${f.name}</span>${subject ? `<span class="meta">${esc(CATS[a.k])}</span>` : ""}`;
};

const short = t => t.length > 118 ? t.slice(0, 115).replace(/\s+\S*$/, "") + "…" : t;

// THE BYLINE CARRIES THE CREATOR'S OWN CHANNEL PICTURE, never a cast character (Tom, 9 Sep
// 2026: "here I think it needs to be the logo for the creator, that's what most people will be
// used to"). The whole promise of the site is that a named person wrote the piece, so a mascot
// in the author slot works against it. The cast still marks the FORMAT everywhere else: the tag
// dot, the thread stripe, the Snippet bubble and the deck. Initials are the fallback when a
// channel picture cannot be resolved.
const initials = h => String(h || "").replace(/^@/, "").replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase();
const avatarOf = a => (R.avatars || {})[a.c] || "";
const byMark = (a, px = 28) => {
  const url = avatarOf(a);
  const size = px === 28 ? "" : ` style="--av:${px}px"`;
  return url
    ? `<span class="av"${size}><img src="${esc(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>`
    : `<span class="av ini"${size}>${esc(initials(a.c))}</span>`;
};

// Grid card. Format rule on top, picture with its character, tag row, headline, byline.
export const card3 = (a, base) => {
  const f = fmtOf(a);
  return `<a class="card3" href="${base}${R.artPath(a)}" style="border-top-color:${f.col}">
    <span class="th" style="--bg:url(${esc(a.thumbSmall)})"><img alt="" loading="lazy" decoding="async" src="${esc(a.thumbSmall)}"></span>
    <span class="tagrow">${fmtTag(a, true, 26)}</span>
    <span class="headline">${esc(a.h)}</span>
    <span class="by">${byMark(a, 24)}<span class="meta">${esc(a.c)} · ${a.rt} min</span></span>
  </a>`;
};

// Rail row, for "Also today".
const railRow = (a, base) => `<a class="rrow" href="${base}${R.artPath(a)}">
    <span class="th" style="--bg:url(${esc(a.thumbSmall)})"><img alt="" loading="lazy" decoding="async" src="${esc(a.thumbSmall)}"></span>
    <span class="txt">${fmtTag(a, false, 22)}<h3>${esc(a.h)}</h3><span class="meta">${esc(a.c)} · ${esc(CATS[a.k])} · ${a.rt} min</span></span>
  </a>`;

// Thread take: the stripe and the label carry the format, so a thread shows at a glance that
// it holds two news pieces and two theories.
export const take3 = (a, base) => {
  const f = fmtOf(a);
  return `<li><a href="${base}${R.artPath(a)}"><span class="stripe" style="background:${f.col}"></span>
    <span class="tk"><b style="color:${f.ink}">${esc(a.b)} <span class="fn">· ${f.name}</span></b><span>${esc(a.h)}</span></span></a></li>`;
};

// Wire row with the format tag above the headline.
export function wire3(list, base) {
  const groups = [];
  for (const a of list) {
    const g = groups[groups.length - 1];
    if (g && g.k === R.dayKey(a.p)) g.items.push(a); else groups.push({ k: R.dayKey(a.p), p: a.p, items: [a] });
  }
  return groups.map((g, gi) => (gi === 1 ? R.adSlot("in-feed", "336×280", "300×250", "ad-infeed") : "") + `
    <section class="daygroup"><div class="daylabel">${esc(R.dayLabel(g.p))}</div><ul class="wire">
    ${g.items.map(a => `
      <li><a href="${base}${R.artPath(a)}">
        <span class="wthumb" style="--bg:url(${esc(a.thumbSmall)})"><img src="${esc(a.thumbSmall)}" alt="" loading="lazy" decoding="async"></span>
        <span class="txt">${fmtTag(a)}<h3>${esc(a.h)}</h3>
          <span class="sub"><b>${esc(a.c)}</b><span>${esc(CATS[a.k])}</span></span></span>
        <span class="rt">${a.rt} min</span>
      </a></li>`).join("")}
    </ul></section>`).join("");
}

// ---------- Snippets: a Short as a speech bubble. No cover image, ever.
// Reading time for a Snippet in seconds, at 240 words a minute, rounded to the nearest five.
const secs = w => Math.max(10, Math.round(w / 4 / 5) * 5);
const clock = p => new Date(p).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const mark = a => byMark(a, 28);

export const bubble = (a, data, base, big = false) => {
  const f = fmtOf(a);
  return `<a class="bubble${big ? " big" : ""}" href="${base}${R.artPath(a)}">
    <span class="bb" style="background:${f.wash};--tail:${f.wash}">
      <span class="q">${esc(a.h)}</span>
      <span class="bbmeta">${fmtTag(a)}<span class="meta" style="color:${f.ink}">${a.w} words · ${secs(a.w)} sec</span></span>
      <span class="bbcast">${cast(f.cast, 44)}</span>
    </span>
    <span class="who">${mark(a)}<span class="whotxt"><b>${esc(a.b)}</b><span class="meta">${esc(a.c)} · ${clock(a.p)}</span></span></span>
  </a>`;
};

export const colRow = (a, base) => {
  const f = fmtOf(a);
  return `<a class="crow" href="${base}${R.artPath(a)}"><span class="meta t">${clock(a.p)}</span><i style="background:${f.col}"></i><span class="q">${esc(a.h)} <span class="meta">${esc(a.c)}</span></span><span class="meta">${a.w} words</span></a>`;
};

export function snippetsSection(data, base) {
  const list = (data.snippets || []).slice(0, 7);
  if (list.length < 4) return "";
  return `
    <section class="snips">
      <div class="rule-h"><h2>Snippets</h2><span class="note">the creators' Shorts, in writing · a minute or less each · live through the day</span></div>
      <div class="bubbles">${list.slice(0, 4).map(a => bubble(a, data, base)).join("")}</div>
      ${list.length > 4 ? `<div class="col">${list.slice(4).map(a => colRow(a, base)).join("")}</div>` : ""}
      <a class="morelink" href="${base}/snippets">The whole column, newest first &rarr;</a>
    </section>`;
}

// ---------- The front page.
export function homePage3(data, base, section, page, ctx) {
  const { list, lead, rest, pages, wireList, pager, threads } = ctx;
  const byId = id => data.arts.find(a => a.id === id);
  const also = page === 1 ? rest.filter(a => a.w >= 400).slice(0, 4) : [];
  const grid = page === 1 ? rest.filter(a => !also.includes(a) && a.w >= 400).slice(0, 4) : [];
  const f = fmtOf(lead);
  const secName = section === "all" ? "" : CATS[section];
  const body = `
<main class="homeview home3">
  <div class="wrap">
    ${page > 1 ? `<div class="rule-h" style="margin-top:2rem"><h2>${section === "all" ? "Older stories" : "Older in " + esc(secName)}</h2><span class="note">page ${page} of ${pages}</span></div>` : `
    <section class="leadpkg">
      <a class="hero" href="${base}${R.artPath(lead)}">
        <span class="th" style="--bg:url(${esc(lead.thumbSmall)})"><img alt="" src="${esc(lead.thumb)}" onerror="this.onerror=null;this.src='${esc(lead.thumbSmall.replace("mqdefault", "hqdefault"))}'"></span>
        <span class="tagrow">${fmtTag(lead, false, 30)}<span class="meta">${esc(CATS[lead.k])}</span></span>
        <h1 class="headline">${esc(lead.h)}</h1>
        <span class="dek">${esc(lead.s)}</span>
        <span class="by">${byMark(lead, 36)}<span class="whotxt"><b>${esc(lead.b)} <span class="meta">${esc(lead.c)}</span></b><span class="meta">${esc(R.fmt(lead.p))} · ${lead.w.toLocaleString("en-GB")} words · ${lead.rt} min read${lead.views ? ` · ${R.fmtViews(lead.views)} views on YouTube` : ""}</span></span></span>
      </a>
      <aside class="also">
        <div class="rule-h"><h2>Also today</h2><span class="note">${esc(new Date().toLocaleDateString("en-GB", { weekday: "long", timeZone: "Europe/London" }))}</span></div>
        ${also.map(a => railRow(a, base)).join("")}
        <a class="morelink" href="${base}/${section === "all" ? "" : "s/" + section}?p=2">${section === "all" ? "All of today's stories" : "More in " + esc(secName)} &rarr;</a>
      </aside>
    </section>
    <section class="latest">
      <div class="rule-h"><h2>Latest${section === "all" ? " across the network" : " in " + esc(secName)}</h2><span class="note">${list.length} stories</span></div>
      ${grid.length ? `<section class="grid4">${grid.map(a => card3(a, base)).join("")}</section>` : ""}
    </section>
    ${section === "all" ? snippetsSection(data, base) : ""}
    ${threads.length ? `
    <section class="threadsec">
      <div class="rule-h"><h2>Threads</h2><span class="note">one subject, several creators, side by side</span></div>
      <div class="threads">${threads.map(t => `
        <section class="thread">
          <div class="thread-top"><span class="kicker">Thread</span><h3><a href="${base}/t/${esc(t.slug)}" style="color:inherit;text-decoration:none">${esc(t.t)}</a></h3>
            <span class="count">${t.n} articles · ${t.c} creators</span></div>
          <ul class="takes">${t.items.map(byId).filter(Boolean).map(a => take3(a, base)).join("")}</ul>
        </section>`).join("")}
      </div>
    </section>` : ""}
    <div class="rule-h"><h2>${section === "all" ? "Older stories" : "Older in " + esc(secName)}</h2><span class="note">${list.length} stories</span></div>`}
    <div class="cols">
      <div>${wire3(wireList.filter(a => !also.includes(a) && !grid.includes(a)), base)}${pager}</div>
      ${R.rail(data.panel, base, data)}
    </div>
    ${R.band(base)}
  </div>
</main>`;
  return body;
}

// ---------- /snippets: the whole column, and on a phone a deck you flick through.
// Every sixth card in the deck is an ad card: paper, labelled, never first, never mid-read.
export function snippetsPage(data, base) {
  const list = data.snippets || [];
  if (!list.length) return null;
  let adN = 0;
  const cards = [];
  list.forEach((a, i) => {
    if (i > 0 && i % 5 === 0) { adN++; cards.push(`<section class="deckcard adcard" id="ad-${adN}"><span class="adlbl">Advertisement</span>${R.adSlot("snippet-deck-" + adN, "300×250", "300×250", "ad-deck")}</section>`); }
    const f = fmtOf(a);
    cards.push(`<section class="deckcard" id="s-${esc(a.id)}" style="background:${f.wash}">
      <div class="deckin">
        <div class="decktop"><span class="meta" style="color:${f.ink}">${i + 1} of ${list.length}</span><span class="meta" style="color:${f.ink}">${clock(a.p)} · ${esc(R.fmt(a.p))}</span></div>
        <div class="deckmid">
          ${fmtTag(a)}
          <h2 class="q">${esc(a.h)}</h2>
          ${a.s ? `<p class="s">${esc(a.s)}</p>` : ""}
          <div class="who">${mark(a)}<span class="whotxt"><b>${esc(a.b)}</b><span class="meta">${esc(a.c)} · ${a.w} words · ${secs(a.w)} sec</span></span></div>
          <div class="deckacts"><a style="color:${f.ink}" href="https://www.youtube.com/shorts/${esc(a.v)}" target="_blank" rel="noopener">Watch the Short</a><a class="ghost" href="${base}${R.artPath(a)}">Read it</a></div>
        </div>
        <div class="deckfoot">${cast(f.cast, 96)}</div>
      </div>
    </section>`);
  });
  return `
<main class="snipview">
  <div class="wrap snipintro">
    <div class="rule-h"><h2>Snippets</h2><span class="note">${list.length} quick reads · newest first</span></div>
    <p class="lede">Every Short the creators post, in writing, one take each, none longer than a minute. No cover, no scroll: the words are the picture. On a phone, flick up for the next one.</p>
  </div>
  <div class="deck">${cards.join("")}</div>
</main>
<script>
(function(){
  var d=document.querySelector('.deck'); if(!d) return;
  function go(n){var cs=[].slice.call(d.querySelectorAll('.deckcard'));var i=cs.findIndex(function(c){return c.getBoundingClientRect().top>=-8});var t=cs[Math.max(0,Math.min(cs.length-1,i+n))];if(t)t.scrollIntoView({behavior:'smooth',block:'start'});}
  document.addEventListener('keydown',function(e){if(e.key==='ArrowDown'||e.key==='j'){e.preventDefault();go(1)}if(e.key==='ArrowUp'||e.key==='k'){e.preventDefault();go(-1)}});
})();
</script>`;
}

// ---------- Stylesheet for design 3. Sits on top of CSS2 (the warm paper, Instrument Sans and
// Newsreader) and adds only what the new page needs.
export const CSS3 = String.raw`
/* line-height 1 so the label's own line box does not add leading above the capitals; the row
   then aligns its CAP HEIGHT to the top of the picture beside it (see .rrow .txt). */
.fmt{display:inline-flex;align-items:center;gap:.45rem;font-family:var(--disp);font-weight:600;font-size:.7rem;line-height:1;letter-spacing:.1em;text-transform:uppercase;white-space:nowrap}
.fmt i{width:9px;height:9px;border-radius:2px;display:inline-block;flex-shrink:0}
.tagrow{display:flex;justify-content:space-between;align-items:center;gap:.8rem}
.tagrow .meta{white-space:nowrap}
.th{display:block;position:relative;overflow:hidden;background:var(--paper-3);aspect-ratio:16/9;border-radius:10px}
.th::before,.wire .wthumb::before{content:"";position:absolute;inset:-12%;background:var(--bg) center/cover no-repeat;filter:blur(14px) saturate(1.15);opacity:.9}
.th img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;transition:transform .55s cubic-bezier(.2,.7,.3,1)}
.wire .wthumb{position:relative}.wire .wthumb img{position:relative;object-fit:contain}
a:hover .th img{transform:scale(1.035)}
.fmc{width:var(--fmc,26px);height:var(--fmc,26px);border-radius:8px;display:inline-flex;align-items:flex-end;justify-content:center;overflow:hidden;flex-shrink:0;line-height:0}
.fmc svg{width:78%;height:auto;margin-bottom:-4%}
.by{display:flex;align-items:center;gap:.5rem}
.by .cast{flex-shrink:0}
.whotxt{display:flex;flex-direction:column;gap:.1rem;min-width:0}
.whotxt b{font-family:var(--disp);font-weight:600;font-size:.9rem;color:var(--ink)}
.morelink{display:inline-block;margin-top:1rem;font-family:var(--disp);font-weight:600;font-size:.86rem;color:var(--blue);text-decoration:none}

/* lead package */
.leadpkg{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:clamp(1.6rem,3.5vw,2.6rem);padding:2.4rem 0 .5rem;align-items:start}
.hero{display:flex;flex-direction:column;gap:.7rem;text-decoration:none;color:inherit}
.hero .th{aspect-ratio:16/9}
.hero .tagrow{justify-content:flex-start;gap:1rem;margin-top:.4rem}
.hero .headline{font-size:clamp(1.9rem,3.4vw,2.9rem);margin:0}
.hero:hover .headline{color:var(--blue)}
.hero .dek{font-size:1.12rem;color:var(--ink-2);max-width:40rem;line-height:1.5}
.also .rule-h{margin-top:0}
.rrow{display:grid;grid-template-columns:104px 1fr;gap:.9rem;padding:.95rem 0;border-bottom:1px solid var(--rule);align-items:start;text-decoration:none;color:inherit}
.rrow .txt{display:flex;flex-direction:column;gap:.3rem;min-width:0}
.rrow h3{font-family:var(--disp);font-weight:600;font-size:1rem;line-height:1.28;letter-spacing:-.014em;margin:0}
.rrow:hover h3{color:var(--blue)}

/* cards and wire */
.grid4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1.4rem;padding:1.3rem 0 0}
.card3{display:flex;flex-direction:column;gap:.55rem;border-top:3px solid var(--blue);padding-top:.8rem;text-decoration:none;color:inherit}
.card3 .tagrow{margin-top:.6rem}
.card3 .headline{font-size:1.12rem;line-height:1.22;letter-spacing:-.018em}
.card3:hover .headline{color:var(--blue)}
.wire .txt .fmt{margin:.9rem 0 .15rem}
.takes .stripe{width:3px;border-radius:2px}
.takes button,.takes a{grid-template-columns:3px 1fr}
.takes .tk b{display:block}
.takes .tk b .fn{display:inline;color:var(--ink-3);font-weight:500}

/* snippets */
.latest{margin-top:2.6rem}
.snips{margin-top:2.8rem}
.bubbles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1.4rem;margin-top:1.4rem}
.bubble{display:flex;flex-direction:column;gap:.85rem;text-decoration:none;color:inherit}
.bubble .bb{position:relative;border-radius:18px;padding:1.4rem 1.4rem 1.5rem;min-height:10.5rem;display:flex;flex-direction:column;justify-content:space-between;gap:1rem}
.bubble .q{font-family:var(--disp);font-weight:600;font-size:1.18rem;line-height:1.22;letter-spacing:-.022em;color:var(--ink);text-wrap:pretty}
.bubble.big .q{font-size:1.5rem}
.bubble .bbmeta{display:flex;justify-content:space-between;align-items:flex-end;padding-right:3.6rem;gap:.6rem;flex-wrap:wrap}
.bubble .bbmeta .meta{white-space:nowrap}
.bubble .bb::after{content:"";position:absolute;left:26px;bottom:-12px;border-left:12px solid transparent;border-right:12px solid transparent;border-top:14px solid var(--tail)}
.bubble .bbcast{position:absolute;right:.9rem;bottom:-.4rem;line-height:0}
.bubble:hover .q{color:var(--blue)}
.who{display:flex;align-items:center;gap:.6rem;padding-left:.4rem;min-width:0}
.av{width:var(--av,28px);height:var(--av,28px);border-radius:50%;background:var(--paper-3);color:var(--ink);font-family:var(--disp);font-weight:600;font-size:calc(var(--av,28px) * .36);display:inline-flex;align-items:center;justify-content:center;letter-spacing:.02em;overflow:hidden;flex-shrink:0}
.av img{width:100%;height:100%;object-fit:cover;display:block}
.whotxt b,.whotxt .meta{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.col{display:flex;flex-direction:column;margin-top:1.6rem;border-top:1px solid var(--rule)}
.crow{display:grid;grid-template-columns:3.2rem 9px 1fr auto;gap:.85rem;align-items:baseline;padding:.8rem 0;border-bottom:1px solid var(--rule);text-decoration:none;color:inherit}
.crow i{width:9px;height:9px;border-radius:2px;align-self:center;display:block}
.crow .t{font-variant-numeric:tabular-nums}
.crow .q{font-family:var(--disp);font-weight:500;font-size:.95rem;line-height:1.35;letter-spacing:-.01em}
.crow:hover .q{color:var(--blue)}

/* the deck */
.snipview .lede{font-size:1.1rem;color:var(--ink-2);max-width:40rem;margin:.9rem 0 1.6rem}
.deck{display:flex;flex-direction:column;gap:1.2rem;max-width:var(--maxw);margin:0 auto;padding:0 clamp(1.4rem,5vw,3.5rem) 3rem}
.deckcard{border-radius:24px;padding:2rem 2.2rem 1.6rem;position:relative;min-height:22rem}
.deckin{display:flex;flex-direction:column;justify-content:space-between;gap:1.4rem;height:100%}
.decktop{display:flex;justify-content:space-between}
.deckmid{display:flex;flex-direction:column;gap:1rem;max-width:44rem}
.deckcard .q{font-family:var(--disp);font-weight:600;font-size:clamp(1.5rem,2.6vw,2.2rem);line-height:1.12;letter-spacing:-.03em;margin:0;text-wrap:pretty}
.deckcard .s{margin:0;color:var(--ink-2);font-size:1.05rem;max-width:36rem}
.deckacts{display:flex;gap:.7rem;flex-wrap:wrap}
.deckacts a{display:inline-block;border:1.5px solid currentColor;border-radius:999px;padding:.55rem 1rem;font-family:var(--disp);font-weight:600;font-size:.82rem;text-decoration:none;line-height:1}
.deckacts a.ghost{border-color:var(--rule-2);color:var(--ink-2)}
.deckfoot{display:flex;justify-content:flex-end;line-height:0}
.adcard{background:var(--paper-2);border:1px solid var(--rule-2);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.6rem;min-height:18rem}
.adlbl{font-family:var(--disp);font-weight:600;font-size:.62rem;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.snipview .ad-deck{margin:0}
@media (max-width:62rem){.leadpkg{grid-template-columns:1fr}.grid4{grid-template-columns:repeat(2,minmax(0,1fr))}.bubbles{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:40rem){
  .grid4,.bubbles{grid-template-columns:1fr}
  .crow{grid-template-columns:3rem 9px 1fr}.crow>.meta:last-child{display:none}
  .deck{gap:0;padding:0;scroll-snap-type:y mandatory}
  .deckcard{border-radius:0;min-height:100svh;scroll-snap-align:start;padding:2.4rem 1.6rem 2.2rem}
  .has-anchor .deckcard{padding-bottom:5.2rem}
  .deckcard .q{font-size:2rem}
  .snipview .snipintro{padding-bottom:.6rem}
}
`;
