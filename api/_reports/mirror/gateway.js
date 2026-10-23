// The monday gateway: ecosystem.digitalfoxtalent.com/api/v1/monday accepts the same GraphQL requests Make sends to
// monday (63 of our 64 monday scenarios use monday's raw GraphQL module), so a scenario can be moved off monday
// by changing only where it sends its request and which key it uses. Stage 1 (now): PASS-THROUGH. The request is
// sent to monday unchanged and monday's answer is returned unchanged, so a moved scenario behaves exactly as before.
// What the gateway adds:
//   - only keys Tom has allowed to use the gateway (/data/api-keys) can call it;
//   - changes are limited to the kinds our scenarios make (MUTATIONS below); anything else is refused;
//   - every call is logged by key: which operations, read or change, how long, the outcome. Never the content;
//   - items a change touched are copied into the Ecosystem straight away instead of within 30 minutes.
// Later stages answer reads from the Ecosystem's copy, then everything, section by section.

import { parse, print, Kind } from "graphql";
import { read, write } from "./db.js";
import { refreshItems } from "./edit.js";
import { isExcluded } from "./policy.js";

const API = "https://api.monday.com/v2";
const MAX_QUERY = 100000;
export const MUTATIONS = new Set(["change_multiple_column_values", "change_simple_column_value", "change_column_value", "create_item", "create_subitem",
  "create_update", "create_notification", "move_item_to_group", "archive_item", "create_group"]);

export const GATEWAY_SCHEMA = [
  `ALTER TABLE mirror.api_keys ADD COLUMN IF NOT EXISTS gateway boolean NOT NULL DEFAULT false`,
  `CREATE TABLE IF NOT EXISTS mirror.gateway_log (
     id bigserial PRIMARY KEY,
     at timestamptz NOT NULL DEFAULT now(),
     key_id bigint NOT NULL,
     kind text,                                        -- query | mutation
     fields text[],                                    -- the top-level operations, e.g. {items_page} or {create_item}
     status int,
     ms int,
     refreshed int,
     error text
   )`,
  `CREATE INDEX IF NOT EXISTS gateway_log_key ON mirror.gateway_log (key_id, at DESC)`,
];

let fetchImpl = (...a) => fetch(...a);
export function setGatewayFetch(f) { fetchImpl = f; }

// Read operations a gateway key may use (no account, teams, workspaces, webhooks or assets).
export const READS = new Set(["boards", "items", "items_page_by_column_values", "next_items_page", "users", "me", "docs", "complexity"]);

class Refusal extends Error { constructor(status, message) { super(message); this.status = status; } }
const no = (status, message) => { throw new Refusal(status, message); };

// Parse with the real GraphQL parser and refuse anything whose meaning could differ from what we check: exactly
// one operation, no named fragments, only plain fields (no fragments or directives) at the top level. The
// request forwarded to monday is the parser's own re-print of what was checked.
export function analyse(query) {
  let doc;
  try { doc = parse(query, { noLocation: true }); } catch (e) { no(400, "The query is not valid GraphQL."); }
  const ops = doc.definitions.filter(d => d.kind === Kind.OPERATION_DEFINITION);
  if (ops.length !== doc.definitions.length) no(400, "Named fragments are not supported; write the fields inline.");
  if (ops.length !== 1) no(400, "Send one operation per request.");
  const op = ops[0];
  if (op.operation === "subscription") no(400, "Subscriptions are not supported.");
  if (op.directives && op.directives.length) no(400, "Directives are not supported at the top level.");
  for (const r of op.selectionSet.selections) {
    if (r.kind !== Kind.FIELD) no(400, "Fragments are not supported at the top level.");
    if (r.directives && r.directives.length) no(400, "Directives are not supported at the top level.");
  }
  const roots = op.selectionSet.selections;
  return { kind: op.operation, roots, fields: roots.map(r => r.name.value), printed: print(doc) };
}
// Kept for the log and older callers.
export function topFields(query) { try { const a = analyse(query); return { kind: a.kind, fields: a.fields, operations: 1 }; } catch (e) { return { kind: "invalid", fields: [], operations: 0 }; } }

