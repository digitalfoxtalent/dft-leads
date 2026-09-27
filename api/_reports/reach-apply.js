// Reporting refresh write step (team only, POST /reach-apply). Writes Spotify, Apple Podcasts,
// Amazon Music and other-apps listens onto creator rows from a platform report read in the browser.
//
// WHY IT WORKS THIS WAY
// Megaphone (one of our distribution routes) only serves its delivery report to a signed-in browser,
// and the report cannot be sent from that tab to this site. So the Reporting refresh task reads the
// report in the Megaphone tab, keeps only episodes whose title matches a campaign video, and passes
// those few figures to the report-site tab, which posts them here together with its own map of
// campaign video -> title fingerprint. Nothing is typed into monday by hand.
//
// BODY { asOf: "YYYY-MM-DD", source: "Megaphone",
//        vh:  { youtubeId: titleHash },        // 8 hex of SHA-1 of the lower-cased letters and digits of the YouTube title
//        vat: { youtubeId: "YYYY-MM-DD" },      // YouTube publish date
//        stats: { titleHash: [[sp, ap, am, ot, episodeId, "YYYY-MM-DD published"], ...] } }
// RULES
//   - a title that matches two or more episodes is left alone and listed (a person decides)
//   - an episode published more than 2 days before the video is not a match
//   - a video already matched to a different episode keeps its first match (listed)
//   - figures only ever rise: each platform keeps the higher of the old and new number
//   - videos not in this report keep their old line; rows with nothing to change are not written
// WRITES per changed row: REACH DETAIL, SPOTIFY / APPLE PODCASTS / AMAZON MUSIC / OTHER APPS LISTENS,
// REACH SOURCES. ?dry=1 reports what it would do and writes nothing.

import { monday } from "./monday.js";
import { videoDetails } from "./campaigns/videos.js";

