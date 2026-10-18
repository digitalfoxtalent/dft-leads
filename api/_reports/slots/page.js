// The Slot board page. Data arrives in the __DATA__ script tag (see load.js); everything else is drawn here.
export const TEMPLATE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><link rel="icon" type="image/png" href="https://digitalfoxtalent.com/dft/favicon.png"><title>DFT Slot board</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Hanken+Grotesk:wght@400;500;600&family=Martian+Mono:wght@400;500&display=swap">
<style>
:root{--bg:#F2F3F6;--surface:#FFFFFF;--sunk:#E9EBF0;--ink:#14161B;--body:#3A3F49;--muted:#687080;--line:#DFE2E8;--line-soft:#ECEEF2;--accent:#C05600;--accent-fill:#FF8800;--accent-soft:#FFF0DF;--good:#2C7A4B;--good-soft:#E3F1E8;--warn:#8A6D00;--warn-soft:#FFF6D6;--shadow:0 1px 2px rgba(20,22,27,.05),0 8px 24px -12px rgba(20,22,27,.12)}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#0E1014;--surface:#171A20;--sunk:#1D2128;--ink:#F2F3F6;--body:#C8CCD4;--muted:#8B919D;--line:#2A2F38;--line-soft:#22262E;--accent:#FF9A2E;--accent-soft:#2B2016;--good:#6FC48E;--good-soft:#18261E;--warn:#E8C34A;--warn-soft:#2A2410;--shadow:0 1px 2px rgba(0,0,0,.3)}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#0E1014;--surface:#171A20;--sunk:#1D2128;--ink:#F2F3F6;--body:#C8CCD4;--muted:#8B919D;--line:#2A2F38;--line-soft:#22262E;--accent:#FF9A2E;--accent-soft:#2B2016;--good:#6FC48E;--good-soft:#18261E;--warn:#E8C34A;--warn-soft:#2A2410;--shadow:0 1px 2px rgba(0,0,0,.3)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--body);font:15px/1.5 "Hanken Grotesk",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
h1,h2,h3{font-family:"Bricolage Grotesque",sans-serif;color:var(--ink);margin:0;letter-spacing:-.01em}
.wrap{max-width:1360px;margin:0 auto;padding:28px 20px 80px;display:flex;flex-direction:column;gap:24px}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:12px 20px;flex-wrap:wrap}
.brandline{display:flex;align-items:center;height:42px;overflow:hidden}.wordmark{height:72px;width:auto;display:block;margin:-12px 0 0 -37px;mix-blend-mode:multiply}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .brandline{height:auto;overflow:visible} :root:not([data-theme="light"]) .wordmark{height:44px;margin:0;mix-blend-mode:normal;border-radius:8px}}
.tabs{display:inline-flex;gap:2px;padding:3px;background:var(--sunk);border-radius:999px;max-width:100%;overflow-x:auto;scrollbar-width:none}
.tabs a{padding:7px 15px;border-radius:999px;font-size:13.5px;font-weight:600;color:var(--muted);text-decoration:none;white-space:nowrap}.tabs a:hover{color:var(--ink)}
.tabs a[aria-current="page"]{background:var(--surface);color:var(--ink);box-shadow:var(--shadow)}
h1{font-size:clamp(30px,4.6vw,46px);font-weight:800;line-height:1.02}h1 em{font-style:normal;color:var(--accent)}
.sub{color:var(--muted);max-width:80ch;margin:10px 0 0}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
.tile{border:1px solid var(--line);background:var(--surface);border-radius:14px;padding:16px 18px;box-shadow:var(--shadow)}.tile b{display:block;font-family:"Martian Mono",ui-monospace,monospace;font-size:24px;color:var(--ink);font-weight:500;letter-spacing:-.02em;white-space:nowrap}.tile span{font-size:13px;color:var(--muted)}
.tile.hi{background:var(--accent-soft);border-color:transparent}.tile.hi b{color:var(--accent)}
.meter{height:6px;border-radius:9px;background:var(--sunk);overflow:hidden;margin-top:10px}.meter i{display:block;height:100%;background:var(--good)}
.bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
#q{border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:10px;padding:9px 12px;font:inherit;font-size:14px;min-width:220px}
label.tog{display:inline-flex;align-items:center;gap:6px;font-size:13.5px;color:var(--muted);cursor:pointer}label.tog input{accent-color:var(--accent-fill)}
.card{background:var(--surface);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow);overflow:hidden}
.scroll{overflow-x:auto}
table{border-collapse:separate;border-spacing:0;width:100%;min-width:980px;font-size:13.5px}
th{font-family:"Martian Mono",monospace;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:500;text-align:left;padding:12px 10px 8px;border-bottom:1px solid var(--line);vertical-align:top;background:var(--surface);position:sticky;top:0;z-index:1}
th.wk{min-width:112px}th.wk .d{color:var(--ink);font-size:11px;display:block}th.wk .n{display:block;text-transform:none;letter-spacing:0;font-family:"Hanken Grotesk",sans-serif;font-size:12px;color:var(--muted);margin-top:2px}
th.wk .rel{display:block;margin-top:6px;font-family:"Hanken Grotesk",sans-serif;text-transform:none;letter-spacing:0;font-size:11.5px;color:var(--warn);background:var(--warn-soft);border-radius:6px;padding:2px 6px;white-space:normal;max-width:150px}
th.wk.now .d{color:var(--accent)}
td{padding:10px;border-bottom:1px solid var(--line-soft);vertical-align:top}
td.c{position:sticky;left:0;background:var(--surface);z-index:1;min-width:230px;border-right:1px solid var(--line-soft)}
td.c b{color:var(--ink);font-weight:600;display:block}td.c span{display:block;color:var(--muted);font-size:12px}
td.c .flag{display:inline-block;margin-top:4px;font-size:11px;padding:1px 7px;border-radius:999px;background:var(--sunk);color:var(--muted)}
td.c .flag.p{background:var(--warn-soft);color:var(--warn)}
td.w{min-width:112px}
.chip{display:block;font-size:12px;line-height:1.3;padding:3px 7px;border-radius:7px;margin:0 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px;background:var(--good-soft);color:var(--good);border:1px solid transparent}
.chip.pen{background:transparent;border:1px dashed var(--line);color:var(--muted)}
.open{display:inline-block;font-family:"Martian Mono",monospace;font-size:12px;padding:3px 8px;border-radius:999px;background:var(--accent-soft);color:var(--accent)}
.open.zero{background:var(--sunk);color:var(--muted)}
.none{color:var(--line);font-size:12px}
td.tot{font-family:"Martian Mono",monospace;font-size:12.5px;color:var(--ink);text-align:right;white-space:nowrap}td.tot span{display:block;color:var(--muted);font-size:11px}
tr.paused td{opacity:.6}
tfoot td{font-family:"Martian Mono",monospace;font-size:11.5px;color:var(--muted);border-bottom:0;background:var(--bg)}tfoot td.c{background:var(--bg)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px}.two .card{padding:18px 20px}.two h3{font-size:17px;margin-bottom:8px}.two ul{margin:0;padding-left:18px;color:var(--body);font-size:14px}.two li{margin:4px 0}
.note{font-size:13px;color:var(--muted)}.err{background:var(--accent-soft);color:var(--accent);border-radius:12px;padding:12px 14px}
.empty{padding:60px 20px;text-align:center;color:var(--muted)}
@media(max-width:820px){.wrap{padding:24px 16px 70px}.two{grid-template-columns:1fr}td.c{min-width:170px}}
</style></head><body><div class="wrap">
<div class="topbar"><div class="brandline"><img class="wordmark" src="https://df-cdn.b-cdn.net/GeneralLendingConfigs/landing_logo/DigitalFoxTalent-TextLogoBLACK-VECTOR.svg" alt="Digital Fox Talent" width="216" height="72"></div>
<nav class="tabs" aria-label="Brand Partnerships"><a href="https://roster-viewguarantee.digitalfoxtalent.com" target="_blank" rel="noopener">Roster</a><a href="/partnerships/slot-board" aria-current="page">Slot board</a><a href="/partnerships">All of Brand Partnerships</a></nav></div>
<header><h1>Slot <em>board</em></h1><p class="sub">Every creator's expected uploads for the next eight weeks, what is sold against them, and what is still open. Rebuilt every night from YouTube, the US Campaigns board and the rates board; nothing here is typed in by hand.</p></header>
<div id="app"></div>
</div>
<script id="data" type="application/json">__DATA__</script>
<script>
const D=JSON.parse(document.getElementById("data").textContent);
const $=s=>document.querySelector(s),esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const nf=n=>n==null||isNaN(n)?"0":Math.round(n).toLocaleString("en-US"),money=n=>"$"+nf(n);
const short=n=>n>=1e6?(n/1e6).toFixed(1).replace(/\\.0$/,"")+"M":n>=1e3?Math.round(n/1e3)+"k":nf(n);
const dfmt=s=>{const d=new Date(s+"T00:00:00Z");return d.toLocaleDateString("en-US",{month:"short",day:"numeric",timeZone:"UTC"});};
const state={q:"",paused:false,pencil:true,sort:"value"};
try{const s=JSON.parse(localStorage.getItem("slots:view")||"{}");Object.assign(state,{paused:!!s.paused,pencil:s.pencil!==false,sort:s.sort||"value"});}catch(e){}
function save(){try{localStorage.setItem("slots:view",JSON.stringify({paused:state.paused,pencil:state.pencil,sort:state.sort}));}catch(e){}}
function render(){
  const app=$("#app");
  if(D.empty){app.innerHTML='<div class="card empty"><h3>Nothing to show yet</h3><p>'+esc(D.error)+'</p></div>';return;}
  const T=D.totals,W=D.weeks,today=new Date().toISOString().slice(0,10);
  const built=new Date(D.builtAt).toLocaleString("en-US",{timeZone:"America/Denver",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})+" MT";
  let rows=D.creators.filter(c=>!state.q||c.name.toLowerCase().includes(state.q)||(c.handle||"").toLowerCase().includes(state.q));
  if(!state.paused)rows=rows.filter(c=>!c.cadence.paused);
  if(state.sort==="name")rows=rows.slice().sort((a,b)=>a.name.localeCompare(b.name));
  else if(state.sort==="open")rows=rows.slice().sort((a,b)=>b.openSlots-a.openSlots||b.openValue-a.openValue);
  const weekTot=W.map((w,k)=>({e:rows.reduce((s,c)=>s+c.weeks[k].expected,0),b:rows.reduce((s,c)=>s+c.weeks[k].booked.length,0),o:rows.reduce((s,c)=>s+c.weeks[k].open,0)}));
  const unsched=D.creators.flatMap(c=>c.unscheduled.map(u=>Object.assign({creator:c.name},u)));
  const paused=D.creators.filter(c=>c.cadence.paused);
  const unread=D.creators.filter(c=>c.uploadsError);
  app.innerHTML=
  (D.stale?'<p class="err">'+esc(D.stale)+'</p>':'')+
  '<div class="tiles">'+
  '<div class="tile hi"><b>'+nf(T.open)+'</b><span>Open slots, next 8 weeks</span></div>'+
  '<div class="tile"><b>'+short(T.openViews)+'</b><span>Guaranteed views on open slots</span></div>'+
  '<div class="tile"><b>'+money(T.openValue)+'</b><span>Open inventory at rate card</span></div>'+
  '<div class="tile"><b>'+nf(T.booked)+'</b><span>Sold slots ('+money(T.bookedValue)+')'+(T.pencilled?' · '+nf(T.pencilled)+' pencilled':'')+'</span></div>'+
  '<div class="tile"><b>'+T.sellThrough+'%</b><span>Sell-through (sold of all slots)</span><div class="meter"><i style="width:'+T.sellThrough+'%"></i></div></div>'+
  '<div class="tile"><b>'+nf(T.creators-T.paused)+'</b><span>Creators posting'+(T.paused?' · '+T.paused+' paused':'')+'</span></div>'+
  '</div>'+
  '<div class="bar"><input id="q" type="search" placeholder="Search creators" value="'+esc(state.q)+'" aria-label="Search creators">'+
  '<label class="tog"><input type="checkbox" id="tpaused"'+(state.paused?' checked':'')+'> Show paused creators</label>'+
  '<label class="tog"><input type="checkbox" id="tpencil"'+(state.pencil?' checked':'')+'> Show pencilled deals</label>'+
  '<label class="tog">Sort <select id="sort"><option value="value"'+(state.sort==="value"?' selected':'')+'>by open value</option><option value="open"'+(state.sort==="open"?' selected':'')+'>by open slots</option><option value="name"'+(state.sort==="name"?' selected':'')+'>by name</option></select></label>'+
  '<span class="note" style="margin-left:auto">Built '+esc(built)+'</span></div>'+
  '<div class="card"><div class="scroll"><table><thead><tr><th>Creator</th>'+W.map(w=>'<th class="wk'+(today>=w.start&&today<=w.end?' now':'')+'"><span class="d">'+dfmt(w.start)+' to '+dfmt(w.end)+'</span><span class="n">'+w.expected+' uploads expected</span>'+w.releases.slice(0,3).map(r=>'<span class="rel" title="'+esc(r.date)+'">'+esc(r.name)+'</span>').join("")+(w.releases.length>3?'<span class="n">+'+(w.releases.length-3)+' more releases</span>':'')+'</th>').join("")+'<th style="text-align:right">8 weeks</th></tr></thead><tbody>'+
  (rows.length?rows.map(c=>'<tr'+(c.cadence.paused?' class="paused"':'')+'><td class="c"><b>'+esc(c.name)+'</b><span>'+esc(c.handle||"")+(c.rate?' · '+money(c.rate)+' per video':'')+(c.vg?' · '+short(c.vg)+' views':'')+'</span><span>'+(c.cadence.paused?'<i class="flag p">Paused: last upload '+esc(c.cadence.last||"unknown")+'</i>':(c.cadence.rate+' a week'+(c.cadence.irregular?' <i class="flag">irregular</i>':'')))+(c.uploadsError?' <i class="flag p" title="'+esc(c.uploadsError)+'">YouTube not read</i>':'')+'</span></td>'+
    c.weeks.map(w=>'<td class="w">'+w.booked.map(s=>'<a class="chip" title="'+esc(s.deal+(s.start?' · '+s.start+(s.end?' to '+s.end:''):'')+' · '+s.group)+'" href="https://digitalfoxtalent.monday.com/boards/6162879609/pulses/'+esc(s.dealId)+'" target="_blank" rel="noopener">'+esc(s.brand)+'</a>').join("")+(state.pencil?w.pencilled.map(s=>'<span class="chip pen" title="'+esc(s.deal+' · '+s.group)+'">'+esc(s.brand)+'?</span>').join(""):'')+(w.expected?'<span class="open'+(w.open?'':' zero')+'">'+w.open+' open</span>':(w.booked.length?'':'<span class="none">no upload</span>'))+'</td>').join("")+
    '<td class="tot">'+nf(c.openSlots)+' open<span>'+nf(c.bookedSlots)+' sold · '+money(c.openValue)+'</span></td></tr>').join(""):'<tr><td class="c" colspan="10"><span>No creators match.</span></td></tr>')+
  '</tbody><tfoot><tr><td class="c">'+rows.length+' creators shown</td>'+weekTot.map(t=>'<td>'+t.o+' open<br>'+t.b+' sold of '+t.e+'</td>').join("")+'<td class="tot">'+nf(weekTot.reduce((s,t)=>s+t.o,0))+' open<span>'+nf(weekTot.reduce((s,t)=>s+t.b,0))+' sold</span></td></tr></tfoot></table></div></div>'+
  '<div class="two"><div class="card"><h3>Sold, date not set yet ('+unsched.length+')</h3>'+(unsched.length?'<ul>'+unsched.slice(0,40).map(u=>'<li><b>'+esc(u.creator)+'</b> · '+esc(u.brand)+' <span class="note">('+esc(u.group)+')</span></li>').join("")+'</ul>':'<p class="note">Every sold slot has a flight date.</p>')+'<p class="note">These are won deals with no live date or publish date on the creator row, so they are not placed in a week. Add the flight dates on the US Campaigns board and they move onto the grid overnight.</p></div>'+
  '<div class="card"><h3>How to read this</h3><ul><li>Expected uploads come from each channel\\u2019s last 12 weeks on YouTube, long-form only (over 3 minutes, no live streams). A channel with nothing in 30 days is paused and offers no slots.</li><li>Sold slots are creator rows on deals at Campaign Won or later, placed in the week their flight starts. Pencilled deals (opportunities, contract review) show with a question mark and are not counted.</li><li>Open slots are expected uploads minus sold, one read per video. Value uses the rate card the roster quotes.</li><li>Yellow labels on a week are studio releases from the release matcher.</li></ul>'+(unread.length?'<p class="note">YouTube could not be read for: '+esc(unread.map(c=>c.name).join(", "))+'. Their rows show no expected uploads until the next build.</p>':'')+(D.skippedCount?'<p class="note">'+D.skippedCount+' campaign rows name a creator who is not on the rates board, so they are not shown.</p>':'')+(paused.length&&!state.paused?'<p class="note">'+paused.length+' paused creators are hidden. Tick \\u201cShow paused creators\\u201d to see them.</p>':'')+'</div></div>';
  $("#q").oninput=e=>{state.q=e.target.value.toLowerCase().trim();render();$("#q").focus();const v=$("#q");v.setSelectionRange(v.value.length,v.value.length);};
  $("#tpaused").onchange=e=>{state.paused=e.target.checked;save();render();};
  $("#tpencil").onchange=e=>{state.pencil=e.target.checked;save();render();};
  $("#sort").onchange=e=>{state.sort=e.target.value;save();render();};
}
render();
</script></body></html>`;
