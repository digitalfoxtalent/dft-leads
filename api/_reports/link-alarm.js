// Missing link alarm (cron /api/link-finder?pass=alarm, weekdays 15:05 UTC = 9:05am Mountain).
//
// Tom, 6 Oct 2026: Power Play's Kikoff October rows went live on 5 Oct with no video link on monday,
// so their client page showed nothing and Margot noticed before we did. The link finders wait until a
// flight has finished (about 8 days), so a person pasting the link is the only way it lands quickly.
// This alarm makes sure that person is asked, and told what an empty row costs.
//
// Changed 9 Oct 2026 (Tom): Alex and Margot no longer paste video links; links come only from the
// automatic finders (early fill, nightly link finder, unmatched reads, TikTok/Instagram finder and the
// Monday flight audit). So the alarm no longer asks the sales lead to paste anything. It now tells Tom,
// in ONE notification a day, which live rows the finders have still not filled 10 days after go-live
// (the flight has ended and every finder has had its chance), with the likely reason for each, so the
// gap can be fixed in the system rather than by hand.
//
// A creator row on US Campaigns (subitems 6162879732) gets an alarm when ALL of these hold:
//   - LIVE VIDEO URLS (text_mm6aq9qp) is empty and LINK BACKFILL (color_mm7jh1xw) has no label
//   - its LIVE DATE (timerange_mm1m50vx) started 2 to 45 days ago
//   - it is a content row (not an expense or fee line) on a deal that has been won (not Opportunities,
//     Contract Review, lost or cancelled)
// A row is reported once, from day 10 to day 45 after go-live. Each reported row gets an update
// ("Link not found automatically") that stops a repeat; Tom gets one notification per run that names
// the rows (up to 12, newest first) and their likely reason.

import { mondayCall } from "./runlog.js";
import { skipRow } from "./flight-match.js";

const SUB_BOARD = 6162879732, TOM = 40241658, D = 864e5, LIST_MAX = 12;
const FIRST_DAY = 10, LAST_DAY = 45;
const SENT = "Link not found automatically";
// Deals not yet won have provisional dates; lost or cancelled ones have nothing to report.
const SKIP_GROUP = /opportunit|contract review|lost|cancel|declin|dead|archiv/i;

const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nice = iso => { const d = new Date(iso + "T12:00:00Z"); return d.getUTCDate() + " " + MON[d.getUTCMonth()]; };

// Best guess at why the finders missed it, from what the row itself shows.
export function likelyReason(cv) {
  const del = String(cv.dropdown_mm3y3k3e || "");
  if (!String(cv.connect_boards__1 || "").trim()) return "no creator linked on the row (GLOBAL TALENT ROSTER is empty), so the finders do not know which channel to search";
  if (/tiktok|instagram|reel|short/i.test(del) && !/youtube/i.test(del)) return "a TikTok or Instagram deliverable; the social finder needs the sound, the song title or a brand tag in the post";
  if (/podcast|audio/i.test(del)) return "a podcast deliverable; podcast reach comes from the Megaphone export, not a video link";
  return "no upload in the LIVE DATE week carries a link to the brand or a spoken read of it; the video may be late, unlisted, or the LIVE DATE may be wrong";
}

async function loadRows(token) {
  const fields = "cursor items { id name updates(limit:25) { text_body } " +
    "parent_item { id name group { title } column_values(ids:[\"deal_owner\",\"dropdown_mm1a3tqp\"]) { id text ... on PeopleValue { persons_and_teams { id kind } } } } " +
    "column_values(ids:[\"timerange_mm1m50vx\",\"color_mm7jh1xw\",\"connect_boards__1\",\"dropdown_mm3y3k3e\"]) { id text ... on BoardRelationValue { display_value } } }";
  const q = p => "query { boards(ids:[" + SUB_BOARD + "]) { items_page(limit:200, query_params:{rules:[{column_id:\"text_mm6aq9qp\", compare_value:[], operator:is_empty},{column_id:\"timerange_mm1m50vx\", compare_value:[], operator:is_not_empty}]}) { " + p + " } } }";
  let d = await mondayCall(token, q(fields), {}, 25000);
  let page = d.boards[0].items_page, items = page.items.slice(), guard = 0;
  while (page.cursor && guard++ < 10) {
    d = await mondayCall(token, "query { next_items_page(limit:200, cursor:\"" + page.cursor + "\") { " + fields + " } }", {}, 25000);
    page = d.next_items_page; items = items.concat(page.items);
  }
  return items;
}

