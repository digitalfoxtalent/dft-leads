// Link finder for creator rows that have no LIVE VIDEO URLS. READ ONLY: it suggests, it never writes.
//
// For each creator row with no link, it looks through that creator's YouTube uploads in a window
// around the row's live date (or the deal's close date) and suggests videos whose title or
// description names the brand. A human approves before anything is written to monday.
//
//   /backfill            -> which creators have rows without links, and how many
//   /backfill?h=@handle  -> suggested videos for that creator's rows

import { monday } from "./monday.js";

const SUB_BOARD = 6162879732;
const WIN_BEFORE = 14, WIN_AFTER = 75; // days around the live or close date

const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

export async function missingRows(token) {
  const fields = "cursor items { id name parent_item { id name group { title } column_values(ids:[\"date__1\",\"dropdown_mm1a3tqp\",\"connect_boards\",\"lookup_mkz6pygk\",\"lookup_mm5zp13v\"]) { id text ... on BoardRelationValue { display_value } ... on MirrorValue { display_value } } } column_values(ids:[\"connect_boards__1\",\"timerange_mm1m50vx\",\"date_mm1mb38m\",\"color_mm7jh1xw\"]) { id text ... on BoardRelationValue { display_value } } }";
  let d = await monday(token, "query { boards(ids:[" + SUB_BOARD + "]) { items_page(limit:500, query_params:{rules:[{column_id:\"text_mm6aq9qp\", compare_value:[], operator:is_empty}]}) { " + fields + " } } }");
  let page = d.boards[0].items_page, items = page.items.slice(), guard = 0;
  while (page.cursor && guard++ < 10) {
    d = await monday(token, "query { next_items_page(limit:500, cursor:\"" + page.cursor + "\") { " + fields + " } }");
    page = d.next_items_page; items = items.concat(page.items);
  }
  const out = [];
  for (const it of items) {
    const p = it.parent_item; if (!p) continue;
    const cv = {}; for (const c of it.column_values) cv[c.id] = (c.display_value != null && c.display_value !== "") ? c.display_value : c.text;
    const pv = {}; for (const c of p.column_values) pv[c.id] = (c.display_value != null && c.display_value !== "") ? c.display_value : c.text;
    const brand = pv.dropdown_mm1a3tqp || String(p.name).split(/[_]/)[0];
    const live = String(cv.timerange_mm1m50vx || "").slice(0, 10);
    if (cv.color_mm7jh1xw) continue; // already handled by the nightly backfill
    out.push({ id: it.id, row: it.name, deal: p.name, dealId: p.id, stage: p.group && p.group.title, h: cv.connect_boards__1 || "",
      brand, live, pub: cv.date_mm1mb38m || "", closed: pv.date__1 || "",
      client: [pv.connect_boards, pv.lookup_mkz6pygk, pv.lookup_mm5zp13v].filter(Boolean).join(", ") });
  }
  return out;
}

export async function yt(path, key) {
  const r = await fetch("https://www.googleapis.com/youtube/v3/" + path + (path.includes("?") ? "&" : "?") + "key=" + key);
  const j = await r.json();
  if (!r.ok) throw new Error("YouTube " + r.status + ": " + JSON.stringify(j.error && j.error.message || j).slice(0, 160));
  return j;
}

// GTR: roster row name -> YouTube handle, and whether the creator is on the signed roster.
const ROSTER_GROUPS = new Set(["youtube long form", "short form", "need to set up with suppliers"]);
export async function loadGtr(token) {
  const g = await monday(token, "query { boards(ids:[6160485039]) { items_page(limit:500) { items { name group { title } column_values(ids:[\"text_mm6nqp7b\",\"color_mm6cgavk\"]) { id text } } } } }");
  const handle = {}, signed = {};
  for (const it of g.boards[0].items_page.items) {
    const cv = {}; for (const c of it.column_values) cv[c.id] = c.text || "";
    const k = String(it.name).toLowerCase();
    handle[k] = cv.text_mm6nqp7b || "";
    signed[k] = ROSTER_GROUPS.has(String(it.group && it.group.title || "").toLowerCase()) || cv.color_mm6cgavk === "Signed";
  }
  return { handle, signed };
}

export const anchorOf = r => r.pub || r.live || r.closed;

