// Creator earnings calculator: the channel lookup behind ecosystem.digitalfoxtalent.com/marketing/earnings-calculator.
//
// INTERNAL PREVIEW (Tom, 17 Oct 2026: "I'd like to see this internally first"). The page sits behind the
// Ecosystem's DFT sign-in. A public version for digitalfoxtalent.com, which saves each result as a sign-up
// lead, comes after Tom has seen this one.
//
// earningsLookup(q) takes a YouTube handle, channel URL or channel id and returns the channel's numbers
// the estimate is built from. The money model itself lives in the page (MODEL), so its constants are
// visible and easy to change in one place.
//
// What it measures, matching the roster's view guarantee model (renewal-sync):
//   avg      mean views of the last 10 long-form videos (over 3 minutes, at least 3 days old)
//   perMonth long-form uploads a month, from the last 90 days
// Keys: YOUTUBE_API_KEY_CALC first (a key for this page alone, so the scans cannot use up its allowance),
// then the project's shared YOUTUBE_API_KEY. Each lookup costs about 3 quota units, or about 103 when a
// name has to be searched for.
// When every key is out of quota, a roster channel still gets an answer from the Rates board
// (18417663127, synced daily by renewal-sync); the result says so (source: "roster").

const YT = "https://www.googleapis.com/youtube/v3/";

async function yt(path, key) {
  const r = await fetch(YT + path + (path.includes("?") ? "&" : "?") + "key=" + key);
  const j = await r.json();
  if (j.error) {
    const msg = String(j.error.message || "error").replace(/<[^>]+>/g, "");
    const e = new Error(/quota/i.test(msg) ? "QUOTA" : "YouTube: " + msg);
    e.quota = /quota/i.test(msg);
    throw e;
  }
  return j;
}

