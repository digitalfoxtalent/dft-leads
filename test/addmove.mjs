// Tests for adding an item and moving an item between groups (edit.js createItem/moveItem, route.js).
// In-memory Postgres (PGlite) and a fake monday API, so nothing real is touched.
//   npm install --no-save @electric-sql/pglite@0.3.15 && node test/addmove.mjs

import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setExecutor, read, write } from "../api/_reports/mirror/db.js";
import { ensureSchema } from "../api/_reports/mirror/schema.js";
import { setFetch, boardToken, formToken } from "../api/_reports/mirror/edit.js";
import { mirrorPage } from "../api/_reports/mirror/route.js";

const pg = new PGlite();
setExecutor({
  read: async (t, p) => (await pg.query(t, p)).rows,
  write: async (t, p) => (await pg.query(t, p)).rows,
  batch: async list => { const out = []; for (const [t, p] of list) out.push((await pg.query(t, p)).rows); return out; },
});
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const TOKEN = "monday-token-test";
const MARGOT = "margot@digitalfoxtalent.com", TOM = "tom@digitalfoxtalent.com";
const SITE = "https://ecosystem.digitalfoxtalent.com";

// ---------- fake monday ----------
const items = { "500": { board: "100", group: "topics", name: "Kikoff case study", created: new Date(0).toISOString() } };
let nextId = 7000, mode = "ok", calls = [];
setFetch(async (url, opts) => {
  const body = JSON.parse(opts.body), v = body.variables;
  assert.equal(opts.headers.Authorization, TOKEN);
  calls.push(body.query.match(/(create_item|items_page_by_column_values|move_item_to_group|items \(ids)/)[1]);
  const reply = data => ({ ok: true, json: async () => ({ data }) });
  if (/create_item/.test(body.query)) {
    if (mode === "reject") throw new Error("socket hang up");
    if (mode === "graphql") return { ok: true, json: async () => ({ errors: [{ message: "Complexity budget exhausted" }] }) };
    const id = String(nextId++);
    items[id] = { board: v.b, group: v.g, name: v.n, created: new Date().toISOString() };
    if (mode === "lost") throw new Error("timeout after monday made it");
    return reply({ create_item: { id } });
  }
  if (/items_page_by_column_values/.test(body.query)) {
    const found = Object.entries(items).filter(([, x]) => x.board === v.b && x.name === v.n).map(([id, x]) => ({ id, created_at: x.created, group: { id: x.group } }));
    return reply({ items_page_by_column_values: { items: found } });
  }
  if (/move_item_to_group/.test(body.query)) {
    if (mode === "reject") throw new Error("nope");
    items[v.i].group = v.g;
    return reply({ move_item_to_group: { id: v.i } });
  }
  if (/items \(ids/.test(body.query)) {
    const id = String(v.i[0]), x = items[id];
    return reply({ items: x ? [{ id, name: x.name, state: "active", board: { id: x.board }, group: { id: x.group }, updated_at: new Date().toISOString(), column_values: [] }] : [] });
  }
  throw new Error("unexpected monday call");
});

// ---------- seed ----------
await ensureSchema();
const COLS = [{ id: "t1", title: "Type", type: "text" }];
const GROUPS = [{ id: "topics", title: "Priority", color: "#00c875" }, { id: "later", title: "Ideas <later>", color: "#579bfc" }];
await write(`INSERT INTO mirror.boards (id, name, board_type, department, access, allowed_emails, columns, groups) VALUES
  (100, 'Editorial Plan', 'board', 'marketing', 'team', '{}', $1::jsonb, $2::jsonb),
  (200, 'Partner Pay Cap', 'board', 'finance', 'listed', '{tom@digitalfoxtalent.com}', $1::jsonb, $2::jsonb)`, [JSON.stringify(COLS), JSON.stringify(GROUPS)]);
await write(`INSERT INTO mirror.items (id, board_id, group_id, name, vals, pos) VALUES (500, 100, 'topics', 'Kikoff case study', '{}', 1), (600, 200, 'topics', 'Cap', '{}', 1)`);
await write(`INSERT INTO mirror.team (email, name) VALUES ($1, 'Margot'), ($2, 'Tom James')`, [MARGOT, TOM]);

const res = { setHeader() {} };
const get = (r, who = MARGOT, query = {}) => mirrorPage(r, { method: "GET", headers: {}, query }, res, who, TOKEN);
const postJ = (r, body, who = MARGOT, origin = SITE) => mirrorPage(r, { method: "POST", headers: { origin }, query: {}, body }, res, who, TOKEN);
const J = out => JSON.parse(out.body);
const K = boardToken(TOKEN, MARGOT, "100");

// ---------- the board ----------
let out = await get("boards/100");
ok((out.html.match(/data-eco-add data-g="/g) || []).length === 2 && /data-g="later"/.test(out.html) && /Ideas &lt;later&gt;/.test(out.html), "every group, even an empty one, has + Add item");
ok(/class="gn">0 items/.test(out.html), "empty group shows 0 items");
out = await get("boards/100", MARGOT, { q: "kikoff" });
ok(!/data-g="later"/.test(out.html), "searching hides empty groups");
out = await get("boards/200", TOM);
ok(!/data-eco-add/.test(out.html) && !/class="gn">0/.test(out.html), "read-only board: no add row, no empty groups");
let d = J(await get("boards/100/items/500/panel"));
ok(/data-eco-move data-f="topics"/.test(d.html) && /<option value="later">Ideas &lt;later&gt;<\/option>/.test(d.html), "panel has the group menu on editable boards");
d = J(await get("boards/200/items/600/panel", TOM));
ok(d.ok && !/data-eco-move/.test(d.html), "no group menu on read-only boards");

// ---------- add item: guards ----------
calls = [];
d = J(await postJ("boards/100/items/new", { k: K, g: "topics", name: "New piece" }, MARGOT, "https://evil.example"));
ok(!d.ok && /did not come from/.test(d.message), "add from another site refused");
d = J(await postJ("boards/100/items/new", { k: "x".repeat(K.length), g: "topics", name: "New piece" }));
ok(!d.ok && /expired/.test(d.message), "bad token refused");
d = J(await postJ("boards/100/items/new", { k: K, g: "nope", name: "New piece" }));
ok(!d.ok && /group is not on this board/.test(d.message), "unknown group refused");
d = J(await postJ("boards/100/items/new", { k: K, g: "topics", name: "   " }));
ok(!d.ok && /cannot be empty/.test(d.message), "empty name refused");
d = J(await postJ("boards/100/items/new", { k: K, g: "topics", name: "a".repeat(256) }));
ok(!d.ok && /too long/.test(d.message), "over-long name refused");
d = J(await postJ("boards/200/items/new", { k: boardToken(TOKEN, TOM, "200"), g: "topics", name: "x" }, TOM));
ok(!d.ok && /cannot be edited/.test(d.message), "no adding on boards outside the pilot");
ok(calls.length === 0, "no monday call for any refused add");
out = await get("boards/100/items/new");
ok(out.status === 405, "GET to the add address does nothing");

// ---------- add item: works ----------
d = J(await postJ("boards/100/items/new", { k: K, g: "later", name: "Guide: <b>bold</b> idea" }));
ok(d.ok && /Added to monday/.test(d.message), "item added");
const newId = String(nextId - 1);
ok(items[newId] && items[newId].board === "100" && items[newId].group === "later" && items[newId].name === "Guide: <b>bold</b> idea", "monday got the board, group and name");
ok(new RegExp(`<tr data-i="${newId}">`).test(d.html) && /Guide: &lt;b&gt;bold&lt;\/b&gt; idea/.test(d.html) && /data-c="t1"/.test(d.html), "reply is the new row, escaped and click-to-edit");
let row = (await read(`SELECT group_id, name FROM mirror.items WHERE id = $1`, [newId]))[0];
ok(row && row.group_id === "later", "new item in our copy, in the right group");
let log = (await read(`SELECT * FROM mirror.edits ORDER BY id DESC LIMIT 1`))[0];
ok(log.ok && log.column_id === "_create" && String(log.item_id) === newId && log.email === MARGOT, "addition logged");
out = await get("boards/100/items/" + newId);
ok(/Item added/.test(out.html) && !/name="e" value/.test(out.html), "change log shows it, with no Undo");

mode = "lost";
const before = Object.keys(items).length;
d = J(await postJ("boards/100/items/new", { k: K, g: "topics", name: "Lost reply item" }));
ok(d.ok && Object.keys(items).length === before + 1, "reply lost but monday made it: found, reported as added, not duplicated");
// a same-named item made a moment ago (by someone else, or an earlier add) is never claimed as this add
items["8800"] = { board: "100", group: "topics", name: "Twin", created: new Date().toISOString() };
mode = "lost";
d = J(await postJ("boards/100/items/new", { k: K, g: "topics", name: "Twin" }));
ok(d.ok && new RegExp(`data-i="${nextId - 1}"`).test(d.html) && !/data-i="8800"/.test(d.html), "lost reply: only the item this add made is matched, not an older twin");
mode = "graphql";
items["8801"] = { board: "100", group: "topics", name: "Refused twin", created: new Date().toISOString() };
d = J(await postJ("boards/100/items/new", { k: K, g: "topics", name: "Refused twin" }));
ok(!d.ok && /did not confirm/.test(d.message), "monday refused the add: reported as not added");
ok((await read(`SELECT count(*)::int AS n FROM mirror.edits WHERE column_id = '_create' AND item_id = 8801`))[0].n === 0, "a refusal never claims someone else's same-named item");
mode = "reject";
d = J(await postJ("boards/100/items/new", { k: K, g: "topics", name: "Rejected item" }));
ok(!d.ok && /did not confirm/.test(d.message) && !/socket/.test(d.message), "monday error: not claimed as added, raw error kept out");
ok((await read(`SELECT ok, error FROM mirror.edits ORDER BY id DESC LIMIT 1`))[0].ok === false, "failed add logged");
mode = "ok";

// ---------- move ----------
calls = [];
d = J(await postJ("boards/100/items/500/move", { k: K, g: "later", f: "later" }));
ok(!d.ok && /moved this item in monday/.test(d.message) && !calls.includes("move_item_to_group"), "stale group: refused, not moved");
d = J(await postJ("boards/100/items/500/move", { k: K, g: "nope", f: "topics" }));
ok(!d.ok && /not on this board/.test(d.message), "unknown target group refused");
d = J(await postJ("boards/200/items/600/move", { k: boardToken(TOKEN, TOM, "200"), g: "later", f: "topics" }, TOM));
ok(!d.ok && items["600"] === undefined, "no moving on boards outside the pilot");
d = J(await postJ("boards/100/items/500/move", { k: K, g: "later", f: "topics" }, MARGOT, "https://evil.example"));
ok(!d.ok && items["500"].group === "topics", "move from another site refused");
d = J(await postJ("boards/100/items/500/move", { k: K, g: "later", f: "topics" }));
ok(d.ok && d.g === "later" && items["500"].group === "later" && /Moved to Ideas <later>/.test(d.message), "item moved in monday");
ok((await read(`SELECT group_id FROM mirror.items WHERE id = 500`))[0].group_id === "later", "our copy follows");
log = (await read(`SELECT * FROM mirror.edits ORDER BY id DESC LIMIT 1`))[0];
ok(log.ok && log.column_id === "_group" && log.old_text === "Priority" && log.new_text === "Ideas <later>", "move logged with group names");
const r = await postJ("boards/100/items/500/undo", { t: formToken(TOKEN, MARGOT, "500"), e: log.id });
ok(/cannot be undone/.test(r.html), "a move has no undo (move it back instead)");
items["500"].board = "999";
d = J(await postJ("boards/100/items/500/move", { k: K, g: "topics", f: "later" }));
ok(!d.ok && /no longer on this board/.test(d.message), "item moved to another board in monday: refused");
items["500"].board = "100";
mode = "reject";
d = J(await postJ("boards/100/items/500/move", { k: K, g: "topics", f: "later" }));
ok(!d.ok && /did not move/.test(d.message) && items["500"].group === "later", "monday error on move reported");
mode = "ok";

// a conflicted move puts the menu where monday says the item is
items["500"].group = "topics";
d = J(await postJ("boards/100/items/500/move", { k: K, g: "later", f: "later" }));
ok(!d.ok && d.g === "topics", "conflict reply carries the item's real group");
out = await get("assets/eco-board.js");
ok(/d\.ok \|\| d\.g !== from/.test(out.body), "script follows monday's group after a conflict");

// an item whose group is not on the board (renamed or deleted in monday) shows "(no group)", not the first group
await write(`INSERT INTO mirror.items (id, board_id, group_id, name, vals) VALUES (900, 100, 'gone', 'Orphan', '{}')`);
d = J(await get("boards/100/items/900/panel"));
ok(/<option value="" selected disabled>\(no group\)<\/option>/.test(d.html), "unknown current group shown as (no group)");

// on a board split over pages, empty groups are not shown (their items may be on another page)
await write(`INSERT INTO mirror.items (id, board_id, group_id, name, vals, pos) SELECT 10000 + g, 100, 'topics', 'Filler ' || g, '{}', 100 + g FROM generate_series(1, 210) g`);
await write(`DELETE FROM mirror.items WHERE board_id = 100 AND group_id = 'later'`);
out = await get("boards/100");
ok(!/data-g="later"/.test(out.html) && /Page 1 of 2/.test(out.html), "paginated board: no empty groups");

// ---------- shared hourly limit ----------
await write(`INSERT INTO mirror.edits (email, board_id, item_id, column_id, ok) SELECT $1, 100, 500, 't1', true FROM generate_series(1, 60)`, [MARGOT]);
d = J(await postJ("boards/100/items/new", { k: K, g: "topics", name: "One too many" }));
ok(!d.ok && /Too many changes/.test(d.message), "adds count towards the 60 changes an hour");

out = await get("assets/eco-board.js");
ok(/items\/new/.test(out.body) && /\/move"/.test(out.body) && /insertAdjacentHTML\("beforebegin", d\.html\)/.test(out.body), "script adds rows from server HTML only");

console.log("add/move tests passed: " + pass);