const SUB_BOARD = 6162879732;
const C = { urls: "text_mm6aq9qp", detail: "long_text_mm7jfzzx", sp: "numeric_mm7j691z", ap: "numeric_mm7j7zbb", am: "numeric_mm7kryz6", ot: "numeric_mm7j74wv", src: "text_mm7j9va" };
const ID_RE = /(?:v=|youtu\.be\/|shorts\/|live\/|embed\/)([A-Za-z0-9_-]{11})/g;
const DETAIL_RE = /^([A-Za-z0-9_-]{11})\s+ep:(\S+)\s+sp:(\d+)\s+ap:(\d+)\s+am:(\d+)\s+ot:(\d+)(?:\s+by:(\w+))?/;
const D = 864e5;
const day = s => new Date(String(s).slice(0, 10) + "T00:00:00Z").getTime();
const fmt = s => new Date(day(s)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

async function mondayVars(token, query, variables) {
  const r = await fetch("https://api.monday.com/v2", { method: "POST", headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" }, body: JSON.stringify({ query, variables }) });
  const d = await r.json();
  if (!r.ok || (d && d.errors)) throw new Error("monday: " + JSON.stringify((d && d.errors) || r.status).slice(0, 300));
  return d.data;
}

async function loadRows(token) {
  const ids = JSON.stringify(Object.values(C));
  const fields = "cursor items { id name column_values(ids:" + ids + ") { id text } }";
  let d = await monday(token, "query { boards(ids:[" + SUB_BOARD + "]) { items_page(limit:500, query_params:{rules:[{column_id:\"" + C.urls + "\", compare_value:[], operator:is_not_empty}]}) { " + fields + " } } }");
  let page = d.boards[0].items_page, items = page.items.slice(), guard = 0;
  while (page.cursor && guard++ < 10) { d = await monday(token, "query { next_items_page(limit:500, cursor:\"" + page.cursor + "\") { " + fields + " } }"); page = d.next_items_page; items = items.concat(page.items); }
  return items.map(it => { const o = { id: it.id, name: it.name }; for (const c of it.column_values) o[c.id] = c.text || ""; return o; });
}

function parseDetail(text) {
  const vids = {};
  for (const line of String(text || "").split(/\n/)) {
    const m = line.trim().match(DETAIL_RE); if (!m) continue;
    vids[m[1]] = { ep: m[2], sp: +m[3], ap: +m[4], am: +m[5], ot: +m[6], by: m[7] || "id" };
  }
  return vids;
}

export async function reachApply(token, body, dry) {
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(String(body && body.asOf)) ? body.asOf : new Date().toISOString().slice(0, 10);
  const source = String(body && body.source || "Megaphone").slice(0, 40);
  const vh = (body && body.vh) || {}, vat = (body && body.vat) || {}, stats = (body && body.stats) || {};
  if (!Object.keys(vh).length || !Object.keys(stats).length) throw new Error("vh and stats are both required");
  const rows = await loadRows(token);
  const out = { asOf, dry: !!dry, rows: rows.length, changed: 0, videos: 0, matched: 0, kept: 0, ambiguous: [], byDate: [], tooEarly: [], otherEpisode: [], noTitle: 0, writes: [], failed: [] };
  const plans = [];
  for (const r of rows) {
    const vids = [...new Set([...String(r[C.urls]).matchAll(ID_RE)].map(m => m[1]))];
    const old = parseDetail(r[C.detail]);
    const lines = {};
    for (const v of vids) {
      out.videos++;
      const prev = old[v];
      const h = vh[v];
      if (!h) out.noTitle++;
      const cands = (h && stats[h]) || [];
      let hit = null;
      // A title on several episodes of a show (a breakdown re-published later): the video's own copies
      // are the ones published from 2 days before to 14 days after the video. One -> that one; several
      // -> all copies of this video, added together; none, or no video date -> left for a person.
      if (cands.length > 1 && vat[v]) {
        const own = cands.filter(c => c[5] && day(c[5]) >= day(vat[v]) - 2 * D && day(c[5]) <= day(vat[v]) + 14 * D);
        if (own.length && !(prev && !own.some(c => String(c[4]) === prev.ep))) {
          const sum = own.reduce((a, c) => [a[0] + (+c[0] || 0), a[1] + (+c[1] || 0), a[2] + (+c[2] || 0), a[3] + (+c[3] || 0)], [0, 0, 0, 0]);
          hit = { ep: String(own[0][4]) + (own.length > 1 ? "+" + (own.length - 1) : ""), sp: sum[0], ap: sum[1], am: sum[2], ot: sum[3], by: "title" };
          if (prev && prev.ep !== hit.ep && own.length > 1) hit.ep = prev.ep;
          out.byDate.push(r.id + " " + v + " took " + own.length + " of " + cands.length + " episodes (" + own.map(c => c[5]).join(", ") + ")");
        } else out.ambiguous.push(r.id + " " + v + " (" + cands.length + " episodes, none published within 2 weeks of the video)");
      }
      else if (cands.length > 1) out.ambiguous.push(r.id + " " + v + " (" + cands.length + " episodes)");
      else if (cands.length === 1) {
        const [sp, ap, am, ot, ep, pub] = cands[0];
        if (pub && vat[v] && day(pub) < day(vat[v]) - 2 * D) out.tooEarly.push(r.id + " " + v + " episode " + pub + " video " + vat[v]);
        else if (prev && prev.ep !== String(ep)) out.otherEpisode.push(r.id + " " + v + " kept " + prev.ep);
        else hit = { ep: String(ep), sp: +sp || 0, ap: +ap || 0, am: +am || 0, ot: +ot || 0, by: "title" };
      }
      if (hit && prev) for (const k of ["sp", "ap", "am", "ot"]) hit[k] = Math.max(hit[k], prev[k]);
      if (hit) { out.matched++; lines[v] = hit; }
      else if (prev) { out.kept++; lines[v] = prev; }
    }
    if (!Object.keys(lines).length) continue;
    const sum = { sp: 0, ap: 0, am: 0, ot: 0 };
    for (const l of Object.values(lines)) for (const k in sum) sum[k] += l[k];
    for (const k in sum) { const was = parseFloat(r[C[k]]); if (Number.isFinite(was)) sum[k] = Math.max(sum[k], was); }
    const detail = "as of " + asOf + " (Spotify and apps, from the " + source + " report; figures only rise)\n" +
      Object.entries(lines).map(([v, l]) => v + " ep:" + l.ep + " sp:" + l.sp + " ap:" + l.ap + " am:" + l.am + " ot:" + l.ot + " by:" + l.by).join("\n");
    const same = String(r[C.detail]).replace(/^as of [^\n]*\n?/, "").trim() === detail.replace(/^as of [^\n]*\n?/, "").trim() &&
      ["sp", "ap", "am", "ot"].every(k => parseFloat(r[C[k]]) === sum[k]);
    if (same) continue;
    const vals = { [C.detail]: { text: detail }, [C.sp]: String(sum.sp), [C.ap]: String(sum.ap), [C.am]: String(sum.am), [C.ot]: String(sum.ot),
      [C.src]: "Spotify and apps " + fmt(asOf) + " (" + source + ")" };
    plans.push({ id: r.id, name: r.name, sum, n: Object.keys(lines).length, vals });
  }
  out.changed = plans.length;
  out.writes = plans.slice(0, 40).map(p => p.id + " " + p.name + " sp " + p.sum.sp + " ap " + p.sum.ap + " am " + p.sum.am + " ot " + p.sum.ot + " (" + p.n + " videos)");
  if (dry || !plans.length) return out;
  // 10 rows per request, 5 requests at a time (the same pattern as the view sync)
  const batches = []; for (let i = 0; i < plans.length; i += 10) batches.push(plans.slice(i, i + 10));
  const one = async b => {
    const q = "mutation (" + b.map((_, i) => "$v" + i + ": JSON!").join(", ") + ") { " + b.map((p, i) => "r" + i + ": change_multiple_column_values(board_id:" + SUB_BOARD + ", item_id:" + p.id + ", column_values:$v" + i + ") { id }").join(" ") + " }";
    const vars = {}; b.forEach((p, i) => { vars["v" + i] = JSON.stringify(p.vals); });
    try { await mondayVars(token, q, vars); }
    catch (e) { for (const p of b) { try { await mondayVars(token, "mutation ($v: JSON!) { change_multiple_column_values(board_id:" + SUB_BOARD + ", item_id:" + p.id + ", column_values:$v) { id } }", { v: JSON.stringify(p.vals) }); } catch (e2) { out.failed.push(p.id + " " + String(e2.message).slice(0, 120)); } } }
  };
  for (let i = 0; i < batches.length; i += 5) await Promise.all(batches.slice(i, i + 5).map(one));
  return out;
}

// From a platform report the team uploaded on /refresh (the page parses the file in the browser and
// posts one entry per episode): the server matches episodes to campaign videos itself, by exact title
// (lower-cased letters and digits only), using the YouTube titles it reads for the campaign videos.
// BODY { asOf, source, episodes: [{ t: title, e: episodeId, p: "YYYY-MM-DD", sp, ap, am, ot }] }
export const normTitle = s => String(s || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
export async function reachApplyEpisodes(token, body, dry) {
  const eps = Array.isArray(body && body.episodes) ? body.episodes : [];
  if (eps.length < 50) throw new Error("the file has too few episodes (" + eps.length + ") - is it the right report?");
  const rows = await loadRows(token);
  const vids = [...new Set(rows.flatMap(r => [...String(r[C.urls]).matchAll(ID_RE)].map(m => m[1])))];
  const chunks = []; for (let i = 0; i < vids.length; i += 50) chunks.push(vids.slice(i, i + 50));
  const info = {};
  for (let i = 0; i < chunks.length; i += 5) {
    const got = await Promise.all(chunks.slice(i, i + 5).map(c => videoDetails(c.join(",")).catch(() => ({ videos: {} }))));
    for (const g of got) Object.assign(info, g.videos || {});
  }
  const vh = {}, vat = {};
  for (const v of vids) if (info[v] && info[v].t) { vh[v] = normTitle(info[v].t); if (info[v].at) vat[v] = info[v].at; }
  const want = new Set(Object.values(vh)), stats = {};
  for (const e of eps) {
    const k = normTitle(e.t); if (!k || !want.has(k)) continue;
    (stats[k] = stats[k] || []).push([+e.sp || 0, +e.ap || 0, +e.am || 0, +e.ot || 0, String(e.e || "").slice(0, 36), String(e.p || "").slice(0, 10)]);
  }
  const out = await reachApply(token, { asOf: body.asOf, source: body.source, vh, vat, stats }, dry);
  out.episodes = eps.length; out.titlesRead = Object.keys(vh).length; out.campaignVideos = vids.length;
  out.episodesMatched = Object.values(stats).reduce((a, l) => a + l.length, 0);
  return out;
}
