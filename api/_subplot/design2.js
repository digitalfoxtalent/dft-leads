// SUBPLOT design v2 - "retype and de-box".
//
// An OVERRIDE sheet, appended after the live stylesheet, so nothing about the current design
// is deleted while this is being judged. Structure is untouched: same masthead, nav, lead,
// threads, wire, rail. What changes is the type, the surface and the amount of chrome.
//
// The three moves, in order of how much they matter:
//   1. TYPE. Montserrat and Mulish are the loudest "mid-2010s" signal on the page. Display
//      goes to Instrument Sans, body copy to a real editorial serif (Newsreader), and the
//      typewriter mono disappears from dates and counts, where it was doing nothing but
//      making meta shout.
//   2. CHROME. Outlined boxes, 1.5px ink hairlines, 14px radii and 4px accent frames are
//      replaced by space, weight and tint. Panels lose their borders entirely.
//   3. SURFACE. Pure #FFF on near-black is harsh at article length. A warm off-white ground,
//      softer ink, and rules at low alpha instead of solid grey. Plus a dark mode.
//
// Turn on with ?d=2, off with ?d=1. The choice sticks in a cookie so navigation keeps it.

export const FONTS2 =
  "https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700" +
  "&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&display=swap";

export const CSS2 = String.raw`
/* ---------- 1. tokens ---------- */
:root{
  --paper:#FCFBF9; --paper-2:#F4F2ED; --paper-3:#EBE8E1;
  --rule:rgba(22,22,28,.10); --rule-2:rgba(22,22,28,.16);
  --ink:#16161C; --ink-2:#55555F; --ink-3:#8B8B94;
  --blue:#2218E8; --blue-ink:#1A12B8; --blue-wash:#EFEEFD;
  --disp:"Instrument Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  --body:"Newsreader",Georgia,"Times New Roman",serif;
  --mono:"Instrument Sans",ui-sans-serif,system-ui,sans-serif;
  --s--1:.85rem; --s-0:1rem; --s-1:1.2rem;
}
body{font-size:19px;line-height:1.66;letter-spacing:.002em}

/* ---------- 2. masthead and nav ---------- */
.top-in{padding-top:3.2rem;padding-bottom:1.9rem}
.wordmark{letter-spacing:-.035em;font-weight:700}

/* SUBPLOT masthead, 22 Sep 2026. The wordmark is a drawn SVG (wordmark.js), not live type:
   heavier than the 700 cut, spaced pair by pair, with the O redrawn as a squircle screen that
   takes the day's accent. Sized so the cap height matches what the type gave us: cap height is
   720 of the 752-unit viewBox, so height = --wm-size * .72 * 752/720. The rule under the word
   is the ink width of the mark, 4401 units, at the same scale. */
.brand-subplot{--wm-size:clamp(2.2rem,7.4vw,4.6rem);--wm-bar:calc(var(--wm-size) * .72 * 4401 / 720)}
.brand-subplot .wordmark-drawn{display:block;line-height:0;letter-spacing:0;color:var(--blue)}
.brand-subplot .wordmark-drawn .wm{display:block;width:auto;height:calc(var(--wm-size) * .72 * 752 / 720)}
.brand-subplot .plotline{margin:.6rem 0 1.15rem}
/* The day's accent is carried as two custom properties so the same server-rendered markup can
   serve both colour schemes; --wm-accent is what the mark and the thread under it actually read.
   On the house day (Sunday) neither is set, the word runs all in ultramarine and the thread falls
   back to Foxy Orange. */
.brand-subplot .brandblock{--wm-accent:var(--accent-lt)}
.brand-subplot .plotline::after{background:var(--wm-accent,var(--orange))}
.nav{border-top:1px solid var(--rule-2)}
.nav button,.nav a{
  font-family:var(--disp);font-weight:600;font-size:.95rem;letter-spacing:-.005em;
  text-transform:none;padding:1.1rem 1.15rem;border-bottom-width:2px;color:var(--ink-2);
}
.nav button[aria-current="true"],.nav a[aria-current="true"]{color:var(--ink);border-bottom-color:var(--ink)}

/* ---------- 3. labels: quieter, and no typewriter ---------- */
.kicker{font-weight:600;font-size:.7rem;letter-spacing:.1em;color:var(--blue)}
.rule-h{border-top:1px solid var(--ink);padding-top:.9rem;margin-top:4.4rem}
.rule-h h2{font-weight:600;font-size:.78rem;letter-spacing:.12em;color:var(--ink-2)}
.rule-h .note,.meta,.daylabel,.thread-top .count,.roster .rc,.roster .rn span,.evtx span,.wire .rt{
  font-family:var(--disp);letter-spacing:0;font-weight:500;color:var(--ink-3);
}
.meta{font-size:.78rem}
.daylabel{font-size:.74rem;letter-spacing:.08em;border-bottom:1px solid var(--rule-2);padding:.7rem 0}

/* ---------- 4. headlines ----------
   Sizes are stated outright rather than through a token, so a card headline can never fall
   back to something enormous if a variable does not resolve. Card headlines are deliberately
   close to body size: at three columns the measure is only ~340px, and anything larger wraps
   into a wall of text. */
.grid3 .headline,.card .headline{font-size:1.12rem;line-height:1.22;letter-spacing:-.018em}
@media (max-width:52rem){.grid3 .headline,.card .headline{font-size:1.08rem}}
.wire .txt h3{font-size:1.04rem;line-height:1.3;letter-spacing:-.014em}

.headline{font-weight:600;letter-spacing:-.028em;line-height:1.08}
.lead .headline{font-size:clamp(1.9rem,3.6vw,2.9rem)}
.thread-top h3{font-weight:600;letter-spacing:-.022em;font-size:1.16rem}
.takes .tk span{font-family:var(--disp);font-weight:500;letter-spacing:-.008em}
.takes .tk b{font-weight:600;font-size:.76rem}

/* ---------- 5. de-box ---------- */
.box{border:0;background:transparent}
.box h2{border-bottom:1px solid var(--ink);padding:0 0 .7rem;margin:0 0 .2rem;font-weight:600;font-size:.78rem;letter-spacing:.12em;color:var(--ink-2)}
.box .note{padding:.9rem 0;border-bottom:1px solid var(--rule)}
.roster li{padding:.6rem 0}
.evlist a{padding:1rem 0}
.thread{border-top:0;background:var(--paper-2);padding:1.6rem 1.7rem 1.7rem}
.thread .kicker{color:var(--ink-3)}
.takes .stripe{background:var(--rule-2)}
.takes li{border-top:1px solid var(--rule)}

/* ---------- 6. images: bigger, unframed ---------- */
.thumb,.lead .plate,.player,.wire .wthumb{border-radius:8px}
.thread,.box,.ad,.honest,.terms,.done,.source,.band,.step{border-radius:0}
.promo{border-radius:4px}
.joinblock{border-radius:4px}
.player{border:0}
.wire .wthumb{width:168px;border:0;border-radius:8px;margin:1.15rem 0}
@media (max-width:34rem){.wire .wthumb{width:104px}}
.card:hover .thumb img{transform:scale(1.03)}

/* ---------- 7. article ---------- */
.prose{font-size:1.16rem;line-height:1.72}
.prose h2{font-family:var(--disp);font-weight:600;font-size:1.3rem;letter-spacing:-.02em;margin:2.4em 0 .6em}
.prose h2::before{display:none}
.source{background:transparent;border-top:1px solid var(--ink);border-bottom:1px solid var(--rule);padding:1.1rem 0}
.source a{border-bottom-width:1px}

/* ---------- 8. rhythm ---------- */
.grid3{gap:2.8rem;padding:2rem 0 0}
.threads{gap:1.9rem;margin-top:1.9rem}
.cols{padding:2.6rem 0 4.2rem}

/* ---------- 9. dark ---------- */
@media (prefers-color-scheme:dark){
  :root{
    color-scheme:dark;
    --paper:#121216; --paper-2:#1A1A20; --paper-3:#23232A;
    --rule:rgba(255,255,255,.11); --rule-2:rgba(255,255,255,.19);
    --ink:#F2F1EE; --ink-2:#B4B3B0; --ink-3:#86858A;
    --blue:#8C86FF; --blue-ink:#A9A4FF; --blue-wash:#1E1D34;
  }
  .brand-subplot .brandblock{--wm-accent:var(--accent-dk)}
  .top,.nav{background:var(--paper)}
  .band{background:var(--blue-wash)}
  .band .cta{background:var(--ink);color:var(--paper)}
  .player{background:#000}
}
`;
