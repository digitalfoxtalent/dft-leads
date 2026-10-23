// Tests for My work (pages.js renderMyWork). In-memory Postgres (PGlite), no monday calls.
//   npm install --no-save @electric-sql/pglite@0.3.15 && node test/mywork.mjs

import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setExecutor, write } from "../api/_reports/mirror/db.js";
import { ensureSchema } from "../api/_reports/mirror/schema.js";
import { renderMyWork } from "../api/_reports/mirror/pages.js";
import { mirrorPage } from "../api/_reports/mirror/route.js";

const pg = new PGlite();
setExecutor({
  read: async (t, p) => (await pg.query(t, p)).rows,
  write: async (t, p) => (await pg.query(t, p)).rows,
  batch: async list => { const out = []; for (const [t, p] of list) out.push((await pg.query(t, p)).rows); return out; },
});
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const MARGOT = "margot@digitalfoxtalent.com", AMY = "amy@digitalfoxtalent.com", NEW = "new@digitalfoxtalent.com";

await ensureSchema();
const COLS = [
  { id: "o1", title: "Owner", type: "people" },
  { id: "t1", title: "Notes", type: "text" },
  { id: "s1", title: "Status", type: "status", labels: { "0": ["Working on it", "#fdab3d"], "1": ["Done", "#00c875"] } },
  { id: "d1", title: "Due", type: "date" },
];
await write(`INSERT INTO mirror.boards (id, name, board_type, department, access, allowed_emails, columns, groups) VALUES
  (100, 'Editorial Plan', 'board', 'marketing', 'team', '{}', $1::jsonb, '[{"id":"g1","title":"Priority"}]'),
  (200, 'Pay Cap <secret>', 'board', 'finance', 'listed', '{tom@digitalfoxtalent.com}', $1::jsonb, '[]'),
  (300, 'Gone Board', 'board', 'content', 'team', '{}', $1::jsonb, '[]')`, [JSON.stringify(COLS)]);
await write(`UPDATE mirror.boards SET gone = true WHERE id = 300`);
const st = (l, i) => [l, JSON.stringify({ index: i })];
const items = [
  [1, 100, "Overdue piece", { o1: ["Margot Smith", null], s1: st("Working on it", 0), d1: ["2026-10-20", null] }],
  [2, 100, "Due today <b>x</b>", { o1: ["Tom James, Margot Smith", null], d1: ["2026-10-23", null] }],
  [3, 100, "This week", { o1: ["Margot Smith", null], d1: ["2026-10-25", null] }],
  [4, 100, "Next week", { o1: ["Margot Smith", null], d1: ["2026-10-29", null] }],
  [5, 100, "Later on", { o1: ["Margot Smith", null], d1: ["2026-12-01", null] }],
  [6, 100, "No date", { o1: ["Margot Smith", null] }],
  [7, 100, "Done and dusted", { o1: ["Margot Smith", null], s1: st("Done", 1), d1: ["2026-10-01", null] }],
  [8, 100, "Someone else", { o1: ["Margot Smithson", null], d1: ["2026-10-23", null] }],
  [9, 100, "Name only in a text column", { t1: ["Margot Smith", null] }],
  [10, 200, "Private finance row", { o1: ["Margot Smith", null] }],
  [11, 300, "On a gone board", { o1: ["Margot Smith", null] }],
];
items.push([13, 100, "Ancient task", { o1: ["Margot Smith", null], d1: ["2026-06-01", null] }]);
items.push([14, 100, "Commission paid row", { o1: ["Margot Smith", null], s1: st("Commission Paid", 0), d1: ["2026-09-01", null] }]);
items.push([15, 500, "On an archive board", { o1: ["Margot Smith", null] }]);
items.push([16, 100, "In a done group", { o1: ["Margot Smith", null], d1: ["2026-10-01", null] }]);
await write(`INSERT INTO mirror.boards (id, name, board_type, department, access, allowed_emails, columns, groups) VALUES (500, '2024-2025 Archive US campaigns', 'board', 'partnerships', 'team', '{}', $1::jsonb, '[]')`, [JSON.stringify(COLS)]);
await write(`UPDATE mirror.boards SET groups = '[{"id":"g1","title":"Priority"},{"id":"g9","title":"Complete - commission paid"}]' WHERE id = 100`);
for (const [id, b, name, vals] of items) await write(`INSERT INTO mirror.items (id, board_id, group_id, name, vals) VALUES ($1, $2, 'g1', $3, $4::jsonb)`, [id, b, name, JSON.stringify(vals)]);
await write(`UPDATE mirror.items SET group_id = 'g9' WHERE id = 16`);
await write(`INSERT INTO mirror.items (id, board_id, group_id, name, vals, deleted) VALUES (12, 100, 'g1', 'Deleted row', '{"o1":["Margot Smith",null]}', true)`);
await write(`INSERT INTO mirror.team (email, name) VALUES ($1, 'Margot Smith'), ($2, 'Amy Lee'), ($3, NULL)`, [MARGOT, AMY, NEW]);

