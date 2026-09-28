// House promo for the article rail: recruit SubPlotters where a reader is already reading one.
//
// Three variants, each arguing a different reason to join. Which one a reader sees is picked
// in the BROWSER, not on the server: pages are CDN-cached, so a server-side choice would hand
// the same variant to everyone who hit the same cached copy and the comparison would be junk.
//
// Measurement, in order of how much it is worth:
//   1. CONVERSIONS. The link carries ?v=<variant>, the application form keeps it in a hidden
//      field, and it lands on the monday row. That is the number that matters: applications
//      per variant, not clicks.
//   2. Views and clicks go to Vercel Web Analytics as custom events if the plan exposes them.
//      Written so that it is a no-op when it does not, and never breaks the page.

import { ch } from "./cast.js";

export const PROMO = [
  {
    id: "money",
    kicker: "Write for SUBPLOT",
    head: "Your videos are already articles. They just haven't been written yet.",
    line: "We turn them into pieces under your name, and you keep 60% of what they earn.",
    cta: "See the terms",
    face: "subplot", wash: "#EFEEFD", edge: "#2218E8",
  },
  {
    id: "readers",
    kicker: "Write for SUBPLOT",
    head: "Some of your audience would rather read than watch.",
    line: "Same take, in writing, linked back to the video. An audience on top of your views.",
    cta: "How it works",
    face: "lorekeeper", wash: "#F1F0EC", edge: "#0E0E16",
  },
  {
    id: "yours",
    kicker: "Write for SUBPLOT",
    head: "Under your name. Non-exclusive. Leave whenever you like.",
    line: "No minimum term, and every article links to the video it came from.",
    cta: "Apply in a minute",
    face: "critic", wash: "#FFF1E2", edge: "#FF8806",
  },
];

export const promoCss = String.raw`
.promo{position:relative;display:block;overflow:hidden;text-decoration:none;color:inherit;
  border-radius:12px;padding:1.15rem 1.2rem 1.25rem;background:var(--pwash,var(--paper-2));
  border-top:3px solid var(--pedge,var(--blue));transition:transform .18s ease}
.promo:hover{transform:translateY(-2px)}
.promo .pfig{position:absolute;right:-14px;bottom:-18px;width:96px;opacity:.95;pointer-events:none}
.promo .pfig svg{width:96px;height:auto;display:block}
.promo .pk{position:relative;font-family:var(--disp);font-weight:700;font-size:.62rem;letter-spacing:.15em;text-transform:uppercase;color:var(--pedge,var(--blue))}
.promo h3{position:relative;font-family:var(--disp);font-weight:700;font-size:1.04rem;line-height:1.2;letter-spacing:-.02em;margin:.5rem 0 .4rem;max-width:80%}
.promo p{position:relative;margin:0;font-size:.84rem;line-height:1.5;color:var(--ink-2);max-width:74%}
.promo .pc{position:relative;display:inline-block;margin-top:.85rem;font-family:var(--disp);font-weight:700;font-size:.78rem;color:var(--pedge,var(--blue))}
.promo:hover .pc{text-decoration:underline}
.promo[hidden]{display:none}
.joinblock{position:relative;overflow:hidden;margin:3.4rem 0 1rem;padding:2rem 2.2rem 2.1rem;background:var(--blue-wash);border-top:3px solid var(--blue);border-radius:12px;display:grid;grid-template-columns:1fr auto;gap:1.5rem;align-items:end}
.joinblock .jtx{max-width:44rem}
.joinblock h2{font-family:var(--disp);font-weight:700;font-size:clamp(1.2rem,2.2vw,1.6rem);line-height:1.16;letter-spacing:-.022em;margin:.5rem 0 .5rem}
.joinblock p{margin:0;color:var(--ink-2);font-size:.95rem;line-height:1.6}
.joinblock .jcta{display:inline-block;margin-top:1.1rem;font-family:var(--disp);font-weight:700;font-size:.84rem;color:#fff;background:var(--blue);padding:.75rem 1.1rem;border-radius:8px;text-decoration:none}
.joinblock .jcta:hover{background:var(--ink)}
.joinblock .jfig{align-self:end;margin-bottom:-1.4rem}
.joinblock .jfig svg{width:128px;height:auto;display:block}
@media (max-width:44rem){.joinblock{grid-template-columns:1fr;padding:1.6rem 1.4rem}.joinblock .jfig{display:none}}
@media (prefers-color-scheme:dark){.promo{background:var(--paper-2)}.promo p{color:var(--ink-2)}}
`;

// All three are rendered; the browser reveals one. No layout shift: they are display:none
// until chosen, and the rail has no fixed height.
export function promoRail(base) {
  const cards = PROMO.map(v => `
  <a class="promo" data-v="${v.id}" hidden href="${base}/join?v=${v.id}"
     style="--pwash:${v.wash};--pedge:${v.edge}">
    <span class="pfig" aria-hidden="true">${ch(v.face, 96)}</span>
    <span class="pk">${v.kicker}</span>
    <h3>${v.head}</h3>
    <p>${v.line}</p>
    <span class="pc">${v.cta} &rarr;</span>
  </a>`).join("");
  return `<div class="promowrap">${cards}<script>(function(){
  var els=document.querySelectorAll('.promowrap .promo');
  if(!els.length)return;
  var pick=els[Math.floor(Math.random()*els.length)];
  pick.hidden=false;
  var id=pick.getAttribute('data-v');
  function ev(n){try{if(window.va)window.va('event',{name:n,data:{variant:id}});}catch(e){}}
  ev('subplotter_promo_view');
  pick.addEventListener('click',function(){ev('subplotter_promo_click');});
})();</script></div>`;
}

// The wide version, for the foot of an article. Someone who has just finished reading a
// creator's piece is the warmest audience this site has for the pitch, so it gets more room
// than the rail card and states the deal outright rather than teasing it.
export function joinBlock(base) {
  return `
  <section class="joinblock">
    <span class="jfig" aria-hidden="true">${ch("subplot", 128)}</span>
    <div class="jtx">
      <span class="pk">Write for SUBPLOT</span>
      <h2>Make videos? Your next one could be an article here.</h2>
      <p>We turn your videos into articles under your name, linked back to the original. You keep 60% of what they earn, non-exclusive, and you can leave whenever you like.</p>
      <a class="jcta" href="${base}/join?v=footer">Become a SubPlotter &rarr;</a>
    </div>
  </section>`;
}
