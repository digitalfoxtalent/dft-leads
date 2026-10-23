// Tests for the nightly full backup (api/_reports/mirror/backup.js). In-memory Postgres (PGlite) and a fake
// monday API, so nothing real is touched.
//   npm install --no-save @electric-sql/pglite@0.3.15 && node test/backup.mjs

import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setExecutor, read, write } from "../api/_reports/mirror/db.js";
import { ensureSchema } from "../api/_reports/mirror/schema.js";
import { runBackup, backupStatus, blockText } from "../api/_reports/mirror/backup.js";
import { mirrorPage } from "../api/_reports/mirror/route.js";

const pg = new PGlite();
setExecutor({
  read: async (t, p) => (await pg.query(t, p)).rows,
  write: async (t, p) => (await pg.query(t, p)).rows,
  batch: async list => { const out = []; for (const [t, p] of list) out.push((await pg.query(t, p)).rows); return out; },
});
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };

// ---------- fake monday: board 100 has 150 updates (two pages), board 200 has 1, plus docs ----------
const updates = { "100": [], "200": [{ id: "9001", item_id: "600", body: "<p>Hi</p>", text_body: "Hi", created_at: "2026-10-20T10:00:00Z", updated_at: null, creator: { name: "Tom James" }, assets: [], replies: [] }] };
for (let i = 0; i < 150; i++) updates["100"].push({ id: String(5000 + 150 - i), item_id: "500", body: "<p>U" + i + "</p>", text_body: "U" + i, created_at: new Date(Date.UTC(2026, 9, 20) - i * 60000).toISOString(),
  updated_at: null, creator: { name: "Vivianne Lee" }, assets: i === 0 ? [{ id: "777", name: "brief.pdf", file_extension: "pdf", file_size: 2048, created_at: "2026-10-20T10:00:00Z" }] : [],
  replies: i === 0 ? [{ id: "8001", body: "<p>Thanks\u0000</p>", text_body: "Thanks", created_at: "2026-10-20T11:00:00Z", updated_at: null, creator: { name: "Tom James" } }] : [] });
