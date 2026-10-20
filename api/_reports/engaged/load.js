// Engaged views: every roster creator connected through Channel Connect, one panel each.
// reports.digitalfoxtalent.com/engaged (Tom, 14 Oct 2026). READ ONLY.
//
// WHY. Since YouTube's 24 Aug 2026 change, brands and agencies price on Engaged Views rather
// than public views (MatchUp for Wargaming was the first to ask). Channel Connect already holds
// each creator's read-only YouTube Analytics access, so this report lists every creator, and a
// click on one opens their latest 12 long-form videos with engaged and public views.
//
// SOURCES
//   monday     Creator YouTube Access (18432126799): who is connected (Status = Granted, kept by
//              api/kit-sync.js daily) and each channel id.
//   Connect    connect.digitalfoxtalent.com/api/views?format=json, the live engaged views page
//              (dft-connect api/views.js). Signed per channel with STATS_SECRET, which this reads at
//              run time from the API Keys board, the same way kit-sync does. Never logged or shown.
//
// BRAND LINK. Each panel carries the creator's brand-safe engaged views link (the HTML page) to
// copy into a reply. Brands never see this report; it is team only like every other report.

import crypto from "node:crypto";
import { monday } from "../monday.js";
import { readSummary } from "./summary.js";

const ACCESS_BOARD = 18432126799;
const A = { chan: "text_mm7df591", status: "color_mm7dpp3w", granted: "date_mm7dmz8d" };
const KEY_ITEM = 13197661446; // API Keys: "Channel Connect STATS_SECRET (dft-connect Vercel)"
const KEY_COL = "text_mm5bcxe7";
const CONNECT = "https://connect.digitalfoxtalent.com";
const CH_RE = /^UC[A-Za-z0-9_-]{22}$/;
const NOT_CREATORS = /own channel|how channel connect/i; // the DFT reference row and the how-to row

let secretCache = null;
async function readSecret(tok) {
  if (secretCache && Date.now() - secretCache.at < 10 * 60 * 1000) return secretCache.v;
  const d = await monday(tok, `query { items(ids:[${KEY_ITEM}]) { column_values(ids:["${KEY_COL}"]) { text } } }`);
  const v = String((d.items[0] && d.items[0].column_values[0] && d.items[0].column_values[0].text) || "").trim();
  if (v.length < 20) throw new Error("STATS_SECRET row on the API Keys board is empty");
  secretCache = { at: Date.now(), v };
  return v;
}
const viewsUrl = (secret, ch) => `${CONNECT}/api/views?k=${encodeURIComponent(ch)}&t=${crypto.createHmac("sha256", secret).update("views:" + ch).digest("base64url").slice(0, 32)}`;

