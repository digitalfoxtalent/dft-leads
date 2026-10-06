// Missing link alarm (cron /api/link-finder?pass=alarm, weekdays 15:05 UTC = 9:05am Mountain).
//
// Tom, 6 Oct 2026: Power Play's Kikoff October rows went live on 5 Oct with no video link on monday,
// so their client page showed nothing and Margot noticed before we did. The link finders wait until a
// flight has finished (about 8 days), so a person pasting the link is the only way it lands quickly.
// This alarm makes sure that person is asked, and told what an empty row costs.
//
// A creator row on US Campaigns (subitems 6162879732) gets an alarm when ALL of these hold:
//   - LIVE VIDEO URLS (text_mm6aq9qp) is empty and LINK BACKFILL (color_mm7jh1xw) has no label
//   - its LIVE DATE (timerange_mm1m50vx) started 2 to 45 days ago
//   - it is a content row (not an expense or fee line) on a deal that has been won (not Opportunities,
//     Contract Review, lost or cancelled)
// First alarm on day 2; one reminder in days 9 to 16 if it is still empty; then nothing more from here
// (the 2-week check-in flags it again on its own schedule).
//
// Who: everyone in the parent deal's SALES LEAD; Tom when that is empty.
// Each alarm is a monday notification (one line, monday also uses it as the email subject) plus an
// update on the row with the detail. The update is what stops a repeat: "Link alarm sent" and
// "Link alarm reminder sent". At most 3 notifications per person per run, newest live date first and
// reminders last, so a backlog arrives over a few mornings instead of all at once.

import { mondayCall } from "./runlog.js";
import { skipRow } from "./flight-match.js";

const SUB_BOARD = 6162879732, TOM = 40241658, PER_PERSON = 3, D = 864e5;
const FIRST_DAY = 2, REMIND_DAY = 9, REMIND_UNTIL = 16, LAST_DAY = 45;
const SENT = "Link alarm sent", REMINDED = "Link alarm reminder sent";
// Deals not yet won have provisional dates; lost or cancelled ones have nothing to report.
const SKIP_GROUP = /opportunit|contract review|lost|cancel|declin|dead|archiv/i;

const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nice = iso => { const d = new Date(iso + "T12:00:00Z"); return d.getUTCDate() + " " + MON[d.getUTCMonth()]; };