export async function runAlarm(token, opts) {
  opts = opts || {};
  const now = opts.now || Date.now(), today = new Date(now).toISOString().slice(0, 10);
  const summary = { pass: "alarm", dry: !!opts.dry, checked: 0, due: 0, sent: 0, errors: [], plan: [] };
  const items = await loadRows(token);
  const due = [];
  for (const it of items) {
    const p = it.parent_item; if (!p) continue;
    summary.checked++;
    const cv = {}; for (const c of it.column_values) cv[c.id] = (c.display_value != null && c.display_value !== "") ? c.display_value : (c.text || "");
    if (cv.color_mm7jh1xw) continue;
    if (p.group && SKIP_GROUP.test(p.group.title || "")) continue;
    const m = String(cv.timerange_mm1m50vx).match(/(\d{4}-\d{2}-\d{2})/); if (!m) continue;
    const age = Math.floor((Date.parse(today + "T00:00:00Z") - Date.parse(m[1] + "T00:00:00Z")) / D);
    if (age < FIRST_DAY || age > LAST_DAY) continue;
    if (skipRow({ row: it.name })) continue;
    const ups = (it.updates || []).map(u => u.text_body || "").join("\n");
    if (ups.includes(SENT)) continue;
    const pv = {}; for (const c of p.column_values) pv[c.id] = c.text || "";
    const brand = pv.dropdown_mm1a3tqp || String(p.name).split(/[_ ]/)[0];
    due.push({ id: it.id, row: it.name, deal: p.name, brand, live: m[1], age, why: likelyReason(cv), lead: pv.deal_owner || "" });
  }
  due.sort((a, b) => b.live.localeCompare(a.live));
  summary.due = due.length;
  for (const r of due) summary.plan.push({ id: r.id, deal: r.deal, row: r.row, live: r.live, why: r.why });
  if (opts.dry || !due.length) return summary;
  // One notification to Tom naming the rows; it opens the newest one.
  const list = due.slice(0, LIST_MAX).map(r => r.brand + " x " + r.row + " (live " + nice(r.live) + "): " + r.why).join("; ");
  const text = due.length + (due.length === 1 ? " live campaign has" : " live campaigns have") + " no video link 10+ days after go-live, and the automatic finders could not find one: " + list + (due.length > LIST_MAX ? "; and " + (due.length - LIST_MAX) + " more (each has an update)." : ".") + " Ask Claude to look at the finders for these.";
  try { await mondayCall(token, "mutation ($u: ID!, $t: ID!, $x: String!) { create_notification(user_id:$u, target_id:$t, target_type:Project, text:$x) { text } }", { u: String(TOM), t: String(due[0].id), x: text.slice(0, 1900) }); }
  catch (e) { summary.errors.push("notify: " + String(e.message || e).slice(0, 160)); }
  for (const r of due) {
    const body = "<b>" + SENT + "</b> (reported to Tom on " + today + ")<br><br>" +
      "<b>Brand:</b> " + esc(r.brand) + "<br><b>Creator:</b> " + esc(r.row) + "<br><b>Campaign:</b> " + esc(r.deal) + "<br><b>Live since:</b> " + nice(r.live) + "<br><br>" +
      "Video links come only from the automatic finders now (Tom, 9 Oct 2026). None of them has found this campaign's video 10 days after go-live. Likely reason: " + esc(r.why) + ".<br><br>" +
      "Until a link is in, the campaign has no views, CPM or guarantee progress on monday or on the client's reach report. If the LIVE DATE is wrong (the video went up on another day), correcting it lets the finders look in the right week.";
    try { await mondayCall(token, "mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t) { id } }", { i: String(r.id), t: body }); summary.sent++; }
    catch (e) { summary.errors.push(r.id + ": " + String(e.message || e).slice(0, 160)); }
  }
  return summary;
}
