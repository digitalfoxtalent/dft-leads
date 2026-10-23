// Tests for the monday gateway (gateway.js, /api/v1/monday). In-memory Postgres (PGlite) and a fake monday.
//   npm install --no-save @electric-sql/pglite@0.3.15 && node test/gateway.mjs

import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setExecutor, read, write } from "../api/_reports/mirror/db.js";
import { ensureSchema } from "../api/_reports/mirror/schema.js";
import { serveApi, createKey, adminToken } from "../api/_reports/mirror/apikeys.js";
import { setGatewayFetch, topFields } from "../api/_reports/mirror/gateway.js";
import { setFetch } from "../api/_reports/mirror/edit.js";
import { mirrorPage } from "../api/_reports/mirror/route.js";

const pg = new PGlite();
setExecutor({
  read: async (t, p) => (await pg.query(t, p)).rows,
  write: async (t, p) => (await pg.query(t, p)).rows,
  batch: async list => { const out = []; for (const [t, p] of list) out.push((await pg.query(t, p)).rows); return out; },
});
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const TOM = "tom@digitalfoxtalent.com", TOKEN = "monday-server-token";

// ---------- fake monday (the gateway's pass-through, and the item refresh) ----------
const sent = [];
const live = { "501": { board: "100", name: "New deal", group: "g1", vals: { t1: ["hello", "\"hello\""] }, state: "active" } };
setGatewayFetch(async (url, opts) => {
  assert.equal(opts.headers.Authorization, TOKEN);
  const b = JSON.parse(opts.body); sent.push({ body: b, version: opts.headers["API-Version"] });
  if (/create_item/.test(b.query)) return { ok: true, status: 200, text: async () => JSON.stringify({ data: { create_item: { id: "501" } }, account_id: 1 }) };
  if (/archive_item/.test(b.query)) { live["500"] = { state: "archived" }; return { ok: true, status: 200, text: async () => JSON.stringify({ data: { archive_item: { id: "500" } } }) }; }
  if (/boom/.test(b.query)) return { ok: false, status: 500, text: async () => "oops" };
  return { ok: true, status: 200, text: async () => JSON.stringify({ data: { boards: [{ id: "100", items_page: { items: [{ id: "500", name: "Kikoff" }] } }] }, account_id: 1 }) };
});
setFetch(async (url, opts) => { // refreshItems reads the item back
  const b = JSON.parse(opts.body), id = b.variables.i[0], it = live[id];
  return { ok: true, json: async () => ({ data: { items: it ? [{ id, name: it.name, state: it.state, board: { id: it.board }, group: { id: it.group }, parent_item: null, updated_at: new Date().toISOString(), created_at: new Date().toISOString(),
    column_values: Object.entries(it.vals || {}).map(([cid, [text, value]]) => ({ id: cid, text, value })) }] : [] } }) };
});

await ensureSchema();
await write(`INSERT INTO mirror.boards (id, name, board_type, department, access, allowed_emails) VALUES (100, 'Renewal Pipeline', 'board', 'partnerships', 'team', '{}')`);
await write(`INSERT INTO mirror.items (id, board_id, group_id, name, vals) VALUES (500, 100, 'g1', 'Kikoff', '{}')`);
await write(`INSERT INTO mirror.team (email, name) VALUES ($1, 'Tom James')`, [TOM]);
const gk = await createKey("Make: renewal alerts", [], [], TOM, "n1", true);
const plain = await createKey("Make: read only", ["partnerships"], [], TOM, "n2", false);
const gw = (body, k = gk, method = "POST", headers = {}) => serveApi({ method, headers: Object.assign({ authorization: "Bearer " + k }, headers), query: {}, body }, "monday", TOKEN);
const Q = `query ($b: [ID!]) { boards (ids: $b) { id items_page (limit: 5) { items { id name column_values { id text ... on MirrorValue { display_value } } } } } }`;

// ---------- parsing ----------
ok(JSON.stringify(topFields(Q)) === JSON.stringify({ kind: "query", fields: ["boards"], operations: 1 }), "reads the top-level fields of a query");
ok(JSON.stringify(topFields(`mutation { a: create_item (board_id: 1, item_name: "x { y }") { id } create_update (item_id: 2, body: "z") { id } }`).fields) === '["create_item","create_update"]', "aliases resolved; braces inside strings ignored");
ok(topFields(`{ me { id } }`).kind === "query" && topFields(`query A { me { id } } query B { me { id } }`).operations === 2, "shorthand queries; several operations counted");

