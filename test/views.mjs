// Tests for board views: filter by person or status, sort, Kanban (pages.js renderBoard).
// In-memory Postgres (PGlite), no monday calls.
//   npm install --no-save @electric-sql/pglite@0.3.15 && node test/views.mjs

import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setExecutor, write } from "../api/_reports/mirror/db.js";
import { ensureSchema } from "../api/_reports/mirror/schema.js";
import { setFetch } from "../api/_reports/mirror/edit.js";
import { mirrorPage } from "../api/_reports/mirror/route.js";

const pg = new PGlite();
setExecutor({
  read: async (t, p) => (await pg.query(t, p)).rows,
  write: async (t, p) => (await pg.query(t, p)).rows,
  batch: async list => { const out = []; for (const [t, p] of list) out.push((await pg.query(t, p)).rows); return out; },
});
setFetch(async () => { throw new Error("no monday calls expected"); });
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const MARGOT = "margot@digitalfoxtalent.com", TOM = "tom@digitalfoxtalent.com";

await ensureSchema();
const COLS = [
  { id: "s1", title: "Draft status", type: "status", labels: { "0": ["Idea", "#c4c4c4"], "1": ["Brief ready", "#00c875"], "2": ["Published", "#579bfc"] } },
  { id: "s2", title: "Phase", type: "status", labels: { "0": ["Phase 1", "#00c875"], "1": ["Phase 2", "#fdab3d"] } },
  { id: "o1", title: "Owner", type: "people" },
  { id: "n1", title: "Priority score", type: "numbers" },
  { id: "d1", title: "Target date", type: "date" },
];
const GROUPS = [{ id: "g1", title: "Priority", color: "#00c875" }, { id: "g2", title: "Later", color: "#579bfc" }, { id: "g3", title: "Empty group" }];
await write(`INSERT INTO mirror.boards (id, name, board_type, department, access, allowed_emails, columns, groups) VALUES
  (100, 'Editorial Plan', 'board', 'marketing', 'team', '{}', $1::jsonb, $2::jsonb),
  (200, 'Ops Board', 'board', 'content', 'team', '{}', $1::jsonb, $2::jsonb),
  (300, 'No Status Board', 'board', 'content', 'team', '{}', '[{"id":"t1","title":"Text","type":"text"}]', '[]')`, [JSON.stringify(COLS), JSON.stringify(GROUPS)]);
const st = (l, i) => [l, JSON.stringify({ index: i })];
const rows = [
  [1, "g1", "Alpha", { s1: st("Idea", 0), s2: st("Phase 1", 0), o1: ["Tom James", null], n1: ["88", "\"88\""], d1: ["2026-10-06", null] }],
  [2, "g1", "Bravo", { s1: st("Brief ready", 1), o1: ["Tom James, Vivianne Lee", null], n1: ["9", "\"9\""] }],
  [3, "g2", "Charlie", { s1: st("Published", 2), s2: st("Phase 2", 1), o1: ["Tom", null], n1: ["n/a", null] }],
  [4, "g2", "Delta", { o1: ["<script>x</script>", null], n1: ["120", "\"120\""] }],
];
for (const [id, g, name, vals] of rows) await write(`INSERT INTO mirror.items (id, board_id, group_id, name, vals, pos) VALUES ($1::bigint, 100, $2, $3, $4::jsonb, $5::int), ($6::bigint, 200, $2, $3, $4::jsonb, $5::int)`, [id, g, name, JSON.stringify(vals), id, id + 100]);
await write(`INSERT INTO mirror.team (email, name) VALUES ($1, 'Margot'), ($2, 'Tom James')`, [MARGOT, TOM]);

const res = { setHeader() {} };
const page = async (id, query = {}, who = MARGOT) => (await mirrorPage("boards/" + id, { method: "GET", headers: {}, query }, res, who, "tok")).html;
const names = h => [...h.matchAll(/<tr data-i="\d+"><td class="nm"[^>]*><div class="nmw"><a [^>]*>([^<]+)<\/a>/g)].map(m => m[1]);
const cards = (h, lane) => { const m = h.match(new RegExp(`<section class="lane" data-v="${lane}"[\\s\\S]*?</section>`)); return m ? [...m[0].matchAll(/class="kcard"[^>]*><a [^>]*>([^<]+)</g)].map(x => x[1]) : null; };

