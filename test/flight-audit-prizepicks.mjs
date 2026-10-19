// Replays the 19 Oct 2026 PrizePicks x The Reel Rejects case with monday, YouTube scan, transcripts and fetch mocked.
// Run: node --experimental-test-module-mocks test/flight-audit-prizepicks.mjs
// Two reads from 16 and 18 Oct sat inside October Spot1's own flight (12 to 18 Oct). Because that flight had ended
// the day before, the audit left it out and flagged both reads to Tom as make-goods for September Spot2 instead.
// Fixed: a read inside any row's own dates belongs to that row, and a flight counts as finished the day after it ends.
import assert from "node:assert/strict";
import { mock } from "node:test";
const R = new URL("../api/_reports/", import.meta.url).href;
const READ = "let's go. this week's videos are sponsored by prizepicks the easy to use fantasy sports betting app. more on them in just a bit";
const now = Date.parse("2026-10-19T08:34:00Z"); // the Monday run
const item = (id, deal, live, links) => ({ id, name: "TRR", parent_item: { id: "p" + id, name: deal, group: { title: "Client Invoiced" }, column_values: [{ id: "dropdown_mm1a3tqp", text: "PrizePicks" }] },
  column_values: [{ id: "connect_boards__1", text: "", display_value: "@reelrejects" }, { id: "text_mm6aq9qp", text: links }, { id: "timerange_mm1m50vx", text: live }, { id: "date_mm1mb38m", text: "" }] });
const board = [
  item("201", "PrizePicks_TRR_September_Spot2_2026", "2026-09-28 - 2026-10-04", "https://www.youtube.com/watch?v=SEPT0000001, https://www.youtube.com/watch?v=SEPT0000002"),
  item("202", "PrizePicks_TRR_October_Spot1_2026", "2026-10-12 - 2026-10-18", "https://www.youtube.com/watch?v=OCT00000001"),
  item("203", "PrizePicks_TRR_December_2026", "2026-12-21 - 2026-12-27", ""),
];
const up = (v, at) => ({ v, at: at + "T16:00:00Z", n: 1000, t: "Video " + v, u: [], m: ["prizepicks"] });
const vids = [up("SEPT0000001", "2026-09-29"), up("SEPT0000002", "2026-10-01"), up("OCT00000001", "2026-10-13"), up("mOhb1WbilOE", "2026-10-16"), up("oh9nEh-EOZg", "2026-10-18")];
const text = Object.fromEntries(vids.map(v => [v.v, READ]));
const updates = {};
const real = async f => ({ ...(await import(R + f + "?real")) });
mock.module(R + "monday.js", { namedExports: { ...(await real("monday.js")), monday: async (t, q) => {
  if (q.includes("items_page")) return { boards: [{ items_page: { cursor: null, items: board } }] };
  const m = q.match(/items\(ids:\[(\d+)\]\)/); if (m) { const it = board.find(x => x.id === m[1]);
    return { items: [{ name: it.name, parent_item: { name: it.parent_item.name }, column_values: [{ text: it.column_values[1].text }], updates: (updates[m[1]] || []).map(b => ({ text_body: b })) }] }; }
  throw new Error("unexpected monday query " + q.slice(0, 80)); } } });
mock.module(R + "scan.js", { namedExports: { ...(await real("scan.js")), scanUploads: async () => ({ vids, units: 3 }) } });
mock.module(R + "backfill.js", { namedExports: { ...(await real("backfill.js")), loadGtr: async () => ({}) } });
mock.module(R + "timestamps.js", { namedExports: { ...(await real("timestamps.js")), transcripts: async ask => Object.fromEntries(ask.filter(v => text[v]).map(v => [v, text[v]])) } });
const sent = [];
globalThis.fetch = async (url, o) => { const b = JSON.parse(o.body); sent.push(b);
  const v = b.variables || {};
  if (b.query.includes("change_multiple_column_values")) board.find(x => x.id === v.i).column_values[1].text = JSON.parse(v.v).text_mm6aq9qp;
  if (b.query.includes("create_update")) (updates[v.i] = updates[v.i] || []).push(v.t);
  return { ok: true, json: async () => ({ data: {} }) }; };
const { runAudit, notifyText, flagUpdate } = await import(R + "flight-audit.js");

// 1. The two reads go to October Spot1, the row whose own dates they sit in, audited the morning after it ended.
const live = await runAudit("tok", { now });
assert.deepEqual(live.errors, []);
const oct = board[1].column_values[1].text;
assert.match(oct, /mOhb1WbilOE/); assert.match(oct, /oh9nEh-EOZg/);
assert.doesNotMatch(board[0].column_values[1].text, /mOhb1WbilOE|oh9nEh-EOZg/, "nothing added to September Spot2");
assert.ok(!(live.flags || []).some(f => f.video.startsWith("mOhb1WbilOE") || f.video.startsWith("oh9nEh-EOZg")), "not flagged as make-goods");
assert.ok(!(updates["201"] || []).length, "no update on September Spot2");
// 2. Run again: nothing is added or flagged twice.
sent.length = 0;
const again = await runAudit("tok", { now });
assert.deepEqual(again.errors, []); assert.equal(again.added, 0);
assert.ok(!sent.some(b => b.query.includes("create_update") || b.query.includes("create_notification")), "second run is silent");

// 3. Wording: what it is, which deal, what to do, and no em dashes.
const x = { r: { id: "201", brand: "PrizePicks", deal: "PrizePicks_TRR_September_Spot2_2026", h: "@reelrejects" }, v: { v: "AAAAAAAAAAA", at: "2026-10-30", t: "A video" }, kind: "possible make-good", why: "PrizePicks is read out in it, 26 days after this flight ended" };
const n = notifyText([x, { ...x, v: { ...x.v, v: "BBBBBBBBBBB" } }]);
assert.match(n, /^Action needed: confirm 2 PrizePicks videos for PrizePicks_TRR_September_Spot2_2026 \(@reelrejects\) - possible make-good\./);
assert.match(n, /press Add if they belong to this deal\. If not, do nothing\.$/);
const u = flagUpdate(x);
for (const part of ["please confirm this PrizePicks video", "Found:", "Why it was not added:", "What to do:", "pass=audit&amp;accept=201:AAAAAAAAAAA", "LIVE VIDEO URLS", "will not be flagged again"]) assert.ok(u.includes(part), "update says " + part);
assert.ok(!/—/.test(n + u), "no em dashes");
console.log("PrizePicks replay ok");
