// Tests for the editing switch per section (switch.js, /data/editing). In-memory Postgres (PGlite) and a fake
// monday API, so nothing real is touched.
//   npm install --no-save @electric-sql/pglite@0.3.15 && node test/switch.mjs

import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setExecutor, read, write } from "../api/_reports/mirror/db.js";
import { ensureSchema } from "../api/_reports/mirror/schema.js";
import { setFetch, boardToken, canEdit, fp } from "../api/_reports/mirror/edit.js";
import { switchToken, _resetSwitches, loadSwitches } from "../api/_reports/mirror/switch.js";
import { mirrorPage } from "../api/_reports/mirror/route.js";

const pg = new PGlite();
setExecutor({
  read: async (t, p) => (await pg.query(t, p)).rows,
  write: async (t, p) => (await pg.query(t, p)).rows,
  batch: async list => { const out = []; for (const [t, p] of list) out.push((await pg.query(t, p)).rows); return out; },
});
let pass = 0, mondayCalls = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const TOKEN = "monday-token-test", TOM = "tom@digitalfoxtalent.com", MARGOT = "margot@digitalfoxtalent.com";
const SITE = "https://ecosystem.digitalfoxtalent.com";
setFetch(async () => { mondayCalls++; throw new Error("monday should not be called in these tests"); });

await ensureSchema();
const COLS = [{ id: "t1", title: "Type", type: "text" }];
await write(`INSERT INTO mirror.boards (id, name, board_type, department, access, allowed_emails, columns, groups) VALUES
  (100, 'Editorial Plan', 'board', 'marketing', 'team', '{}', $1::jsonb, '[{"id":"g1","title":"G"}]'),
  (200, 'Ops Board', 'board', 'content', 'team', '{}', $1::jsonb, '[{"id":"g1","title":"G"}]'),
  (300, 'Pay Cap', 'board', 'finance', 'team', '{}', $1::jsonb, '[{"id":"g1","title":"G"}]')`, [JSON.stringify(COLS)]);
await write(`INSERT INTO mirror.items (id, board_id, group_id, name, vals) VALUES (500, 100, 'g1', 'A', '{"t1":["x","\\"x\\""]}'), (600, 200, 'g1', 'B', '{}')`);
await write(`INSERT INTO mirror.team (email, name) VALUES ($1, 'Tom James'), ($2, 'Margot')`, [TOM, MARGOT]);

const res = { setHeader() {} };
const get = (r, who = MARGOT) => mirrorPage(r, { method: "GET", headers: {}, query: {} }, res, who, TOKEN);
const post = (r, body, who = TOM, origin = SITE) => mirrorPage(r, { method: "POST", headers: { origin }, query: {}, body }, res, who, TOKEN);
const flipBody = (d, on, who = TOM) => ({ t: switchToken(TOKEN, who), d, on: on ? "1" : "0" });
const board = async id => (await read(`SELECT id::text AS id, name, folder_path, workspace_name, board_type, department, access, allowed_emails, gone, columns, groups FROM mirror.boards WHERE id = $1`, [id]))[0];
const team = new Set([TOM, MARGOT]);

// fails closed before the switch is read
_resetSwitches();
ok(!canEdit(await board(100), MARGOT, team), "nothing is editable before the switch has been read");
await loadSwitches(true);
ok(canEdit(await board(100), MARGOT, team) && !canEdit(await board(200), MARGOT, team), "starts with Marketing on (the pilot), others off");

// the page
let out = await get("data/editing");
ok(out.status === 200 && /Editing in the Ecosystem/.test(out.html) && /Only Tom can change these/.test(out.html) && !/name="t"/.test(out.html), "teammates see the switch, without buttons");
out = await get("data/editing", TOM);
ok(/Turn editing off/.test(out.html) && /Turn editing on/.test(out.html) && /Always read-only/.test(out.html), "Tom sees buttons; finance shows as always read-only");
ok(!/name="d" value="finance"/.test(out.html), "no button for finance");

// guards
out = await post("data/editing", flipBody("marketing", false, MARGOT), MARGOT);
ok(out.status === 400 && /Only Tom/.test(out.html), "only Tom can flip it");
out = await post("data/editing", flipBody("marketing", false), TOM, "https://evil.example");
ok(out.status === 400 && /did not come from/.test(out.html), "flip from another site refused");
out = await post("data/editing", Object.assign(flipBody("marketing", false), { t: "x".repeat(32) }));
ok(out.status === 400 && /expired/.test(out.html), "bad token refused");
out = await post("data/editing", flipBody("nonsense", true));
ok(out.status === 400 && /Unknown section/.test(out.html), "unknown section refused");
out = await post("data/editing", flipBody("finance", true));
ok(out.status === 400 && /stays read-only/.test(out.html), "finance cannot be turned on");
ok((await read(`SELECT count(*)::int AS n FROM mirror.switch_log`))[0].n === 0, "nothing logged for refused flips");
await write(`UPDATE mirror.edit_switch SET is_on = true WHERE department = 'marketing'`);
await write(`INSERT INTO mirror.edit_switch (department, is_on) VALUES ('finance', true) ON CONFLICT (department) DO UPDATE SET is_on = true`);
await loadSwitches(true);
ok(!canEdit(await board(300), TOM, team), "finance stays read-only even if the table says on");

