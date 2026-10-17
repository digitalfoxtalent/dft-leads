// End-to-end run of runAudit with monday, YouTube scan, transcripts and fetch mocked.
// Run: node --experimental-test-module-mocks test/flight-audit-e2e.mjs
// Added 17 Oct 2026: the 12 Oct run failed with "ids is not a function", which the pure unit tests could not see.
import assert from "node:assert/strict";
import { mock } from "node:test";
const R = new URL("../api/_reports/", import.meta.url).href;
const OLD = "thank you to hule for sponsoring this video more on them in just a bit. so a big part of that has been hule i drink so much i ended up buying the actual protein powder bag so i can make it at home and mix it with some stuff it has been a reliable source of protein and energy for me";
const NEW = "thank you to hule for sponsoring this video more on them in just a bit. they have stayed a core part of my journey having them a couple of times a week because i am a man who is all about efficiency so when i am running between shoots and meetings hule keeps me going";
const now = Date.parse("2026-10-12T08:30:00Z");
const item = (id, live, links) => ({ id, name: "TRR", parent_item: { id: "p" + id, name: "Huel_" + id, group: { title: "Live" }, column_values: [{ id: "dropdown_mm1a3tqp", text: "HUEL" }] },
  column_values: [{ id: "connect_boards__1", text: "", display_value: "@reelrejects" }, { id: "text_mm6aq9qp", text: links }, { id: "timerange_mm1m50vx", text: live }, { id: "date_mm1mb38m", text: "" }] });
const board = [item("111", "2026-09-07 - 2026-09-13", "https://www.youtube.com/watch?v=OWN00000001, https://www.youtube.com/watch?v=OWN00000002")];
const up = (v, at) => ({ v, at: at + "T16:00:00Z", n: 1000, t: "Video " + v, u: [], m: ["huel"] });
const vids = [up("OWN00000001", "2026-09-08"), up("OWN00000002", "2026-09-10"), up("MONDAY00001", "2026-09-14"), up("NEWCOPY0001", "2026-09-15"), up("LATE0000001", "2026-09-30")];
const text = { OWN00000001: OLD, OWN00000002: OLD, MONDAY00001: OLD, NEWCOPY0001: NEW, LATE0000001: OLD };
const updates = {}; // row id -> update bodies posted
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
const { runAudit } = await import(R + "flight-audit.js");

const dry = await runAudit("tok", { now, dry: true });
assert.deepEqual(dry.errors, [], "dry run has no errors");
assert.equal(sent.length, 0, "dry run writes nothing");
assert.equal(dry.added, 1); assert.equal(dry.videos, 1);
assert.deepEqual(dry.flags.map(f => f.video.split(" ")[0] + ":" + f.kind).sort(), ["LATE0000001:possible make-good", "NEWCOPY0001:copy differs"]);

const live = await runAudit("tok", { now });
assert.deepEqual(live.errors, [], "live run has no errors");
assert.match(board[0].column_values[1].text, /MONDAY00001/, "spill added to the row");
assert.doesNotMatch(board[0].column_values[1].text, /NEWCOPY0001|LATE0000001/, "flagged videos not added");
assert.equal(updates["111"].length, 3, "one update for the add, one per flag");
assert.ok(sent.some(b => b.query.includes("create_notification")), "Tom is notified");

sent.length = 0;
const again = await runAudit("tok", { now });
assert.deepEqual(again.errors, []); assert.equal(again.added, 0, "second run adds nothing");
assert.ok(!sent.some(b => b.query.includes("create_update") || b.query.includes("create_notification")), "second run flags nothing twice");
console.log("runAudit e2e ok");
