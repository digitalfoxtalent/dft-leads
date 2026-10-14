export const CSS = String.raw`
:root{
  color-scheme:light;
  --paper:#FFFFFF; --paper-2:#F5F5F9; --paper-3:#ECECF4;
  --rule:#E3E3EB; --rule-2:#C7C7D3;
  --ink:#0E0E16; --ink-2:#4A4A5A; --ink-3:#777787;
  --blue:#2218E8; --blue-ink:#1A12B8; --blue-wash:#ECEBFD;
  --orange:#FF8806; --orange-ink:#B25A00; --orange-wash:#FFF1E2;
  --pink:#F712AE;
  --tint:var(--blue);
  --maxw:78rem;
  --s--1:.8rem; --s-0:1rem; --s-1:1.18rem;
  --disp:"Montserrat",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  --body:"Mulish",ui-sans-serif,system-ui,sans-serif;
  --mono:"DM Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--body);font-size:17px;line-height:1.62;-webkit-font-smoothing:antialiased}
img{display:block;max-width:100%}
.wrap{max-width:var(--maxw);margin:0 auto;padding:0 clamp(1.4rem,5vw,3.5rem)}
button{font:inherit;color:inherit;background:none;border:0;padding:0;text-align:left}

/* ============ masthead ============ */
.top{background:var(--paper)}
.top-in{display:grid;grid-template-columns:1fr auto;gap:2rem;align-items:end;padding-top:2.6rem;padding-bottom:1.6rem}
.brandblock{display:block;cursor:pointer;width:100%}
.wordmark{
  font-family:var(--disp);font-weight:800;font-size:var(--wm-size,clamp(2.2rem,7.4vw,4.6rem));
  line-height:.9;letter-spacing:-.005em;text-transform:uppercase;margin:0;color:var(--blue);
}
/* the plot line and the sub-plot: main line in ultramarine, a shorter thread in orange beneath */
.plotline{display:block;position:relative;height:11px;margin:.8rem 0 .8rem}
.plotline::before{content:"";position:absolute;left:0;right:0;top:0;height:4px;background:var(--blue)}
.plotline::after{content:"";position:absolute;left:0;top:7px;width:var(--wm-bar,min(38%,15rem));height:4px;background:var(--orange);
  clip-path:polygon(0 0,100% 0,calc(100% - 4px) 100%,0 100%)}
.tagline{margin:0;color:var(--ink-2);font-size:var(--s--1);max-width:40rem}
.top-meta{display:flex;flex-direction:column;align-items:flex-end;gap:.25rem;font-family:var(--mono);font-size:.72rem;color:var(--ink-3);white-space:nowrap}
.top-meta b{color:var(--ink-2);font-weight:500}
.nav{border-top:1px solid var(--ink);border-bottom:1px solid var(--rule);background:var(--paper);position:sticky;top:0;z-index:5}
.nav-in{display:flex;overflow-x:auto;scrollbar-width:none}
.nav-in::-webkit-scrollbar{display:none}
.nav button{cursor:pointer;white-space:nowrap;font-family:var(--disp);font-weight:700;font-size:.74rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-2);padding:1.05rem 1.2rem;border-bottom:3px solid transparent;margin-bottom:-1px;transition:color .15s,border-color .15s}
.nav button:hover{color:var(--blue)}
.nav button[aria-current="true"]{color:var(--blue);border-bottom-color:var(--blue)}

/* ============ shared ============ */
.kicker{font-family:var(--disp);font-weight:700;font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;color:var(--blue);display:inline-block}
.rule-h{display:flex;align-items:baseline;justify-content:space-between;gap:1rem;border-top:2px solid var(--ink);padding-top:.8rem;margin-top:3.6rem}
.rule-h h2{font-family:var(--disp);font-weight:800;font-size:.84rem;letter-spacing:.13em;text-transform:uppercase;margin:0}
.rule-h .note{font-family:var(--mono);font-size:.72rem;color:var(--ink-3)}
.headline{font-family:var(--disp);font-weight:700;letter-spacing:-.022em;line-height:1.12;text-wrap:balance;margin:0;color:var(--ink)}
.dek{color:var(--ink-2);margin:0}
.meta{font-family:var(--mono);font-size:.72rem;color:var(--ink-3);font-variant-numeric:tabular-nums}
.who{font-size:var(--s--1);color:var(--ink-2)}
.who b{color:var(--ink);font-weight:700}
.thumb{display:block;position:relative;overflow:hidden;background:var(--paper-3);aspect-ratio:16/9}
.thumb img{width:100%;height:100%;object-fit:cover;transition:transform .55s cubic-bezier(.2,.7,.3,1)}
.card:hover .thumb img{transform:scale(1.045)}
.card:hover .headline{color:var(--blue)}
.card{cursor:pointer;display:flex;flex-direction:column;gap:.7rem}

/* ============ lead ============ */
.lead{padding:2.6rem 0 0;cursor:pointer;display:block;width:100%}
.lead .plate{display:block;aspect-ratio:24/9;position:relative;overflow:hidden;background:var(--paper-3)}
.lead .plate img{width:100%;height:100%;object-fit:cover;object-position:50% 32%}

.leadgrid{display:grid;grid-template-columns:1.5fr 1fr;gap:1.6rem clamp(2rem,5vw,4rem);padding:1.8rem 0 .6rem;align-items:end}
.lead .headline{font-size:clamp(1.7rem,3.2vw,2.5rem);display:block}
.lead:hover .headline{color:var(--blue)}
.leadside{display:flex;flex-direction:column;gap:.7rem;padding-bottom:.35rem}
.lead .dek{font-size:1.02rem}
.leadmeta{display:flex;flex-wrap:wrap;gap:.3rem .9rem;align-items:baseline;padding-top:.6rem;border-top:1px solid var(--rule)}

/* ============ threads ============ */
.threads{display:grid;grid-template-columns:repeat(auto-fit,minmax(17rem,1fr));gap:1.6rem;margin-top:1.6rem}
.thread{background:var(--paper-2);padding:1.5rem 1.6rem 1.6rem;display:flex;flex-direction:column;gap:.7rem;border-top:3px solid var(--pink)}
.thread-top{display:flex;flex-direction:column;gap:.3rem}
.thread-top h3{font-family:var(--disp);font-weight:800;font-size:1.12rem;letter-spacing:-.015em;margin:0;line-height:1.15}
.thread-top .count{font-family:var(--mono);font-size:.7rem;color:var(--ink-3)}
.thread .kicker{color:#C2087F}
.takes{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.takes li{border-top:1px solid var(--rule-2)}
.takes button{display:grid;width:100%;grid-template-columns:2px 1fr;gap:0 .7rem;cursor:pointer;align-items:stretch}
.takes .stripe{background:var(--pink)}
.takes .tk{padding:.75rem 0;display:flex;flex-direction:column;gap:.12rem;min-width:0}
.takes .tk b{font-size:.78rem;color:var(--blue);font-weight:700}
.takes .tk span{font-family:var(--disp);font-weight:600;font-size:.88rem;line-height:1.3;color:var(--ink);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.takes button:hover .tk span{color:var(--blue)}

/* ============ 3-up ============ */
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:2.2rem;padding:1.6rem 0 0}
@media (max-width:52rem){.grid3{grid-template-columns:repeat(2,1fr)}}
@media (max-width:34rem){.grid3{grid-template-columns:1fr}}
.grid3 .headline{font-size:var(--s-1)}

/* ============ wire + rail ============ */
.cols{display:grid;grid-template-columns:1fr 19rem;gap:clamp(2.5rem,6vw,5rem);padding:2.2rem 0 3.5rem;align-items:start}
.daygroup{margin:0 0 2.2rem}
.daylabel{font-family:var(--mono);font-size:.7rem;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3);padding:.6rem 0;border-bottom:1px solid var(--ink)}
.wire{list-style:none;margin:0;padding:0}
.wire li{border-bottom:1px solid var(--rule)}
.wire button{width:100%;display:grid;grid-template-columns:1fr auto;gap:0 1rem;align-items:stretch;cursor:pointer;transition:background .15s}
.wire button:hover{background:var(--paper-2)}
.wire .stripe{display:none}
.wire .txt{padding:1.05rem 0;display:flex;flex-direction:column;gap:.25rem;min-width:0}
.wire .txt h3{font-family:var(--disp);font-weight:600;font-size:.98rem;line-height:1.3;margin:0;letter-spacing:-.012em}
.wire button:hover .txt h3{color:var(--blue)}
.wire .sub{font-size:.78rem;color:var(--ink-3);display:flex;flex-wrap:wrap;gap:.2rem .6rem}
.wire .sub b{color:var(--ink-2);font-weight:700}
.wire .sub span{color:var(--blue-ink);font-weight:600}
.wire .rt{padding:1.1rem 0 0;font-family:var(--mono);font-size:.7rem;color:var(--ink-3);font-variant-numeric:tabular-nums;white-space:nowrap}

.rail{display:flex;flex-direction:column;gap:2rem}
.box{border:1px solid var(--rule-2);background:var(--paper)}
.box h2{font-family:var(--disp);font-weight:800;font-size:.74rem;letter-spacing:.13em;text-transform:uppercase;margin:0;padding:1rem 1.3rem;border-bottom:1px solid var(--rule-2);color:var(--ink)}
.box .note{padding:1rem 1.3rem;font-size:var(--s--1);color:var(--ink-2);margin:0;line-height:1.5;border-bottom:1px solid var(--rule)}
.roster{list-style:none;margin:0;padding:0}
.roster li{display:flex;align-items:center;gap:.7rem;padding:.55rem 1.3rem;border-bottom:1px solid var(--rule)}
.roster li:last-child{border-bottom:0}
.mono{width:24px;height:24px;flex:none;display:grid;place-items:center;background:var(--blue-wash);color:var(--blue);font-family:var(--mono);font-size:.62rem}
.roster .rn{flex:1;min-width:0;font-size:.85rem;line-height:1.2}
.roster .rn span{display:block;color:var(--ink-3);font-size:.7rem;font-family:var(--mono)}
.roster .rc{font-family:var(--mono);font-size:.7rem;color:var(--ink-3);font-variant-numeric:tabular-nums}
.stdlist{list-style:none;margin:0;padding:.5rem 0}
.stdlist li{padding:.45rem 1.3rem;font-size:var(--s--1);color:var(--ink-2);display:flex;gap:.55rem;line-height:1.45}
.stdlist li::before{content:"";width:5px;height:5px;background:var(--orange);margin-top:.55rem;flex:none}

/* ============ article ============ */
.artview{display:none;padding-bottom:4rem}
body[data-view="article"] .artview{display:block}
body[data-view="article"] .homeview{display:none}
.artrule{height:4px;background:var(--blue)}
.back{cursor:pointer;color:var(--ink-2);font-size:var(--s--1);padding:1.6rem 0 .2rem;display:inline-block}
.back:hover{color:var(--blue)}
.artmain{max-width:43rem;margin:0 auto;padding-top:1.4rem}
.artmain .headline{font-size:clamp(1.85rem,3.6vw,2.6rem);margin:.5rem 0 0}
.artmain .dek{font-size:1.12rem;margin:.85rem 0 0}
.authorbar{display:flex;align-items:center;gap:1rem;margin:2rem 0;padding:1.1rem 0;border-top:1px solid var(--ink);border-bottom:1px solid var(--rule);flex-wrap:wrap}
.authorbar .mono{width:36px;height:36px;font-size:.78rem}
.authorbar .nm{flex:1;min-width:9rem;line-height:1.3}
.authorbar .nm b{display:block;font-size:.97rem}
.authorbar .nm span{font-family:var(--mono);font-size:.72rem;color:var(--ink-3)}
.prose{font-size:1.07rem;line-height:1.76}
.prose p{margin:0 0 1.15em}
.prose h2{font-family:var(--disp);font-weight:700;font-size:1.22rem;line-height:1.26;letter-spacing:-.018em;margin:2.1em 0 .65em;text-wrap:balance}
.prose h2::before{content:"";display:block;width:26px;height:4px;background:var(--orange);margin-bottom:.55rem;clip-path:polygon(0 0,100% 0,calc(100% - 4px) 100%,0 100%)}
.source{display:flex;gap:1rem;align-items:center;flex-wrap:wrap;background:var(--blue-wash);padding:1.2rem 1.4rem;margin:2.8rem 0 1.4rem}
.source .lbl{font-family:var(--disp);font-weight:700;font-size:.66rem;letter-spacing:.14em;text-transform:uppercase;color:var(--blue-ink)}
.source a{color:var(--blue);font-weight:700;text-decoration:none;border-bottom:1.5px solid currentColor}
.disclose,.ai-disclosure{border-left:3px solid var(--orange);padding:.15rem 0 .15rem 1rem;color:var(--ink-3);font-size:var(--s--1);margin:1.1rem 0 0;line-height:1.55}
.tags{display:flex;flex-wrap:wrap;gap:.4rem;margin:1.7rem 0 0}
.tags span{font-family:var(--mono);font-size:.68rem;color:var(--ink-2);background:var(--paper-2);padding:.22rem .5rem}

/* ============ join ============ */
.joinview{display:none;padding-bottom:4rem}
body[data-view="join"] .joinview{display:block}
body[data-view="join"] .homeview{display:none}
.joinhero{display:grid;grid-template-columns:1.2fr 1fr;gap:clamp(2rem,6vw,5rem);padding:3.4rem 0 3rem;border-bottom:1px solid var(--ink);align-items:end}
.joinhero h1{font-family:var(--disp);font-weight:800;font-size:clamp(2rem,4.6vw,3.4rem);letter-spacing:-.03em;line-height:1.02;margin:.5rem 0 0;text-wrap:balance}
.joinhero h1 em{font-style:normal;color:var(--blue)}
.joinhero p{margin:0;font-size:1.08rem;color:var(--ink-2);max-width:32rem}
.joinhero .cta{display:inline-block;margin-top:1rem;background:var(--blue);color:#fff;font-family:var(--disp);font-weight:700;font-size:.82rem;letter-spacing:.08em;text-transform:uppercase;padding:.85rem 1.3rem;cursor:pointer}
.joinhero .cta:hover{background:var(--blue-ink)}
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:0;margin-top:1.4rem;border-left:1px solid var(--rule-2)}
.step{padding:1.6rem 1.8rem 1.8rem 1.6rem;border-right:1px solid var(--rule-2);display:flex;flex-direction:column;gap:.5rem}
.step .n{font-family:var(--mono);font-size:.72rem;color:var(--orange-ink)}
.step h3{font-family:var(--disp);font-weight:800;font-size:1.15rem;letter-spacing:-.015em;margin:0;line-height:1.2}
.step p{margin:0;color:var(--ink-2);font-size:.95rem}
.twocol{display:grid;grid-template-columns:1fr 1fr;gap:clamp(2rem,5vw,4rem);margin-top:2.6rem}
.twocol h3{font-family:var(--disp);font-weight:800;font-size:.8rem;letter-spacing:.13em;text-transform:uppercase;margin:0 0 .7rem}
.twocol ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.55rem}
.twocol li{padding-left:1rem;position:relative;color:var(--ink-2);line-height:1.5}
.twocol li::before{content:"";position:absolute;left:0;top:.62em;width:6px;height:6px;background:var(--orange)}
.twocol li b{color:var(--ink);font-weight:700}
.honest{margin-top:3rem;background:var(--blue-wash);padding:1.9rem 2.2rem;display:grid;grid-template-columns:auto 1fr;gap:1.2rem;align-items:start}
.honest .lbl{font-family:var(--disp);font-weight:800;font-size:.72rem;letter-spacing:.13em;text-transform:uppercase;color:var(--blue-ink);padding-top:.25rem;white-space:nowrap}
.honest p{margin:0 0 .6rem;color:var(--ink);max-width:44rem}
.honest p:last-child{margin:0}
.apply{margin-top:3.6rem;display:grid;grid-template-columns:1fr 1.2fr;gap:clamp(2rem,5vw,4rem);border-top:2px solid var(--ink);padding-top:2.2rem}
.apply h2{font-family:var(--disp);font-weight:800;font-size:1.5rem;letter-spacing:-.02em;margin:0 0 .5rem;line-height:1.1}
.apply .aside p{color:var(--ink-2);margin:0 0 .8rem;font-size:.97rem}
.form{display:flex;flex-direction:column;gap:1.2rem}
.field{display:flex;flex-direction:column;gap:.3rem}
.field label{font-family:var(--disp);font-weight:700;font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-2)}
.field label small{font-family:var(--body);font-weight:400;text-transform:none;letter-spacing:0;color:var(--ink-3)}
.field input,.field select{font:inherit;color:var(--ink);background:var(--paper);border:1px solid var(--rule-2);padding:.8rem 1rem;border-radius:0;width:100%}
.field input:focus,.field select:focus{outline:2px solid var(--blue);outline-offset:1px;border-color:var(--blue)}
.field .handle{display:grid;grid-template-columns:auto 1fr}
.field .handle span{border:1px solid var(--rule-2);border-right:0;background:var(--paper-2);padding:.8rem .9rem;font-family:var(--mono);font-size:.85rem;color:var(--ink-3)}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:.9rem}
.terms{display:grid;grid-template-columns:auto 1fr;gap:1rem;align-items:start;background:var(--orange-wash);border-left:3px solid var(--orange);padding:.9rem 1.1rem}
.terms .lbl{font-family:var(--disp);font-weight:800;font-size:.66rem;letter-spacing:.13em;text-transform:uppercase;color:var(--orange-ink);padding-top:.2rem;white-space:nowrap}
.terms p{margin:0;font-size:.9rem;color:var(--ink-2);line-height:1.55}
.terms b{color:var(--ink)}
.consent b{color:var(--ink);font-weight:700}
.consent{display:grid;grid-template-columns:auto 1fr;gap:.6rem;align-items:start;font-size:.88rem;color:var(--ink-2);line-height:1.5}
.consent input{margin-top:.3rem;accent-color:var(--blue)}
.submit{background:var(--blue);color:#fff;font-family:var(--disp);font-weight:700;font-size:.82rem;letter-spacing:.08em;text-transform:uppercase;padding:.9rem 1.3rem;cursor:pointer;align-self:flex-start}
.submit:hover{background:var(--blue-ink)}
.submit[disabled]{opacity:.5;cursor:default}
.formnote{font-size:.8rem;color:var(--ink-3);margin:0}
.done{background:var(--orange-wash);border-left:4px solid var(--orange);padding:1rem 1.2rem}
.done b{display:block;font-family:var(--disp);font-weight:800;font-size:1.05rem;margin-bottom:.3rem}
.done p{margin:0;color:var(--ink-2)}
.band{margin:0 0 3rem;background:var(--blue);color:#fff;padding:2.4rem clamp(1.6rem,4vw,3rem);display:grid;grid-template-columns:1fr auto;gap:1.5rem;align-items:center}
.band h2{font-family:var(--disp);font-weight:800;font-size:clamp(1.3rem,2.6vw,1.9rem);letter-spacing:-.025em;margin:0;line-height:1.1}
.band p{margin:.4rem 0 0;color:#D9D7FF;max-width:40rem;font-size:.97rem}
.band .cta{background:#fff;color:var(--blue);font-family:var(--disp);font-weight:700;font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;padding:.85rem 1.2rem;cursor:pointer;white-space:nowrap}
.band .cta:hover{background:var(--orange);color:#fff}
.nav .join{margin-left:auto;color:var(--orange-ink)}
.nav .join:hover{color:var(--orange-ink);border-bottom-color:var(--orange)}
.top-meta .joinlink{color:var(--blue);font-weight:500;cursor:pointer;font-family:var(--disp);font-size:.74rem;letter-spacing:.06em;text-transform:uppercase}
.top-meta .joinlink:hover{color:var(--orange-ink)}
.foot .legal{font-family:var(--mono);font-size:.68rem;color:var(--ink-3)}
.foot .legal a{color:inherit;text-decoration:none}.foot .legal a:hover{color:var(--blue)}
@media (max-width:52rem){.joinhero,.twocol,.apply,.band,.honest,.row2{grid-template-columns:1fr}.steps{grid-template-columns:1fr}}

/* ============ video ============ */
.player{position:relative;aspect-ratio:16/9;background:#000;margin:0 0 1.6rem;overflow:hidden;border:4px solid var(--orange)}
.player img{width:100%;height:100%;object-fit:cover;opacity:.92}
.player iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.player .play{position:absolute;inset:0;display:grid;place-items:center;cursor:pointer;background:linear-gradient(to top,rgba(0,0,0,.45),rgba(0,0,0,0) 45%)}
.player .play::before{content:"";width:74px;height:52px;background:var(--orange);clip-path:polygon(0 0,100% 0,100% 100%,0 100%);border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.35);transition:background .15s,transform .15s}
.player .play::after{content:"";position:absolute;width:0;height:0;border-style:solid;border-width:11px 0 11px 20px;border-color:transparent transparent transparent #fff;margin-left:4px}
.player .play:hover::before{background:var(--blue);transform:scale(1.06)}
.player .cap{position:absolute;left:0;right:0;bottom:0;padding:.7rem 1rem;color:#fff;font-family:var(--disp);font-weight:700;font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;display:flex;justify-content:space-between;gap:1rem;pointer-events:none}
.player .cap span:last-child{font-family:var(--mono);font-weight:400;letter-spacing:.02em;text-transform:none;opacity:.85}

/* ============ footer ============ */
.foot{border-top:1px solid var(--ink);background:var(--paper-2)}
.foot-in{display:grid;grid-template-columns:repeat(auto-fit,minmax(12rem,1fr));gap:2.2rem;padding-top:3rem;padding-bottom:3.2rem}
.foot h3{font-family:var(--disp);font-weight:800;font-size:.68rem;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-3);margin:0 0 .5rem}
.foot p,.foot li{font-size:var(--s--1);color:var(--ink-2);margin:0 0 .35rem;line-height:1.55}
.foot ul{list-style:none;margin:0;padding:0}
.fm{font-family:var(--disp);font-weight:800;font-size:1.3rem;color:var(--blue);text-transform:uppercase;letter-spacing:-.01em}
.protolabel{background:var(--paper-3);border-top:1px solid var(--rule-2);color:var(--ink-3);font-family:var(--mono);font-size:.68rem;padding:.9rem 0}
button:focus-visible,a:focus-visible{outline:2px solid var(--orange);outline-offset:3px}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
@media (max-width:62rem){.leadgrid{grid-template-columns:1fr}.cols{grid-template-columns:1fr}.lead .plate{aspect-ratio:16/9}}
@media (max-width:34rem){.wire button{grid-template-columns:1fr}.wire .rt{display:none}.top-in{grid-template-columns:1fr}.top-meta{align-items:flex-start}}
`;