// turn Marketing off: takes effect at once
out = await post("data/editing", flipBody("marketing", false));
ok(out.status === 200 && /editing is off/.test(out.html), "Tom turns Marketing off");
out = await get("boards/100");
ok(!/data-k=/.test(out.html) && !/data-eco-add/.test(out.html) && /Read-only copy/.test(out.html), "Marketing boards are read-only straight away");
out = await get("marketing/boards");
ok(!/editable here/.test(out.html), "section page no longer says editable");
ok((await read(`SELECT email, department, turned_on FROM mirror.switch_log`))[0].email === TOM, "flip logged with who");

// another server instance still holding "on" in memory must not write: every write re-reads the switch
await write(`UPDATE mirror.edit_switch SET is_on = true WHERE department = 'marketing'`);
await loadSwitches(true); // this instance now believes Marketing is on
await write(`UPDATE mirror.edit_switch SET is_on = false WHERE department = 'marketing'`); // Tom turns it off elsewhere
const K = boardToken(TOKEN, MARGOT, "100");
let d = JSON.parse((await post("boards/100/items/500/cell", { k: K, c: "t1", f: fp("x"), v: "y" }, MARGOT)).body);
ok(!d.ok, "cell edit refused once the switch is off, even on an instance that cached it as on");
await write(`UPDATE mirror.edit_switch SET is_on = true WHERE department = 'marketing'`); await loadSwitches(true);
await write(`UPDATE mirror.edit_switch SET is_on = false WHERE department = 'marketing'`);
d = JSON.parse((await post("boards/100/items/500/update", { k: K, t: "hello" }, MARGOT)).body);
ok(!d.ok, "posting an update refused");
await write(`UPDATE mirror.edit_switch SET is_on = true WHERE department = 'marketing'`); await loadSwitches(true);
await write(`UPDATE mirror.edit_switch SET is_on = false WHERE department = 'marketing'`);
d = JSON.parse((await post("boards/100/items/new", { k: K, g: "g1", name: "New" }, MARGOT)).body);
ok(!d.ok, "adding an item refused");
ok(mondayCalls === 0, "monday never called while the section is off");

// turn Content on
out = await post("data/editing", flipBody("content", true));
ok(/editing is on/.test(out.html), "Tom turns Content on");
out = await get("boards/200");
ok(/data-k=/.test(out.html) && /data-eco-add/.test(out.html), "Content boards become editable");
out = await get("data/editing");
ok(/Recent changes/.test(out.html) && /Turned on/.test(out.html) && /Turned off/.test(out.html), "change history on the page");

// money, legal and private boards are never editable, whichever section they are filed under
await write(`INSERT INTO mirror.boards (id, name, board_type, department, access, allowed_emails, columns, groups) VALUES
  (400, 'Commission tracker', 'board', 'content', 'team', '{}', $1::jsonb, '[]'),
  (401, 'Content invoices', 'board', 'content', 'team', '{}', $1::jsonb, '[]')`, [JSON.stringify(COLS)]);
await write(`UPDATE mirror.boards SET folder_path = 'Legal / Contracts' WHERE id = 401`);
await write(`INSERT INTO mirror.boards (id, name, board_type, department, access, allowed_emails, columns, groups, folder_path) VALUES
  (402, 'Plain board', 'board', 'content', 'team', '{}', $1::jsonb, '[]', 'Legal / Contracts')`, [JSON.stringify(COLS)]);
ok(!canEdit(await board(400), TOM, team), "a commission board filed under Content stays read-only with Content on");
ok(!canEdit(await board(402), TOM, team), "a board in a Legal folder stays read-only");
ok(canEdit(await board(200), TOM, team), "an ordinary Content board is editable");
ok(!canEdit({ id: "200", board_type: "board", department: "content", access: "team", allowed_emails: [] }, TOM, team), "a board record without its name is treated as locked");

// turned off between the first check and the monday write: nothing is written
let mutations = 0;
setFetch(async (url, opts) => {
  const body = JSON.parse(opts.body);
  if (/change_multiple_column_values/.test(body.query)) { mutations++; return { ok: true, json: async () => ({ data: { change_multiple_column_values: { id: "600" } } }) }; }
  if (/items \(ids/.test(body.query)) {
    await write(`UPDATE mirror.edit_switch SET is_on = false WHERE department = 'content'`); // Tom turns Content off right now
    return { ok: true, json: async () => ({ data: { items: [{ id: "600", name: "B", state: "active", board: { id: "200" }, group: { id: "g1" }, updated_at: new Date().toISOString(), column_values: [] }] } }) };
  }
  throw new Error("unexpected " + body.query.slice(0, 40));
});
await loadSwitches(true);
d = JSON.parse((await post("boards/200/items/600/cell", { k: boardToken(TOKEN, MARGOT, "200"), c: "t1", f: fp(""), v: "new" }, MARGOT)).body);
ok(!d.ok && /just been turned off/.test(d.message) && mutations === 0, "switch turned off mid-request: monday is not written");

console.log("switch tests passed: " + pass);
