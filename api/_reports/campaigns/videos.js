// Per-video detail for the campaign drawer: title, channel, publish date and current views, so
// anyone can check a campaign's total video by video. READ ONLY.
//
// YouTube Data API first (1 unit per 50 videos). If the day's allowance is used up, YouTube's
// oEmbed gives the title and channel (no views). YouTube serves servers a page without view
// counts, so reading the watch page does not work from here. Full results are cached for
// 3 hours; title-only results are not cached, so views appear as soon as the allowance resets.

const CACHE_MS = 3 * 60 * 60 * 1000;
const cache = {}; // id -> { at, d }
let apiOffUntil = 0;

const unesc = s => String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/\\u0026/g, "&").replace(/\\"/g, '"');

async function viaApi(ids, key) {
  if (!key || Date.now() < apiOffUntil) return {};
  const r = await fetch("https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=" + ids.join(",") + "&key=" + key);
  if (r.status === 403) { const n = new Date(); n.setUTCHours(7, 5, 0, 0); if (n <= new Date()) n.setUTCDate(n.getUTCDate() + 1); apiOffUntil = n.getTime(); return {}; }
  const j = await r.json(); const out = {};
  for (const x of (j && j.items) || []) out[x.id] = { t: x.snippet.title, ch: x.snippet.channelTitle, at: String(x.snippet.publishedAt || "").slice(0, 10), v: Number(x.statistics && x.statistics.viewCount || 0), src: "api" };
  return out;
}
async function viaOembed(id) {
  const r = await fetch("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + id));
  if (!r.ok) return null;
  const j = await r.json();
  return { t: j.title || "", ch: j.author_name || "", at: "", v: null, src: "oembed" };
}

export async function videoDetails(idsParam) {
  const ids = [...new Set(String(idsParam || "").split(",").map(s => s.trim()).filter(s => /^[A-Za-z0-9_-]{11}$/.test(s)))].slice(0, 50);
  const out = {}, want = [];
  for (const id of ids) { const c = cache[id]; if (c && Date.now() - c.at < CACHE_MS) out[id] = c.d; else want.push(id); }
  if (want.length) {
    let got = {};
    try { got = await viaApi(want, process.env.YOUTUBE_API_KEY); } catch (e) {}
    const miss = want.filter(id => !got[id]);
    const pages = await Promise.race([
      Promise.all(miss.map(id => viaOembed(id).catch(() => null).then(d => [id, d]))),
      new Promise(res => setTimeout(() => res([]), 8000)),
    ]);
    for (const [id, d] of pages) if (d) got[id] = d;
    for (const id of want) if (got[id]) { if (got[id].v != null) cache[id] = { at: Date.now(), d: got[id] }; out[id] = got[id]; }
  }
  return { at: new Date().toISOString(), videos: out };
}