// ---------------------------------------------------------------------------
// Platform layout. Emitted only for a brand with layout:"grid" (Wordie), on top
// of CSS above. Image-led and creator-forward, but every headline lands in full
// with a standfirst under it - it is an article site, not a video site.
export const GRID_CSS = String.raw`
body.grid{background:#fff}
body.grid .wrap{max-width:none;padding:0}
/* top bar */
.pbar{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.94);backdrop-filter:blur(8px);border-bottom:1px solid var(--rule)}
.pbar-in{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:clamp(1rem,3vw,2.2rem);padding:.9rem clamp(1.1rem,3vw,2rem);max-width:96rem;margin:0 auto}
.plogo{display:flex;align-items:center;gap:.55rem;text-decoration:none}
.plogo b{font-family:var(--disp);font-weight:800;font-size:1.5rem;letter-spacing:-.024em;color:var(--ink)}
.plogo b i{font-style:normal;color:var(--tint)}
.psearch{max-width:34rem;width:100%;justify-self:center;display:flex;border:1px solid var(--rule);border-radius:999px;background:var(--paper-2);overflow:hidden}
.psearch input{border:0;background:none;padding:.68rem 1.25rem;font:inherit;font-size:.9rem;width:100%;outline:none;color:var(--ink)}
.pjoin{display:flex;align-items:center;gap:.55rem;border:1px solid var(--rule);border-radius:999px;padding:.55rem 1.05rem;font-family:var(--disp);font-weight:700;font-size:.85rem;white-space:nowrap;background:#fff;color:var(--ink);text-decoration:none}
.pjoin:hover{background:var(--paper-2)}
/* shell */
.pshell{display:grid;grid-template-columns:14.75rem 1fr;max-width:96rem;margin:0 auto}
.prail{padding:1.6rem .85rem;border-right:1px solid var(--rule)}
.pnav{display:flex;align-items:center;gap:.9rem;padding:.62rem .8rem;border-radius:11px;text-decoration:none;color:var(--ink);font-size:.9rem}
.pnav:hover{background:var(--paper-2)}
.pnav[aria-current]{background:var(--blue-wash);font-weight:700;color:var(--blue-ink)}
.prail h4{font-family:var(--disp);font-size:.66rem;letter-spacing:.11em;text-transform:uppercase;color:var(--ink-3);margin:1.85rem .8rem .6rem}
.pfol{display:flex;align-items:center;gap:.65rem;padding:.4rem .8rem;font-size:.86rem;text-decoration:none;color:var(--ink);border-radius:9px}
.pfol:hover{background:var(--paper-2)}
.pfol img,.pfol span.mono{width:26px;height:26px;border-radius:50%;flex:none;object-fit:cover}
.pcta{margin:1.8rem .7rem 0;border:1px solid var(--rule);border-radius:16px;padding:1.05rem 1rem;background:#FBFDFC}
.pcta b{display:block;font-family:var(--disp);font-size:.92rem;margin-bottom:.35rem}
.pcta p{margin:0 0 .8rem;font-size:.82rem;line-height:1.55;color:var(--ink-2)}
.pcta a{display:block;text-align:center;background:var(--tint);color:#fff;font-family:var(--disp);font-weight:700;font-size:.78rem;padding:.62rem .4rem;border-radius:999px;text-decoration:none;white-space:nowrap}
.pmain{padding:0 clamp(1.1rem,2.6vw,2.5rem) 4.5rem;min-width:0}
/* byline: creator on every single item, two deliberate lines */
.pby{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:.1rem .55rem;font-size:.82rem;color:var(--ink-3);text-decoration:none}
.pby img,.pby .ini{width:30px;height:30px;border-radius:50%;grid-row:span 2;object-fit:cover}
.pby .ini{display:grid;place-items:center;background:var(--blue-wash);color:var(--blue);font-family:var(--mono);font-size:.62rem}
.pby .who{display:flex;align-items:baseline;gap:.38rem;min-width:0}
.pby .cn{color:var(--ink);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pby .hd{color:var(--ink-3);font-size:.78rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pby .mt{font-size:.78rem;color:var(--ink-3)}
/* hero */
.phero{display:grid;grid-template-columns:1.42fr .58fr;gap:1.4rem;padding:1.9rem 0 0}
.pbig{position:relative;border-radius:16px;overflow:hidden;aspect-ratio:16/10;text-decoration:none;display:block;background:var(--paper-2)}
.pbig>img{width:100%;height:100%;object-fit:cover}
.pbig::after{content:"";position:absolute;inset:0;background:linear-gradient(to top,rgba(8,8,14,.94) 0%,rgba(8,8,14,.78) 26%,rgba(8,8,14,.5) 52%,rgba(8,8,14,.26) 74%,rgba(8,8,14,.1) 90%,rgba(8,8,14,0) 100%)}
.pbigtxt{display:block;position:absolute;left:0;right:0;bottom:0;padding:1.7rem 1.9rem;color:#fff;z-index:2}
.pkick{display:inline-block;font-family:var(--disp);font-size:.64rem;font-weight:800;letter-spacing:.13em;text-transform:uppercase;background:var(--tint);color:#fff;padding:.3rem .6rem;border-radius:6px;margin-bottom:.8rem}
.pbigtxt h2{font-family:var(--disp);font-size:clamp(1.5rem,2.4vw,2.05rem);line-height:1.13;letter-spacing:-.028em;margin:0 0 .6rem;font-weight:800;max-width:22em;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.pbigtxt .pstand{font-size:.95rem;line-height:1.55;color:rgba(255,255,255,.86);margin:0 0 .9rem;max-width:40em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pbigtxt .pby .cn{color:#fff}
.pbigtxt .pby .hd,.pbigtxt .pby .mt{color:rgba(255,255,255,.68)}
.psubs{display:grid;gap:1.15rem;align-content:start}
.psub{display:grid;gap:.65rem;text-decoration:none;color:inherit}
.psub>span:last-child{display:block}
.psubimg{display:block;border-radius:13px;overflow:hidden;aspect-ratio:16/9;background:var(--paper-2)}
.psubimg>img{width:100%;height:100%;object-fit:cover}
.psub h3{font-family:var(--disp);font-size:1rem;line-height:1.3;letter-spacing:-.015em;margin:0 0 .45rem;font-weight:700}
/* section heads */
.psech{display:flex;align-items:baseline;justify-content:space-between;padding:2.7rem 0 1.1rem}
.psech h2{font-family:var(--disp);font-size:1.28rem;letter-spacing:-.022em;margin:0}
.psech a{font-size:.85rem;color:var(--tint);font-weight:700;text-decoration:none}
/* card grid */
.pgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:2.1rem 1.6rem}
.pcard{text-decoration:none;color:inherit;display:block}
.pci{display:block;border-radius:14px;overflow:hidden;aspect-ratio:16/9;margin-bottom:.8rem;background:var(--paper-2)}
.pci>img{width:100%;height:100%;object-fit:cover}
.pcard h3{font-family:var(--disp);font-size:1.06rem;line-height:1.3;letter-spacing:-.018em;margin:0 0 .45rem;font-weight:700}
.pcard .pstand{font-size:.86rem;line-height:1.55;color:var(--ink-2);margin:0 0 .7rem}
/* creators strip */
.pcrs{display:grid;grid-template-columns:repeat(5,1fr);gap:1.1rem}
.pcr{border:1px solid var(--rule);border-radius:16px;padding:1.35rem 1rem;text-align:center;display:grid;justify-items:center;gap:.15rem;text-decoration:none;color:inherit}
.pcr:hover{border-color:var(--rule-2)}
.pcr img,.pcr .ini{width:58px;height:58px;border-radius:50%;margin-bottom:.5rem;object-fit:cover}
.pcr .ini{display:grid;place-items:center;background:var(--blue-wash);color:var(--blue);font-family:var(--mono);font-size:.85rem}
.pcr b{font-family:var(--disp);font-size:.9rem;letter-spacing:-.01em}
.pcr .hd{font-size:.78rem;color:var(--ink-3)}
.pcr .crm{font-size:.75rem;color:var(--ink-3);margin-top:.15rem}
.pcr .fl{margin-top:.8rem;background:var(--ink);color:#fff;font-family:var(--disp);font-size:.78rem;font-weight:700;padding:.45rem 1.25rem;border-radius:999px}
/* footer */
.pfoot{border-top:1px solid var(--rule);padding:2rem clamp(1.1rem,3vw,2rem);max-width:96rem;margin:0 auto;display:flex;flex-wrap:wrap;gap:1rem;justify-content:space-between;font-size:.82rem;color:var(--ink-3)}
.pfoot a{color:var(--ink-2);text-decoration:none;margin-left:1.1rem}
/* launch state - the front page before the first article exists */
.plaunch{max-width:62rem;padding:clamp(3rem,8vw,6rem) 0 4rem}
.plaunch .pkick{margin-bottom:1.4rem}
.plaunch h1{font-family:var(--disp);font-size:clamp(1.95rem,4.4vw,3.15rem);line-height:1.1;letter-spacing:-.032em;font-weight:800;margin:0 0 1.3rem;max-width:17em}
.plead{font-size:clamp(1rem,1.5vw,1.14rem);line-height:1.65;color:var(--ink-2);margin:0 0 2.3rem;max-width:44em}
.plaunch-cta{display:flex;flex-wrap:wrap;gap:.85rem;margin-bottom:3.4rem}
.pbtn{background:var(--tint);color:#fff;font-family:var(--disp);font-weight:700;font-size:.92rem;padding:.85rem 1.8rem;border-radius:999px;text-decoration:none}
.pbtn:hover{background:var(--blue-ink)}
.pbtn-2{border:1px solid var(--rule-2);color:var(--ink);font-family:var(--disp);font-weight:700;font-size:.92rem;padding:.85rem 1.6rem;border-radius:999px;text-decoration:none}
.pbtn-2:hover{background:var(--paper-2)}
.pproof{list-style:none;margin:0 0 3.6rem;padding:2rem 0 0;border-top:1px solid var(--rule);display:grid;grid-template-columns:repeat(3,1fr);gap:1.9rem}
.pproof li{display:grid;gap:.4rem;align-content:start}
.pproof b{font-family:var(--disp);font-size:1.5rem;letter-spacing:-.024em;color:var(--tint)}
.pproof span{font-size:.9rem;line-height:1.55;color:var(--ink-2)}
.pscope{border-top:1px solid var(--rule);padding-top:2rem}
.pscope h2{font-family:var(--disp);font-size:1.16rem;letter-spacing:-.02em;margin:0 0 .7rem}
.pscope .pstand{font-size:.95rem;line-height:1.6;color:var(--ink-2);margin:0 0 1.4rem;max-width:46em}
.pchips{display:flex;flex-wrap:wrap;gap:.55rem}
.pchips span{border:1px solid var(--rule);border-radius:999px;padding:.42rem 1rem;font-size:.85rem;color:var(--ink-2)}
@media(max-width:720px){ .pproof{grid-template-columns:1fr;gap:1.4rem} }
/* editorial ornaments that read as a mistake once the platform chrome is around them */
body.grid .joinhero{border-bottom:0}
@media(max-width:1080px){ .pshell{grid-template-columns:1fr} .prail{display:none} .pgrid{grid-template-columns:repeat(2,1fr)} .phero{grid-template-columns:1fr} .pcrs{grid-template-columns:repeat(2,1fr)} }
@media(max-width:640px){ .pgrid{grid-template-columns:1fr} .psearch{display:none} }
`;

