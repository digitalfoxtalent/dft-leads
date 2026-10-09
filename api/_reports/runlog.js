// Run log for the nightly campaign-link jobs, so a job that stops running is noticed the next morning.
//
// Each scheduled run of the link finder (both passes) and the podcast export reader adds one item to the monday board
// "Campaign link backfill log" (18432874155): name "nightly <job> <YYYY-MM-DD HH:MM> <status>",
// with the run's summary as an update. The watchdog below (cron /api/link-finder?pass=watch) reads them every morning and
// notifies Tom when a job has no run in the last 26 hours, or its last run failed.
//
// Logging is best effort: it never throws and never holds a run up for more than a few seconds.

export const RUN_BOARD = 18432874155;
export const JOBS = { links: "link-finder", unmatched: "unmatched-reads", podcasts: "podcast-export", alarm: "link-alarm", social: "social-links" };
const LABEL = { "link-finder": "Link finder (empty rows)", "unmatched-reads": "Make-good and unmatched reads pass", "podcast-export": "Podcast reach from the Megaphone export", "link-alarm": "Missing link alarm (weekdays)", "social-links": "TikTok and Instagram link finder" };

async function mondayCall(token, query, variables, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 8000);
  try {
    const r = await fetch("https://api.monday.com/v2", {
      method: "POST", signal: ctl.signal,
      headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" },
      body: JSON.stringify({ query, variables: variables || {} }),
    });
    const d = await r.json();
    if (!r.ok || (d && d.errors)) throw new Error("monday: " + JSON.stringify((d && d.errors) || r.status).slice(0, 300));
    return d.data;
  } finally { clearTimeout(t); }
}
export { mondayCall };

const stamp = ms => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
const esc = s => String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// status: "ok" | "partial" | "failed" | "alert" (the watchdog found a problem)
export function runStatus(summary) {
  if (!summary || summary.failed || summary.error) return "failed";
  if (summary.problems && summary.problems.length) return "alert";
  const errs = (summary.errors || []).filter(e => !/channel not found|YouTube 404/i.test(String(e)));
  return errs.length ? "partial" : "ok";
}

export async function recordRun(token, job, summary) {
  if (!token) return null;
  try {
    const status = runStatus(summary);
    const name = "nightly " + job + " " + stamp(Date.now()) + " " + status;
    const d = await mondayCall(token, "mutation ($b: ID!, $n: String!) { create_item(board_id:$b, item_name:$n) { id } }", { b: String(RUN_BOARD), n: name });
    const id = d && d.create_item && d.create_item.id;
    if (id) {
      const body = "<pre>" + esc(JSON.stringify(summary, null, 1)).slice(0, 15000) + "</pre>";
      await mondayCall(token, "mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t) { id } }", { i: String(id), t: body });
    }
    return id;
  } catch (e) {
    return null;
  }
}

// Morning watchdog (cron /api/link-finder?pass=watch at 10:15 UTC, after the 09:00 YouTube view sync).
// Checks, for the last 26 hours:
//   1. the link finder logged a run, and it did not fail
//   2. the unmatched sponsor reads pass logged a run, and it did not fail
//   3. the podcast export reader (/api/podcast-sync) logged a run, and it did not fail
//   3a. the TikTok and Instagram link finder (?pass=social, daily 08:05 UTC) logged a run, and it did not fail
//   3b. the missing link alarm (?pass=alarm, weekdays) logged a run, and it did not fail (checked Tuesday to Saturday)
//   4. the YouTube view sync wrote LATEST VIEWS on the creator rows (it changes hundreds every day)
// A run that finished with errors ("partial", e.g. the YouTube allowance ran out) counts as a problem
// when the run before it was not clean either: two days in a row means it is not catching up by itself.
// Anything wrong: one alert item on the run log board and a monday notification to Tom.
// A clean morning logs "nightly cron-watch ... ok" and sends nothing.
export const WATCH_USERS = [40241658]; // Tom James
const SUB_BOARD = 6162879732, LATEST_VIEWS = "numeric_mm4bn6yq", WINDOW_H = 26;
const NEW_JOB_GRACE = { "podcast-export": "2026-10-10T00:00:00Z", "link-alarm": "2026-10-08T00:00:00Z", "social-links": "2026-10-14T00:00:00Z" };