// ---------- person ----------
let h = await page(100);
ok(/>Person<\/summary>/.test(h) && /Tom James<\/a>/.test(h) && /Vivianne Lee<\/a>/.test(h) && /&lt;script&gt;x&lt;\/script&gt;<\/a>/.test(h) && !/<script>x/.test(h), "person menu lists everyone, escaped");
h = await page(100, { person: "Tom James" });
ok(JSON.stringify(names(h)) === JSON.stringify(["Alpha", "Bravo"]), "filter by person matches whole names in multi-person cells");
ok(/Person: Tom James/.test(h) && /class="menu on"/.test(h) && /Clear all/.test(h) && /2 items match/.test(h), "active filter shows on the button, with Clear all");
h = await page(100, { person: "Tom" });
ok(JSON.stringify(names(h)) === JSON.stringify(["Charlie"]), "\"Tom\" does not match \"Tom James\"");
h = await page(100, { person: "%" });
ok(names(h).length === 0, "wildcards in the person filter are literal");
h = await page(100, { person: "x' OR 1=1 --" });
ok(names(h).length === 0, "injection attempt just matches nobody");

// ---------- status ----------
h = await page(100, { st: "s1:Published" });
ok(JSON.stringify(names(h)) === JSON.stringify(["Charlie"]) && /Draft status: Published/.test(h), "filter by status label");
h = await page(100, { st: "s1:" });
ok(JSON.stringify(names(h)) === JSON.stringify(["Delta"]), "filter by empty status");
h = await page(100, { st: "s1:Made up" });
ok(names(h).length === 4 && !/Clear all/.test(h), "unknown label ignored");
h = await page(100, { st: "o1:Tom" });
ok(names(h).length === 4, "only status columns can be filtered this way");
h = await page(100, { st: "s1:Idea" });
ok(!/data-g="g3"/.test(h), "empty groups hidden while filtering");
ok(/data-g="g3"/.test(await page(100)), "empty groups shown on the plain editable board");

// ---------- sort ----------
h = await page(100, { sort: "n1", dir: "desc" });
ok(JSON.stringify(names(h)) === JSON.stringify(["Alpha", "Bravo", "Delta", "Charlie"]), "numbers sort numerically, non-numbers last, within groups");
ok(/Sort: Priority score \(Z to A\)/.test(h), "sort shown on the button");
h = await page(100, { sort: "name", dir: "desc" });
ok(JSON.stringify(names(h)) === JSON.stringify(["Bravo", "Alpha", "Delta", "Charlie"]), "sort by name");
h = await page(100, { sort: "vals; DROP TABLE x", dir: "desc" });
ok(JSON.stringify(names(h)) === JSON.stringify(["Alpha", "Bravo", "Charlie", "Delta"]) && !/Sort:/.test(h), "unknown sort column ignored");
h = await page(100, { person: "Tom James", sort: "n1", dir: "desc" });
ok(/href="\/boards\/100\?person=Tom%20James&amp;sort=n1&amp;dir=desc&amp;view=kanban/.test(h), "links keep the other settings");
ok(/<input type="hidden" name="person" value="Tom James">/.test(h) && /<input type="hidden" name="sort" value="n1">/.test(h), "search keeps the filters too");

// ---------- kanban ----------
h = await page(100, { view: "kanban" });
ok(/<a class="on" href="\/boards\/100\?view=kanban/.test(h) && /class="kanban" data-kc="s1"/.test(h), "Kanban tab, grouped by the first status column");
ok(JSON.stringify(cards(h, "Idea")) === '["Alpha"]' && JSON.stringify(cards(h, "Brief ready")) === '["Bravo"]' && JSON.stringify(cards(h, "Published")) === '["Charlie"]' && JSON.stringify(cards(h, "")) === '["Delta"]', "cards in the right columns, empty ones in Empty");
ok(/class="kcard" data-i="1" draggable="true" data-f="/.test(h), "cards can be dragged on editable boards");
ok(/<span>Owner<\/span>Tom James/.test(h), "cards show key fields");
h = await page(100, { view: "kanban", kc: "s2" });
ok(/data-kc="s2"/.test(h) && JSON.stringify(cards(h, "Phase 2")) === '["Charlie"]' && /Columns: Phase/.test(h), "choose which status column makes the Kanban");
h = await page(100, { view: "kanban", kc: "nope" });
ok(/data-kc="s1"/.test(h), "unknown Kanban column falls back to the first status column");
h = await page(200, { view: "kanban" });
ok(/class="kanban">/.test(h) && !/draggable="true"/.test(h) && !/data-kc=/.test(h), "read-only board: Kanban to look at, no dragging");
h = await page(300, { view: "kanban" });
ok(!/class="kanban"/.test(h) && !/>Kanban</.test(h), "no Kanban on a board without a status column");
h = await page(100, { view: "kanban", person: "Tom James" });
ok(JSON.stringify(cards(h, "Published")) === "[]" && JSON.stringify(cards(h, "Idea")) === '["Alpha"]', "filters apply to Kanban too");

const js = (await mirrorPage("assets/eco-board.js", { method: "GET", headers: {}, query: {} }, res, MARGOT, "tok")).body;
ok(/dragstart/.test(js) && /\/cell"/.test(js) && /CSS\.escape\(d\.v\)/.test(js), "drag saves through the checked cell edit");

console.log("views tests passed: " + pass);
