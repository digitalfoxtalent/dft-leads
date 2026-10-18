// The Slot board page. Data arrives in the __DATA__ script tag (see load.js); everything else is drawn here.
// Layout: four headline tiles, then one grid (a row per creator, a column per week). Each week cell is shaded
// by how many sponsor slots are still open (darker = more to sell) and carries the number, so the grid reads
// as a heat map; sold deals sit on top as solid green chips. Studio releases fold into one row under the
// week headers. Colours: open = the brand orange ramp, sold = green; both always carry a label or number.
export const TEMPLATE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><link rel="icon" type="image/png" href="https://digitalfoxtalent.com/dft/favicon.png"><title>DFT Slot board</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Hanken+Grotesk:wght@400;500;600;700&display=swap">
<style>
:root{--bg:#F2F3F6;--surface:#FFFFFF;--sunk:#E9EBF0;--ink:#14161B;--body:#3A3F49;--muted:#687080;--line:#DFE2E8;--line-soft:#ECEEF2;--accent:#C05600;--accent-fill:#FF8800;--accent-soft:#FFF0DF;--good:#1F6B40;--good-ink:#FFFFFF;--good-soft:#E3F1E8;--good-text:#2C7A4B;--warn:#8A6D00;--warn-soft:#FFF6D6;
--h1:#FFE9D3;--h2:#FFC994;--h3:#FFA24D;--h1t:#14161B;--h2t:#14161B;--h3t:#14161B;
--shadow:0 1px 2px rgba(20,22,27,.05),0 8px 24px -12px rgba(20,22,27,.12)}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#0E1014;--surface:#171A20;--sunk:#1D2128;--ink:#F2F3F6;--body:#C8CCD4;--muted:#8B919D;--line:#2A2F38;--line-soft:#22262E;--accent:#FF9A2E;--accent-soft:#2B2016;--good:#6FC48E;--good-ink:#0E1014;--good-soft:#18261E;--good-text:#6FC48E;--warn:#E8C34A;--warn-soft:#2A2410;
--h1:#33271A;--h2:#55401F;--h3:#7E5A26;--h1t:#F2F3F6;--h2t:#F2F3F6;--h3t:#FFFFFF;--shadow:0 1px 2px rgba(0,0,0,.3)}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#0E1014;--surface:#171A20;--sunk:#1D2128;--ink:#F2F3F6;--body:#C8CCD4;--muted:#8B919D;--line:#2A2F38;--line-soft:#22262E;--accent:#FF9A2E;--accent-soft:#2B2016;--good:#6FC48E;--good-ink:#0E1014;--good-soft:#18261E;--good-text:#6FC48E;--warn:#E8C34A;--warn-soft:#2A2410;
--h1:#33271A;--h2:#55401F;--h3:#7E5A26;--h1t:#F2F3F6;--h2t:#F2F3F6;--h3t:#FFFFFF;--shadow:0 1px 2px rgba(0,0,0,.3)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--body);font:15px/1.5 "Hanken Grotesk",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-variant-numeric:tabular-nums}
h1,h2,h3{font-family:"Bricolage Grotesque",sans-serif;color:var(--ink);margin:0;letter-spacing:-.01em}
a{color:inherit}
.wrap{max-width:1440px;margin:0 auto;padding:28px 20px 80px;display:flex;flex-direction:column;gap:20px}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:12px 20px;flex-wrap:wrap}
.brandline{display:flex;align-items:center;height:42px;overflow:hidden}.wordmark{height:72px;width:auto;display:block;margin:-12px 0 0 -37px;mix-blend-mode:multiply}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .brandline{height:auto;overflow:visible} :root:not([data-theme="light"]) .wordmark{height:44px;margin:0;mix-blend-mode:normal;border-radius:8px}}
.tabs{display:inline-flex;gap:2px;padding:3px;background:var(--sunk);border-radius:999px;max-width:100%;overflow-x:auto;scrollbar-width:none}
.tabs a{padding:7px 15px;border-radius:999px;font-size:13.5px;font-weight:600;color:var(--muted);text-decoration:none;white-space:nowrap}.tabs a:hover{color:var(--ink)}
.tabs a[aria-current="page"]{background:var(--surface);color:var(--ink);box-shadow:var(--shadow)}
h1{font-size:clamp(30px,4.2vw,42px);font-weight:800;line-height:1.02}h1 em{font-style:normal;color:var(--accent)}
.sub{color:var(--muted);max-width:96ch;margin:8px 0 0;font-size:14.5px}
/* headline tiles */
.tiles{display:grid;grid-template-columns:1.25fr 1fr 1fr 1fr;gap:12px}
.tile{border:1px solid var(--line);background:var(--surface);border-radius:14px;padding:16px 18px;box-shadow:var(--shadow);min-width:0}
.tile .k{font-size:12.5px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.tile b{display:block;font-family:"Bricolage Grotesque",sans-serif;font-size:34px;line-height:1.1;color:var(--ink);font-weight:700;letter-spacing:-.02em;margin:6px 0 2px;white-space:nowrap}
.tile .s{font-size:13.5px;color:var(--muted)}
.tile.hi{background:var(--accent-soft);border-color:transparent}.tile.hi b{color:var(--accent)}
.meter{height:8px;border-radius:9px;background:var(--sunk);overflow:hidden;margin-top:10px}.meter i{display:block;height:100%;min-width:4px;border-radius:9px;background:var(--good-text)}
/* controls + legend */
.bar{display:flex;gap:10px 16px;flex-wrap:wrap;align-items:center}
#q{border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:10px;padding:9px 12px;font:inherit;font-size:14px;min-width:220px}
select{border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:10px;padding:8px 10px;font:inherit;font-size:14px}
label.tog{display:inline-flex;align-items:center;gap:6px;font-size:14px;color:var(--body);cursor:pointer}label.tog input{accent-color:var(--accent-fill);width:16px;height:16px}
.legend{display:flex;gap:6px 16px;flex-wrap:wrap;align-items:center;font-size:13px;color:var(--muted);margin-left:auto}
.legend .ramp{display:inline-flex;align-items:center;gap:2px}.legend .ramp i{display:inline-block;width:30px;height:20px;border-radius:4px;font:600 11px/20px "Hanken Grotesk",sans-serif;font-style:normal;text-align:center}
.legend .sw{display:inline-flex;align-items:center;gap:6px}
.built{font-size:13px;color:var(--muted)}
/* grid */
.card{background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow)}
.grid{overflow:auto;max-height:calc(100vh - 96px);border-radius:16px}
table{border-collapse:separate;border-spacing:0;width:100%;min-width:1060px;table-layout:fixed;font-size:14px}
col.cr{width:250px}col.tot{width:130px}
th{text-align:left;font-weight:600;color:var(--ink);padding:12px 8px 10px;border-bottom:1px solid var(--line);vertical-align:bottom;background:var(--surface);position:sticky;top:0;z-index:2}
th.corner{left:0;z-index:4;font-size:12.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;padding-left:16px;border-right:1px solid var(--line)}
th.wk .d{display:block;font-size:14.5px;white-space:nowrap}
th.wk .n{display:block;font-weight:400;font-size:12.5px;color:var(--muted);white-space:nowrap}
th.wk .now{display:inline-block;font-size:11px;font-weight:700;color:var(--accent);background:var(--accent-soft);border-radius:999px;padding:1px 8px;margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em}
th.tot,td.tot{text-align:right;padding-right:16px}
td{padding:6px 4px;border-bottom:1px solid var(--line-soft);vertical-align:middle}
td.c{position:sticky;left:0;background:var(--surface);z-index:1;padding:10px 12px 10px 16px;border-right:1px solid var(--line)}
.who{display:flex;gap:10px;align-items:center;min-width:0}
.who img{width:30px;height:30px;border-radius:50%;flex:none;background:var(--sunk);object-fit:cover}
.who .t{min-width:0}
.who b{display:block;color:var(--ink);font-weight:700;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.who span{display:block;color:var(--muted);font-size:12.5px;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.flag{display:inline-block;font-size:11px;font-style:normal;font-weight:600;padding:0 7px;border-radius:999px;background:var(--warn-soft);color:var(--warn);margin-left:4px}
/* one week for one creator */
.cell{border-radius:8px;min-height:40px;padding:5px 6px;display:flex;flex-direction:column;justify-content:center;gap:3px}
.cell .num{font-size:17px;font-weight:700;line-height:1.1;text-align:center}.cell .num small{font-size:12px;font-weight:600;margin-left:3px}.cell .of{display:block;font-size:11.5px;line-height:1.2;text-align:center;opacity:.8}
.h1{background:var(--h1);color:var(--h1t)}.h2{background:var(--h2);color:var(--h2t)}.h3{background:var(--h3);color:var(--h3t)}
.cell.full{background:var(--good-soft);color:var(--good-text)}.cell.full .num{font-size:13px}
.cell.none{color:var(--muted);opacity:.6}.cell.none .num{font-weight:400}
.chip{display:block;font-size:12px;font-weight:600;line-height:1.25;padding:3px 7px;border-radius:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:var(--good);color:var(--good-ink);text-decoration:none}
.chip:hover{filter:brightness(1.08)}
.chip.pen{background:var(--surface);color:var(--body);border:1.5px dashed var(--muted);font-weight:500}
.legend .chip{display:inline-block}
td.tot b{display:block;font-size:17px;color:var(--ink)}td.tot span{display:block;font-size:12.5px;color:var(--muted);white-space:nowrap}
tr.paused td.c .who,tr.paused .cell{opacity:.5}
tbody tr:hover td{background:var(--line-soft)}tbody tr:hover td.c{background:var(--line-soft)}
/* releases row */
tr.rel td{background:var(--bg);padding:6px 6px;vertical-align:top;border-bottom:1px solid var(--line)}
tr.rel td.c{background:var(--bg);font-size:12.5px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
tr.rel:hover td{background:var(--bg)}
details summary{cursor:pointer;font-size:13px;color:var(--warn);font-weight:600;list-style:none;white-space:nowrap}details summary::-webkit-details-marker{display:none}
details summary::before{content:"+ ";}details[open] summary::before{content:"\\2212  ";}
details ul{margin:6px 0 2px;padding:0;list-style:none;font-size:12.5px;color:var(--body)}details li{padding:2px 0;border-top:1px solid var(--line-soft)}details li span{color:var(--muted)}
tfoot td{background:var(--bg);font-size:13px;color:var(--muted);border-bottom:0;position:sticky;bottom:0;z-index:1;padding:10px 8px}
tfoot td.c{z-index:3;background:var(--bg);font-weight:600;color:var(--ink)}tfoot td b{color:var(--ink)}
/* bottom cards */
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px}.two .card{padding:18px 20px}.two h3{font-size:18px;margin-bottom:10px}
.two ul{margin:0;padding-left:18px;color:var(--body);font-size:14px}.two li{margin:5px 0}
.uns{list-style:none;padding:0!important}.uns li{display:flex;gap:8px;flex-wrap:wrap;align-items:baseline;padding:6px 0;border-top:1px solid var(--line-soft);margin:0!important}
.uns li b{color:var(--ink);min-width:140px}.uns .chip{display:inline-block;max-width:220px}
.note{font-size:13px;color:var(--muted)}.err{background:var(--accent-soft);color:var(--accent);border-radius:12px;padding:12px 14px;margin:0}
.empty{padding:60px 20px;text-align:center;color:var(--muted)}
@media(max-width:1100px){.tiles{grid-template-columns:1fr 1fr}.legend{margin-left:0}}
@media(max-width:820px){.wrap{padding:22px 16px 70px}.two{grid-template-columns:1fr}col.cr{width:180px}.tile b{font-size:28px}#q{min-width:0;flex:1 1 100%}.grid{max-height:none}}
</style></head><body><div class="wrap">
<div class="topbar"><div class="brandline"><img class="wordmark" src="https://df-cdn.b-cdn.net/GeneralLendingConfigs/landing_logo/DigitalFoxTalent-TextLogoBLACK-VECTOR.svg" alt="Digital Fox Talent" width="216" height="72"></div>
<nav class="tabs" aria-label="Brand Partnerships"><a href="https://roster-viewguarantee.digitalfoxtalent.com" target="_blank" rel="noopener">Roster</a><a href="/partnerships/slot-board" aria-current="page">Slot board</a><a href="/partnerships">All of Brand Partnerships</a></nav></div>
<header><h1>Slot <em>board</em></h1><p class="sub">Every video a creator posts can carry a sponsor. Each box shows how many of that week\u2019s expected videos are still free to sell; green is sold, and darker orange means more left. Rebuilt every night from YouTube, US Campaigns and the rates board.</p></header>
<div id="app"></div>
</div>
<script id="data" type="application/json">__DATA__</script>
<script>
const D=JSON.parse(document.getElementById("data").textContent);
const $=s=>document.querySelector(s),esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const nf=n=>n==null||isNaN(n)?"0":Math.round(n).toLocaleString("en-US"),money=n=>"$"+nf(n);
const short=n=>n>=1e6?(n/1e6).toFixed(1).replace(/\\.0$/,"")+"M":n>=1e3?Math.round(n/1e3)+"k":nf(n);
const smoney=n=>n>=1e6?"$"+(n/1e6).toFixed(2).replace(/0$/,"")+"M":"$"+short(n);
const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const dp=s=>{const d=new Date(s+"T00:00:00Z");return {m:MON[d.getUTCMonth()],d:d.getUTCDate()};};
const range=(a,b)=>{const x=dp(a),y=dp(b);return x.m+" "+x.d+"\\u2013"+(x.m===y.m?"":y.m+" ")+y.d;};
const day=s=>{const x=dp(s);return x.m+" "+x.d;};
const pace=r=>!r?"no recent uploads":r>=1?(Math.round(r*10)/10)+" uploads a week":"1 upload every "+Math.round(1/r)+" weeks";
const heat=o=>o<=0?"":o<=3?"h1":o<=9?"h2":"h3";
const DONE=/^complete/i; // finished and paid deals: no flight date is expected any more
const state={q:"",paused:false,pencil:true,sort:"value"};
try{const s=JSON.parse(localStorage.getItem("slots:view")||"{}");Object.assign(state,{paused:!!s.paused,pencil:s.pencil!==false,sort:s.sort||"value"});}catch(e){}
function save(){try{localStorage.setItem("slots:view",JSON.stringify({paused:state.paused,pencil:state.pencil,sort:state.sort}));}catch(e){}}
function cell(c,w,k){
  const wk=D.weeks[k],label=esc(c.name)+" \\u00b7 "+range(wk.start,wk.end)+": ";
  const chips=w.booked.map(s=>'<a class="chip" title="Sold: '+esc(s.brand+" \\u00b7 "+s.deal+(s.start?" \\u00b7 "+s.start:"")+" \\u00b7 "+s.group)+'" href="https://digitalfoxtalent.monday.com/boards/6162879609/pulses/'+esc(s.dealId)+'" target="_blank" rel="noopener">'+esc(s.brand)+'</a>').join("")+
    (state.pencil?w.pencilled.map(s=>'<span class="chip pen" title="Pencilled, not sold yet: '+esc(s.deal+" \\u00b7 "+s.group)+'">'+esc(s.brand)+'?</span>').join(""):"");
  if(!w.expected)return '<div class="cell none" title="'+label+'no upload expected">'+chips+(w.booked.length?'':'<span class="num">\\u2013</span>')+'</div>';
  if(!w.open)return '<div class="cell full" title="'+label+'all '+w.expected+' expected videos sold">'+chips+'<span class="num">Sold out</span><span class="of">'+w.expected+' of '+w.expected+' sold</span></div>';
  const val=c.rate?" ("+money(w.open*c.rate)+")":"";
  return '<div class="cell '+heat(w.open)+'" title="'+label+w.open+' left of '+w.expected+' expected videos'+(w.booked.length?', '+w.booked.length+' sold':'')+val+'">'+chips+'<span class="num">'+w.open+'<small>left</small></span><span class="of">of '+w.expected+' video'+(w.expected===1?'':'s')+'</span></div>';
}
function render(){
  const app=$("#app");
  if(D.empty){app.innerHTML='<div class="card empty"><h3>Nothing to show yet</h3><p>'+esc(D.error)+'</p></div>';return;}
  const T=D.totals,W=D.weeks,today=new Date().toISOString().slice(0,10);
  const built=new Date(D.builtAt).toLocaleString("en-US",{timeZone:"America/Denver",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})+" MT";
  let rows=D.creators.filter(c=>!state.q||c.name.toLowerCase().includes(state.q)||(c.handle||"").toLowerCase().includes(state.q));
  if(!state.paused)rows=rows.filter(c=>!c.cadence.paused);
  if(state.sort==="name")rows=rows.slice().sort((a,b)=>a.name.localeCompare(b.name));
  else if(state.sort==="open")rows=rows.slice().sort((a,b)=>b.openSlots-a.openSlots||b.openValue-a.openValue);
  else rows=rows.slice().sort((a,b)=>b.openValue-a.openValue||b.openSlots-a.openSlots);
  const weekTot=W.map((w,k)=>({e:rows.reduce((s,c)=>s+c.weeks[k].expected,0),b:rows.reduce((s,c)=>s+c.weeks[k].booked.length,0),o:rows.reduce((s,c)=>s+c.weeks[k].open,0)}));
  const unsAll=D.creators.flatMap(c=>c.unscheduled.map(u=>Object.assign({creator:c.name},u)));
  const uns=unsAll.filter(u=>!DONE.test(u.group||"")),unsDone=unsAll.length-uns.length;
  const unsBy={};uns.forEach(u=>{(unsBy[u.creator]=unsBy[u.creator]||[]).push(u);});
  const paused=D.creators.filter(c=>c.cadence.paused),unread=D.creators.filter(c=>c.uploadsError);
  app.innerHTML=
  (D.stale?'<p class="err">'+esc(D.stale)+'</p>':'')+
  '<div class="tiles">'+
  '<div class="tile hi"><div class="k">Open slots</div><b>'+nf(T.open)+'</b><div class="s">next 8 weeks \\u00b7 '+short(T.openViews)+' guaranteed views</div></div>'+
  '<div class="tile"><div class="k">Open inventory</div><b title="'+money(T.openValue)+'">'+smoney(T.openValue)+'</b><div class="s">at rate card</div></div>'+
  '<div class="tile"><div class="k">Sold</div><b>'+nf(T.booked)+'</b><div class="s">'+money(T.bookedValue)+(T.pencilled?' \\u00b7 '+nf(T.pencilled)+' pencilled':'')+'</div></div>'+
  '<div class="tile"><div class="k">Sell-through</div><b>'+T.sellThrough+'%</b><div class="meter" role="img" aria-label="'+T.sellThrough+' percent sold"><i style="width:'+Math.min(100,Math.max(0,T.sellThrough))+'%"></i></div><div class="s" style="margin-top:6px">of '+nf(T.expected)+' expected uploads</div></div>'+
  '</div>'+
  '<div class="bar"><input id="q" type="search" placeholder="Search creators" value="'+esc(state.q)+'" aria-label="Search creators">'+
  '<select id="sort" aria-label="Sort"><option value="value"'+(state.sort==="value"?' selected':'')+'>Most open value first</option><option value="open"'+(state.sort==="open"?' selected':'')+'>Most open slots first</option><option value="name"'+(state.sort==="name"?' selected':'')+'>A to Z</option></select>'+
  '<label class="tog"><input type="checkbox" id="tpencil"'+(state.pencil?' checked':'')+'> Pencilled deals</label>'+
  '<label class="tog"><input type="checkbox" id="tpaused"'+(state.paused?' checked':'')+'> Paused creators'+(paused.length?' ('+paused.length+')':'')+'</label>'+
  '<div class="legend"><span>Slots left</span><span class="ramp"><i class="h1">1\\u20133</i><i class="h2">4\\u20139</i><i class="h3">10+</i></span><span class="sw"><span class="chip">Brand</span>sold</span><span class="sw"><span class="chip pen">Brand?</span>pencilled</span><span class="built">Built '+esc(built)+'</span></div></div>'+
  '<div class="card"><div class="grid"><table><colgroup><col class="cr">'+W.map(()=>'<col>').join("")+'<col class="tot"></colgroup>'+
  '<thead><tr><th class="corner">Creator</th>'+W.map((w,k)=>'<th class="wk">'+(today>=w.start&&today<=w.end?'<span class="now">This week</span>':'')+'<span class="d">'+range(w.start,w.end)+'</span><span class="n">'+weekTot[k].o+' left \\u00b7 '+weekTot[k].b+' sold</span></th>').join("")+'<th class="tot">8 weeks</th></tr></thead><tbody>'+
  '<tr class="rel"><td class="c">Releases</td>'+W.map(w=>'<td>'+(w.releases.length?'<details><summary>'+w.releases.length+' release'+(w.releases.length===1?'':'s')+'</summary><ul>'+w.releases.slice().sort((a,b)=>a.date<b.date?-1:1).map(r=>'<li><span>'+day(r.date)+'</span> '+esc(r.name)+'</li>').join("")+'</ul></details>':'<span class="note">None</span>')+'</td>').join("")+'<td></td></tr>'+
  (rows.length?rows.map(c=>'<tr'+(c.cadence.paused?' class="paused"':'')+'><td class="c"><div class="who">'+(c.logo?'<img src="'+esc(c.logo)+'" alt="" loading="lazy" referrerpolicy="no-referrer">':'')+'<div class="t"><b title="'+esc(c.name+(c.handle?" "+c.handle:""))+'">'+esc(c.name)+'</b><span>'+(c.rate?smoney(c.rate)+' a video':'no rate')+(c.vg?' \\u00b7 '+short(c.vg)+' views':'')+'</span><span>'+(c.cadence.paused?'<i class="flag">Paused</i> last upload '+esc(c.cadence.last||"unknown"):pace(c.cadence.rate)+(c.cadence.irregular?'<i class="flag">irregular</i>':''))+(c.uploadsError?'<i class="flag" title="'+esc(c.uploadsError)+'">YouTube not read</i>':'')+'</span></div></div></td>'+
    c.weeks.map((w,k)=>'<td>'+cell(c,w,k)+'</td>').join("")+
    '<td class="tot"><b>'+nf(c.openSlots)+' left</b><span>'+smoney(c.openValue)+'</span><span>'+nf(c.bookedSlots)+' sold</span></td></tr>').join(""):'<tr><td class="c" colspan="'+(W.length+2)+'"><span class="note">No creators match.</span></td></tr>')+
  '</tbody><tfoot><tr><td class="c">'+rows.length+' creators</td>'+weekTot.map(t=>'<td><b>'+nf(t.o)+'</b> left<br>'+nf(t.b)+' sold</td>').join("")+'<td class="tot"><b>'+nf(weekTot.reduce((s,t)=>s+t.o,0))+'</b> left<br>'+nf(weekTot.reduce((s,t)=>s+t.b,0))+' sold</td></tr></tfoot></table></div></div>'+
  '<div class="two"><div class="card"><h3>Sold, no flight date yet ('+uns.length+')</h3>'+(uns.length?'<ul class="uns">'+Object.keys(unsBy).sort().map(n=>'<li><b>'+esc(n)+'</b>'+unsBy[n].map(u=>'<a class="chip" title="'+esc(u.deal+" \\u00b7 "+u.group)+'" href="https://digitalfoxtalent.monday.com/boards/6162879609/pulses/'+esc(u.dealId)+'" target="_blank" rel="noopener">'+esc(u.brand)+'</a>').join("")+'</li>').join("")+'</ul>':'<p class="note">Every live deal has a flight date.</p>')+'<p class="note">Won deals with no live or publish date on the creator row, so they are not in a week yet. Add the dates on US Campaigns and they move onto the grid overnight.'+(unsDone?' '+unsDone+' completed and paid deals with no date are left out.':'')+'</p></div>'+
  '<div class="card"><h3>How to read this</h3><ul><li>Every video can carry a sponsor, so each video a creator is expected to post is one slot. A box reading \u201c11 left, of 13 videos\u201d means 13 videos are expected that week, 2 are sold and 11 are free to sell. Darker orange means more left.</li><li>Expected uploads come from each channel\\u2019s last 12 weeks on YouTube, long-form only (over 3 minutes, no live streams). A channel with nothing in 30 days is paused and offers no slots.</li><li>Green is sold: deals at Campaign Won or later, placed in the week the flight starts. Click one to open the deal. Dashed boxes with a question mark are pencilled (opportunities, contract review) and are not counted.</li><li>Open value uses the rate card the roster quotes, one read per video. Open the Releases row to see studio releases that week.</li></ul>'+(unread.length?'<p class="note">YouTube could not be read for: '+esc(unread.map(c=>c.name).join(", "))+'. Their rows show no expected uploads until the next build.</p>':'')+(D.skippedCount?'<p class="note">'+nf(D.skippedCount)+' campaign rows name a creator who is not on the rates board, so they are not shown.</p>':'')+'</div></div>';
  $("#q").oninput=e=>{state.q=e.target.value.toLowerCase().trim();render();const v=$("#q");v.focus();v.setSelectionRange(v.value.length,v.value.length);};
  $("#tpaused").onchange=e=>{state.paused=e.target.checked;save();render();};
  $("#tpencil").onchange=e=>{state.pencil=e.target.checked;save();render();};
  $("#sort").onchange=e=>{state.sort=e.target.value;save();render();};
}
render();
</script></body></html>`;