async function loadRows(token) {
  const fields = "cursor items { id name updates(limit:25) { text_body } " +
    "parent_item { id name group { title } column_values(ids:[\"deal_owner\",\"dropdown_mm1a3tqp\"]) { id text ... on PeopleValue { persons_and_teams { id kind } } } } " +
    "column_values(ids:[\"timerange_mm1m50vx\",\"color_mm7jh1xw\"]) { id text } }";
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
  const summary = { pass: "alarm", dry: !!opts.dry, checked: 0, due: 0, sent: 0, reminders: 0, held: 0, errors: [], plan: [] };
  const items = await loadRows(token);
  const due = [];
  for (const it of items) {
    const p = it.parent_item; if (!p) continue;
    summary.checked++;
    const cv = {}; for (const c of it.column_values) cv[c.id] = c.text || "";
    if (cv.color_mm7jh1xw) continue;
    if (p.group && SKIP_GROUP.test(p.group.title || "")) continue;
    const m = String(cv.timerange_mm1m50vx).match(/(\d{4}-\d{2}-\d{2})/); if (!m) continue;
    const age = Math.floor((Date.parse(today + "T00:00:00Z") - Date.parse(m[1] + "T00:00:00Z")) / D);
    if (age < FIRST_DAY || age > LAST_DAY) continue;
    if (skipRow({ row: it.name })) continue;
    const ups = (it.updates || []).map(u => u.text_body || "").join("\n");
    const sent = ups.includes(SENT), reminded = ups.includes(REMINDED);
    // One reminder, in days 9 to 16. An older row that only got its first alarm late (the backlog) gets no reminder.
    if (reminded || (sent && (age < REMIND_DAY || age > REMIND_UNTIL))) continue;
    const pv = {}; let people = [];
    for (const c of p.column_values) { pv[c.id] = c.text || ""; if (c.id === "deal_owner") people = (c.persons_and_teams || []).filter(x => x.kind === "person").map(x => String(x.id)); }
    if (!people.length) people = [String(TOM)];
    const brand = pv.dropdown_mm1a3tqp || String(p.name).split(/[_ ]/)[0];
    due.push({ id: it.id, row: it.name, deal: p.name, brand, live: m[1], age, reminder: sent, people: [...new Set(people)], names: pv.deal_owner || "Tom James" });
  }
  // Newest go-lives first, so a campaign that went live two days ago is never stuck behind an older backlog; reminders last.
  due.sort((a, b) => (a.reminder - b.reminder) || b.live.localeCompare(a.live));
  summary.due = due.length;
  const count = {};
  for (const r of due) {
    if (r.people.some(u => (count[u] || 0) >= PER_PERSON)) { summary.held++; continue; }
    r.people.forEach(u => { count[u] = (count[u] || 0) + 1; });
    const who = r.brand + " x " + r.row;
    // Three lines: what is wrong, exactly how to fix it, and what it costs until then (Tom, 6 Oct 2026).
    const text = (r.reminder ? "Still no video link: " : "Video link missing: ") + who + ", live from " + nice(r.live) + ".\n" +
      "To fix: click this notification to open the row, then paste the video link into the LIVE VIDEO URLS column (several links go in the same cell, separated by commas). If the video is not up yet, change the LIVE DATE to when it will be.\n" +
      "Until then this campaign is not reported: no views, CPM or guarantee progress on monday or on the client's reach report.";
    summary.plan.push({ id: r.id, deal: r.deal, row: r.row, live: r.live, reminder: r.reminder, to: r.names, text });
    if (opts.dry) continue;
    const body =
      "<b>" + (r.reminder ? REMINDED : SENT) + "</b> to " + esc(r.names) + " on " + today + "<br><br>" +
      "<b>Brand:</b> " + esc(r.brand) + "<br><b>Creator:</b> " + esc(r.row) + "<br><b>Campaign:</b> " + esc(r.deal) + "<br><b>Live since:</b> " + nice(r.live) + "<br><br>" +
      "<b>What to do:</b> paste the video link into LIVE VIDEO URLS on this row. Several links go in the same cell, separated by commas. Include any TikTok or Instagram posts too. If the video is not up yet, move the LIVE DATE to when it will be, and this alarm waits for the new date.<br><br>" +
      "<b>Until the link is in, this campaign is not being reported:</b><br>" +
      "- Views are not counted, so LATEST VIEWS, CPM and the guarantee % stay blank on monday.<br>" +
      "- It is missing from the Campaign Reach report, including the client's own page (for example Power Play or Rhapsody), so the client sees nothing for this campaign and is more likely to chase us.<br>" +
      "- Its eCPM cannot be calculated.<br>" +
      "- The 2-week check-in with the brand cannot go out.<br>" +
      "The nightly link finder may fill it after the flight ends (about 8 days after go-live), but only when the video description links the brand. Do not rely on it.<br><br>" +
      (r.reminder ? "This is the last reminder from the link alarm." : "If it is still empty in a week, a reminder follows.");
    try {
      for (const u of r.people) await mondayCall(token, "mutation ($u: ID!, $t: ID!, $x: String!) { create_notification(user_id:$u, target_id:$t, target_type:Project, text:$x) { text } }", { u, t: String(r.id), x: text });
      await mondayCall(token, "mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t) { id } }", { i: String(r.id), t: body });
      if (r.reminder) summary.reminders++; else summary.sent++;
    } catch (e) { summary.errors.push(r.id + ": " + String(e.message || e).slice(0, 160)); }
  }
  return summary;
}