export async function runWatch(token, opts) {
  opts = opts || {};
  const now = Date.now(), since = now - WINDOW_H * 36e5, problems = [], seen = {};
  const d = await mondayCall(token, "query { boards(ids:[" + RUN_BOARD + "]) { items_page(limit:100, query_params:{order_by:[{column_id:\"__creation_log__\", direction:desc}]}) { items { id name created_at } } } }", {}, 20000);
  const all = d.boards[0].items_page.items || [];
  const items = all.filter(i => new Date(i.created_at).getTime() >= since);
  const dow = new Date(now).getUTCDay(); // the alarm runs Monday to Friday at 15:05 UTC, so this 10:15 check sees it Tuesday to Saturday
  for (const job of [JOBS.links, JOBS.unmatched, JOBS.podcasts, JOBS.social].concat(dow >= 2 && dow <= 6 ? [JOBS.alarm] : [])) {
    const mine = i => String(i.name).startsWith("nightly " + job + " ");
    const runs = items.filter(mine);
    seen[job] = runs.map(i => i.name);
    // A new job gets until NEW_JOB_GRACE to log its first run, so the morning before its first run is quiet.
    if (!runs.length && NEW_JOB_GRACE[job] && now < Date.parse(NEW_JOB_GRACE[job]) && !all.some(mine)) { seen[job] = "not started yet"; continue; }
    if (!runs.length) { problems.push(LABEL[job] + " did not run in the last " + WINDOW_H + " hours"); continue; }
    if (/ failed$/.test(runs[0].name)) { problems.push(LABEL[job] + " ran but failed: " + runs[0].name); continue; }
    const prev = all.filter(mine).find(i => i.id !== runs[0].id);
    if (/ partial$/.test(runs[0].name) && prev && !/ ok$/.test(prev.name)) problems.push(LABEL[job] + " finished with errors two runs in a row: " + runs[0].name + " (open it for the errors)");
  }
  const a = await mondayCall(token, "query { boards(ids:[" + SUB_BOARD + "]) { activity_logs(from:\"" + new Date(since).toISOString() + "\", column_ids:[\"" + LATEST_VIEWS + "\"], limit:1) { id } } }", {}, 20000);
  const viewWrites = (a.boards[0].activity_logs || []).length;
  if (!viewWrites) problems.push("YouTube view sync wrote no views in the last " + WINDOW_H + " hours");
  const summary = { pass: "watch", problems, seen, viewWrites };
  if (opts.dry) return summary;
  const day = new Date(now).toISOString().slice(0, 10);
  if (problems.length) {
    const alert = await mondayCall(token, "mutation ($b: ID!, $n: String!) { create_item(board_id:$b, item_name:$n) { id } }", { b: String(RUN_BOARD), n: "ALERT " + day + ": campaign reporting jobs need a look" });
    const id = alert && alert.create_item && alert.create_item.id;
    if (id) {
      await mondayCall(token, "mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t) { id } }", { i: String(id), t: "<ul>" + problems.map(p => "<li>" + esc(p) + "</li>").join("") + "</ul><p>Logs: Vercel project dft-leads, Logs, filter /api/link-finder, /api/podcast-sync or /api/view-count-sync.</p>" });
      const text = "Campaign reporting jobs need a look: " + day + "\n" + problems.slice(0, 4).join("\n") + "\nCampaign reporting may be missing links, views or podcast numbers until fixed.\nCheck the Vercel dft-leads logs. Tom";
      for (const u of WATCH_USERS) {
        try { await mondayCall(token, "mutation ($u: ID!, $t: ID!, $x: String!) { create_notification(user_id:$u, target_id:$t, target_type:Project, text:$x) { text } }", { u: String(u), t: String(id), x: text }); summary.notified = (summary.notified || 0) + 1; }
        catch (e) { summary.notifyError = String(e.message || e).slice(0, 200); }
      }
    }
  }
  await recordRun(token, "cron-watch", summary);
  return summary;
}