async function creators(tok) {
  const ids = JSON.stringify(Object.values(A));
  const d = await monday(tok, `query { boards(ids:[${ACCESS_BOARD}]) { items_page(limit:500) { items { id name column_values(ids:${ids}) { id text } } } } }`);
  return d.boards[0].items_page.items
    .filter(it => !NOT_CREATORS.test(it.name))
    .map(it => {
      const c = Object.fromEntries(it.column_values.map(v => [v.id, v.text || ""]));
      return { name: it.name, channel: c[A.chan].trim(), connected: c[A.status] === "Granted", granted: c[A.granted] || "" };
    })
    .filter(r => CH_RE.test(r.channel))
    .sort((a, b) => (b.connected - a.connected) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

// One creator's figures, for the panel (route /engaged-data?ch=UC...).
export async function engagedData(tok, ch) {
  if (!CH_RE.test(String(ch || ""))) throw new Error("bad channel id");
  const url = viewsUrl(await readSecret(tok), ch);
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 25000);
  try {
    // mature=1: the latest 12 long-form videos at least a week old, so daily uploaders get averages too
    // (dft-connect #9, 20 Oct 2026). brandUrl below stays the plain link, so brands see what they always did.
    const r = await fetch(url + "&format=json&mature=1", { signal: ctl.signal, headers: { Accept: "application/json" } });
    if (r.status === 404) return { channel: ch, unavailable: "This creator has not connected yet." };
    if (r.status === 410) return { channel: ch, unavailable: "This creator removed our access." };
    if (!r.ok) return { channel: ch, unavailable: "YouTube did not answer just now (" + r.status + "). Try again in a minute." };
    return Object.assign(await r.json(), { brandUrl: url });
  } finally { clearTimeout(t); }
}

// Engaged views for specific videos (Campaign reach drawer, 15 Oct 2026). byChannel is
// { channelId: [videoIds] }. Channels not connected through Channel Connect answer 404 and are
// skipped. Never throws: a report must render even if Channel Connect is down.
// unknown: video ids whose channel is not known (YouTube's daily allowance ran out, so only
// oEmbed answered). Each connected channel is asked for those too; YouTube Analytics only ever
// answers for a channel's own videos, so the right channel claims each one.
export async function engagedForVideos(tok, byChannel, unknown) {
  const out = {};
  byChannel = Object.assign({}, byChannel || {});
  const unk = (unknown || []).filter(id => /^[A-Za-z0-9_-]{11}$/.test(id)).slice(0, 50);
  if (tok && unk.length) {
    try { (await creators(tok)).filter(r => r.connected).forEach(r => { byChannel[r.channel] = [...new Set((byChannel[r.channel] || []).concat(unk))]; }); } catch (e) {}
  }
  const chans = Object.keys(byChannel).filter(c => CH_RE.test(c)).slice(0, 80);
  if (!tok || !chans.length) return out;
  let secret;
  try { secret = await readSecret(tok); } catch (e) { return out; }
  await Promise.all(chans.map(async ch => {
    const all = [...new Set((byChannel[ch] || []).filter(id => /^[A-Za-z0-9_-]{11}$/.test(id)))].slice(0, 500);
    for (let i = 0; i < all.length; i += 50) { // YouTube Analytics takes up to 50 videos per report
      const ids = all.slice(i, i + 50);
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 12000);
      try {
        const r = await fetch(viewsUrl(secret, ch) + "&v=" + ids.join(","), { signal: ctl.signal, headers: { Accept: "application/json" } });
        if (r.ok) Object.assign(out, (await r.json()).videos || {});
        else if (r.status === 404 || r.status === 410) break; // not connected
      } catch (e) { /* unreachable: no engaged figure */ } finally { clearTimeout(t); }
    }
  }));
  return out;
}

// Connected creators only, for other reports (Campaign reach).
export async function connectedChannels(tok) { return (await creators(tok)).filter(r => r.connected); }
// Every creator row with a channel id, connected or not (All creators view, summary.js).
export async function allCreators(tok) { return creators(tok); }

