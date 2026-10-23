// Tests for editing in the Ecosystem (api/_reports/mirror/edit.js). In-memory Postgres (PGlite) and a fake
// monday API, so nothing real is touched.
//   npm install --no-save @electric-sql/pglite@0.3.15 && node test/edit.mjs

import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setExecutor, read, write } from "../api/_reports/mirror/db.js";
import { ensureSchema } from "../api/_reports/mirror/schema.js";
import { setFetch, saveEdit, undoEdit, mondayValue, formToken, currentText } from "../api/_reports/mirror/edit.js";
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
const TOM = "tom@digitalfoxtalent.com", MARGOT = "margot@digitalfoxtalent.com", AMY = "amy@digitalfoxtalent.com";

// ---------- fake monday ----------
const live = { id: "500", board: "100", name: "Kikoff case study", vals: {
  t1: ["Pitch", "\"Pitch\""], s1: ["Brief ready", JSON.stringify({ index: 1 })], n1: ["88", "\"88\""], d1: ["2026-10-06", JSON.stringify({ date: "2026-10-06" })],
  f1: ["42", null] } };
const sent = [];
setFetch(async (url, opts) => {
  const body = JSON.parse(opts.body);
  assert.equal(opts.headers.Authorization, TOKEN);
  if (/change_multiple_column_values/.test(body.query)) {
    sent.push(body.variables);
    const v = JSON.parse(body.variables.v);
    for (const [k, x] of Object.entries(v)) {
      if (k === "name") { live.name = x; continue; }
      const text = x == null ? "" : typeof x === "string" ? x : x.label || x.text || x.date || x.url || x.email || (x.checked ? "v" : "");
      if (text === "" ) delete live.vals[k]; else live.vals[k] = [text, JSON.stringify(x)];
    }
    return { ok: true, json: async () => ({ data: { change_multiple_column_values: { id: live.id } } }) };
  }
  if (/items \(ids/.test(body.query)) {
    return { ok: true, json: async () => ({ data: { items: [{ id: live.id, name: live.name, state: "active", board: { id: live.board }, group: { id: "topics" }, updated_at: new Date().toISOString(),
      column_values: Object.entries(live.vals).map(([id, [text, value]]) => ({ id, type: "x", text, value })) }] } }) };
  }
  throw new Error("unexpected monday call " + body.query.slice(0, 60));
});

// ---------- seed ----------
await ensureSchema();
const COLS = [
  { id: "t1", title: "Type", type: "text" },
  { id: "s1", title: "Draft status", type: "status", labels: { "0": ["Idea", "#c4c4c4"], "1": ["Brief ready", "#00c875"], "2": ["Published", "#579bfc"] } },
  { id: "n1", title: "Priority score", type: "numbers" },
  { id: "d1", title: "Target date", type: "date" },
  { id: "l1", title: "Notes", type: "long_text" },
  { id: "k1", title: "Review row", type: "link" },
  { id: "f1", title: "Score formula", type: "formula" },
];
await write(`INSERT INTO mirror.boards (id, name, board_type, department, access, allowed_emails, columns, groups) VALUES
  (100, 'Editorial Plan', 'board', 'marketing', 'team', '{}', $1::jsonb, '[{"id":"topics","title":"Priority"}]'),
  (200, 'Partner Pay Cap', 'board', 'finance', 'listed', '{tom@digitalfoxtalent.com}', $1::jsonb, '[]'),
  (300, 'Private Marketing', 'board', 'marketing', 'listed', '{tom@digitalfoxtalent.com}', $1::jsonb, '[]')`, [JSON.stringify(COLS)]);
await write(`INSERT INTO mirror.items (id, board_id, group_id, name, vals) VALUES (500, 100, 'topics', $1, $2::jsonb), (600, 200, null, 'Cap', '{}'), (700, 300, null, 'Secret', '{}')`,
  [live.name, JSON.stringify(live.vals)]);
await write(`INSERT INTO mirror.team (email) VALUES ($1), ($2), ($3)`, [TOM, MARGOT, AMY]);
const team = new Set([TOM, MARGOT, AMY]);
const board = async id => (await read(`SELECT id::text AS id, board_type, department, access, allowed_emails, gone, columns FROM mirror.boards WHERE id = $1`, [id]))[0];
const item = async id => (await read(`SELECT id::text AS id, name, vals FROM mirror.items WHERE id = $1`, [id]))[0];
const fpOf = async (col, id) => { const crypto = await import("node:crypto"); return crypto.createHash("sha256").update(String(currentText(col, await item(id)))).digest("base64url").slice(0, 16); };
const post = (body, origin = "https://ecosystem.digitalfoxtalent.com") => ({ method: "POST", headers: { origin }, body });
const resStub = { setHeader() {} };

// ---------- the page ----------
let out = await mirrorPage("boards/100/items/500", { method: "GET", headers: {}, query: {} }, resStub, MARGOT, TOKEN);
ok(out.status === 200 && /Editable here/.test(out.html) && /action="\/boards\/100\/items\/500\/edit"/.test(out.html), "Marketing item shows the edit form");
ok(!/name="f_f1"/.test(out.html), "formula column is not editable");
ok(/<option selected>Brief ready<\/option>/.test(out.html), "status shows as a dropdown with the current label");
out = await mirrorPage("boards/200/items/600", { method: "GET", headers: {}, query: {} }, resStub, TOM, TOKEN);
ok(out.status === 200 && !/class="edit"/.test(out.html) && /Read-only copy/.test(out.html), "Finance board stays read-only");
out = await mirrorPage("boards/300/items/700", { method: "GET", headers: {}, query: {} }, resStub, MARGOT, TOKEN);
ok(out.status === 404, "a private Marketing board is still hidden from people not on it");
out = await mirrorPage("boards/100/items/500/edit", { method: "GET", headers: {}, query: {} }, resStub, MARGOT, TOKEN);
ok(out.status === 405, "GET to the edit address does nothing");

// ---------- validation ----------
ok(JSON.stringify(mondayValue(COLS[1], "Published")) === '{"label":"Published"}', "status value");
assert.throws(() => mondayValue(COLS[1], "Made up"), /choose one/); pass++;
assert.throws(() => mondayValue(COLS[2], "abc"), /number/); pass++;
assert.throws(() => mondayValue(COLS[5], "javascript:alert(1)"), /web address/); pass++;
assert.throws(() => mondayValue({ id: "name", title: "Name", type: "name" }, "  "), /cannot be empty/); pass++;
ok(JSON.stringify(mondayValue(COLS[3], "")) === "{}", "empty date clears");

// ---------- guards ----------
const b100 = await board(100);
const tok = formToken(TOKEN, MARGOT, "500");
const base = async () => ({ t: tok, f_t1: "Pitch", b_t1: await fpOf(COLS[0], 500), f_s1: "Brief ready", b_s1: await fpOf(COLS[1], 500), f_n1: "88", b_n1: await fpOf(COLS[2], 500) });
let r = await saveEdit(post(await base(), "https://evil.example"), TOKEN, MARGOT, b100, await item(500), team);
ok(!r.ok && /did not come from/.test(r.message), "post from another site refused");
r = await saveEdit(post(Object.assign(await base(), { t: "x".repeat(32) })), TOKEN, MARGOT, b100, await item(500), team);
ok(!r.ok && /expired/.test(r.message), "forged form token refused");
r = await saveEdit(post(Object.assign(await base(), { t: formToken(TOKEN, AMY, "500") })), TOKEN, MARGOT, b100, await item(500), team);
ok(!r.ok, "someone else's form token refused");
r = await saveEdit(post({ t: formToken(TOKEN, TOM, "600") }), TOKEN, TOM, await board(200), await item(600), team);
ok(!r.ok && /cannot be edited/.test(r.message), "finance board cannot be edited even by Tom");
r = await saveEdit(post(Object.assign(await base(), { f_n1: "lots" })), TOKEN, MARGOT, b100, await item(500), team);
ok(!r.ok && /number/.test(r.message) && sent.length === 0, "invalid value refused before anything is written");
r = await saveEdit(post(await base()), TOKEN, MARGOT, b100, await item(500), team);
ok(r.ok && /Nothing changed/.test(r.message) && sent.length === 0, "unchanged form writes nothing");

// ---------- a real edit ----------
r = await saveEdit(post(Object.assign(await base(), { f_s1: "Published", f_n1: "95", f_t1: "Case <b>study</b>" })), TOKEN, MARGOT, b100, await item(500), team);
ok(r.ok && sent.length === 1, "edit saved with one monday call");
const v = JSON.parse(sent[0].v);
ok(v.s1.label === "Published" && v.n1 === "95" && v.t1 === "Case <b>study</b>" && !("f1" in v), "monday got exactly the changed fields in the right format");
let it = await item(500);
ok(it.vals.s1[0] === "Published" && it.vals.n1[0] === "95", "our copy shows monday's new values straight away");
let log = await read(`SELECT * FROM mirror.edits ORDER BY id`);
ok(log.length === 3 && log.every(x => x.email === MARGOT && x.ok) && log.find(x => x.column_id === "s1").old_text === "Brief ready", "each changed field logged with who and the old value");
out = await mirrorPage("boards/100/items/500", { method: "GET", headers: {}, query: {} }, resStub, MARGOT, TOKEN);
ok(/Changes made in the Ecosystem/.test(out.html) && /Case &lt;b&gt;study&lt;\/b&gt;/.test(out.html) && !/Case <b>study/.test(out.html), "history shown and escaped");

// ---------- someone changed it in monday meanwhile ----------
const stale = await base(); // fingerprints of what Margot sees now
live.vals.s1 = ["Idea", JSON.stringify({ index: 0 })]; // changed in monday, not yet copied
const sentBefore = sent.length;
r = await saveEdit(post(Object.assign(stale, { f_s1: "Brief ready" })), TOKEN, MARGOT, b100, await item(500), team);
ok(!r.ok && /changed Draft status in monday/.test(r.message) && sent.length === sentBefore, "edit refused when monday moved on; nothing overwritten");
it = await item(500);
ok(it.vals.s1[0] === "Idea", "our copy refreshed to monday's newer value");

// ---------- undo ----------
const numEdit = (await read(`SELECT id::text AS id FROM mirror.edits WHERE column_id = 'n1' AND ok`))[0].id;
r = await undoEdit(post({ t: tok, e: numEdit }), TOKEN, MARGOT, b100, await item(500), team);
ok(r.ok && JSON.parse(sent[sent.length - 1].v).n1 === "88" && live.vals.n1[0] === "88", "undo writes the old value back to monday");
r = await undoEdit(post({ t: tok, e: numEdit }), TOKEN, MARGOT, b100, await item(500), team);
ok(!r.ok, "a change cannot be undone twice");
r = await undoEdit(post({ t: tok, e: "1; DROP TABLE mirror.edits" }), TOKEN, MARGOT, b100, await item(500), team);
ok(!r.ok && (await read(`SELECT count(*)::int AS n FROM mirror.edits`))[0].n > 0, "bad undo id refused");

// ---------- rate limit ----------
for (let i = 0; i < 60; i++) await write(`INSERT INTO mirror.edits (email, board_id, item_id, column_id, ok) VALUES ($1, 100, 500, 't1', true)`, [AMY]);
r = await saveEdit(post({ t: formToken(TOKEN, AMY, "500") }), TOKEN, AMY, b100, await item(500), team);
ok(!r.ok && /Too many/.test(r.message), "60 changes an hour per person");

// ---------- through the route ----------
const before = sent.length;
out = await mirrorPage("boards/100/items/500/edit", { method: "POST", headers: { origin: "https://ecosystem.digitalfoxtalent.com" }, query: {},
  body: Object.assign(await base(), { f_t1: "Guide" }) }, resStub, MARGOT, TOKEN);
ok(out.status === 200 && /Saved to monday: Type/.test(out.html) && sent.length === before + 1, "edit through the route shows the saved note");
out = await mirrorPage("boards/200/items/600/edit", { method: "POST", headers: { origin: "https://ecosystem.digitalfoxtalent.com" }, query: {}, body: { t: formToken(TOKEN, TOM, "600"), f_t1: "x" } }, resStub, TOM, TOKEN);
ok(out.status === 400 && sent.length === before + 1, "finance edit through the route refused, nothing sent");

console.log("edit tests passed: " + pass);
