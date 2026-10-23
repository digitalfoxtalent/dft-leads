// AI ASSISTANT REFERRALS, 23 Oct 2026 (Tom: "Yes, let's do it", tracking visits from ChatGPT, Perplexity, Copilot and
// the like after the AI-search work in #195 and #196).
//
// Pages are cached at Vercel's edge, so the server never sees most visits. Instead each page carries a few lines of
// script (beacon() below): when the reader arrived from an AI assistant, judged by document.referrer or a utm_source
// tag, it POSTs the assistant's name and the page path to /__ai-hit. Nothing else is sent: no cookies, no IP, no
// user id. Counts land in a private Apify key-value store, one record per month, and /__ai-stats returns the last
// 30 days as JSON for SUBPLOT HQ. Read-modify-write can drop a count if two hits land in the same instant; at these
// volumes that is fine.

const API = "https://api.apify.com/v2/key-value-stores";
const STORE_NAME = "subplot-ai-stats";
const tok = () => process.env.APIFY_TOKEN || "";

// Referrer host or utm_source fragment -> assistant name. Search engines (google.com, bing.com) are NOT here: those
// are ordinary search visits, already in Vercel Analytics.
export const SOURCES = [
  [/(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$|^chatgpt/i, "ChatGPT"],
  [/(^|\.)perplexity\.ai$|^perplexity/i, "Perplexity"],
  [/(^|\.)copilot\.microsoft\.com$|^copilot/i, "Copilot"],
  [/(^|\.)gemini\.google\.com$|^gemini/i, "Gemini"],
  [/(^|\.)claude\.ai$|^claude/i, "Claude"],
  [/(^|\.)meta\.ai$/i, "Meta AI"],
  [/(^|\.)chat\.mistral\.ai$/i, "Mistral"],
  [/(^|\.)you\.com$/i, "You.com"],
  [/(^|\.)phind\.com$/i, "Phind"],
  [/(^|\.)grok\.com$/i, "Grok"],
  [/(^|\.)chat\.deepseek\.com$/i, "DeepSeek"],
];
const NAMES = new Set(SOURCES.map(s => s[1]));

// Inline script for every SUBPLOT page. Kept tiny and dependency-free; it only fires for AI referrals.
export const beacon = () => `<script>
(function(){try{
var S=${JSON.stringify(SOURCES.map(([re, n]) => [re.source, n]))};
var h="";try{h=new URL(document.referrer).hostname}catch(e){}
var u=(new URLSearchParams(location.search).get("utm_source")||"");
if(h===location.hostname)return;
for(var i=0;i<S.length;i++){var r=new RegExp(S[i][0],"i");if((h&&r.test(h))||(u&&r.test(u))){
navigator.sendBeacon&&navigator.sendBeacon("/__ai-hit",new Blob([JSON.stringify({s:S[i][1],p:location.pathname})],{type:"text/plain"}));return}}
}catch(e){}})();
</script>`;

let storeId = null;
async function store() {
  if (storeId) return storeId;
  if (!tok()) throw new Error("APIFY_TOKEN missing");
  const r = await fetch(`${API}?name=${STORE_NAME}&token=${tok()}`, { method: "POST" });
  const j = await r.json();
  if (!r.ok || !j.data?.id) throw new Error("ai-stats store: " + (j.error?.message || r.status));
  return (storeId = j.data.id);
}
const monthKey = d => "ai-" + d.slice(0, 7);
async function read(key) {
  const r = await fetch(`${API}/${await store()}/records/${key}?token=${tok()}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("ai-stats read " + r.status);
  return r.json();
}
async function write(key, val) {
  const r = await fetch(`${API}/${await store()}/records/${key}?token=${tok()}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(val) });
  if (!r.ok) throw new Error("ai-stats write " + r.status);
}

export async function recordHit(raw) {
  let b; try { b = JSON.parse(String(raw || "")); } catch { return false; }
  const s = String(b?.s || ""), p = String(b?.p || "");
  if (!NAMES.has(s) || p.length > 200 || !/^\/[A-Za-z0-9_\-\/]*$/.test(p)) return false;
  const day = new Date().toISOString().slice(0, 10);
  const key = monthKey(day);
  const rec = (await read(key)) || { days: {}, pages: {} };
  const d = (rec.days[day] = rec.days[day] || {});
  d[s] = (d[s] || 0) + 1;
  rec.pages[p] = (rec.pages[p] || 0) + 1;
  await write(key, rec);
  return true;
}

export async function stats() {
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 864e5).toISOString().slice(0, 10);
  const keys = [...new Set([monthKey(since), monthKey(now.toISOString())])];
  const recs = (await Promise.all(keys.map(read))).filter(Boolean);
  const bySource = {}, byDay = {}, pages = {};
  let total = 0;
  for (const r of recs) {
    for (const [day, m] of Object.entries(r.days || {})) {
      if (day < since) continue;
      for (const [s, n] of Object.entries(m)) { bySource[s] = (bySource[s] || 0) + n; byDay[day] = (byDay[day] || 0) + n; total += n; }
    }
    for (const [p, n] of Object.entries(r.pages || {})) pages[p] = (pages[p] || 0) + n;
  }
  const top = Object.entries(pages).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([path, n]) => ({ path, n }));
  return { since, total, bySource, byDay, topPages: top, note: "Visits that arrived from an AI assistant, last 30 days. Top pages cover the months in range." };
}
