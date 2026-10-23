// Tests for the Ecosystem API v1 and its keys (apikeys.js, /data/api-keys). In-memory Postgres (PGlite).
//   npm install --no-save @electric-sql/pglite@0.3.15 && node test/api.mjs

import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setExecutor, read, write } from "../api/_reports/mirror/db.js";
import { ensureSchema } from "../api/_reports/mirror/schema.js";
import { serveApi, createKey, adminToken } from "../api/_reports/mirror/apikeys.js";
import { mirrorPage } from "../api/_reports/mirror/route.js";

const pg = new PGlite();
setExecutor({
  read: async (t, p) => (await pg.query(t, p)).rows,
  write: async (t, p) => (await pg.query(t, p)).rows,
  batch: async list => { const out = []; for (const [t, p] of list) out.push((await pg.query(t, p)).rows); return out; },
});
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const TOM = "tom@digitalfoxtalent.com", MARGOT = "margot@digitalfoxtalent.com", SITE = "https://ecosystem.digitalfoxtalent.com";

await ensureSchema();
const COLS = [{ id: "s1", title: "Status", type: "status", labels: { "0": ["Open", "#fdab3d"] } }, { id: "t1", title: "Notes", type: "text" }];
await write(`INSERT INTO mirror.boards (id, name, board_type, department, access, allowed_emails, columns, groups, synced_at, mirror_items) VALUES
  (100, 'Renewal Pipeline', 'board', 'partnerships', 'team', '{}', $1::jsonb, '[{"id":"g1","title":"Live"}]', now(), 3),
  (101, 'Private Deals', 'board', 'partnerships', 'listed', '{tom@digitalfoxtalent.com}', $1::jsonb, '[]', now(), 1),
  (150, 'Subitems of Renewal Pipeline', 'sub_items_board', 'partnerships', 'team', '{}', '[]', '[]', now(), 1),
  (200, 'Pay Cap', 'board', 'finance', 'listed', '{tom@digitalfoxtalent.com}', $1::jsonb, '[]', now(), 1),
  (300, 'Editorial Plan', 'board', 'marketing', 'team', '{}', $1::jsonb, '[]', now(), 0)`, [JSON.stringify(COLS)]);
await write(`UPDATE mirror.boards SET parent_board_id = 100 WHERE id = 150`);
await write(`INSERT INTO mirror.items (id, board_id, parent_id, group_id, name, vals, created_at, updated_at) VALUES
  (1, 100, NULL, 'g1', 'Kikoff', '{"s1":["Open","{\\"index\\":0}"],"t1":["note",null]}', '2026-10-01', '2026-10-01'),
  (2, 100, NULL, 'g1', 'Zocdoc', '{}', '2026-10-02', '2026-10-20'),
  (3, 100, NULL, 'g1', 'Gone one', '{}', '2026-10-03', '2026-10-21'),
  (4, 150, 1, NULL, 'Sub task', '{}', '2026-10-01', '2026-10-01'),
  (5, 101, NULL, NULL, 'Secret deal', '{}', '2026-10-01', '2026-10-01'),
  (6, 200, NULL, NULL, 'Cap', '{}', '2026-10-01', '2026-10-01')`);
await write(`UPDATE mirror.items SET deleted = true WHERE id = 3`);
await write(`INSERT INTO mirror.updates (id, item_id, body, creator, created_at) VALUES (900, 1, 'Signed!', 'Margot', now())`);
await write(`INSERT INTO mirror.backup_updates (id, board_id, item_id, body_text, creator, created_at) VALUES (901, 100, 1, 'Deleted in monday', 'Margot', now())`);
await write(`INSERT INTO mirror.boards (id, name, board_type, department, access, allowed_emails, columns, groups) VALUES (102, 'Commission tracker', 'board', 'partnerships', 'team', '{}', '[]', '[]')`);
await write(`INSERT INTO mirror.items (id, board_id, parent_id, name, vals) VALUES (7, 150, 3, 'Orphan sub', '{}')`);
await write(`INSERT INTO mirror.team (email, name) VALUES ($1, 'Tom James'), ($2, 'Margot')`, [TOM, MARGOT]);

const key = await createKey("Make: renewals", ["partnerships"], [], TOM);
const call = (path, k = key, method = "GET", query = {}) => serveApi({ method, headers: { authorization: k ? "Bearer " + k : undefined }, query }, path);