// ---------- pass-through ----------
let r = await gw({ query: Q, variables: { b: ["100"] } });
ok(r.status === 200 && JSON.parse(r.raw).data.boards[0].items_page.items[0].name === "Kikoff" && /"account_id":1/.test(r.raw), "a query goes to monday unchanged and monday's answer comes back unchanged");
ok(sent.at(-1).body.query === Q && JSON.stringify(sent.at(-1).body.variables) === '{"b":["100"]}' && sent.at(-1).version === "2025-04", "same query and variables sent; default API version");
r = await gw({ query: Q }, gk, "POST", { "api-version": "2024-10" });
ok(sent.at(-1).version === "2024-10", "the caller's API version is passed on");
r = await gw(JSON.stringify({ query: Q }));
ok(r.status === 200, "a body sent as text works too");

// ---------- changes ----------
r = await gw({ query: `mutation ($b: ID!, $n: String!) { create_item (board_id: $b, item_name: $n) { id } }`, variables: { b: "100", n: "New deal" } });
ok(r.status === 200 && JSON.parse(r.raw).data.create_item.id === "501", "an allowed change passes through");
const copied = (await read(`SELECT name, board_id::text AS b, vals->'t1'->>0 AS t FROM mirror.items WHERE id = 501`))[0];
ok(copied && copied.name === "New deal" && copied.b === "100" && copied.t === "hello", "the new item is in the Ecosystem straight away");
r = await gw({ query: `mutation { archive_item (item_id: 500) { id } }` });
ok(r.status === 200 && (await read(`SELECT deleted FROM mirror.items WHERE id = 500`))[0].deleted === true, "an archived item is marked deleted straight away");
const before = sent.length;
r = await gw({ query: `mutation { delete_board (board_id: 100) { id } }` });
ok(r.status === 403 && /does not allow delete_board/.test(JSON.stringify(r.body)) && sent.length === before, "changes our scenarios never make are refused before reaching monday");
r = await gw({ query: `mutation { create_item (board_id: 1, item_name: "x") { id } delete_item (item_id: 2) { id } }` });
ok(r.status === 403 && sent.length === before, "one refused change in a request refuses the whole request");
r = await gw({ query: `query A { me { id } } query B { me { id } }` });
ok(r.status === 400 && sent.length === before, "one operation per request");
r = await gw({ query: `subscription { x }` });
ok(r.status === 400, "subscriptions refused");
r = await gw({ query: "" });
ok(r.status === 400, "empty query refused");
r = await gw({ query: "x".repeat(100001) });
ok(r.status === 400, "huge query refused");
r = await gw({ query: Q }, gk, "GET");
ok(r.status === 405, "GET refused");
r = await gw({ query: `query { boom }` });
ok(r.status === 500 && r.raw === "oops", "monday's own errors come back as they are");

// ---------- keys ----------
r = await gw({ query: Q }, plain);
ok(r.status === 403 && /not allowed to use the monday gateway/.test(JSON.stringify(r.body)), "a key without gateway permission is refused");
r = await serveApi({ method: "POST", headers: {}, query: {}, body: { query: Q } }, "monday", TOKEN);
ok(r.status === 401, "no key: refused");
r = await serveApi({ method: "POST", headers: { authorization: "Bearer " + gk }, query: {}, body: { query: Q } }, "monday", "");
ok(r.status === 503, "no monday token on the server: refused");

// ---------- the log ----------
const logRows = await read(`SELECT kind, fields, status, refreshed, error FROM mirror.gateway_log ORDER BY id`);
ok(logRows.length >= 14 && logRows.some(l => l.kind === "mutation" && l.fields[0] === "create_item" && l.refreshed === 1) && logRows.some(l => l.status === 403 && /delete_board/.test(l.error)), "every gateway call logged: operations, outcome, items copied");
ok(!JSON.stringify(logRows).includes("New deal") && !JSON.stringify(logRows).includes("Kikoff"), "the log never holds content");
await write(`INSERT INTO mirror.gateway_log (key_id, status) SELECT id, 200 FROM mirror.api_keys, generate_series(1, 10000) WHERE name = 'Make: renewal alerts'`);
r = await gw({ query: Q });
ok(r.status === 429, "10,000 gateway calls an hour per key");

// ---------- the key page ----------
const page = await mirrorPage("data/api-keys", { method: "POST", headers: { origin: "https://ecosystem.digitalfoxtalent.com" }, query: {}, body: { t: adminToken("tok", TOM), do: "create", name: "Make: gateway only", gateway: "1", n: "n3" } }, { setHeader() {} }, TOM, "tok");
ok(page.status === 200 && (await read(`SELECT gateway FROM mirror.api_keys WHERE name = 'Make: gateway only'`))[0].gateway === true, "Tom can make a gateway key");
ok(/Gateway \(24 h\)/.test(page.html), "gateway use shown per key");

console.log("gateway tests passed: " + pass);