// Look through one creator's uploads and return every candidate video for each of their rows.
export async function scanCreator(handle, mine, key, gtr, pageCap) {
  const PAGE_CAP = Math.max(1, Math.min(40, Number(pageCap) || 20)); // YouTube quota guard: 1 unit per page
  const ytHandle = (gtr && gtr.handle[handle.toLowerCase()]) || handle;
  const ch = await yt("channels?part=contentDetails,snippet&forHandle=" + encodeURIComponent(ytHandle), key);
  const c0 = ch.items && ch.items[0];
  if (!c0) return { handle, ytHandle, notFound: true, units: 1, rows: mine.map(r => ({ ...r, anchor: anchorOf(r), candidates: [] })) };
  const uploads = c0.contentDetails.relatedPlaylists.uploads;
  const anchor = anchorOf;
  const dates = mine.map(anchor).filter(Boolean).sort();
  const earliest = dates.length ? new Date(new Date(dates[0]).getTime() - WIN_BEFORE * 864e5) : null;
  const vids = []; let pageToken = "", pages = 0;
  while (pages++ < PAGE_CAP) {
    const pl = await yt("playlistItems?part=contentDetails&maxResults=50&playlistId=" + uploads + (pageToken ? "&pageToken=" + pageToken : ""), key);
    for (const x of pl.items || []) vids.push({ id: x.contentDetails.videoId, at: x.contentDetails.videoPublishedAt });
    const last = pl.items && pl.items.length && pl.items[pl.items.length - 1].contentDetails.videoPublishedAt;
    if (!pl.nextPageToken || (earliest && last && new Date(last) < earliest)) break;
    pageToken = pl.nextPageToken;
  }
  const reachedBack = !earliest || (vids.length && new Date(vids[vids.length - 1].at) < earliest) || pages <= PAGE_CAP;
  const inWin = (v, r) => { const a = anchor(r); if (!a || !v.at) return false; const t = new Date(v.at).getTime(), c = new Date(a).getTime(); return t >= c - WIN_BEFORE * 864e5 && t <= c + WIN_AFTER * 864e5; };
  const need = vids.filter(v => mine.some(r => inWin(v, r)));
  const info = {};
  for (let i = 0; i < need.length; i += 50) {
    const vd = await yt("videos?part=snippet,statistics,contentDetails&id=" + need.slice(i, i + 50).map(v => v.id).join(","), key);
    for (const x of vd.items || []) info[x.id] = { title: x.snippet.title, desc: x.snippet.description || "", at: x.snippet.publishedAt, views: Number(x.statistics.viewCount || 0), dur: x.contentDetails.duration };
  }
  const words = brand => String(brand || "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const rows = mine.map(r => {
    const w = words(r.brand), squash = w.replace(/ /g, "");
    const cands = [];
    if (squash.length >= 3) {
      const re = new RegExp("\\b" + w.split(" ").map(x => x.replace(/[.*+?^${}()|[\]\\]/g, "")).join("[\\s-]*") + "\\b", "i");
      for (const v of need) {
        if (!inWin(v, r) || !info[v.id]) continue;
        const I = info[v.id], desc = I.desc;
        const inTitle = re.test(I.title);
        const m = re.exec(desc);
        const urls = (desc.match(/https?:\/\/[^\s)]+/gi) || []).filter(u => u.toLowerCase().replace(/[^a-z0-9]/g, "").includes(squash));
        if (!inTitle && !m && !urls.length) continue;
        const near = m ? /sponsor|partner|thanks to|brought to you|use (my )?code|promo code/i.test(desc.slice(Math.max(0, m.index - 250), m.index + 250)) : false;
        const score = (urls.length ? 3 : 0) + (near ? 2 : 0) + (m ? 1 : 0) + (inTitle ? 1 : 0);
        const days = (new Date(I.at) - new Date(anchor(r))) / 864e5;
        cands.push({ v: v.id, title: I.title.slice(0, 90), at: I.at.slice(0, 10), views: I.views, score, sponsorLink: !!urls.length, sponsorWords: near, days: Math.round(days), link: urls[0] ? urls[0].slice(0, 80) : "", short: /^PT(\d+S|[0-5]?\dS?)$/.test(I.dur) });
      }
    }
    cands.sort((x, y) => y.score - x.score || Math.abs(x.days - 3) - Math.abs(y.days - 3));
    return { ...r, anchor: anchor(r), candidates: cands };
  });
  return { handle, ytHandle, channel: c0.snippet.title, scanned: vids.length, checked: need.length, reachedBack, units: 1 + pages + Math.ceil(need.length / 50), rows };
}

export async function backfill(token, handle, maxPages) {
  const rows = await missingRows(token);
  if (!handle) {
    const by = {};
    for (const r of rows) { const k = r.h || "(no roster link)"; by[k] = by[k] || { rows: 0, dated: 0 }; by[k].rows++; if (r.live || r.pub || r.closed) by[k].dated++; }
    return { total: rows.length, creators: by };
  }
  const key = process.env.YOUTUBE_API_KEY; if (!key) throw new Error("YOUTUBE_API_KEY missing");
  const mine = rows.filter(r => r.h.toLowerCase() === handle.toLowerCase());
  if (!mine.length) return { handle, rows: [] };
  const gtr = await loadGtr(token);
  const x = await scanCreator(handle, mine, key, gtr, maxPages);
  return { ...x, rows: x.rows.map(r => ({ id: r.id, deal: r.deal, row: r.row, stage: r.stage, brand: r.brand, anchor: r.anchor, candidates: r.candidates.slice(0, 5) })) };
}
