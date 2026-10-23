// Tests for search everything and the group footers (pages.js renderSearch, summaryRow). In-memory Postgres.
//   npm install --no-save @electric-sql/pglite@0.3.15 && node test/search.mjs

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
const COLS = [{ id: "s1", title: "Status", type: "status", labels: { "0": ["Working on it", "#fdab3d"], "1": ["Done", "#00c875"] } }, { id: "n1", title: "Views", type: "numbers" }, { id: "t1", title: "Notes", type: "text" }];
await write(`INSERT INTO mirror.boards (id, name, board_type, department, access, allowed_emails, columns, groups) VALUES
  (100, 'Kikoff Campaign Board', 'board', 'marketing', 'team', '{}', $1::jsonb, '[{"id":"g1","title":"G"}]'),
  (200, 'Kikoff Pay Cap', 'board', 'finance', 'listed', '{tom@digitalfoxtalent.com}', $1::jsonb, '[]'),
  (300, 'Old Kikoff', 'board', 'content', 'team', '{}', $1::jsonb, '[]')`, [JSON.stringify(COLS)]);
await write(`UPDATE mirror.boards SET gone = true WHERE id = 300`);
const st = (l, i) => [l, JSON.stringify({ index: i })];
const rows = [
  [1, 100, "Kikoff <b>launch</b>", { s1: st("Done", 1), n1: ["1,000", null] }],
  [2, 100, "Another piece", { s1: st("Done", 1), n1: ["250.5", null], t1: ["mentions kikoff in notes", null] }],
  [3, 100, "Third", { s1: st("Working on it", 0), n1: ["n/a", null] }],
  [4, 100, "Fourth", {}],
  [5, 200, "Kikoff private payment", {}],
  [6, 300, "Kikoff on a gone board", {}],
];
for (const [id, b, name, vals] of rows) await write(`INSERT INTO mirror.items (id, board_id, group_id, name, vals) VALUES ($1, $2, 'g1', $3, $4::jsonb)`, [id, b, name, JSON.stringify(vals)]);
await write(`INSERT INTO mirror.team (email, name) VALUES ($1, 'Margot'), ($2, 'Tom James')`, [MARGOT, TOM]);
const res = { setHeader() {} };
const get = (r, query = {}, who = MARGOT) => mirrorPage(r, { method: "GET", headers: {}, query }, res, who, "tok");

let h = (await get("search", { q: "kikoff" })).html;
ok(/<mark>Kikoff<\/mark> Campaign Board/.test(h), "board names match, highlighted");
ok(/href="\/boards\/100#item-1"><mark>Kikoff<\/mark> &lt;b&gt;launch&lt;\/b&gt;<\/a>/.test(h), "item names match, escaped, open in the side panel");
ok(/Another piece<\/a><span class="muted sm"> \(matches a field\)/.test(h), "a match in a field is found and labelled");
ok(!/Pay Cap/.test(h) && !/private payment/.test(h), "boards you cannot see stay hidden, names included");
ok(!/gone board/.test(h) && !/Old Kikoff/.test(h), "archived boards left out");
ok(/2 items and 1 board match/.test(h), "counts");
h = (await get("search", { q: "kikoff" }, TOM)).html;
ok(/Kikoff Pay Cap/.test(h) && /private payment/.test(h), "Tom sees the board he is listed on");
h = (await get("search", { q: "%" })).html;
ok(/Type at least two letters/.test(h), "one character is not searched");
h = (await get("search", { q: "%_" })).html;
ok(/Nothing matches/.test(h), "wildcards are literal");
h = (await get("search", { q: "<script>" })).html;
ok(!/<script>"/.test(h) && /value="&lt;script&gt;"/.test(h), "the query is escaped");
h = (await get("boards/100")).html;
ok(/action="\/search"/.test(h), "the sidebar search box searches everything");

// group footer
ok(/<tfoot><tr><td class="nm sum"><\/td>/.test(h), "each group has a footer");
const bar = h.match(/<span class="bat" title="([^"]*)">(.*?)<\/span>/);
ok(bar && bar[1] === "Done: 2, Working on it: 1, Empty: 1" && /width:50\.00%;background:#00c875/.test(bar[2]) && /width:25\.00%;background:#fdab3d/.test(bar[2]), "status bar in label colours, by share");
ok(/<td class="sum num"><b>1,250.5<\/b><span>sum<\/span>/.test(h), "numbers summed (commas handled, text ignored)");

console.log("search tests passed: " + pass);
