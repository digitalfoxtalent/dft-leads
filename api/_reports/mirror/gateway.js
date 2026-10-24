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

import crypto from "node:crypto";
import { parse, print, visit, Kind } from "graphql";
import { read, write } from "./db.js";
import { refreshItems } from "./edit.js";
import { isExcluded } from "./policy.js";

const API = "https://api.monday.com/v2";
const MAX_QUERY = 100000;
export const MUTATIONS = new Set(["change_multiple_column_values", "change_simple_column_value", "change_column_value", "create_item", "create_subitem",
  "create_update", "create_notification", "move_item_to_group", "archive_item", "create_group"]);

export const GATEWAY_SCHEMA = [
  `ALTER TABLE mirror.api_keys ADD COLUMN IF NOT EXISTS gateway boolean NOT NULL DEFAULT false`,
  `ALTER TABLE mirror.api_keys ADD COLUMN IF NOT EXISTS gateway_linked boolean NOT NULL DEFAULT false`, // may read mirrored and connected column text
  `ALTER TABLE mirror.api_keys ADD COLUMN IF NOT EXISTS jobs boolean NOT NULL DEFAULT false`, // may run Make jobs (jobs.js)
  `CREATE TABLE IF NOT EXISTS mirror.gateway_cursors (key_id bigint NOT NULL, hash text NOT NULL, at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (key_id, hash))`,
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
  ...GATEWAY_GRANTS(),
];