// ---------- keys ----------
ok(/^eco_[A-Za-z0-9_-]{32}$/.test(key), "keys look like eco_...");
const stored = (await read(`SELECT key_hash, key_hint FROM mirror.api_keys`))[0];
ok(stored.key_hash !== key && stored.key_hash.length === 64 && stored.key_hint === key.slice(-4), "only a hash and the last 4 characters are stored");
let r = await call("boards", null);
ok(r.status === 401, "no key: refused");
r = await call("boards", "eco_" + "x".repeat(32));
ok(r.status === 401, "unknown key: refused");

// ---------- reading ----------
r = await call("boards");
ok(r.status === 200 && JSON.stringify(r.body.boards.map(b => b.id)) === '["100"]', "a key sees only its sections' team boards (not listed-only, finance, other sections or subitem boards)");
ok(JSON.stringify(r.body.boards[0].columns[0]) === JSON.stringify({ id: "s1", title: "Status", type: "status", labels: ["Open"] }), "columns with their labels");
r = await call("boards/300");
ok(r.status === 404, "a board in another section looks like it does not exist");
r = await call("boards/101");
ok(r.status === 404, "listed-only boards hidden unless the key allows them");
r = await call("boards/100/items", key, "GET", { limit: "1" });
ok(r.status === 200 && r.body.items.length === 1 && r.body.items[0].name === "Kikoff" && r.body.next_cursor === "1", "items page with a cursor");
ok(JSON.stringify(r.body.items[0].values.s1) === JSON.stringify({ text: "Open", value: { index: 0 } }), "values as text and monday's value");
r = await call("boards/100/items", key, "GET", { cursor: "1" });
ok(r.body.items.length === 1 && r.body.items[0].name === "Zocdoc" && r.body.next_cursor === null, "next page; deleted items left out");
r = await call("boards/100/items", key, "GET", { updated_since: "2026-10-10T00:00:00Z" });
ok(r.body.items.length === 1 && r.body.items[0].id === "2", "changed since a time");
r = await call("boards/100/items", key, "GET", { updated_since: "yesterday-ish" });
ok(r.status === 400, "bad date refused");
r = await call("boards/100/items", key, "GET", { cursor: "1; DROP TABLE x" });
ok(r.status === 400, "bad cursor refused");
r = await call("items/1");
ok(r.status === 200 && r.body.item.subitems.length === 1 && r.body.item.updates.length === 1 && r.body.item.updates[0].text === "Signed!", "an item with its subitems and updates (updates deleted in monday are not served)");
r = await call("items/7");
ok(r.status === 404, "a subitem whose parent item is deleted is not served");
r = await call("boards/102");
ok(r.status === 404, "a whole-team money board (commission) is never included by section");
r = await call("boards/100/items", key, "GET", { updated_since: "1" });
ok(r.status === 400, "updated_since must be a real date and time");
r = await call("items/4");
ok(r.status === 200 && r.body.item.parent_id === "1", "a subitem, by its parent's section");
r = await call("items/6");
ok(r.status === 404, "finance item hidden from a partnerships key");
r = await call("items/1", key, "POST");
ok(r.status === 405, "version 1 is read only");
r = await call("nonsense");
ok(r.status === 404, "unknown address");

const priv = await createKey("Make: private", ["partnerships"], ["101"], TOM);
r = await call("boards/101", priv);
ok(r.status === 200, "a board named on the key is readable, even a private one");
r = await call("items/6", priv);
ok(r.status === 404, "but only the named one");

// ---------- logging and limits ----------
ok((await read(`SELECT count(*)::int AS n FROM mirror.api_log WHERE key_id IS NULL`))[0].n === 0 && (await read(`SELECT count(*)::int AS n FROM mirror.api_log`))[0].n >= 16, "every keyed call is logged; calls without a key are not");
ok((await read(`SELECT last_used_at FROM mirror.api_keys WHERE name = 'Make: renewals'`))[0].last_used_at, "last used recorded");
await write(`INSERT INTO mirror.api_log (key_id, method, path, status) SELECT id, 'GET', 'boards', 200 FROM mirror.api_keys, generate_series(1, 1000) WHERE name = 'Make: renewals'`);
r = await call("boards");
ok(r.status === 429, "1,000 calls an hour per key");

