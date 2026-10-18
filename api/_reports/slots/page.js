// The Ad Inventory Slots Available page (was "Slot board"). Data arrives in the __DATA__ script tag (see load.js); everything else is drawn here.
// Layout: four headline tiles, then one grid (a row per creator, a column per week). Every video a creator is
// expected to post that week is one square: green = sold (shows the brand's first letter, hover for the brand
// and deal, click to open it on monday), orange = pending (pencilled), empty = free to sell. "N of M left" sits below.
export const TEMPLATE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><link rel="icon" type="image/png" href="https://digitalfoxtalent.com/dft/favicon.png"><title>DFT Ad Inventory Slots Available</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Hanken+Grotesk:wght@400;500;600;700&display=swap">
<style>
:root{--bg:#F2F3F6;--surface:#FFFFFF;--sunk:#E9EBF0;--ink:#14161B;--body:#3A3F49;--muted:#687080;--line:#DFE2E8;--line-soft:#ECEEF2;--accent:#C05600;--accent-fill:#FF8800;--accent-soft:#FFF0DF;--slot:#AEB5C1;--good:#1F6B40;--good-ink:#FFFFFF;--good-soft:#E3F1E8;--good-text:#2C7A4B;--warn:#8A6D00;--warn-soft:#FFF6D6;

--shadow:0 1px 2px rgba(20,22,27,.05),0 8px 24px -12px rgba(20,22,27,.12)}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#0E1014;--surface:#171A20;--sunk:#1D2128;--ink:#F2F3F6;--body:#C8CCD4;--muted:#8B919D;--line:#2A2F38;--line-soft:#22262E;--accent:#FF9A2E;--accent-soft:#2B2016;--slot:#5A616D;--good:#6FC48E;--good-ink:#0E1014;--good-soft:#18261E;--good-text:#6FC48E;--warn:#E8C34A;--warn-soft:#2A2410;
--shadow:0 1px 2px rgba(0,0,0,.3)}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#0E1014;--surface:#171A20;--sunk:#1D2128;--ink:#F2F3F6;--body:#C8CCD4;--muted:#8B919D;--line:#2A2F38;--line-soft:#22262E;--accent:#FF9A2E;--accent-soft:#2B2016;--slot:#5A616D;--good:#6FC48E;--good-ink:#0E1014;--good-soft:#18261E;--good-text:#6FC48E;--warn:#E8C34A;--warn-soft:#2A2410;
--shadow:0 1px 2px rgba(0,0,0,.3)}
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
.sub{color:var(--muted);margin:8px 0 0;font-size:14.5px}
/* headline tiles */
.tiles{display:grid;grid-template-columns:1.25fr 1fr 1fr 1fr;gap:12px}
.tile{border:1px solid var(--line);background:var(--surface);border-radius:14px;padding:16px 18px;box-shadow:var(--shadow);min-width:0}
.tile .k{font-size:12.5px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.tile b{display:block;font-family:"Bricolage Grotesque",sans-serif;font-size:34px;line-height:1.1;color:var(--ink);font-weight:700;letter-spacing:-.02em;margin:6px 0 2px;white-space:nowrap}
.tile .s{font-size:13.5px;color:var(--muted)}
.tile.hi{background:var(--accent-soft);border-color:transparent}.tile.hi b{color:var(--accent)}
.meter{height:8px;border-radius:9px;background:var(--sunk);overflow:hidden;margin-top:10px}.meter i{display:block;height:100%;min-width:4px;border-radius:9px;background:var(--good-text)}
.built{font-size:13px;color:var(--muted)}
/* grid */
.card{background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow)}
.grid{border-radius:16px}
table{border-collapse:separate;border-spacing:0;width:100%;min-width:1060px;table-layout:fixed;font-size:14px}
col.cr{width:250px}col.tot{width:210px}
th{text-align:left;font-weight:600;color:var(--ink);padding:12px 8px 10px;border-bottom:1px solid var(--line);vertical-align:bottom;background:var(--surface);position:sticky;top:0;z-index:2}
th.corner{left:0;z-index:4;font-size:12.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;padding-left:16px;border-right:1px solid var(--line)}
th.wk .d{display:block;font-size:14.5px;white-space:nowrap}
th.wk .mo{display:block;margin:0 -8px 8px;font-size:11.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;line-height:16px}th.wk .mo b{display:block;height:16px;padding-left:8px;font-weight:700}th.wk .mo i{display:block;height:6px;margin-top:3px;border-top:2px solid var(--slot)}th.wk .mo.f{margin-left:2px}th.wk .mo.f b{padding-left:6px}th.wk .mo.f i{border-left:2px solid var(--slot);border-top-left-radius:5px}th.wk .mo.l{margin-right:4px}th.wk .mo.l i{border-right:2px solid var(--slot);border-top-right-radius:5px}
th.tot{text-align:right;padding-right:16px}td.tot{padding:8px 16px 8px 12px}
td{padding:6px 4px;border-bottom:1px solid var(--line-soft);vertical-align:middle}
td.c{position:sticky;left:0;background:var(--surface);z-index:1;padding:10px 12px 10px 16px;border-right:1px solid var(--line)}
.who{display:flex;gap:10px;align-items:center;min-width:0}
.who img{width:30px;height:30px;border-radius:50%;flex:none;background:var(--sunk);object-fit:cover}
.who .t{min-width:0}
.who b{display:block;color:var(--ink);font-weight:700;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.who span{display:block;color:var(--muted);font-size:12.5px;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.flag{display:inline-block;font-size:11px;font-style:normal;font-weight:600;padding:0 7px;border-radius:999px;background:var(--warn-soft);color:var(--warn);margin-left:4px}
/* one week for one creator */
.cell{border-radius:8px;padding:6px;display:flex;flex-direction:column;gap:5px;background:var(--bg);min-height:40px;justify-content:center}
.slots{display:flex;flex-wrap:wrap;gap:3px}
.slots i,.slots a{display:flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:3px;border:1.5px solid var(--slot);background:var(--surface);font:700 9px/1 "Hanken Grotesk",sans-serif;font-style:normal;text-decoration:none;text-transform:uppercase}
.slots .sold{background:var(--good);border-color:var(--good);color:var(--good-ink);cursor:pointer}.slots a.sold:hover{filter:brightness(1.15)}
.slots .pen{background:var(--accent-fill);border-color:var(--accent-fill);color:#14161B;cursor:default}
#tip{position:fixed;z-index:50;pointer-events:none;background:var(--ink);color:var(--surface);font-size:12.5px;line-height:1.35;padding:6px 9px;border-radius:7px;max-width:280px;box-shadow:var(--shadow);display:none}#tip b{display:block;font-size:13px}
.cap{font-size:12px;color:var(--muted);line-height:1.2}.cap b{font-size:14px;color:var(--ink)}
.cell.none{background:transparent;color:var(--muted);text-align:center;opacity:.6}
.mb+.mb{margin-top:9px}.mb .ml{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:0 6px;font-size:12px;color:var(--muted);white-space:nowrap}.mb .ml b{color:var(--ink);font-size:13.5px}.mb .ml .s{color:var(--good-text);font-weight:600}.mb .ml span+span{margin-left:auto}
.mb .bar{display:flex;height:7px;border-radius:9px;background:var(--sunk);overflow:hidden;margin-top:4px}.mb .bar i{display:block;height:100%;background:var(--good)}
tr.paused td.c .who,tr.paused .cell{opacity:.5}
tbody tr:hover td{background:var(--line-soft)}tbody tr:hover td.c{background:var(--line-soft)}
tfoot td{position:sticky;bottom:0;z-index:2;background:var(--surface);border-top:2px solid var(--line);border-bottom:0;padding:10px 8px;box-shadow:0 -6px 12px -10px rgba(0,0,0,.25)}
tfoot td.c{z-index:4;font-size:12.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}
tfoot .cap{display:block}tfoot .sub{display:block;font-size:12px;color:var(--muted);margin-top:2px;white-space:nowrap}

/* bottom cards */
.note{font-size:13px;color:var(--muted)}.err{background:var(--accent-soft);color:var(--accent);border-radius:12px;padding:12px 14px;margin:0}
.empty{padding:60px 20px;text-align:center;color:var(--muted)}
@media(max-width:1100px){.tiles{grid-template-columns:1fr 1fr}}
@media(max-width:820px){.wrap{padding:22px 16px 70px}col.cr{width:180px}.tile b{font-size:28px}.grid{overflow-x:auto}}
</style></head><body><div class="wrap">
<div class="topbar"><div class="brandline"><img class="wordmark" src="https://df-cdn.b-cdn.net/GeneralLendingConfigs/landing_logo/DigitalFoxTalent-TextLogoBLACK-VECTOR.svg" alt="Digital Fox Talent" width="216" height="72"></div>
<nav class="tabs" aria-label="Brand Partnerships"><a href="https://roster-viewguarantee.digitalfoxtalent.com" target="_blank" rel="noopener">Roster</a><a href="/partnerships/slot-board" aria-current="page">Ad Inventory Slots Available</a><a href="/partnerships">All of Brand Partnerships</a></nav></div>
<header><h1>Ad Inventory Slots Available</h1><p class="sub">Every video a creator posts can carry a sponsor. Each square is one video expected that week: green is sold, orange is pending (hover either for the brand; click a sold one to open the deal), an empty square is still free to sell. Rebuilt every night from YouTube, US Campaigns and the rates board.</p></header>
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
function cell(c,w,k){
  const wk=D.weeks[k],label=esc(c.name)+" \\u00b7 "+range(wk.start,wk.end)+": ";
  const n=Math.max(w.expected,w.booked.length);
  if(!n)return '<div class="cell none" title="'+label+'no video expected"><span>\\u2013</span></div>';
  const ltr=s=>esc(((s.brand||"?").trim().match(/[A-Za-z0-9]/)||["?"])[0]);
  let sq=w.booked.map(s=>'<a class="sold" href="https://digitalfoxtalent.monday.com/boards/6162879609/pulses/'+esc(s.dealId)+'" target="_blank" rel="noopener" aria-label="Sold: '+esc(s.brand)+'" data-tip="'+esc(s.brand)+'" data-sub="'+esc("Sold \\u00b7 "+s.deal+(s.start?" \\u00b7 "+day(s.start):""))+'">'+ltr(s)+'</a>').join("")+
    w.pencilled.map(s=>'<i class="pen" aria-label="Pending: '+esc(s.brand)+'" data-tip="'+esc(s.brand)+'" data-sub="'+esc("Pending, not sold yet \\u00b7 "+s.deal+(s.group?" \\u00b7 "+s.group:"")+(s.start?" \\u00b7 "+day(s.start):""))+'">'+ltr(s)+'</i>').join("");
  for(let i=w.booked.length+w.pencilled.length;i<n;i++)sq+='<i></i>';
  const val=c.rate&&w.open?", "+money(w.open*c.rate)+" open":"";
  return '<div class="cell'+(w.open?'':' full')+'" title="'+label+w.expected+' video'+(w.expected===1?'':'s')+' expected, '+w.booked.length+' sold, '+w.open+' left'+val+'"><div class="slots">'+sq+'</div></div>';
}
function mbar(sold,left,total,fmt){const f=total?Math.min(100,sold/total*100):0;
  return '<div class="mb"><div class="ml"><span class="s">'+fmt(sold)+' sold</span><span><b>'+fmt(left)+'</b> of '+fmt(total)+' left</span></div><div class="bar" role="img" aria-label="'+fmt(sold)+' sold, '+fmt(left)+' left"><i style="width:'+f+'%"></i></div></div>';}
function tot(booked,open,bookedVal,openVal){return mbar(booked,open,booked+open,nf)+mbar(bookedVal,openVal,bookedVal+openVal,smoney);}
function foot(rows,W){
  const sum=f=>rows.reduce((n,c)=>n+f(c),0);
  const wk=W.map((w,k)=>{const e=sum(c=>c.weeks[k].expected),o=sum(c=>c.weeks[k].open),b=sum(c=>c.weeks[k].booked.length),p=sum(c=>(c.weeks[k].pencilled||[]).length);
    return '<td><span class="cap"><b>'+nf(o)+'</b> of '+nf(e)+' left</span><span class="sub">'+nf(b)+' sold'+(p?' \\u00b7 '+nf(p)+' pending':'')+'</span></td>';}).join("");
  return '<tfoot><tr><td class="c">Total</td>'+wk+'<td class="tot">'+tot(sum(c=>c.bookedSlots),sum(c=>c.openSlots),sum(c=>c.bookedSlots*(c.rate||0)),sum(c=>c.openValue))+'</td></tr></tfoot>';
}
function render(){
  const app=$("#app");
  if(D.empty){app.innerHTML='<div class="card empty"><h3>Nothing to show yet</h3><p>'+esc(D.error)+'</p></div>';return;}
  const T=D.totals,W=D.weeks;
  const mon=W.map(w=>new Date(Date.parse(w.start+"T00:00:00Z")+3*864e5).toLocaleString("en-US",{month:"long",timeZone:"UTC"})); // a week belongs to the month holding most of its days
  const pend=c=>c.weeks.reduce((n,w)=>n+(w.pencilled||[]).length,0);
  const rows=D.creators.filter(c=>!c.cadence.paused).sort((a,b)=>b.bookedSlots-a.bookedSlots||pend(b)-pend(a)||b.openValue-a.openValue); // most booked in these 8 weeks first
  app.innerHTML=
  (D.stale?'<p class="err">'+esc(D.stale)+'</p>':'')+
  '<div class="tiles">'+
  '<div class="tile hi"><div class="k">Open slots</div><b>'+nf(T.open)+'</b><div class="s">next 8 weeks \\u00b7 '+short(T.openViews)+' guaranteed views</div></div>'+
  '<div class="tile"><div class="k">Open inventory</div><b title="'+money(T.openValue)+'">'+smoney(T.openValue)+'</b><div class="s">at rate card</div></div>'+
  '<div class="tile"><div class="k">Sold</div><b>'+nf(T.booked)+'</b><div class="s">'+money(T.bookedValue)+(T.pencilled?' \\u00b7 '+nf(T.pencilled)+' pending':'')+'</div></div>'+
  '<div class="tile"><div class="k">Sell-through</div><b>'+T.sellThrough+'%</b><div class="meter" role="img" aria-label="'+T.sellThrough+' percent sold"><i style="width:'+Math.min(100,Math.max(0,T.sellThrough))+'%"></i></div><div class="s" style="margin-top:6px">of '+nf(T.expected)+' expected uploads</div></div>'+
  '</div>'+
  '<div class="card"><div class="grid"><table><colgroup><col class="cr">'+W.map(()=>'<col>').join("")+'<col class="tot"></colgroup>'+
  '<thead><tr><th class="corner">Creator</th>'+W.map((w,k)=>'<th class="wk"><span class="mo'+(k===0||mon[k]!==mon[k-1]?' f':'')+(k===W.length-1||mon[k]!==mon[k+1]?' l':'')+'"><b>'+(k===0||mon[k]!==mon[k-1]?mon[k]:'')+'</b><i></i></span><span class="d">'+range(w.start,w.end)+'</span></th>').join("")+'<th class="tot">8 weeks</th></tr></thead><tbody>'+
  (rows.length?rows.map(c=>'<tr'+(c.cadence.paused?' class="paused"':'')+'><td class="c"><div class="who">'+(c.logo?'<img src="'+esc(c.logo)+'" alt="" loading="lazy" referrerpolicy="no-referrer">':'')+'<div class="t"><b title="'+esc(c.name+(c.handle?" "+c.handle:""))+'">'+esc(c.name)+'</b><span>'+(c.cadence.paused?'<i class="flag">Paused</i> last upload '+esc(c.cadence.last||"unknown"):pace(c.cadence.rate))+(c.uploadsError?'<i class="flag" title="'+esc(c.uploadsError)+'">YouTube not read</i>':'')+'</span></div></div></td>'+
    c.weeks.map((w,k)=>'<td>'+cell(c,w,k)+'</td>').join("")+
    '<td class="tot">'+tot(c.bookedSlots,c.openSlots,c.bookedSlots*(c.rate||0),c.openValue)+'</td></tr>').join(""):'<tr><td class="c" colspan="'+(W.length+2)+'"><span class="note">No creators match.</span></td></tr>')+
  '</tbody>'+foot(rows,W)+'</table></div></div>';
}
render();
const tip=document.createElement("div");tip.id="tip";document.body.appendChild(tip);
document.addEventListener("mouseover",e=>{const t=e.target.closest&&e.target.closest("[data-tip]");if(!t){tip.style.display="none";return;}
  const cellBox=t.closest(".cell");if(cellBox)cellBox.dataset.t=cellBox.title,cellBox.title="";
  tip.innerHTML="<b>"+esc(t.dataset.tip)+"</b>"+esc(t.dataset.sub||"");tip.style.display="block";
  const r=t.getBoundingClientRect(),w=tip.offsetWidth,h=tip.offsetHeight;
  let x=Math.min(Math.max(8,r.left+r.width/2-w/2),innerWidth-w-8),y=r.top-h-8;if(y<8)y=r.bottom+8;
  tip.style.left=x+"px";tip.style.top=y+"px";});
document.addEventListener("mouseout",e=>{const t=e.target.closest&&e.target.closest("[data-tip]");if(!t)return;tip.style.display="none";const c=t.closest(".cell");if(c&&c.dataset.t!=null){c.title=c.dataset.t;delete c.dataset.t;}});
document.addEventListener("scroll",()=>{tip.style.display="none";},true);
</script></body></html>`;