export async function renderEngaged(tok) {
  let list = [], error = "";
  let summary = null;
  await Promise.all([
    creators(tok).then(l => { list = l; }, () => { error = "Could not read the Creator YouTube Access board just now."; }),
    readSummary(tok).then(s => { summary = s; }),
  ]);
  const json = JSON.stringify({ list, error, summary, at: new Date().toISOString() }).replace(/</g, "\\u003c");
  return PAGE.replace("__DATA__", () => json);
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><link rel="icon" type="image/png" href="https://digitalfoxtalent.com/dft/favicon.png"><title>DFT Engaged Views</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Hanken+Grotesk:wght@400;500;600&family=Martian+Mono:wght@400;500&display=swap">
<style>
:root{--bg:#F2F3F6;--surface:#FFFFFF;--sunk:#E9EBF0;--ink:#14161B;--body:#3A3F49;--muted:#687080;--line:#DFE2E8;--line-soft:#ECEEF2;--accent:#C05600;--accent-fill:#FF8800;--accent-soft:#FFF0DF;--good:#2C7A4B;--good-soft:#E3F1E8;--shadow:0 1px 2px rgba(20,22,27,.05),0 8px 24px -12px rgba(20,22,27,.12)}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#0E1014;--surface:#171A20;--sunk:#1D2128;--ink:#F2F3F6;--body:#C8CCD4;--muted:#8B919D;--line:#2A2F38;--line-soft:#22262E;--accent:#FF9A2E;--accent-soft:#2B2016;--good:#6FC48E;--good-soft:#18261E;--shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px -14px rgba(0,0,0,.6)}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--body);font:15px/1.5 "Hanken Grotesk",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
h1,h2,h3{font-family:"Bricolage Grotesque",sans-serif;color:var(--ink);margin:0;letter-spacing:-.01em}
.wrap{max-width:1240px;margin:0 auto;padding:28px 20px 80px;display:flex;flex-direction:column;gap:28px}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:12px 20px;flex-wrap:wrap}
.brandline{display:flex;align-items:center;height:42px;overflow:hidden}.wordmark{height:72px;width:auto;display:block;margin:-12px 0 0 -37px;mix-blend-mode:multiply}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .brandline{height:auto;overflow:visible} :root:not([data-theme="light"]) .wordmark{height:44px;margin:0;mix-blend-mode:normal;border-radius:8px}}
.tabs{display:inline-flex;gap:2px;padding:3px;background:var(--sunk);border-radius:999px;max-width:100%;overflow-x:auto;scrollbar-width:none}
.tabs a{padding:7px 15px;border-radius:999px;font-size:13.5px;font-weight:600;color:var(--muted);text-decoration:none;white-space:nowrap}.tabs a:hover{color:var(--ink)}
.tabs a[aria-current="page"]{background:var(--surface);color:var(--ink);box-shadow:var(--shadow)}
h1{font-size:clamp(30px,4.6vw,46px);font-weight:800;line-height:1.02}h1 em{font-style:normal;color:var(--accent)}
.sub{color:var(--muted);margin:10px 0 0}
.layout{display:grid;grid-template-columns:300px minmax(0,1fr);gap:20px;align-items:start}
.card{background:var(--surface);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow)}
.side{padding:14px;position:sticky;top:16px;max-height:calc(100vh - 32px);display:flex;flex-direction:column;gap:10px}
.count{font-family:"Martian Mono",monospace;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:4px 6px 0}
.bar{height:6px;border-radius:9px;background:var(--sunk);overflow:hidden;margin:0 6px}.bar i{display:block;height:100%;background:var(--good)}
#q{border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:10px;padding:9px 12px;font:inherit;font-size:14px;width:100%}
.list{overflow-y:auto;display:flex;flex-direction:column;gap:2px;margin:0 -4px;padding:0 4px}
.who{display:flex;align-items:center;gap:10px;border:0;background:none;text-align:left;padding:9px 10px;border-radius:10px;font:inherit;font-size:14px;color:var(--ink);cursor:pointer;width:100%}
.who:hover{background:var(--sunk)}.who[aria-current="true"]{background:var(--accent-soft);color:var(--accent);font-weight:600}
.who .dot{width:8px;height:8px;border-radius:50%;background:var(--good);flex:none}.who .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.who.off{color:var(--muted);cursor:default}.who.off:hover{background:none}.who.off .dot{background:var(--line)}
.who .d{font-family:"Martian Mono",monospace;font-size:10px;color:var(--muted)}
.lab{font-family:"Martian Mono",monospace;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:10px 10px 4px}
.panel{padding:26px 28px 30px;min-height:420px}
.ph{display:flex;justify-content:space-between;gap:14px 20px;flex-wrap:wrap;align-items:flex-start}
.ph h2{font-size:30px;font-weight:800}.ph .h{color:var(--muted);font-size:14px;margin-top:2px}
.acts{display:flex;gap:8px;flex-wrap:wrap}.btn{border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:999px;padding:8px 14px;font:inherit;font-size:13.5px;font-weight:600;cursor:pointer;text-decoration:none}
.btn.pri{background:var(--accent-fill);border-color:var(--accent-fill);color:#14161B}.btn:hover{border-color:var(--accent-fill)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:24px 0 28px}
.tile{border:1px solid var(--line-soft);background:var(--bg);border-radius:14px;padding:16px 18px}.tile b{display:block;font-family:"Martian Mono",ui-monospace,monospace;font-size:24px;color:var(--ink);font-weight:500;letter-spacing:-.02em;white-space:nowrap}.tile span{font-size:13px;color:var(--muted)}
.tile.hi{background:var(--accent-soft);border-color:transparent}.tile.hi b{color:var(--accent)}
table{width:100%;border-collapse:collapse;font-size:14px}th{font-family:"Martian Mono",monospace;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:500;text-align:right;padding:10px 8px;border-bottom:1px solid var(--line)}th:first-child{text-align:left}
td{padding:12px 8px;border-bottom:1px solid var(--line-soft);text-align:right;color:var(--ink);white-space:nowrap;font-variant-numeric:tabular-nums}td.t{text-align:left;white-space:normal}
td.t a{color:var(--ink);text-decoration:none}td.t a:hover{color:var(--accent)}td.t span{display:block;color:var(--muted);font-size:12px}
tr.fresh td{color:var(--muted)}.who.all{font-weight:600;margin-bottom:4px;border-bottom:1px solid var(--line-soft);border-radius:10px 10px 0 0}th button{all:unset;cursor:pointer}th button:hover,th button[aria-sort]{color:var(--ink)}th button:focus-visible{outline:2px solid var(--accent-fill);outline-offset:2px}tr.go{cursor:pointer}tr.go:hover td{background:var(--sunk)}tr.na td{color:var(--muted)}td .why{display:block;font-size:12px;color:var(--muted)}.sub2{color:var(--muted);font-size:14px;margin-top:2px}.tw{overflow-x:auto}@media(max-width:600px){.hm{display:none}}.note{font-size:13px;color:var(--muted);margin-top:18px}
.empty{display:grid;place-items:center;text-align:center;min-height:360px;color:var(--muted)}.empty h3{font-size:22px;margin-bottom:6px}
.err{background:var(--accent-soft);color:var(--accent);border-radius:12px;padding:12px 14px}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:999px;font-size:14px;opacity:0;transition:opacity .2s;pointer-events:none}.toast.on{opacity:1}
@media(max-width:820px){.layout{grid-template-columns:minmax(0,1fr)}.tiles{grid-template-columns:1fr 1fr}.side{position:static;max-height:none}.list{max-height:260px}.panel{padding:20px 16px}.wrap{padding:24px 16px 70px}td,th{padding:10px 4px;font-size:12.5px}}
</style></head><body><div class="wrap">
<div class="topbar"><div class="brandline"><img class="wordmark" src="https://df-cdn.b-cdn.net/GeneralLendingConfigs/landing_logo/DigitalFoxTalent-TextLogoBLACK-VECTOR.svg" alt="Digital Fox Talent" width="216" height="72"></div>
<nav class="tabs" aria-label="Reports"><a href="/">Campaign reach</a><a href="/platforms">Platform monetization</a><a href="/distribution">Video distribution</a><a href="/coverage">Creator distribution</a><a href="/engaged" aria-current="page">Engaged views</a></nav></div>
<header><h1>Engaged views</h1><p class="sub">Every roster creator connected through Channel Connect. All creators shows everyone side by side with the roster average, refreshed overnight. Pick a creator to see their latest 12 long-form videos that are at least a week old, live from YouTube Analytics, and copy their brand link for a brand.</p></header>
<div class="layout">
<aside class="card side"><div class="count" id="count"></div><div class="bar"><i id="bar"></i></div><input id="q" type="search" placeholder="Search creators" aria-label="Search creators"><div class="list" id="list"></div></aside>
<main class="card panel" id="panel"></main>
</div></div><div class="toast" id="toast"></div>
<script id="data" type="application/json">__DATA__</script>
<script>
const D=JSON.parse(document.getElementById("data").textContent),L=D.list||[],cache={};let cur=null,q="";
const $=s=>document.querySelector(s),esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const nf=n=>n==null||isNaN(n)?"n/a":Math.round(n).toLocaleString("en-US"),pct=(a,b)=>a==null||!b?"n/a":Math.round(100*a/b)+"%";
const on=L.filter(r=>r.connected);
$("#count").textContent=on.length+" of "+L.length+" connected";$("#bar").style.width=(L.length?100*on.length/L.length:0)+"%";
function list(){const m=r=>!q||r.name.toLowerCase().includes(q);const a=on.filter(m),b=L.filter(r=>!r.connected&&m(r));
$("#list").innerHTML='<button class="who all" id="allbtn"'+(cur==="all"?' aria-current="true"':"")+'><span class="n">All creators</span></button>'+(a.length?a.map(r=>'<button class="who" data-ch="'+r.channel+'"'+(r.channel===cur?' aria-current="true"':"")+'><i class="dot"></i><span class="n">'+esc(r.name)+'</span>'+(r.granted?'<span class="d">'+esc(r.granted.slice(5))+'</span>':"")+'</button>').join(""):"")+
(b.length?'<div class="lab">Not connected yet</div>'+b.map(r=>'<div class="who off"><i class="dot"></i><span class="n">'+esc(r.name)+'</span></div>').join(""):"");
document.querySelectorAll("button.who[data-ch]").forEach(x=>x.onclick=()=>pick(x.dataset.ch));$("#allbtn").onclick=()=>showAll();}
function toast(t){const e=$("#toast");e.textContent=t;e.classList.add("on");setTimeout(()=>e.classList.remove("on"),1800);}
function show(ch,d){const r=L.find(x=>x.channel===ch)||{};const p=$("#panel");
if(d.unavailable){p.innerHTML='<div class="empty"><div><h3>'+esc(r.name)+'</h3><p>'+esc(d.unavailable)+'</p></div></div>';return;}
const S=d.summary||{},V=d.videos||[],ev=V.filter(v=>v.engagedViews!=null&&v.views),share=ev.length?ev.reduce((s,v)=>s+v.engagedViews,0)/ev.reduce((s,v)=>s+v.views,0):null;
p.innerHTML='<div class="ph"><div><h2>'+esc(d.title||r.name)+'</h2><div class="h">'+esc(d.handle||r.name)+' · YouTube · as of '+esc(d.asOf||"")+'</div></div><div class="acts"><button class="btn pri" id="copy">Copy brand link</button><a class="btn" href="'+esc(d.brandUrl)+'" target="_blank" rel="noreferrer">Open brand page</a></div></div>'+
'<div class="tiles"><div class="tile hi"><b>'+nf(S.avgEngagedViews)+'</b><span>Average engaged views per video</span></div><div class="tile"><b>'+nf(S.medianEngagedViews)+'</b><span>Median engaged views</span></div><div class="tile"><b>'+nf(S.avgViews)+'</b><span>Average public views</span></div><div class="tile"><b>'+(share==null?"n/a":Math.round(100*share)+"%")+'</b><span>Engaged share of views</span></div></div>'+
'<table><thead><tr><th>Video</th><th>Engaged</th><th>Views</th><th>Share</th></tr></thead><tbody>'+V.map(v=>'<tr'+(v.ageDays<7?' class="fresh"':"")+'><td class="t"><a href="https://www.youtube.com/watch?v='+encodeURIComponent(v.id)+'" target="_blank" rel="noreferrer">'+esc(v.title)+'</a><span>'+esc(v.published)+' · '+v.minutes+' min'+(v.ageDays<7?" · under 7 days old":"")+'</span></td><td>'+nf(v.engagedViews)+'</td><td>'+nf(v.views)+'</td><td>'+pct(v.engagedViews,v.views)+'</td></tr>').join("")+'</tbody></table>'+
'<p class="note">Averages cover these '+(S.videos||0)+' videos, the latest long-form uploads that are at least a week old (over 3 minutes, no live streams). The brand link shows the latest 12 uploads, so newer videos appear there in grey.'+(d.note?" "+esc(d.note):"")+'</p>';
$("#copy").onclick=async()=>{try{await navigator.clipboard.writeText(d.brandUrl);toast("Brand link copied");}catch(e){prompt("Copy the brand link:",d.brandUrl);}};}
let sortKey="avgEngaged",sortDir=-1;
const when=t=>{try{return new Date(t).toLocaleString("en-US",{day:"numeric",month:"short",year:"numeric",hour:"numeric",minute:"2-digit"});}catch(e){return t||"";}};
const share=v=>v==null?"n/a":Math.round(100*v)+"%";
function showAll(){cur="all";list();history.replaceState(null,"",location.pathname);const p=$("#panel"),S=D.summary;
if(!S||S.error||!S.roster){p.innerHTML='<div class="empty"><div><h3>All creators</h3><p>'+(S&&S.error?'The saved copy could not be read just now. ':'There is no saved copy yet. ')+'Build one now, it takes about a minute.</p><p><button class="btn pri" id="build">Build now</button></p></div></div>';$("#build").onclick=build;return;}
const R=S.roster,C=S.creators.slice();
C.sort((a,b)=>(!!a.unavailable-!!b.unavailable)||(sortKey==="name"?sortDir*String(a.name).localeCompare(String(b.name)):sortDir*((a[sortKey]==null?-1:a[sortKey])-(b[sortKey]==null?-1:b[sortKey]))));
const col=(k,l,c)=>'<th'+(c?' class="hm"':"")+'><button data-k="'+k+'"'+(sortKey===k?' aria-sort="'+(sortDir<0?"descending":"ascending")+'"':"")+'>'+l+(sortKey===k?(sortDir<0?" ↓":" ↑"):"")+'</button></th>';
p.innerHTML='<div class="ph"><div><h2>All creators</h2><div class="sub2">'+R.creators+' of '+R.connected+' connected creators in the averages · updated '+esc(when(S.builtAt))+'</div></div><div class="acts"><button class="btn" id="build">Refresh now</button></div></div>'+
'<div class="tiles"><div class="tile hi"><b>'+nf(R.avgEngaged)+'</b><span>Roster average engaged views per video</span></div><div class="tile"><b>'+nf(R.medianEngaged)+'</b><span>Middle creator, engaged views per video</span></div><div class="tile"><b>'+nf(R.avgViews)+'</b><span>Roster average public views per video</span></div><div class="tile"><b>'+share(R.share)+'</b><span>Average engaged share of views</span></div></div>'+
'<div class="tw"><table><thead><tr>'+col("name","Creator")+col("avgEngaged","Avg engaged")+col("medianEngaged","Median engaged",1)+col("avgViews","Avg views")+col("share","Share")+col("videos","Videos",1)+'</tr></thead><tbody>'+
C.map(r=>r.unavailable?'<tr class="na go" data-ch="'+esc(r.channel)+'"><td class="t">'+esc(r.name)+'<span class="why">'+esc(r.unavailable)+'</span></td><td>n/a</td><td class="hm">n/a</td><td>n/a</td><td>n/a</td><td class="hm">0</td></tr>':
'<tr class="go" data-ch="'+esc(r.channel)+'"><td class="t">'+esc(r.name)+'</td><td>'+nf(r.avgEngaged)+'</td><td class="hm">'+nf(r.medianEngaged)+'</td><td>'+nf(r.avgViews)+'</td><td>'+share(r.share)+'</td><td class="hm">'+r.videos+'</td></tr>').join("")+'</tbody></table></div>'+
'<p class="note">The roster average is the average of each creator’s own average, so every creator counts once however often they post. A very big channel still lifts it, so the middle creator figure is the safer one to quote. Each creator’s figures cover their latest 12 long-form videos that are at least a week old (no Shorts or live streams). Click a creator for their videos.'+
((S.notConnected||[]).length?' Not connected yet, so not included: '+S.notConnected.map(esc).join(", ")+'.':"")+'</p>';
p.querySelectorAll("th button").forEach(b=>b.onclick=()=>{const k=b.dataset.k;if(sortKey===k)sortDir=-sortDir;else{sortKey=k;sortDir=k==="name"?1:-1;}showAll();});
p.querySelectorAll("tr.go").forEach(t=>t.onclick=()=>pick(t.dataset.ch));
$("#build").onclick=build;}
async function build(){const b=$("#build");if(b){b.disabled=true;b.textContent="Reading YouTube Analytics for every creator…";}
try{const res=await fetch("/engaged-summary?build=1",{headers:{Accept:"application/json"}});const d=await res.json();if(!res.ok||!d.roster)throw new Error(d.error||res.status);D.summary=d;}
catch(e){toast("Could not refresh just now. Try again in a minute.");}
if(cur==="all")showAll();}
async function pick(ch){cur=ch;list();history.replaceState(null,"","#"+ch);const r=L.find(x=>x.channel===ch)||{};
if(cache[ch])return show(ch,cache[ch]);$("#panel").innerHTML='<div class="empty"><div><h3>'+esc(r.name)+'</h3><p>Reading YouTube Analytics…</p></div></div>';
try{const res=await fetch("/engaged-data?ch="+encodeURIComponent(ch),{headers:{Accept:"application/json"}});const d=await res.json();if(!res.ok)throw new Error(d.error||res.status);if(!d.unavailable)cache[ch]=d;if(cur===ch)show(ch,d);}
catch(e){if(cur===ch)$("#panel").innerHTML='<div class="empty"><div><h3>'+esc(r.name)+'</h3><p class="err">Could not load the figures just now. Click the creator again to retry.</p></div></div>';}}
$("#q").oninput=e=>{q=e.target.value.toLowerCase().trim();list();};
list();
if(D.error)$("#panel").innerHTML='<div class="empty"><p class="err">'+esc(D.error)+'</p></div>';
else{const h=location.hash.slice(1);const hit=on.find(r=>r.channel===h);if(hit)pick(hit.channel);else if(on.length)showAll();else $("#panel").innerHTML='<div class="empty"><div><h3>No creators connected yet</h3><p>Creators appear here the day after they connect.</p></div></div>';}
</script></body></html>`;