// ---------- the key page ----------
const res = { setHeader() {} };
const page = (who, method = "GET", body, origin = SITE) => mirrorPage("data/api-keys", { method, headers: { origin }, query: {}, body }, res, who, "tok");
let out = await page(MARGOT);
ok(out.status === 403 && !/Make: renewals/.test(out.html), "only Tom can see the keys page");
out = await page(TOM);
ok(out.status === 200 && /Make: renewals/.test(out.html) && /\.\.\.\w{4}/.test(out.html) && !out.html.includes(key), "Tom sees keys by name and last 4 characters, never the key");
const T = adminToken("tok", TOM);
out = await page(TOM, "POST", { t: T, do: "create", name: "Make: test", d: ["marketing", "finance"], n: "nonce-1" });
const shown = (out.html.match(/<pre class="key">(eco_[^<]+)<\/pre>/) || [])[1];
ok(out.status === 200 && shown && (await call("boards", shown)).body.boards.some(b => b.id === "300"), "making a key shows it once, and it works");
ok(!(await call("boards", shown)).body.boards.some(b => b.id === "200"), "ticking Finance still does not include finance boards (they are money boards)");
out = await page(TOM, "POST", { t: T, do: "create", name: "Make: test", d: ["marketing"], n: "nonce-1" });
ok(out.status === 400 && /already made a key/.test(out.html) && (await read(`SELECT count(*)::int AS n FROM mirror.api_keys WHERE name = 'Make: test'`))[0].n === 1, "refreshing after making a key does not make a second one");
out = await page(TOM, "POST", { t: T, do: "create", name: "Named boards", boards: "100, 999999", n: "nonce-2" });
ok(out.status === 400 && /999999 is not in/.test(out.html), "extra boards must exist in the copy");
out = await page(TOM, "POST", { t: T, do: "create", name: "Named boards", boards: "101", n: "nonce-3" });
ok(out.status === 200 && /boards 101/.test(out.html), "a key can be made for named boards only");
out = await page(TOM, "POST", { t: T, do: "create", name: "", d: "marketing" });
ok(out.status === 400 && /Give the key a name/.test(out.html), "a key needs a name");
out = await page(TOM, "POST", { t: T, do: "create", name: "x", d: "nonsense" });
ok(out.status === 400 && /Tick at least one section/.test(out.html), "a key needs a real section or named boards");
out = await page(MARGOT, "POST", { t: adminToken("tok", MARGOT), do: "create", name: "sneaky", d: "marketing" });
ok(!(await read(`SELECT 1 FROM mirror.api_keys WHERE name = 'sneaky'`)).length, "nobody but Tom can make a key");
out = await page(TOM, "POST", { t: T, do: "create", name: "csrf", d: "marketing" }, "https://evil.example");
ok(!(await read(`SELECT 1 FROM mirror.api_keys WHERE name = 'csrf'`)).length, "a key cannot be made from another site");
const id = (await read(`SELECT id::text AS id FROM mirror.api_keys WHERE name = 'Make: test'`))[0].id;
out = await page(TOM, "POST", { t: T, do: "revoke", id });
ok(/Key revoked/.test(out.html) && (await call("boards", shown)).status === 401, "a revoked key stops working at once");

// ---------- the one-click key for Make ----------
out = await page(TOM);
ok(/Make the key for Make/.test(out.html) && /eco-board\.js/.test(out.html), "the page offers a one-click key for Make, with the copy button script");
out = await page(TOM, "POST", { t: T, do: "jobs-key", n: "nonce-jobs" });
const jk = (out.html.match(/id="newkey" readonly value="Bearer (eco_[^"]+)"/) || [])[1];
ok(out.status === 200 && jk && /Your key for Make is ready/.test(out.html) && /Open the Make page/.test(out.html) && /data-copy="newkey"/.test(out.html), "one click shows the key ready to copy, with Bearer included, and the Make link");
ok((await read(`SELECT jobs, departments FROM mirror.api_keys WHERE name = 'Make: jobs'`))[0].jobs === true && (await call("boards", jk)).body.boards.length === 0, "it can run jobs and reads no boards");
out = await page(TOM, "POST", { t: T, do: "jobs-key", n: "nonce-jobs" });
ok(out.status === 400 && /already made a key/.test(out.html), "a refresh does not make a second key");
out = await page(TOM);
ok(/Key for Make/.test(out.html) && !/Make the key for Make/.test(out.html) && !out.html.includes(jk), "afterwards the page says the key exists, never shows it again");
out = await page(MARGOT, "POST", { t: adminToken("tok", MARGOT), do: "jobs-key", n: "x" });
ok((await read(`SELECT count(*)::int AS n FROM mirror.api_keys WHERE name = 'Make: jobs'`))[0].n === 1, "only Tom can make it");

console.log("api tests passed: " + pass);
