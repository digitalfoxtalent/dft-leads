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

import { write } from "./db.js";
import { refreshItems } from "./edit.js";

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

// The operation type and its top-level fields (aliases resolved), from the GraphQL text. Fragments, comments and
// strings are handled; several operations in one document are refused, as monday would need an operation name.
export function topFields(query) {
  const q = String(query).replace(/#[^\n]*/g, " ").replace(/"""[\s\S]*?"""/g, '""').replace(/"(?:\\.|[^"\\])*"/g, '""');
  const op = q.match(/^\s*(query|mutation|subscription)?\b/);
  let kind = /^\s*mutation\b/.test(q) ? "mutation" : /^\s*subscription\b/.test(q) ? "subscription" : "query";
  if (op && op[1] === undefined && /^\s*\{/.test(q)) kind = "query";
  const fields = []; let depth = 0, paren = 0, ops = 0;
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*)|([{}()])/g;
  let m;
  while ((m = re.exec(q))) {
    if (m[4]) { const c = m[4]; if (c === "(") paren++; else if (c === ")") paren--; else if (c === "{") { if (depth === 0 && paren === 0) ops++; depth++; } else depth--; continue; }
    if (depth === 1 && paren === 0) { const name = m[2] || m[3]; if (name !== "on" && name !== "complexity" && name !== "__typename") fields.push(name); }
  }
  if (/\bfragment\b/.test(q)) ops = Math.max(1, ops - (q.match(/\bfragment\b/g) || []).length);
  return { kind, fields, operations: ops };
}

// Item ids in a mutation's answer, to copy those items straight away.
function idsIn(data) {
  const out = [];
  for (const v of Object.values(data || {})) { const list = Array.isArray(v) ? v : [v]; for (const x of list) if (x && /^\d{1,19}$/.test(String(x.id || ""))) out.push(String(x.id)); }
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
  const { kind, fields, operations } = topFields(query);
  if (operations !== 1) return refuse(400, "Send one operation per request.", { kind, fields });
  if (kind === "subscription") return refuse(400, "Subscriptions are not supported.", { kind, fields });
  if (kind === "mutation") { const bad = fields.filter(f => !MUTATIONS.has(f)); if (bad.length || !fields.length) return refuse(403, "The gateway does not allow " + (bad[0] || "this change") + ".", { kind, fields }); }
  const version = /^\d{4}-\d{2}$/.test(String((req.headers && req.headers["api-version"]) || "")) ? req.headers["api-version"] : "2025-04";
  let r, text;
  try {
    r = await fetchImpl(API, { method: "POST", headers: { "Content-Type": "application/json", Authorization: token, "API-Version": version },
      body: JSON.stringify({ query, variables: body.variables && typeof body.variables === "object" ? body.variables : undefined }), signal: AbortSignal.timeout(60000) });
    text = await r.text();
  } catch (e) { return refuse(502, "monday did not answer.", { kind, fields }); }
  let refreshed = 0, error = null;
  if (kind === "mutation" && r.ok) {
    try { const d = JSON.parse(text); if (d.errors) error = "monday returned errors"; refreshed = await refreshItems(token, idsIn(d.data)); } catch (e) { error = "answer was not JSON"; }
  } else if (!r.ok) error = "monday status " + r.status;
  await log({ kind, fields, status: r.status, refreshed, error });
  return { status: r.status, raw: text };
}