function secs(iso) {
  const m = String(iso || "").match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

async function resolve(q, key) {
  let s = String(q || "").trim();
  if (!s) throw new Error("Enter a channel handle or link");
  s = s.replace(/^https?:\/\/(www\.|m\.)?youtube\.com/i, "").replace(/[?#].*$/, "");
  let m = s.match(/(?:^|\/channel\/)(UC[\w-]{22})/);
  if (m) return { id: m[1] };
  m = s.match(/^\/?(@[\w.\-]+)/) || s.match(/^\/(?:c|user)\/([\w.\-]+)/);
  const handle = m ? (m[1].startsWith("@") ? m[1] : "@" + m[1]) : (/^[\w.\-]+$/.test(s) ? "@" + s : null);
  if (handle) {
    const j = await yt("channels?part=id&forHandle=" + encodeURIComponent(handle), key);
    if (j.items && j.items[0]) return { id: j.items[0].id };
  }
  const j = await yt("search?part=snippet&type=channel&maxResults=1&q=" + encodeURIComponent(s.replace(/^\//, "")), key);
  if (j.items && j.items[0]) return { id: j.items[0].snippet.channelId, searched: true };
  throw new Error("No YouTube channel found for that");
}

export async function earningsLookup(q, mondayToken) {
  const keys = [...new Set([process.env.YOUTUBE_API_KEY_CALC, process.env.YOUTUBE_API_KEY].filter(Boolean))];
  for (const key of keys) {
    try { return await ytLookup(q, key); }
    catch (e) { if (!e.quota) throw e; }
  }
  const r = await rosterLookup(q, mondayToken);
  if (r) return r;
  throw new Error("YouTube's daily lookup allowance is used up, and this channel is not on the roster's Rates board. Lookups reset at midnight Pacific time.");
}

// Rates board fallback: roster YouTube channels only, matched on handle, channel id or name.
async function rosterLookup(q, token) {
  if (!token) return null;
  const norm = x => String(x || "").toLowerCase().replace(/^https?:\/\/(www\.|m\.)?youtube\.com\/?/, "").replace(/[?#].*$/, "").replace(/^channel\//, "").replace(/^@/, "").replace(/\/.*$/, "").replace(/[^a-z0-9_.-]/g, "");
  const want = norm(q);
  if (!want) return null;
  const cols = ["text_mm49w81b", "text_mm499xez", "text_mm49b3x7", "numeric_mm49b3y2", "numeric_mm5nn2wj", "numeric_mm49cx8f"];
  const query = "{boards(ids:[18417663127]){groups(ids:[\"topics\"]){items_page(limit:500){items{name column_values(ids:" + JSON.stringify(cols) + "){id text}}}}}}";
  const r = await fetch("https://api.monday.com/v2", { method: "POST", headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" }, body: JSON.stringify({ query }) });
  const j = await r.json();
  const items = (((((j.data || {}).boards || [])[0] || {}).groups || [])[0] || {}).items_page;
  for (const it of (items && items.items) || []) {
    const c = Object.fromEntries(it.column_values.map(x => [x.id, x.text || ""]));
    const keys = [c.text_mm49w81b, c.text_mm499xez, c.text_mm49b3x7, it.name].map(norm);
    if (!keys.includes(want)) continue;
    const id = (c.text_mm499xez.match(/UC[\w-]{22}/) || c.text_mm49b3x7.match(/UC[\w-]{22}/) || [""])[0];
    return {
      id, source: "roster", title: it.name, handle: c.text_mm49w81b, thumb: "",
      subs: +c.numeric_mm49cx8f || 0, hiddenSubs: false,
      avg: Math.round(+c.numeric_mm49b3y2 || 0), basis: 10,
      perMonth: +c.numeric_mm5nn2wj || 0, shortsPerMonth: 0, lastUpload: null, recent: [],
    };
  }
  return null;
}

async function ytLookup(q, key) {
  const { id, searched } = await resolve(q, key);
  const cj = await yt("channels?part=snippet,statistics,contentDetails&id=" + id, key);
  const ch = cj.items && cj.items[0];
  if (!ch) throw new Error("Channel not found");
  const uploads = ch.contentDetails && ch.contentDetails.relatedPlaylists && ch.contentDetails.relatedPlaylists.uploads;
  let vids = [];
  if (uploads) {
    const pj = await yt("playlistItems?part=contentDetails&maxResults=50&playlistId=" + uploads, key);
    const ids = (pj.items || []).map(i => i.contentDetails && i.contentDetails.videoId).filter(Boolean);
    if (ids.length) {
      const vj = await yt("videos?part=snippet,contentDetails,statistics&id=" + ids.join(","), key);
      vids = (vj.items || []).map(v => ({
        id: v.id,
        title: v.snippet.title,
        at: v.snippet.publishedAt,
        secs: secs(v.contentDetails.duration),
        views: +(v.statistics.viewCount || 0),
        live: v.snippet.liveBroadcastContent && v.snippet.liveBroadcastContent !== "none",
      })).sort((a, b) => b.at.localeCompare(a.at));
    }
  }
  const now = Date.now(), DAY = 86400000;
  const long = vids.filter(v => v.secs > 180 && !v.live);
  const settled = long.filter(v => now - Date.parse(v.at) >= 3 * DAY).slice(0, 10);
  const avg = settled.length ? Math.round(settled.reduce((a, v) => a + v.views, 0) / settled.length) : 0;
  // Uploads a month from the last 90 days; when the 50 fetched videos cover less than 90 days, use their span.
  const span = vids.length ? Math.min(90, (now - Date.parse(vids[vids.length - 1].at)) / DAY) : 90;
  const recent = v => now - Date.parse(v.at) <= span * DAY;
  const perMonth = span > 0 ? +(long.filter(recent).length / (span / 30)).toFixed(1) : 0;
  const shortsPerMonth = span > 0 ? +(vids.filter(v => v.secs <= 180 && !v.live).filter(recent).length / (span / 30)).toFixed(1) : 0;
  const thumbs = ch.snippet.thumbnails || {};
  return {
    id,
    searched: !!searched,
    title: ch.snippet.title,
    handle: ch.snippet.customUrl || "",
    thumb: (thumbs.medium || thumbs.default || {}).url || "",
    subs: +(ch.statistics.subscriberCount || 0),
    hiddenSubs: !!ch.statistics.hiddenSubscriberCount,
    avg,
    basis: settled.length,
    perMonth,
    shortsPerMonth,
    lastUpload: long[0] ? long[0].at : null,
    recent: settled.slice(0, 5).map(v => ({ id: v.id, title: v.title, views: v.views, at: v.at.slice(0, 10) })),
  };
}
