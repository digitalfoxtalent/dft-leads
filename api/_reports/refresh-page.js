// The Reporting refresh page (team only, GET /refresh). The manual backup for any platform whose
// automatic feed is down or not set up yet. Today: Megaphone's delivery report (Report builder,
// dimensions Podcast title, Episode title, Episode ID, Published date, Application; metric Total
// delivery). Drop the exported CSV on the page: it is read in this browser, reduced to one line per
// episode, and sent to /reach-apply-file, which checks first (nothing written) and writes on "Write".

export const REFRESH_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reporting refresh</title>
<style>
:root{--bg:#f6f5f2;--card:#fff;--ink:#1d1d1f;--muted:#6b6b70;--line:#e3e1dc;--accent:#5b3fd6;--ok:#1e7a46;--warn:#a55a00}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--card:#1d1d21;--ink:#ececef;--muted:#9b9ba3;--line:#2e2e34;--accent:#9d88ff;--ok:#5cc98a;--warn:#e0a050}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 16px}h1{font-size:24px;margin:0 0 4px}p.sub{color:var(--muted);margin:0 0 24px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:16px}
#drop{border:2px dashed var(--line);border-radius:12px;padding:36px 16px;text-align:center;cursor:pointer}#drop.on{border-color:var(--accent)}
button{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:10px 18px;font-size:15px;cursor:pointer}button:disabled{opacity:.4;cursor:default}
.muted{color:var(--muted)}.ok{color:var(--ok)}.warn{color:var(--warn)}ul{padding-left:18px;margin:6px 0}li{margin:2px 0;word-break:break-word}
.big{font-size:20px;font-weight:600}
</style></head><body><main>
<h1>Reporting refresh</h1>
<p class="sub">Spotify, Apple Podcasts, Amazon Music and other apps, for platforms without an automatic feed yet.</p>
<div class="card">
<b>1. Export from Megaphone</b>
<p class="muted" style="margin:6px 0 0">Analytics, Report builder, Delivery report. Dates from 1 Oct 2025 to today. Metric: Total delivery. Dimensions: Podcast title, Episode title, Episode ID, Published date, Application. Click Create report, then Export.</p>
</div>
<div class="card">
<b>2. Drop the file here</b>
<div id="drop" style="margin-top:10px"><div class="big">Drop the CSV here</div><div class="muted">or click to choose it</div><input id="f" type="file" accept=".csv,text/csv" hidden></div>
<div id="st" class="muted" style="margin-top:10px"></div>
</div>
<div class="card" id="res" hidden></div>
</main>
<script>
const $=id=>document.getElementById(id);let EPS=null,SRC="Megaphone",ASOF=new Date().toISOString().slice(0,10);
function parseCSV(t){const rows=[];let row=[],f="",q=false;for(let i=0;i<t.length;i++){const c=t[i];if(q){if(c=='"'){if(t[i+1]=='"'){f+='"';i++}else q=false}else f+=c}else if(c=='"')q=true;else if(c==','){row.push(f);f=""}else if(c=='\\n'||c=='\\r'){if(c=='\\r'&&t[i+1]=='\\n')i++;row.push(f);rows.push(row);row=[];f=""}else f+=c}if(f||row.length){row.push(f);rows.push(row)}return rows.filter(r=>r.length>1)}
const iso=s=>{const d=new Date(s+" UTC");return isNaN(d)?"":d.toISOString().slice(0,10)};
function load(file){$("st").textContent="Reading "+file.name+"...";const m=file.name.match(/(\\d{4}-\\d{2}-\\d{2})\\.csv$/);if(m)ASOF=m[1];
file.text().then(t=>{const R=parseCSV(t.replace(/^\\ufeff/,""));const H=R[0].map(h=>h.trim().toUpperCase());
const ix=n=>H.indexOf(n);const T=ix("EPISODE TITLE"),E=ix("EPISODE ID"),P=ix("PUBLISHED DATE"),A=ix("APPLICATION"),V=ix("TOTAL DELIVERY");
if([T,E,A,V].some(x=>x<0)){$("st").innerHTML='<span class="warn">This file is missing a column it needs (Episode title, Episode ID, Application, Total delivery). Check the report settings in step 1.</span>';return}
const by={};let tot=0;for(const r of R.slice(1)){const id=r[E];if(!id)continue;const e=by[id]=by[id]||{t:r[T],e:id,p:P>=0?iso(r[P]):"",sp:0,ap:0,am:0,ot:0};const n=Math.round(parseFloat(String(r[V]).replace(/,/g,""))||0);tot+=n;const a=r[A]||"";
if(a==="Spotify")e.sp+=n;else if(a==="Apple Podcasts")e.ap+=n;else if(/^Amazon Music/.test(a))e.am+=n;else e.ot+=n}
EPS=Object.values(by);$("st").innerHTML=(R.length-1).toLocaleString()+" rows, "+EPS.length.toLocaleString()+" episodes, "+tot.toLocaleString()+" total delivery. Checking against the campaign videos...";send(true)})}
function send(dry){$("res").hidden=false;$("res").innerHTML='<span class="muted">'+(dry?"Checking":"Writing to monday")+"... this takes up to a minute.</span>";
fetch("/reach-apply-file"+(dry?"?dry=1":""),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({asOf:ASOF,source:SRC,episodes:EPS})}).then(r=>r.json()).then(o=>show(o,dry)).catch(e=>{$("res").innerHTML='<span class="warn">Something went wrong: '+e+'</span>'})}
function list(t,a){return a&&a.length?'<p style="margin:12px 0 0"><b>'+t+" ("+a.length+")</b></p><ul>"+a.slice(0,30).map(x=>"<li class=muted>"+x+"</li>").join("")+"</ul>":""}
function show(o,dry){if(o.error){$("res").innerHTML='<span class="warn">'+o.error+"</span>";return}
$("res").innerHTML='<div class="big '+(dry?"":"ok")+'">'+(dry?"Ready to write "+o.changed+" creator rows":"Written: "+(o.changed-(o.failed||[]).length)+" creator rows")+'</div>'+
'<p class="muted">'+o.campaignVideos+" campaign videos, "+o.matched+" matched to an episode ("+o.episodesMatched+" episodes), "+o.kept+" kept from an earlier refresh. Figures as of "+o.asOf+". Figures only ever rise.</p>"+
list("Rows",o.writes)+list("Same title on several episodes, matched by date",o.byDate)+list("Same title on more than one episode, left for a person",o.ambiguous)+list("Episode older than the video, not matched",o.tooEarly)+list("Already matched to another episode, kept",o.otherEpisode)+list("Failed to write",o.failed)+
(dry&&o.changed?'<p style="margin-top:16px"><button id="go">Write to monday</button></p>':"");if($("go"))$("go").onclick=()=>{$("go").disabled=true;send(false)}}
const d=$("drop");d.onclick=()=>$("f").click();$("f").onchange=e=>e.target.files[0]&&load(e.target.files[0]);
d.ondragover=e=>{e.preventDefault();d.classList.add("on")};d.ondragleave=()=>d.classList.remove("on");d.ondrop=e=>{e.preventDefault();d.classList.remove("on");e.dataTransfer.files[0]&&load(e.dataTransfer.files[0])};
</script></body></html>`;
