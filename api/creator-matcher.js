export const config={maxDuration:300};
// CREATOR MATCHER for the release boards: George's Studio/Dev Upcoming Releases (18415007170, films) and Tom's
// Games, TV & Tech Upcoming Releases (18435939296, split off 17 Oct 2026). Both boards share column ids.
// Two jobs each weekly run:
//  1) PREP (source-once): for releases 0-120 days out with no Suggested Creators yet, scan DFT
//     roster creators' recent uploads for videos on that release's IP, and write creators + videos.
//     Set Outreach Window = "Reach out now" if already <=ALERT_DAYS out, else "Prep window".
//  2) ALERT FLIP: any release 0-ALERT_DAYS days out whose window is not already
//     "Reach out now"/"Launched" is flipped to "Reach out now" (creators were matched earlier during
//     prep) -> this status change fires the team alert email.
// Net effect: the team is alerted ALERT_DAYS (30) days before release, fully prepped
// (creators matched + contact enriched). Runs weekly AFTER enrichment.
export default async function handler(req,res){
const YT=process.env.YOUTUBE_API_KEY;
const MK=process.env.MONDAY_API_KEY;
const RELEASE_BOARDS=["18415007170","18435939296"];
const ROSTER_BOARD="6160485039";
const REL_DATE="date_mm3rpkm4",REL_WINDOW="color_mm5cpevg",REL_CREATORS="long_text_mm5cfcfd",REL_VIDEOS="long_text_mm5cwn40";
const ROSTER_GROUPS=["new_group__1","group_mks8q6fd"];
const R_HANDLE="text_mm4gvn92",R_YT="text_mkwxvv88";
const ALERT_DAYS=30;   // fire "Reach out now" (the team alert) this many days before release
const PREP_MAX=120;    // begin matching creators once a release is within this many days
if(!YT||!MK)return res.status(500).json({error:"Missing env vars"});
const sleep=function(ms){return new Promise(function(r){setTimeout(r,ms);});};
async function monday(q){const r=await fetch("https://api.monday.com/v2",{method:"POST",headers:{"Content-Type":"application/json","Authorization":MK},body:JSON.stringify({query:q})});return r.json();}
async function yt(endpoint,params){const u="https://www.googleapis.com/youtube/v3/"+endpoint+"?"+Object.keys(params).filter(function(k){return params[k]!=null;}).map(function(k){return k+"="+encodeURIComponent(params[k]);}).join("&")+"&key="+YT;try{return await (await fetch(u)).json();}catch(e){return{};}}

// ---- IP / FRANCHISE keyword logic ----
// Match a creator's videos to a release by FRANCHISE, ignoring sequel numbers and subtitles, so
// e.g. a "Witcher 3" video counts toward "The Witcher 4" and "GTA V" counts toward "Grand Theft Auto VI".
// Known abbreviations / alternate names (franchise phrase -> extra strings that also count as a match).
const FRANCHISE_ALIASES={
"grand theft auto":["gta"],
"call of duty":["cod","warzone"],
"resident evil":["biohazard"],
"the legend of zelda":["zelda"],
"final fantasy":["ffvii","ffxvi"],
"the elder scrolls":["skyrim"]
};
// Generic words that must NOT be used as a standalone match token (too noisy on their own).
const GENERIC_TOKENS=new Set(["control","star","stars","world","worlds","story","stories","order","dawn","rise","legacy","zero","company","beast","island","magic","night","last","final","first","dark","light","fire","blood","ring","souls","hill","gate","gates","land","lands","force","hero","team","game","games","movie","film","series","season","edition","complete","definitive","remake","remaster","remastered","chapter","part","reloaded","origins","tarnished","brand","open","sword","field","the","and","for"]);
function normText(s){return (s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();}
function keywordsFor(title){
const raw=(title||"").toLowerCase();
// main title = the part before a subtitle separator (": ", " - ", "(")
const main=raw.split(/\s+[-–—:]\s+|:|\(/)[0];
// franchise phrase: normalized main title minus a trailing sequel number / roman numeral (keeps small words like "of")
const phrase=normText(main).replace(/\s+(\d+|[ivxlcdm]+)$/,"").trim();
// distinctive tokens: words >=4 chars from the franchise that aren't generic
const tokens=phrase.split(" ").filter(function(w){return w.length>=4&&!GENERIC_TOKENS.has(w);});
let aliases=[];
Object.keys(FRANCHISE_ALIASES).forEach(function(fp){if(phrase.indexOf(fp)>=0)aliases=aliases.concat(FRANCHISE_ALIASES[fp]);});
return{phrase:phrase,tokens:tokens,aliases:aliases};
}
function titleMatches(videoTitle,kw){
const v=" "+normText(videoTitle)+" ";
// 1) multi-word franchise phrase appears in the video (precise; e.g. "call of duty", "silent hill")
if(kw.phrase&&kw.phrase.indexOf(" ")>=0&&v.indexOf(kw.phrase)>=0)return true;
// 2) a distinctive franchise token at a word start (e.g. "witcher" -> Witcher 3; "dune" -> Dune Part Two)
for(let i=0;i<kw.tokens.length;i++){if(v.indexOf(" "+kw.tokens[i])>=0)return true;}
// 3) known abbreviations / alternate names (e.g. "gta", "cod", "zelda")
for(let j=0;j<kw.aliases.length;j++){if(new RegExp("\\b"+kw.aliases[j]+"\\b").test(v))return true;}
return false;
}

// ---- Step 1: read releases (date, creators, window); build prep + flip target lists ----
// Upcoming group only, every row (the old single items_page(limit:200) call stopped at 200 of 300+ rows).
const relItems=[];
for(const board of RELEASE_BOARDS){
const relRes=await monday("{boards(ids:["+board+"]){groups(ids:[\"topics\"]){items_page(limit:500){items{id name column_values(ids:[\""+REL_DATE+"\",\""+REL_CREATORS+"\",\""+REL_WINDOW+"\"]){id text}}}}}}");
const grp=(relRes&&relRes.data&&relRes.data.boards&&relRes.data.boards[0]&&relRes.data.boards[0].groups&&relRes.data.boards[0].groups[0])||null;
for(const it of((grp&&grp.items_page&&grp.items_page.items)||[])){it.board=board;relItems.push(it);}
}
const today=Date.now();
const matchTargets=[]; // 0-120d, no creators yet -> match creators (source once)
const flipTargets=[];  // 0-ALERT_DAYS, not yet "Reach out now"/"Launched" -> fire alert
for(const it of relItems){
let dateTxt="",creators="",windowTxt="";
for(const cv of(it.column_values||[])){if(cv.id===REL_DATE)dateTxt=(cv.text||"").trim();if(cv.id===REL_CREATORS)creators=(cv.text||"").trim();if(cv.id===REL_WINDOW)windowTxt=(cv.text||"").trim();}
if(!dateTxt)continue;
const days=Math.round((Date.parse(dateTxt)-today)/86400000);
if(days<0)continue; // launched -> handled by the sourcing task
if(days<=PREP_MAX&&!creators)matchTargets.push({id:it.id,board:it.board,name:it.name,days:days,kw:keywordsFor(it.name)});
if(days<=ALERT_DAYS&&windowTxt!=="Reach out now"&&windowTxt!=="Launched")flipTargets.push({id:it.id,board:it.board,name:it.name,days:days});
}
if(!matchTargets.length&&!flipTargets.length)return res.json({message:"No releases to match or flip",checked:relItems.length});

// ---- Step 2: read roster creators (only needed if we have prep work) ----
const creators=[];
if(matchTargets.length){
const rosterRes=await monday("{boards(ids:["+ROSTER_BOARD+"]){groups(ids:["+ROSTER_GROUPS.map(function(g){return "\""+g+"\"";}).join(",")+"]){items_page(limit:200){items{name column_values(ids:[\""+R_HANDLE+"\",\""+R_YT+"\"]){id text}}}}}}");
for(const grp of((rosterRes&&rosterRes.data&&rosterRes.data.boards&&rosterRes.data.boards[0]&&rosterRes.data.boards[0].groups)||[])){
for(const it of(grp.items_page&&grp.items_page.items||[])){
let handle="",yturl="";for(const cv of(it.column_values||[])){if(cv.id===R_HANDLE)handle=(cv.text||"").trim();if(cv.id===R_YT)yturl=(cv.text||"").trim();}
let resolve=null;const u=yturl||"";
let m=u.match(/youtube\.com\/channel\/(UC[\w-]+)/i);if(m)resolve=["channel",m[1]];
else{m=u.match(/youtube\.com\/@([\w.\-]+)/i);if(m)resolve=["handle",m[1]];else{m=u.match(/youtube\.com\/user\/([\w.\-]+)/i);if(m)resolve=["user",m[1]];}}
if(!resolve&&handle)resolve=["handle",handle.replace(/^@/,"").split(/\s+/)[0]];
if(resolve)creators.push({name:it.name,handle:handle||("@"+ (resolve[1]||"")),resolve:resolve});
}
}
// ---- Step 3: resolve uploads playlist + enumerate recent uploads ----
async function uploadsPlaylist(resolve){
if(resolve[0]==="channel")return "UU"+resolve[1].slice(2);
const body=resolve[0]==="user"?await yt("channels",{part:"contentDetails",forUsername:resolve[1]}):await yt("channels",{part:"contentDetails",forHandle:resolve[1]});
const items=body.items||[];return items.length?items[0].contentDetails.relatedPlaylists.uploads:null;
}
const MAX_VIDS=150;
for(const c of creators){
try{
const pid=await uploadsPlaylist(c.resolve);c.videos=[];
if(!pid)continue;
let token="";
for(let p=0;p<3;p++){
const d=await yt("playlistItems",{part:"snippet",playlistId:pid,maxResults:50,pageToken:token||null});
for(const i of(d.items||[])){const sn=i.snippet||{};const vid=sn.resourceId&&sn.resourceId.videoId;if(vid)c.videos.push({title:sn.title||"",url:"https://www.youtube.com/watch?v="+vid});}
token=d.nextPageToken||"";if(!token||c.videos.length>=MAX_VIDS)break;
}
}catch(e){c.videos=[];}
await sleep(20);
}
}

// ---- Step 4: PREP pass — match creators, write creators + videos, set window ----
const report=[];const matchedIds=new Set();
for(const t of matchTargets){
matchedIds.add(t.id);
const hits=[];
for(const c of creators){
if(!c.videos||!c.videos.length)continue;
const vids=c.videos.filter(function(v){return titleMatches(v.title,t.kw);});
if(vids.length)hits.push({name:c.name,handle:c.handle,count:vids.length,videos:vids.slice(0,2)});
}
hits.sort(function(a,b){return b.count-a.count;});
const top=hits.slice(0,6);
let creatorsText,videosText;
if(top.length){
creatorsText=top.map(function(h){return h.name+" ("+h.handle+") — "+h.count+" video"+(h.count>1?"s":"")+" on this IP";}).join("\n");
const vlines=[];for(const h of top){for(const v of h.videos){vlines.push(h.name+": "+v.title+" — "+v.url);}}
videosText=vlines.slice(0,10).join("\n");
}else{
creatorsText="No roster creators have covered this IP yet — review for genre fit.";
videosText="";
}
// If already within the alert window, go straight to "Reach out now"; otherwise hold at "Prep window".
const windowLabel=t.days<=ALERT_DAYS?"Reach out now":"Prep window";
const cols={};cols[REL_CREATORS]={text:creatorsText};cols[REL_VIDEOS]={text:videosText};cols[REL_WINDOW]={label:windowLabel};
try{await monday("mutation{change_multiple_column_values(board_id:"+t.board+",item_id:"+t.id+",column_values:"+JSON.stringify(JSON.stringify(cols))+",create_labels_if_missing:true){id}}");}catch(e){}
report.push({release:t.name,days:t.days,window:windowLabel,creatorsMatched:top.length,topCreators:top.map(function(h){return h.name+"("+h.count+")";})});
}

// ---- Step 5: ALERT FLIP pass — items prepped earlier that are now within ALERT_DAYS ----
let flipped=0;
for(const f of flipTargets){
if(matchedIds.has(f.id))continue; // already set in the prep pass this run
const cols={};cols[REL_WINDOW]={label:"Reach out now"};
try{await monday("mutation{change_multiple_column_values(board_id:"+f.board+",item_id:"+f.id+",column_values:"+JSON.stringify(JSON.stringify(cols))+",create_labels_if_missing:true){id}}");flipped++;}catch(e){}
await sleep(20);
}

return res.json({message:"Creator matching + "+ALERT_DAYS+"-day alert flip complete",rosterCreators:creators.length,prepped:report.length,flippedToReachOutNow:flipped,report:report});
}
