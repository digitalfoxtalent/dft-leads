// Tests for subitems in the side panel (pages.js subitemsPane, edit.js saveSubCell/createSubitem, route.js).
// In-memory Postgres (PGlite) and a fake monday API, so nothing real is touched.
//   npm install --no-save @electric-sql/pglite@0.3.15 && node test/subitems.mjs

import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setExecutor, read, write } from "../api/_reports/mirror/db.js";
import { ensureSchema } from "../api/_reports/mirror/schema.js";
import { setFetch, boardToken, fp } from "../api/_reports/mirror/edit.js";
import { mirrorPage } from "../api/_reports/mirror/route.js";

const pg = new PGlite();
setExecutor({
  read: async (t, p) => (await pg.query(t, p)).rows,
  write: async (t, p) => (await pg.query(t, p)).rows,
  batch: async list => { const out = []; for (const [t, p] of list) out.push((await pg.query(t, p)).rows); return out; },
});
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const TOKEN = "monday-token-test", MARGOT = "margot@digitalfoxtalent.com", TOM = "tom@digitalfoxtalent.com";
const SITE = "https://ecosystem.digitalfoxtalent.com";

// ---------- fake monday ----------
const items = {
  "500": { board: "100", name: "Parent", subs: ["601", "602"] },
  "501": { board: "100", name: "No subitems yet", subs: [] },
  "601": { board: "150", parent: "500", name: "Write draft", vals: { s1: ["Working on it", JSON.stringify({ index: 0 })] } },
  "602": { board: "150", parent: "500", name: "Get facts", vals: {} },
};
let nextId = 9000, mode = "ok", calls = [];
setFetch(async (url, opts) => {
  const body = JSON.parse(opts.body), v = body.variables;
  const reply = data => ({ ok: true, json: async () => ({ data }) });
  const q = body.query;
  calls.push(q.match(/(create_subitem|change_multiple_column_values|subitems \{|items \(ids)/)[1]);
  if (/create_subitem/.test(q)) {
    if (mode === "reject") throw new Error("socket hang up");
    const id = String(nextId++), p = items[v.p], sb = p.subs.length ? items[p.subs[0]].board : "160";
    items[id] = { board: sb, parent: String(v.p), name: v.n, vals: {} }; p.subs.push(id);
    if (mode === "lost") throw new Error("timeout after monday made it");
    return reply({ create_subitem: { id, board: { id: sb } } });
  }
  if (/change_multiple_column_values/.test(q)) {
    const it = items[v.i]; assert.equal(v.b, it.board);
    for (const [k, x] of Object.entries(JSON.parse(v.v))) {
      if (k === "name") { it.name = x; continue; }
      it.vals[k] = [x.label || x, JSON.stringify(x)];
    }
    return reply({ change_multiple_column_values: { id: v.i } });
  }
  if (/subitems \{/.test(q)) {
    const it = items[v.i[0]];
    return reply({ items: it ? [{ id: v.i[0], state: "active", board: { id: it.board }, subitems: it.subs.map(id => ({ id, name: items[id].name, created_at: new Date().toISOString(), board: { id: items[id].board } })) }] : [] });
  }
  if (/items \(ids/.test(q)) {
    const id = String(v.i[0]), it = items[id];
    return reply({ items: it ? [{ id, name: it.name, state: "active", board: { id: it.board }, parent_item: it.parent ? { id: it.parent } : null, group: { id: "topics" }, updated_at: new Date().toISOString(),
      column_values: Object.entries(it.vals || {}).map(([cid, [text, value]]) => ({ id: cid, type: "x", text, value })) }] : [] });
  }
  throw new Error("unexpected " + q.slice(0, 50));
});

// ---------- seed ----------
await ensureSchema();
const PCOLS = [{ id: "subitems", title: "Subitems", type: "subtasks", subBoards: ["150"] }, { id: "t1", title: "Type", type: "text" }];
const SCOLS = [{ id: "name", title: "Name", type: "name" }, { id: "s1", title: "Status", type: "status", labels: { "0": ["Working on it", "#fdab3d"], "1": ["Done", "#00c875"] } }, { id: "t2", title: "Notes", type: "text" }];
await write(`INSERT INTO mirror.boards (id, name, board_type, department, access, allowed_emails, columns, groups, parent_board_id) VALUES
  (100, 'Editorial Plan', 'board', 'marketing', 'team', '{}', $1::jsonb, '[{"id":"topics","title":"P"}]', NULL),
  (150, 'Subitems of Editorial Plan', 'sub_items_board', 'marketing', 'team', '{}', $2::jsonb, '[]', 100),
  (200, 'Pay Cap', 'board', 'finance', 'listed', '{tom@digitalfoxtalent.com}', $1::jsonb, '[]', NULL),
  (250, 'Subitems of Pay Cap', 'sub_items_board', 'finance', 'listed', '{tom@digitalfoxtalent.com}', $2::jsonb, '[]', 200),
  (300, 'Plain Board', 'board', 'marketing', 'team', '{}', '[{"id":"t1","title":"Type","type":"text"}]', '[]', NULL)`, [JSON.stringify(PCOLS), JSON.stringify(SCOLS)]);
await write(`INSERT INTO mirror.items (id, board_id, parent_id, group_id, name, vals, pos) VALUES
  (500, 100, NULL, 'topics', 'Parent', '{}', 1), (501, 100, NULL, 'topics', 'No subitems yet', '{}', 2),
  (601, 150, 500, NULL, 'Write draft', $1::jsonb, 1), (602, 150, 500, NULL, 'Get facts', '{}', 2),
  (600, 200, NULL, NULL, 'Cap', '{}', 1), (701, 250, 600, NULL, 'Private <sub>', '{}', 1), (800, 300, NULL, NULL, 'Plain', '{}', 1)`, [JSON.stringify(items["601"].vals)]);
await write(`INSERT INTO mirror.team (email, name) VALUES ($1, 'Margot'), ($2, 'Tom James')`, [MARGOT, TOM]);

const res = { setHeader() {} };
const get = (r, who = MARGOT) => mirrorPage(r, { method: "GET", headers: {}, query: {} }, res, who, TOKEN);
const post = (r, body, who = MARGOT, origin = SITE) => mirrorPage(r, { method: "POST", headers: { origin }, query: {}, body }, res, who, TOKEN);
const J = out => JSON.parse(out.body);
const K = boardToken(TOKEN, MARGOT, "100");

// ---------- the panel ----------
let h, d = J(await get("boards/100/items/500/panel"));
ok(/data-tab="s">Subitems<span class="n">2<\/span>/.test(d.html), "Subitems tab with the count");
ok(/<tr data-si="601"><td class="nm" data-c="name" data-t="name"/.test(d.html) && /data-c="s1" data-t="status"/.test(d.html) && /data-cols="/.test(d.html), "subitem cells are click-to-edit, with their picker data");
ok(/data-eco-addsub/.test(d.html), "+ Add subitem");
d = J(await get("boards/200/items/600/panel", TOM));
ok(d.ok && /Private &lt;sub&gt;/.test(d.html) && !/data-c=/.test(d.html.split('data-pane="s"')[1]) && !/data-eco-addsub/.test(d.html), "read-only board: subitems shown, escaped, not editable");
d = J(await get("boards/300/items/800/panel"));
ok(d.ok && !/data-tab="s"/.test(d.html), "no Subitems tab on a board without subitems");

// ---------- editing a subitem ----------
calls = [];
d = J(await post("boards/100/items/500/sub/601/cell", { k: K, c: "s1", f: fp("Working on it"), v: "Done" }));
ok(d.ok && items["601"].vals.s1[0] === "Done" && /Done/.test(d.html), "subitem status saved to monday on the subitems board");
ok((await read(`SELECT vals->'s1'->>0 AS v FROM mirror.items WHERE id = 601`))[0].v === "Done", "our copy follows");
ok((await read(`SELECT board_id::text AS b, column_id FROM mirror.edits ORDER BY id DESC LIMIT 1`))[0].b === "150", "logged against the subitems board");
d = J(await post("boards/100/items/500/sub/602/cell", { k: K, c: "name", f: fp("Get facts"), v: "Get the facts" }));
ok(d.ok && items["602"].name === "Get the facts" && d.html === "Get the facts", "rename a subitem (plain name, no link)");
calls = [];
d = J(await post("boards/100/items/500/sub/701/cell", { k: K, c: "t2", f: fp(""), v: "x" }));
ok(!d.ok && calls.length === 0, "a subitem of another item cannot be edited through this one");
d = J(await post("boards/200/items/600/sub/701/cell", { k: boardToken(TOKEN, TOM, "200"), c: "t2", f: fp(""), v: "x" }, TOM));
ok(!d.ok && calls.length === 0, "subitems of read-only boards cannot be edited");
d = J(await post("boards/100/items/500/sub/601/cell", { k: boardToken(TOKEN, MARGOT, "300"), c: "t2", f: fp(""), v: "x" }));
ok(!d.ok && /expired/.test(d.message) && calls.length === 0, "token for another board refused");
d = J(await post("boards/100/items/500/sub/601/cell", { k: K, c: "t2", f: fp(""), v: "x" }, MARGOT, "https://evil.example"));
ok(!d.ok && calls.length === 0, "request from another site refused");

// ---------- adding a subitem ----------
d = J(await post("boards/100/items/500/sub/new", { k: K, name: "Check <links>" }));
const sid = String(nextId - 1);
ok(d.ok && new RegExp(`<tr data-si="${sid}">`).test(d.html) && /Check &lt;links&gt;/.test(d.html) && /data-c="s1"/.test(d.html), "subitem added, row drawn, escaped, editable");
let row = (await read(`SELECT board_id::text AS b, parent_id::text AS p FROM mirror.items WHERE id = $1`, [sid]))[0];
ok(row.b === "150" && row.p === "500", "in our copy under the right parent and subitems board");
ok((await read(`SELECT column_title FROM mirror.edits ORDER BY id DESC LIMIT 1`))[0].column_title === "Subitem added", "logged");
d = J(await post("boards/100/items/501/sub/new", { k: K, name: "First one" }));
const sb = (await read(`SELECT board_type, access, department, parent_board_id::text AS p FROM mirror.boards WHERE id = 160`))[0];
ok(d.ok && sb && sb.board_type === "sub_items_board" && sb.department === "marketing" && sb.access === "team" && sb.p === "100", "first subitem: the new subitems board is recorded with the parent's access");
mode = "lost";
const n0 = items["500"].subs.length;
d = J(await post("boards/100/items/500/sub/new", { k: K, name: "Lost reply" }));
ok(d.ok && items["500"].subs.length === n0 + 1, "lost reply: found, reported as added, not duplicated");
mode = "reject";
d = J(await post("boards/100/items/500/sub/new", { k: K, name: "Refused" }));
ok(!d.ok && /did not confirm/.test(d.message) && !/socket/.test(d.message), "monday error reported, raw error kept out");
mode = "ok";
d = J(await post("boards/100/items/500/sub/new", { k: K, name: "   " }));
ok(!d.ok && /cannot be empty/.test(d.message), "empty name refused");
await write(`UPDATE mirror.edit_switch SET is_on = false WHERE department = 'marketing'`);
calls = [];
d = J(await post("boards/100/items/500/sub/new", { k: K, name: "While off" }));
ok(!d.ok && calls.length === 0, "nothing added while the section's editing is off");
await write(`UPDATE mirror.edit_switch SET is_on = true WHERE department = 'marketing'`);

const js = J ? (await get("assets/eco-board.js")).body : "";
ok(/\/sub\/new/.test(js) && /pi \+ "\/sub\/" \+ si/.test(js) && /editCell\(e, td, cols\)/.test(js), "script edits and adds subitems");

// a subitem monday has moved under another item is refused
items["602"].parent = "501"; calls = [];
d = J(await post("boards/100/items/500/sub/602/cell", { k: K, c: "t2", f: fp(""), v: "x" }));
ok(!d.ok && /moved to another item/.test(d.message) && !calls.includes("change_multiple_column_values"), "subitem moved in monday: nothing written");
items["602"].parent = "500";

// change log on the parent item shows subitem edits and adds
h = (await get("boards/100/items/500")).html;
ok(/Subitem Write draft: Status/.test(h) && /Subitem added/.test(h), "parent's change log lists subitem edits and adds");

// a locked parent (money board name) cannot have its subitems edited, even in an editable section
await write(`UPDATE mirror.boards SET name = 'Invoices plan' WHERE id = 100`);
calls = [];
d = J(await post("boards/100/items/500/sub/601/cell", { k: K, c: "t2", f: fp(""), v: "x" }));
ok(!d.ok && calls.length === 0, "subitems of a locked board cannot be edited");
await write(`UPDATE mirror.boards SET name = 'Editorial Plan' WHERE id = 100`);

// a subitems board that belongs to another parent is refused
await write(`UPDATE mirror.boards SET parent_board_id = 300 WHERE id = 150`);
d = J(await post("boards/100/items/500/sub/601/cell", { k: K, c: "t2", f: fp(""), v: "x" }));
ok(!d.ok && calls.length === 0, "subitems board of another parent refused");
await write(`UPDATE mirror.boards SET parent_board_id = 100 WHERE id = 150`);

console.log("subitem tests passed: " + pass);