function value(node, vars) {
  if (!node) return undefined;
  switch (node.kind) {
    case Kind.VARIABLE: return vars ? vars[node.name.value] : undefined;
    case Kind.INT: case Kind.FLOAT: case Kind.STRING: case Kind.ENUM: return node.value;
    case Kind.BOOLEAN: return node.value;
    case Kind.LIST: return node.values.map(v => value(v, vars));
    case Kind.NULL: return null;
    default: return undefined;
  }
}
const arg = (field, name, vars) => { const a = (field.arguments || []).find(x => x.name.value === name); return a ? value(a.value, vars) : undefined; };
const list = v => (v == null ? [] : Array.isArray(v) ? v : [v]).map(String);
const isId = v => /^\d{1,19}$/.test(String(v || ""));

// Which boards this key may touch: the boards named on the key, their subitems boards, never a credential board.
async function boardRule(key) {
  const named = new Set((key.boards || []).map(String));
  const subs = named.size ? await read(`SELECT id::text AS id FROM mirror.boards WHERE parent_board_id = ANY($1::bigint[])`, [[...named]]) : [];
  const ok = new Set([...named, ...subs.map(r => r.id)]);
  return id => isId(id) && ok.has(String(id)) && !isExcluded({ id: String(id), name: "" });
}
async function boardsOfItems(ids) {
  if (!ids.length) return [];
  const rows = await read(`SELECT id::text AS id, board_id::text AS board_id FROM mirror.items WHERE id = ANY($1::bigint[])`, [ids]);
  return ids.map(id => (rows.find(r => r.id === id) || {}).board_id || null);
}
async function itemsOfUpdates(ids) {
  if (!ids.length || ids.some(x => !isId(x))) no(400, "Update ids are needed.");
  const rows = await read(`SELECT id::text AS id, item_id::text AS item_id FROM mirror.updates WHERE id = ANY($1::bigint[])
    UNION SELECT id::text, item_id::text FROM mirror.backup_updates WHERE id = ANY($1::bigint[])`, [ids]);
  const out = ids.map(id => (rows.find(r => r.id === id) || {}).item_id || null);
  if (out.some(x => !x)) no(403, "That update is not in the Ecosystem's copy.");
  return out;
}

// Every top-level operation must name what it touches, and everything it names must be on the key's boards.
async function checkScope(a, vars, allowed) {
  const need = async (boards, what) => { if (!boards.length || boards.some(b => !b || !allowed(b))) no(403, "This key may not use " + what + " on that board."); };
  for (const f of a.roots) {
    const n = f.name.value;
    if (a.kind === "mutation" && !MUTATIONS.has(n)) no(403, "The gateway does not allow " + n + ".");
    if (a.kind === "query" && !READS.has(n)) no(403, "The gateway does not allow reading " + n + ".");
    const items = async (ids, what) => { ids = list(ids); if (!ids.length || ids.some(x => !isId(x))) no(400, what + " needs item ids."); await need(await boardsOfItems(ids), what); };
    switch (n) {
      case "boards": { const ids = list(arg(f, "ids", vars)); if (!ids.length) no(403, "boards needs ids (listing every board is not allowed)."); await need(ids, n); break; }
      case "items": await items(arg(f, "ids", vars), n); break;
      case "items_page_by_column_values": await need(list(arg(f, "board_id", vars)), n); break;
      case "docs": {
        const obj = list(arg(f, "object_ids", vars)), ids = list(arg(f, "ids", vars));
        if (!obj.length && !ids.length) no(403, "docs needs ids or object_ids.");
        const fromIds = ids.length ? (await read(`SELECT id::text AS id, object_id::text AS o FROM mirror.backup_docs WHERE id = ANY($1::bigint[])`, [ids.filter(isId)])) : [];
        const objects = obj.concat(ids.map(i => (fromIds.find(r => r.id === i) || {}).o || null));
        await need(objects, n); break;
      }
      case "next_items_page": case "users": case "me": case "complexity": break; // checked on the answer
      case "create_item": case "create_group": await need(list(arg(f, "board_id", vars)), n); break;
      case "change_multiple_column_values": case "change_simple_column_value": case "change_column_value":
        await need(list(arg(f, "board_id", vars)), n); await items(arg(f, "item_id", vars), n); break;
      case "create_subitem": await items(arg(f, "parent_item_id", vars), n); break;
      case "move_item_to_group": case "archive_item": await items(arg(f, "item_id", vars), n); break;
      case "create_update": {
        const item = arg(f, "item_id", vars), parent = arg(f, "parent_id", vars);
        if (item != null) await items(item, n);
        else if (parent != null) await items(await itemsOfUpdates(list(parent)), n);
        else no(400, "create_update needs item_id or parent_id.");
        break;
      }
      case "create_notification": {
        const target = list(arg(f, "target_id", vars)), type = String(arg(f, "target_type", vars) || "");
        if (type === "Project") await items(target, n);
        else if (type === "Post") await items(await itemsOfUpdates(target), n);
        else no(400, "create_notification needs a target_type of Project or Post.");
        break;
      }
      default: no(403, "The gateway does not allow " + n + ".");
    }
  }
}