const docs = [
  { id: "301", object_id: "4001", name: "Marketing handover", workspace_id: "1", url: "https://x.monday.com/docs/4001", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", created_by: { name: "Tom James" } },
  { id: "302", object_id: "4002", name: "Team API keys", workspace_id: "1", url: "https://x.monday.com/docs/4002", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", created_by: { name: "Tom James" } },
];
const blocks = { "301": [{ id: "b1", type: "large title", content: JSON.stringify({ deltaFormat: [{ insert: "Handover" }] }), parent_block_id: null, position: 1 },
  { id: "b2", type: "normal text", content: JSON.stringify({ deltaFormat: [{ insert: "Step one " }, { insert: "and two" }] }), parent_block_id: null, position: 2 }] };
let calls = [];
const fake = async (url, opts) => {
  const body = JSON.parse(opts.body), q = body.query, v = body.variables || {};
  assert.ok(!/mutation/.test(q), "backup never writes to monday");
  const reply = data => ({ ok: true, json: async () => ({ data: Object.assign({ complexity: { after: 9000000, reset_in_x_seconds: 30 } }, data) }) });
  if (/updates \(limit/.test(q)) { calls.push("updates:" + v.b[0] + ":" + v.p); const all = updates[v.b[0]] || []; return reply({ boards: [{ updates: all.slice((v.p - 1) * v.l, v.p * v.l) }] }); }
  if (/items_page/.test(q)) { calls.push("files:" + v.b[0]); return reply({ boards: [{ items_page: { cursor: null, items: v.b[0] === "100" ? [{ id: "500", assets: [{ id: "778", name: "cover.png", file_extension: "png", file_size: 1048576, created_at: "2026-10-01T00:00:00Z" }] }] : [] } }] }); }
  if (/blocks \(limit/.test(q)) { calls.push("blocks:" + v.d[0]); return reply({ docs: [{ blocks: (blocks[v.d[0]] || []).slice((v.p - 1) * v.l, v.p * v.l) }] }); }
  if (/docs \(limit/.test(q)) { calls.push("docs:" + v.p); return reply({ docs: docs.slice((v.p - 1) * v.l, v.p * v.l) }); }
  throw new Error("unexpected " + q.slice(0, 60));
};

await ensureSchema();
await write(`INSERT INTO mirror.boards (id, name, board_type, department, access, allowed_emails, monday_updated_at) VALUES
  (100, 'Editorial Plan', 'board', 'marketing', 'team', '{}', '2026-10-20T12:00:00Z'), (200, 'Ops', 'board', 'content', 'team', '{}', '2026-10-20T12:00:00Z'),
  (300, 'Old board', 'board', 'content', 'team', '{}', '2026-10-20T12:00:00Z')`);
await write(`UPDATE mirror.boards SET gone = true WHERE id = 300`);

// ---------- first pass ----------
let r = await runBackup("tok", { fetchImpl: fake });
ok(r.ok && r.updates === 152 && r.docs === 1, "first pass: every update and reply, and the docs");
ok(calls.includes("updates:100:1") && calls.includes("updates:100:2") && !calls.some(c => c.startsWith("updates:300")), "pages through all updates; archived boards skipped");
let u = (await read(`SELECT count(*)::int AS n FROM mirror.backup_updates WHERE board_id = 100`))[0].n;
ok(u === 151, "150 updates and 1 reply kept for the busy board (the copy keeps only 10)");
const reply = (await read(`SELECT reply_to::text AS r, body_html FROM mirror.backup_updates WHERE id = 8001`))[0];
ok(reply.r === "5150" && reply.body_html === "<p>Thanks</p>", "replies linked to their update; formatted body kept; null bytes stripped");
const d = (await read(`SELECT name, body_text, jsonb_array_length(blocks) AS n FROM mirror.backup_docs WHERE id = 301`))[0];
ok(d && d.body_text === "Handover\nStep one and two" && d.n === 2, "doc kept block by block, with plain text");
ok(!(await read(`SELECT 1 FROM mirror.backup_docs WHERE id = 302`)).length && !calls.includes("blocks:302"), "a doc that holds credentials is never backed up");
const files = await read(`SELECT id::text AS id, update_id::text AS u, item_id::text AS i, size_bytes::int AS s FROM mirror.backup_files ORDER BY id`);
ok(files.length === 2 && files[0].id === "777" && files[0].u === "5150" && files[1].id === "778" && files[1].i === "500", "files on updates and on items registered");
ok(blockText(JSON.stringify({ deltaFormat: [{ insert: "a" }, { insert: { image: 1 } }, { insert: "b" }] })) === "ab" && blockText("nonsense") === "", "block text tolerant of images and junk");

// ---------- the lock, and nothing due ----------
r = await runBackup("tok", { fetchImpl: fake });
ok(r.skipped && /less than 20 minutes/.test(r.skipped), "a second trigger straight away does nothing");
calls = [];
r = await runBackup("tok", { fetchImpl: fake, force: true });
ok(r.ok && calls.length === 0, "nothing is due until the next night");

// ---------- the next night ----------
await write(`UPDATE mirror.backup_state SET done_at = now() - interval '21 hours'`);
await write(`UPDATE mirror.boards SET monday_updated_at = now() WHERE id = 100`);
updates["100"].unshift({ id: "6000", item_id: "500", body: "<p>New</p>", text_body: "New", created_at: new Date().toISOString(), updated_at: null, creator: { name: "Margot" }, assets: [], replies: [] });
calls = [];
r = await runBackup("tok", { fetchImpl: fake, force: true });
ok(r.ok && calls.filter(c => c.startsWith("updates:100")).length === 1 && !calls.includes("updates:100:2"), "changed board: only the first page, which reaches updates already backed up");
ok(!calls.some(c => c.startsWith("updates:200") || c.startsWith("files:200")), "unchanged board: no monday calls at all");
ok((await read(`SELECT 1 FROM mirror.backup_updates WHERE id = 6000`)).length === 1, "the new update is backed up");
ok(!calls.includes("blocks:301"), "unchanged doc not fetched again");

// ---------- weekly full re-read ----------
await write(`UPDATE mirror.backup_state SET done_at = now() - interval '21 hours', full_at = now() - interval '8 days'`);
calls = [];
r = await runBackup("tok", { fetchImpl: fake, force: true });
ok(calls.includes("updates:100:2") && calls.includes("updates:200:1"), "once a week every board is read in full again");

// ---------- status on /data/mirror ----------
const st = await backupStatus();
ok(st.updates === 153 && st.docs === 1 && st.files === 2 && Number(st.bytes) === 1050624 && st.runs.length >= 3, "status counts");
await write(`INSERT INTO mirror.team (email, name) VALUES ('tom@digitalfoxtalent.com', 'Tom James')`);
const page = await mirrorPage("data/mirror", { method: "GET", headers: {}, query: {} }, { setHeader() {} }, "tom@digitalfoxtalent.com", "tok");
ok(/Nightly full backup/.test(page.html) && /153 updates and replies/.test(page.html) && /2 files registered \(1 MB\)/.test(page.html) && /0 copied to the private file store/.test(page.html) && /Database \d+ MB of 1,024 MB/.test(page.html), "shown on the copy status page");

// ---------- a run uses its whole call budget (it used to stop at half) ----------
for (let i = 0; i < 200; i++) {
  docs.push({ id: String(1000 + i), object_id: String(9000 + i), name: "Doc " + i, workspace_id: "1", url: "https://x.monday.com/docs/" + i, created_at: "2026-09-02T00:00:00Z", updated_at: "2026-10-02T00:00:00Z", created_by: { name: "Tom James" } });
  blocks[String(1000 + i)] = [{ id: "c" + i, type: "normal text", content: JSON.stringify({ deltaFormat: [{ insert: "Doc " + i }] }), parent_block_id: null, position: 1 }];
}
await write(`UPDATE mirror.backup_state SET done_at = now() - interval '21 hours', page = 1 WHERE kind = 'docs'`);
await write(`DELETE FROM mirror.backup_runs`);
calls = [];
r = await runBackup("tok", { fetchImpl: fake, force: true });
ok(r.ok && r.calls === 90 && /part way through the docs/.test(r.note), "a run spends its full 90 calls before stopping: " + r.calls);

console.log("backup tests passed: " + pass);
