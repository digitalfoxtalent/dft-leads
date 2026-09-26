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

async function missingRows(token) {
  const fields = "cursor items { id name parent_item { id name group { title } column_values(ids:[\"date__1\",\"dropdown_mm1a3tqp\"]) { id text } } column_values(ids:[\"connect_boards__1\",\"timerange_mm1m50vx\",\"date_mm1mb38m\"]) { id text ... on BoardRelationValue { display_value } } }";
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
    const pv = {}; for (const c of p.column_values) pv[c.id] = c.text;
    const brand = pv.dropdown_mm1a3tqp || String(p.name).split(/[_]/)[0];
    const live = String(cv.timerange_mm1m50vx || "").slice(0, 10);
    out.push({ id: it.id, row: it.name, deal: p.name, dealId: p.id, stage: p.group && p.group.title, h: cv.connect_boards__1 || "",
      brand, live, pub: cv.date_mm1mb38m || "", closed: pv.date__1 || "" });
  }
  return out;
}

async function yt(path, key) {
  const r = await fetch("https://www.googleapis.com/youtube/v3/" + path + (path.includes("?") ? "&" : "?") + "key=" + key);
  const j = await r.json();
  if (!r.ok) throw new Error("YouTube " + r.status + ": " + JSON.stringify(j.error && j.error.message || j).slice(0, 160));
  return j;
}

export async function backfill(token, handle) {
  const rows = await missingRows(token);
  if (!handle) {
    const by = {};
    for (const r of rows) { const k = r.h || "(no roster link)"; by[k] = by[k] || { rows: 0, dated: 0 }; by[k].rows++; if (r.live || r.pub || r.closed) by[k].dated++; }
    return { total: rows.length, creators: by };
  }
  const key = process.env.YOUTUBE_API_KEY; if (!key) throw new Error("YOUTUBE_API_KEY missing");
  const mine = rows.filter(r => r.h.toLowerCase() === handle.toLowerCase());
  if (!mine.length) return { handle, rows: [] };
  // The roster row name is not always the real YouTube handle; the GTR YouTube Handle column is.
  const g = await monday(token, "query { boards(ids:[6160485039]) { items_page(limit:500) { items { name column_values(ids:[\"text_mm6nqp7b\"]) { text } } } } }");
  const gtr = {}; for (const it of g.boards[0].items_page.items) gtr[String(it.name).toLowerCase()] = (it.column_values[0] && it.column_values[0].text) || "";
  const ytHandle = gtr[handle.toLowerCase()] || handle;
  const ch = await yt("channels?part=contentDetails,snippet&forHandle=" + encodeURIComponent(ytHandle), key);
  const c0 = ch.items && ch.items[0];
  if (!c0) return { handle, error: "channel not found for handle", rows: mine.map(r => ({ ...r, candidates: [] })) };
  const uploads = c0.contentDetails.relatedPlaylists.uploads;
  const anchor = r => r.pub || r.live || r.closed;
  const dates = mine.map(anchor).filter(Boolean).sort();
  const earliest = dates.length ? new Date(new Date(dates[0]).getTime() - WIN_BEFORE * 864e5) : null;
  // Walk the uploads playlist newest first until we pass the earliest window.
  const vids = []; let pageToken = "", pages = 0;
  while (pages++ < 60) {
    const pl = await yt("playlistItems?part=contentDetails&maxResults=50&playlistId=" + uploads + (pageToken ? "&pageToken=" + pageToken : ""), key);
    for (const x of pl.items || []) vids.push({ id: x.contentDetails.videoId, at: x.contentDetails.videoPublishedAt });
    const last = pl.items && pl.items.length && pl.items[pl.items.length - 1].contentDetails.videoPublishedAt;
    if (!pl.nextPageToken || (earliest && last && new Date(last) < earliest)) break;
    pageToken = pl.nextPageToken;
  }
  // Only fetch details for videos that fall inside some row's window.
  const inWin = (v, r) => { const a = anchor(r); if (!a || !v.at) return false; const t = new Date(v.at).getTime(), c = new Date(a).getTime(); return t >= c - WIN_BEFORE * 864e5 && t <= c + WIN_AFTER * 864e5; };
  const need = vids.filter(v => mine.some(r => inWin(v, r)));
  const info = {};
  for (let i = 0; i < need.length; i += 50) {
    const vd = await yt("videos?part=snippet,statistics,contentDetails&id=" + need.slice(i, i + 50).map(v => v.id).join(","), key);
    for (const x of vd.items || []) info[x.id] = { title: x.snippet.title, desc: x.snippet.description || "", at: x.snippet.publishedAt, views: Number(x.statistics.viewCount || 0), dur: x.contentDetails.duration };
  }
  // Scoring. A brand named as a whole word counts; named inside a link counts most (sponsor
  // links); "sponsor" near the brand adds weight. Among equals, the video closest after the
  // live date wins. "strong" = one clear winner with a sponsor link or sponsor wording.
  const words = brand => String(brand || "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const out = mine.map(r => {
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
        cands.push({ v: v.id, title: I.title.slice(0, 90), at: I.at.slice(0, 10), views: I.views, score, days: Math.round(days), link: urls[0] ? urls[0].slice(0, 80) : "", short: /^PT(\d+S|[0-5]?\dS?)$/.test(I.dur) });
      }
    }
    cands.sort((x, y) => y.score - x.score || Math.abs(x.days - 3) - Math.abs(y.days - 3));
    const top = cands[0], second = cands[1];
    const conf = !top ? "none" : (top.score >= 3 && (!second || second.score < top.score) ? "strong" : "possible");
    return { id: r.id, deal: r.deal, row: r.row, stage: r.stage, brand: r.brand, anchor: anchor(r), conf, candidates: cands.slice(0, 5) };
  });
  return { handle, ytHandle, channel: c0.snippet.title, scanned: vids.length, checked: need.length, rows: out };
}