// Boards Tom has agreed (in chat) to add to his existing Make key, batch by batch, as scenarios move onto the
// gateway. Each grant only ADDS the named boards and turns on the gateway for that one key (matched by name, the
// last 4 characters Tom sees on /data/api-keys, who made it, and not revoked). Running it again changes nothing.
// Tom can still revoke the key on /data/api-keys at any time, and every gateway call is logged.
function GATEWAY_GRANTS() {
  const grants = [
    // 23 Oct 2026, Tom: "Extend today's Make key". Content batch: 6572088 MSN back catalogue robot (writes the
    // Back Catalogue Queue, reads the Trending & Evergreen Queue) and 6046416 Shorts next-pull date (Shorts Clip Requests).
    { name: "Make: jobs", hint: "nUKx", by: "tom@digitalfoxtalent.com", boards: ["18434716799", "18420546526", "18419654453"] },
  ];
  return grants.map(g => {
    const ids = g.boards.filter(b => /^\d{1,19}$/.test(b)).join(",");
    const esc = s => String(s).replace(/'/g, "''");
    return `UPDATE mirror.api_keys SET gateway = true,
      boards = ARRAY(SELECT DISTINCT b FROM unnest(boards || '{${ids}}'::bigint[]) AS b ORDER BY b)
      WHERE name = '${esc(g.name)}' AND key_hint = '${esc(g.hint)}' AND created_by = '${esc(g.by)}' AND revoked_at IS NULL
        AND NOT (gateway AND boards @> '{${ids}}'::bigint[])`;
  });
}

let fetchImpl = (...a) => fetch(...a);
export function setGatewayFetch(f) { fetchImpl = f; }

// Read operations a gateway key may use (no account, teams, workspaces, webhooks or assets).
export const READS = new Set(["boards", "items", "items_page_by_column_values", "next_items_page", "users", "me", "docs", "complexity"]);
// Fields refused anywhere in a request: ways from an allowed item to items on other boards, contact details,
// and account-wide lists. display_value (the text of mirrored and connected columns) only for keys allowed it.
export const DENY = new Set(["linked_items", "mirrored_items", "linked_item", "email", "phone", "mobile_phone", "account", "owners", "subscribers",
  "teams", "team_owners", "team_subscribers", "workspace", "workspaces", "activity_logs", "views", "webhooks", "apps_monetization_status", "is_admin", "is_guest"]);

class Refusal extends Error { constructor(status, message) { super(message); this.status = status; } }
const no = (status, message) => { throw new Refusal(status, message); };

// Parse with the real GraphQL parser and refuse anything whose meaning could differ from what we check: exactly
// one operation, no named fragments, only plain fields (no fragments or directives) at the top level. The
// request forwarded to monday is the parser's own re-print of what was checked.
// People: only who they are, never their details (the answer to users, me, creator, uploaded_by, created_by).
const PERSON_FIELDS = new Set(["users", "me", "creator", "uploaded_by", "created_by"]);
const PERSON_OK = new Set(["id", "name", "enabled", "__typename"]);
const PROTECTED = new Set(["id", "board", "boards", "board_id", "cursor"]);
// Only the monday API versions the deny-list was written for (newer versions can add fields).
export const VERSIONS = new Set(["2024-10", "2025-01", "2025-04"]);

export function analyse(query, opts = {}) {
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
  // The answer check finds board ids by field name, so those fields may not be renamed anywhere.
  const people = sel => { for (const x of (sel && sel.selections) || []) {
    if (x.kind === Kind.FIELD) { if (!PERSON_OK.has(x.name.value)) no(403, "The gateway only allows a person's id, name and enabled, not " + x.name.value + "."); }
    else people(x.selectionSet);
  } };
  visit(doc, { Field(node) {
    const n = node.name.value;
    if (node.alias && (PROTECTED.has(n) || PROTECTED.has(node.alias.value))) no(400, "Renaming " + n + (PROTECTED.has(node.alias.value) ? " to " + node.alias.value : "") + " is not supported.");
    if (PERSON_FIELDS.has(n)) people(node.selectionSet);
    if (DENY.has(n)) no(403, "The gateway does not allow reading " + n + ".");
    if (n === "display_value" && !opts.linked) no(403, "This key may not read mirrored or connected column text (display_value).");
  } });
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
// Ids from an argument: a single id or a flat list of ids, as strings or numbers; anything else refused.
const list = v => {
  const l = v == null ? [] : Array.isArray(v) ? v : [v];
  for (const x of l) if (!(typeof x === "string" || typeof x === "number")) no(400, "Ids must be strings or numbers.");
  return l.map(String);
};
const hashCursor = c => crypto.createHash("sha256").update(String(c)).digest("hex");
const isId = v => /^\d{1,19}$/.test(String(v || ""));

// Which boards this key may touch: the boards named on the key, their subitems boards, never a credential board.
async function boardRule(key) {
  // Main boards named on the key, and their subitems boards. A subitems board named on its own does not count
  // (its items lead to the parent board, which the key was not given).
  const named = new Set((key.boards || []).map(String));
  const rows = named.size ? await read(`SELECT id::text AS id, board_type FROM mirror.boards WHERE id = ANY($1::bigint[])`, [[...named]]) : [];
  const mains = rows.filter(r => r.board_type === "board").map(r => r.id);
  const subs = mains.length ? await read(`SELECT id::text AS id FROM mirror.boards WHERE parent_board_id = ANY($1::bigint[])`, [mains]) : [];
  const ok = new Set([...mains, ...subs.map(r => r.id)]);
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
async function checkScope(a, vars, allowed, key) {
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
      case "next_items_page": { // only a cursor this gateway handed to this key in the last hour (monday cursors last 60 minutes)
        const c = arg(f, "cursor", vars);
        if (typeof c !== "string" || !c) no(400, "next_items_page needs a cursor.");
        const hit = await read(`SELECT 1 FROM mirror.gateway_cursors WHERE key_id = $1::bigint AND hash = $2 AND at > now() - interval '1 hour'`, [key.id, hashCursor(c)]);
        if (!hit.length) no(403, "That cursor was not issued to this key through the gateway.");
        break;
      }
      case "users": case "me": case "complexity": break; // contact fields are refused anywhere (DENY)
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
  try { a = analyse(query, { linked: !!key.gateway_linked }); allowed = await boardRule(key); await checkScope(a, vars, allowed, key); }
  catch (e) { if (e instanceof Refusal) return refuse(e.status, e.message, a ? { kind: a.kind, fields: a.fields } : {}); throw e; }
  const { kind, fields } = a;
  const asked = String((req.headers && req.headers["api-version"]) || "");
  if (asked && !VERSIONS.has(asked)) return refuse(400, "The gateway supports monday API versions " + [...VERSIONS].join(", ") + ".", { kind, fields });
  const version = asked || "2025-04";
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
  // Remember the page cursors handed out, so next_items_page only follows this key's own pages.
  if (parsed && parsed.data) {
    const cursors = []; const walk = v => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (k === "cursor" && typeof x === "string" && x) cursors.push(x); else walk(x); } };
    walk(parsed.data);
    if (cursors.length) await write(`INSERT INTO mirror.gateway_cursors (key_id, hash) SELECT $1::bigint, unnest($2::text[]) ON CONFLICT DO NOTHING`, [key.id, cursors.slice(0, 50).map(hashCursor)]).catch(() => {});
    if (Math.random() < 0.02) await write(`DELETE FROM mirror.gateway_cursors WHERE at < now() - interval '2 hours'`).catch(() => {});
  }
  if (kind === "mutation" && r.ok) {
    if (!parsed) error = "answer was not JSON";
    else { if (parsed.errors) error = "monday returned errors"; refreshed = await refreshItems(token, idsIn(parsed.data)); }
  } else if (!r.ok) error = "monday status " + r.status;
  await log({ kind, fields, status: r.status, refreshed, error });
  return { status: r.status, raw: text };
}
