// Tests for the Inbox (pages.js renderInbox). In-memory Postgres (PGlite), no monday calls.
//   npm install --no-save @electric-sql/pglite@0.3.15 && node test/inbox.mjs

import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setExecutor, write } from "../api/_reports/mirror/db.js";
import { ensureSchema } from "../api/_reports/mirror/schema.js";
import { mirrorPage } from "../api/_reports/mirror/route.js";

const pg = new PGlite();
setExecutor({
  read: async (t, p) => (await pg.query(t, p)).rows,
  write: async (t, p) => (await pg.query(t, p)).rows,
  batch: async list => { const out = []; for (const [t, p] of list) out.push((await pg.query(t, p)).rows); return out; },
});
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const MARGOT = "margot@digitalfoxtalent.com", TOM = "tom@digitalfoxtalent.com";

await ensureSchema();
const COLS = [{ id: "o1", title: "Owner", type: "people" }, { id: "t1", title: "Notes", type: "text" }];
await write(`INSERT INTO mirror.boards (id, name, board_type, department, access, allowed_emails, columns) VALUES
  (100, 'Editorial Plan', 'board', 'marketing', 'team', '{}', $1::jsonb),
  (200, 'Pay Cap', 'board', 'finance', 'listed', '{tom@digitalfoxtalent.com}', $1::jsonb)`, [JSON.stringify(COLS)]);
await write(`INSERT INTO mirror.items (id, board_id, group_id, name, vals) VALUES
  (1, 100, 'g', 'My item', '{"o1":["Margot Smith, Tom James",null]}'),
  (2, 100, 'g', 'Not mine', '{"o1":["Tom James",null]}'),
  (3, 100, 'g', 'Name only in notes', '{"t1":["Margot Smith",null]}'),
  (4, 200, 'g', 'Private <item>', '{"o1":["Margot Smith",null]}')`);
await write(`INSERT INTO mirror.team (email, name) VALUES ($1, 'Margot Smith'), ($2, 'Tom James')`, [MARGOT, TOM]);
const upd = (id, item, body, creator, ago) => write(`INSERT INTO mirror.updates (id, item_id, body, creator, created_at) VALUES ($1, $2, $3, $4, now() - ($5 || ' hours')::interval)`, [id, item, body, creator, String(ago)]);
await upd(10, 1, "Draft is ready <script>x</script>", "Vivianne Lee", 2);
await upd(11, 2, "@Margot Smith can you check this?", "Tom James", 3);
await upd(12, 2, "Just a note for Tom", "Vivianne Lee", 4);
await upd(13, 1, "My own note", "Margot Smith", 1);
await upd(14, 3, "Text column mention only", "Tom James", 5);
await upd(15, 4, "@Margot Smith private one", "Tom James", 1);
await upd(16, 1, "Old news", "Tom James", 24 * 20);
await upd(17, 1, "Margot Smith via the Ecosystem Posted from the Ecosystem", "Tom James", 1);
await write(`INSERT INTO mirror.posts (email, board_id, item_id, update_id, name, ok) VALUES ($1, 100, 1, 17, 'Margot Smith', true)`, [MARGOT]);

const res = { setHeader() {} };
const get = who => mirrorPage("inbox", { method: "GET", headers: {}, query: {} }, res, who, "tok");
let h = (await get(MARGOT)).html;
ok(/Vivianne Lee<\/b> updated <a href="\/boards\/100#item-1">My item/.test(h), "update on an item assigned to you");
ok(/Tom James<\/b> mentioned you on <a href="\/boards\/100#item-2">Not mine/.test(h), "update that @mentions you");
ok(!/Just a note for Tom/.test(h), "updates on other people's items without a mention are left out");
ok(!/My own note/.test(h) && !/Posted from the Ecosystem/.test(h), "your own updates are left out, including ones posted from the Ecosystem");
ok(!/Text column mention only/.test(h), "a name in a text column does not count");
ok(!/private one/.test(h) && !/Private &lt;item&gt;/.test(h), "boards you cannot see stay hidden");
ok(!/Old news/.test(h), "only the last 14 days");
ok(/&lt;script&gt;x&lt;\/script&gt;/.test(h) && !/<script>x/.test(h), "update text escaped");
ok(/2 updates · 2 new since you last looked/.test(h) && (h.match(/class="ibx new"/g) || []).length === 2, "everything is new on the first visit");
h = (await get(MARGOT)).html;
ok(/2 updates<\/span>/.test(h) && !/class="ibx new"/.test(h), "nothing new on the next visit");
await upd(18, 1, "Fresh one", "Vivianne Lee", 0);
h = (await get(MARGOT)).html;
ok(/1 new since you last looked/.test(h) && /class="ibx new"[\s\S]*Fresh one/.test(h), "a new update is marked new");
h = (await get(TOM)).html;
ok(/Just a note for Tom/.test(h) && !/@Margot Smith can you check/.test(h) && /Margot Smith<\/b> updated/.test(h), "Tom sees his items, not his own updates; Ecosystem posts show their real author");
ok(/href="\/inbox">Inbox</.test(h), "Inbox in the sidebar");

console.log("inbox tests passed: " + pass);