const TODAY = new Date("2026-10-23T15:00:00Z"); // a Friday
const section = (h, title) => { const m = h.match(new RegExp(`<summary>${title} <span>[\\s\\S]*?</details>`)); return m ? [...m[0].matchAll(/<td class="nm"><a [^>]*>([^<]+)<\/a>/g)].map(x => x[1]) : null; };

let h = (await renderMyWork(MARGOT, {}, TODAY)).html;
ok(JSON.stringify(section(h, "Overdue")) === '["Overdue piece"]', "overdue");
ok(JSON.stringify(section(h, "Today")) === '["Due today &lt;b&gt;x&lt;/b&gt;"]', "today, from a multi-person cell, escaped");
ok(JSON.stringify(section(h, "This week")) === '["This week"]', "this week (to Sunday)");
ok(JSON.stringify(section(h, "Next week")) === '["Next week"]', "next week");
ok(JSON.stringify(section(h, "Later")) === '["Later on"]', "later");
ok(JSON.stringify(section(h, "Without a date")) === '["No date"]', "without a date");
ok(!/Done and dusted/.test(h) && !/Commission paid row/.test(h) && !/In a done group/.test(h) && /Show 3 done/.test(h), "done items hidden (Done, Commission Paid, done-style groups), with a Show done button");
ok(!/On an archive board/.test(h), "archive boards left out");
ok(JSON.stringify(section(h, "Overdue by more than two months")) === '["Ancient task"]' && /<details class="group" style="--gc:#9699a6"><summary>Overdue by more than two months/.test(h), "very old overdue items folded away");
ok(!/Someone else/.test(h), "a longer name that starts the same does not match");
ok(!/Name only in a text column/.test(h), "only person columns count");
ok(!/Private finance row/.test(h) && !/Pay Cap/.test(h), "boards you cannot see stay hidden, names included");
ok(!/On a gone board/.test(h) && !/Deleted row/.test(h), "archived boards and deleted items left out");
ok(/href="\/boards\/100#item-1"/.test(h), "items open in the board's side panel");
ok(/7 items/.test(h), "count of open items");
h = (await renderMyWork(MARGOT, { done: "1" }, TODAY)).html;
ok(/Done and dusted/.test(h) && /Hide done/.test(h) && !section(h, "Overdue").includes("Done and dusted"), "Show done includes them, never as overdue");
h = (await renderMyWork(AMY, {}, TODAY)).html;
ok(/Nothing assigned to you/.test(h), "someone with nothing assigned");
h = (await renderMyWork(NEW, {}, TODAY)).html;
ok(/not in the copy yet/.test(h), "someone whose monday name is not copied yet");

const res = { setHeader() {} };
const out = await mirrorPage("my-work", { method: "GET", headers: {}, query: {} }, res, MARGOT, "tok");
ok(out.status === 200 && /class="bd mw on" href="\/my-work"/.test(out.html), "route works, sidebar link highlighted");
const b = await mirrorPage("boards/100", { method: "GET", headers: {}, query: {} }, res, MARGOT, "tok");
ok(/href="\/my-work">My work</.test(b.html), "My work linked from every board's sidebar");

console.log("my work tests passed: " + pass);
