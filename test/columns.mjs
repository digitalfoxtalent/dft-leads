// Tests for editing people, dropdown, timeline and rating columns (edit.js). In-memory Postgres (PGlite) and a fake
// monday API, so nothing real is touched.
//   npm install --no-save @electric-sql/pglite@0.3.15 && node test/columns.mjs

import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setExecutor, read, write } from "../api/_reports/mirror/db.js";
import { ensureSchema } from "../api/_reports/mirror/schema.js";
import { setFetch, boardToken, fp, currentText, mondayValue } from "../api/_reports/mirror/edit.js";
import { loadSwitches } from "../api/_reports/mirror/switch.js";
import { mirrorPage } from "../api/_reports/mirror/route.js";

const pg = new PGlite();
setExecutor({
  read: async (t, p) => (await pg.query(t, p)).rows,
  write: async (t, p) => (await pg.query(t, p)).rows,
  batch: async list => { const out = []; for (const [t, p] of list) out.push((await pg.query(t, p)).rows); return out; },
});
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const TOKEN = "monday-token-test", MARGOT = "margot@digitalfoxtalent.com";
const SITE = "https://ecosystem.digitalfoxtalent.com";

// ---------- fake monday ----------
const USERS = { "11": "Margot Smith", "12": "Tom James", "13": "Guest Person", "21": "Alex Smith", "22": "Alex Smith" }, TEAMS = { "90": "Sales Team" };
const live = { name: "Kikoff", vals: { p1: ["Tom James", JSON.stringify({ personsAndTeams: [{ id: 12, kind: "person" }] })], dd: ["Site, LinkedIn", JSON.stringify({ ids: [1, 2] })] } };
const sent = []; let userCalls = 0, ignore = null;
setFetch(async (url, opts) => {
  const body = JSON.parse(opts.body), v = body.variables;
  const reply = data => ({ ok: true, json: async () => ({ data }) });
  if (/users \(limit/.test(body.query)) { userCalls++; return reply({ users: Object.entries(USERS).map(([id, name]) => ({ id, name, enabled: true })), teams: Object.entries(TEAMS).map(([id, name]) => ({ id, name })) }); }
  if (/change_multiple_column_values/.test(body.query)) {
    const vals = JSON.parse(v.v); sent.push(vals);
    for (const [k, x] of Object.entries(vals)) {
      if (k === ignore) continue; // monday says OK but does not apply it
      if (!x || !Object.keys(x).length) { delete live.vals[k]; continue; }
      const text = x.personsAndTeams ? x.personsAndTeams.map(p => p.kind === "team" ? TEAMS[p.id] : USERS[p.id] || NAMES[p.id]).join(", ") : x.labels ? x.labels.join(", ") : x.from ? x.from + " - " + x.to : x.rating != null ? String(x.rating) : "";
      live.vals[k] = [text, JSON.stringify(x)];
    }
    return reply({ change_multiple_column_values: { id: "500" } });
  }
  if (/items \(ids/.test(body.query)) return reply({ items: [{ id: "500", name: live.name, state: "active", board: { id: "100" }, group: { id: "g1" }, updated_at: new Date().toISOString(),
    column_values: Object.entries(live.vals).map(([id, [text, value]]) => ({ id, type: "x", text, value })) }] });
  throw new Error("unexpected " + body.query.slice(0, 50));
});

// ---------- seed ----------
await ensureSchema();
const COLS = [
  { id: "p1", title: "Owner", type: "people" },
  { id: "dd", title: "Distribution", type: "dropdown", options: ["Site", "LinkedIn", "Pitch", "YouTube"] },
  { id: "tl", title: "Window", type: "timeline" },
  { id: "rt", title: "Priority", type: "rating", max: 5 },
  { id: "d2", title: "Legacy dropdown", type: "dropdown" },
];
await write(`INSERT INTO mirror.boards (id, name, board_type, department, access, allowed_emails, columns, groups) VALUES (100, 'Editorial Plan', 'board', 'marketing', 'team', '{}', $1::jsonb, '[{"id":"g1","title":"G"}]')`, [JSON.stringify(COLS)]);
await write(`INSERT INTO mirror.items (id, board_id, group_id, name, vals) VALUES (500, 100, 'g1', 'Kikoff', $1::jsonb), (501, 100, 'g1', 'Other', '{"d2":["Old value, Another",null]}')`, [JSON.stringify(live.vals)]);
await write(`INSERT INTO mirror.team (email, name, monday_id) VALUES ($1, 'Margot Smith', 11), ('tom@digitalfoxtalent.com', 'Tom James', 12), ('new@digitalfoxtalent.com', 'New Person', NULL)`, [MARGOT]);
await loadSwitches(true);

const res = { setHeader() {} };
const K = boardToken(TOKEN, MARGOT, "100");
const item = async () => (await read(`SELECT id::text AS id, name, vals FROM mirror.items WHERE id = 500`))[0];
const cellPost = async (c, v) => { const it = await item(); const col = COLS.find(x => x.id === c);
  return JSON.parse((await mirrorPage("boards/100/items/500/cell", { method: "POST", headers: { origin: SITE }, query: {}, body: { k: K, c, f: fp(currentText(col, it)), v } }, res, MARGOT, TOKEN)).body); };

// ---------- the board ----------
let h = (await mirrorPage("boards/100", { method: "GET", headers: {}, query: {} }, res, MARGOT, TOKEN)).html;
ok(/data-c="p1" data-t="people"/.test(h) && /data-c="dd" data-t="dropdown"/.test(h) && /data-c="tl" data-t="timeline"/.test(h) && /data-c="rt" data-t="rating"/.test(h), "people, dropdown, timeline and rating cells are editable");
const cols = JSON.parse(h.match(/<script type="application\/json" id="eco-cols">([^<]*)<\/script>/)[1]);
ok(JSON.stringify(cols.p1.o) === JSON.stringify(["Margot Smith", "New Person", "Tom James"]), "people picker lists the team");
ok(JSON.stringify(cols.dd.o) === JSON.stringify(["Site", "LinkedIn", "Pitch", "YouTube"]) && JSON.stringify(cols.d2.o) === JSON.stringify(["Another", "Old value"]) && cols.rt.m === 5, "dropdown options from the column (or values in use), rating scale");

// ---------- people ----------
let d = await cellPost("p1", "Tom James, Margot Smith");
ok(d.ok && JSON.stringify(sent.at(-1).p1) === JSON.stringify({ personsAndTeams: [{ id: 12, kind: "person" }, { id: 11, kind: "person" }] }) && userCalls === 0, "assign two people: ids from our team copy, no extra monday lookup");
ok(/Tom James, Margot Smith/.test(d.html), "cell shows the new people");
d = await cellPost("p1", "Margot Smith, Guest Person, Sales Team");
ok(d.ok && JSON.stringify(sent.at(-1).p1) === JSON.stringify({ personsAndTeams: [{ id: 11, kind: "person" }, { id: 13, kind: "person" }, { id: 90, kind: "team" }] }) && userCalls === 1, "a guest and a team resolve through monday");
const before = sent.length;
d = await cellPost("p1", "Margot Smith, Nobody Real");
ok(!d.ok && /Nobody Real is not a monday user/.test(d.message) && sent.length === before, "unknown person refused, nothing written");
d = await cellPost("p1", "Guest Person, Sales Team, Margot Smith");
ok(d.ok && /No change/.test(d.message) && sent.length === before, "same people in another order is no change");
d = await cellPost("p1", "");
ok(d.ok && JSON.stringify(sent.at(-1).p1) === "{}", "clear the people");

// namesakes, and people who have left monday, are kept by id
const NAMES = { "99": "Old Leaver" };
const setCell = async (text, ids) => { live.vals.p1 = [text, JSON.stringify({ personsAndTeams: ids.map(id => ({ id, kind: "person" })) })];
  await write(`UPDATE mirror.items SET vals = jsonb_set(vals, '{p1}', $1::jsonb) WHERE id = 500`, [JSON.stringify(live.vals.p1)]); };
await setCell("Alex Smith, Alex Smith, Old Leaver", [21, 22, 99]);
d = await cellPost("p1", "Alex Smith, Old Leaver, Margot Smith");
ok(d.ok && JSON.stringify(sent.at(-1).p1.personsAndTeams.map(p => p.id)) === "[21,22,99,11]", "adding someone keeps both Alex Smiths and the person who has left, by id");
d = await cellPost("p1", "Margot Smith");
ok(d.ok && JSON.stringify(sent.at(-1).p1.personsAndTeams.map(p => p.id)) === "[11]", "removing names removes exactly those people");
const n0 = sent.length;
d = await cellPost("p1", "Margot Smith, Alex Smith");
ok(!d.ok && /more than one Alex Smith/.test(d.message) && sent.length === n0, "adding a name two people share is refused, not guessed");

// a change monday accepts but does not apply is reported, not called saved
ignore = "p1";
d = await cellPost("p1", "Margot Smith, Tom James");
ok(!d.ok && /did not apply/.test(d.message), "unapplied change reported");
ignore = null;

// ---------- dropdown ----------
d = await cellPost("dd", "Pitch, YouTube");
ok(d.ok && JSON.stringify(sent.at(-1).dd) === JSON.stringify({ labels: ["Pitch", "YouTube"] }), "dropdown labels written");
d = await cellPost("dd", "Pitch, Made Up");
ok(!d.ok && /choose from the listed options/.test(d.message), "unknown dropdown option refused");

// ---------- timeline ----------
d = await cellPost("tl", "2026-11-01 - 2026-11-14");
ok(d.ok && JSON.stringify(sent.at(-1).tl) === JSON.stringify({ from: "2026-11-01", to: "2026-11-14" }), "timeline written");
d = await cellPost("tl", "2026-11-14 - 2026-11-01");
ok(!d.ok && /start first/.test(d.message), "timeline backwards refused");
ok(currentText(COLS[2], await item()) === "2026-11-01 - 2026-11-14", "timeline reads back as start - end");

// ---------- rating ----------
d = await cellPost("rt", "4");
ok(d.ok && JSON.stringify(sent.at(-1).rt) === JSON.stringify({ rating: 4 }), "rating written");
d = await cellPost("rt", "9");
ok(!d.ok && /1 to 5/.test(d.message), "rating out of range refused");
assert.throws(() => mondayValue(COLS[3], "2.5"), /whole number/); pass++;

// ---------- the item page form and undo ----------
h = (await mirrorPage("boards/100/items/500", { method: "GET", headers: {}, query: {} }, res, MARGOT, TOKEN)).html;
ok(/name="f_p1"[^>]*placeholder="Name, Name"/.test(h) && /name="f_tl"[^>]*placeholder="2026-10-01 - 2026-10-05"/.test(h), "item page form has the new fields");
const last = (await read(`SELECT id FROM mirror.edits WHERE column_id = 'dd' AND ok ORDER BY id DESC LIMIT 1`))[0];
const { formToken } = await import("../api/_reports/mirror/edit.js");
h = (await mirrorPage("boards/100/items/500/undo", { method: "POST", headers: { origin: SITE }, query: {}, body: { t: formToken(TOKEN, MARGOT, "500"), e: String(last.id) } }, res, MARGOT, TOKEN)).html;
ok(/Undone: Distribution/.test(h) && JSON.stringify(sent.at(-1).dd) === JSON.stringify({ labels: ["Site", "LinkedIn"] }), "undo restores the dropdown");

const js = (await mirrorPage("assets/eco-board.js", { method: "GET", headers: {}, query: {} }, res, MARGOT, TOKEN)).body;
ok(/multiPicker/.test(js) && /timelinePicker/.test(js) && !/innerHTML = (?!d\.html)/.test(js), "pickers in the board script, still no client-built HTML");

console.log("column tests passed: " + pass);