// Item ids in a mutation's answer, to copy those items straight away.
function idsIn(data) {
  const out = [];
  for (const v of Object.values(data || {})) { const l = Array.isArray(v) ? v : [v]; for (const x of l) if (x && isId(x.id)) out.push(String(x.id)); }
  return out;
}

// A last check that does not rely on reading the request: any board id in monday's answer must be allowed.
function boardsInAnswer(data) {
  const out = [];
  const walk = (v, parentKey) => {
    if (Array.isArray(v)) { v.forEach(x => walk(x, parentKey)); return; }
    if (!v || typeof v !== "object") return;
    if (parentKey === "boards" && v.id != null) out.push(String(v.id));
    if (parentKey === "board" && v.id != null) out.push(String(v.id));
    if (v.board_id != null) out.push(String(v.board_id));
    for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(data, null);
  return out;
}

// Returns { status, raw } (raw is monday's answer, unchanged) or { status, body } for a refusal.
export async function gatewayCall(req, key, token) {
  const t0 = Date.now();
  const log = (row) => write(`INSERT INTO mirror.gateway_log (key_id, kind, fields, status, ms, refreshed, error) VALUES ($1::bigint, $2, $3::text[], $4, $5, $6, $7)`,
    [key.id, row.kind || null, row.fields || [], row.status, Date.now() - t0, row.refreshed || 0, row.error || null]).catch(() => {});
  const refuse = async (status, error, row = {}) => { await log(Object.assign({ status, error }, row)); return { status, body: { errors: [{ message: error }] } }; };
  if (!key.gateway) return refuse(403, "This key is not allowed to use the monday gateway.");
  if (req.method !== "POST") return refuse(405, "Send the GraphQL request as a POST.");
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { return refuse(400, "The body must be JSON: {\"query\": ..., \"variables\": ...}."); } }
  const query = body && typeof body.query === "string" ? body.query : "";
  if (!query || query.length > MAX_QUERY) return refuse(400, "A GraphQL query is required (100,000 characters at most).");
  if (!(key.boards || []).length) return refuse(403, "This gateway key has no boards. Name the boards its scenario uses on /data/api-keys.");
  const vars = body.variables && typeof body.variables === "object" && !Array.isArray(body.variables) ? body.variables : undefined;
  let a, allowed;
  try { a = analyse(query); allowed = await boardRule(key); await checkScope(a, vars, allowed); }
  catch (e) { if (e instanceof Refusal) return refuse(e.status, e.message, a ? { kind: a.kind, fields: a.fields } : {}); throw e; }
  const { kind, fields } = a;
  const version = /^\d{4}-\d{2}$/.test(String((req.headers && req.headers["api-version"]) || "")) ? req.headers["api-version"] : "2025-04";
  let r, text;
  try {
    r = await fetchImpl(API, { method: "POST", headers: { "Content-Type": "application/json", Authorization: token, "API-Version": version },
      body: JSON.stringify({ query: a.printed, variables: vars }), signal: AbortSignal.timeout(60000) });
    text = await r.text();
  } catch (e) { return refuse(502, "monday did not answer.", { kind, fields }); }
  let refreshed = 0, error = null, parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { /* passed on as it is */ }
  if (parsed && parsed.data) {
    const bad = boardsInAnswer(parsed.data).filter(b => !allowed(b));
    if (bad.length) return refuse(403, "monday's answer included a board this key may not see, so it was withheld.", { kind, fields });
  }
  if (kind === "mutation" && r.ok) {
    if (!parsed) error = "answer was not JSON";
    else { if (parsed.errors) error = "monday returned errors"; refreshed = await refreshItems(token, idsIn(parsed.data)); }
  } else if (!r.ok) error = "monday status " + r.status;
  await log({ kind, fields, status: r.status, refreshed, error });
  return { status: r.status, raw: text };
}
