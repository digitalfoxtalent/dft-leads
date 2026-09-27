// Upload scan for the link backfill (team only, GET /scan?h=@handle&since=YYYY-MM-DD). READ ONLY.
//
// Lists a creator's YouTube uploads from `since` to now, compactly, with the evidence needed to
// match creator rows to videos: publish date, length, views, title, and which of that creator's
// open-row brands the title or description names (m; mt = named in the title), plus description links naming a brand (u)
// and the other non-social links (x), so a standing link can be told apart from a one-off read.
// Cost: about 2 YouTube units per 50 uploads.

import { yt, loadGtr, missingRows } from "./backfill.js";

const SOCIAL = /(youtube\.com|youtu\.be|instagram\.com|twitter\.com|x\.com|tiktok\.com|facebook\.com|fb\.com|discord\.(gg|com)|twitch\.tv|patreon\.com|threads\.net|linktr\.ee|bsky\.app|reddit\.com|spotify\.com|apple\.com|google\.com|goo\.gl|amzn\.to|amazon\.com)/i;
const squash = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const secs = d => { const m = String(d || "").match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); return m ? ((+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0)) : 0; };

export async function scanUploads(token, handle, since, extraBrands, maxPages) {
  const key = process.env.YOUTUBE_API_KEY; if (!key) throw new Error("YOUTUBE_API_KEY missing");
  const gtr = await loadGtr(token);
  const ytHandle = gtr.handle[String(handle).toLowerCase()] || handle;
  const rows = (await missingRows(token)).filter(r => r.h.toLowerCase() === String(handle).toLowerCase());
  const brands = [...new Set(rows.map(r => r.brand).concat(String(extraBrands || "").split(",")).map(b => String(b || "").trim()).filter(Boolean))];
  const bre = brands.map(b => ({ b, sq: squash(b), re: new RegExp("\\b" + String(b).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").join("[\\s.-]*") + "\\b", "i") })).filter(x => x.sq.length >= 3);
  let units = 1;
  const ch = await yt("channels?part=contentDetails,snippet&forHandle=" + encodeURIComponent(ytHandle), key);
  const c0 = ch.items && ch.items[0];
  if (!c0) return { handle, ytHandle, notFound: true, units, brands };
  const up = c0.contentDetails.relatedPlaylists.uploads;
  const from = since ? new Date(since) : new Date(Date.now() - 400 * 864e5);
  const ids = []; let pageToken = "", pages = 0, reachedBack = false;
  const cap = Math.max(1, Math.min(60, Number(maxPages) || 40));
  while (pages < cap) {
    pages++; units++;
    const pl = await yt("playlistItems?part=contentDetails&maxResults=50&playlistId=" + up + (pageToken ? "&pageToken=" + pageToken : ""), key);
    for (const x of pl.items || []) if (new Date(x.contentDetails.videoPublishedAt || 0) >= from) ids.push(x.contentDetails.videoId);
    const last = pl.items && pl.items.length && pl.items[pl.items.length - 1].contentDetails.videoPublishedAt;
    if (!pl.nextPageToken) { reachedBack = true; break; }
    if (last && new Date(last) < from) { reachedBack = true; break; }
    pageToken = pl.nextPageToken;
  }
  const vids = [];
  for (let i = 0; i < ids.length; i += 50) {
    units++;
    const vd = await yt("videos?part=snippet,statistics,contentDetails&id=" + ids.slice(i, i + 50).join(","), key);
    for (const x of vd.items || []) {
      const t = x.snippet.title || "", d = x.snippet.description || "";
      const urls = (d.match(/https?:\/\/[^\s)\]]+/gi) || []).map(u => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/[.,!]+$/, ""));
      const m = bre.filter(z => z.re.test(t) || z.re.test(d)).map(z => z.b), mt = bre.filter(z => z.re.test(t)).map(z => z.b);
      const u = urls.filter(x2 => bre.some(z => squash(x2).includes(z.sq))).slice(0, 4);
      const xo = [...new Set(urls.filter(x2 => !SOCIAL.test(x2) && !u.includes(x2)).map(x2 => x2.slice(0, 40)))].slice(0, 6);
      vids.push({ v: x.id, at: String(x.snippet.publishedAt || "").slice(0, 10), s: secs(x.contentDetails.duration), n: Number(x.statistics && x.statistics.viewCount || 0), t: t.slice(0, 70), m, mt: mt.length ? mt : undefined, u, x: xo, live: x.snippet.liveBroadcastContent !== "none" ? x.snippet.liveBroadcastContent : undefined });
    }
  }
  vids.sort((a, b) => a.at.localeCompare(b.at));
  return { handle, ytHandle, channel: c0.snippet.title, since: from.toISOString().slice(0, 10), reachedBack, units, brands, count: vids.length, vids };
}
