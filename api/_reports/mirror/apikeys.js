// The Ecosystem API (ecosystem.digitalfoxtalent.com/api/v1/...) for Make and other systems, so they can move off
// monday one scenario at a time while monday is still the master copy. Version 1 is READ ONLY.
//
// KEYS: only Tom creates and revokes keys, at /data/api-keys. A key is shown once and stored only as a SHA-256
// hash. Each key reads the whole-team boards of the sections Tom ticks, except money, legal and private boards
// (policy.js editLocked); any other board must be named on the key one by one. Credential boards are never in
// the copy at all. Every call is logged and each key may make at most 1,000 calls an hour.

import crypto from "node:crypto";
import { read, write } from "./db.js";
import { OWNERS } from "./switch.js";
import { editLocked } from "./policy.js";
import { gatewayCall } from "./gateway.js";
import { runJob, JOB_NAMES } from "./jobs.js";

export const API_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS mirror.api_keys (
     id bigserial PRIMARY KEY,
     name text NOT NULL,
     key_hash text NOT NULL UNIQUE,
     key_hint text NOT NULL,                           -- the last 4 characters, to tell keys apart
     departments text[] NOT NULL DEFAULT '{}',
     boards bigint[] NOT NULL DEFAULT '{}',            -- extra boards named one by one (any access, including private)
     nonce text UNIQUE,                                -- the form that made it, so a refresh cannot make a second key
     created_by text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     last_used_at timestamptz,
     revoked_at timestamptz
   )`,
  `CREATE TABLE IF NOT EXISTS mirror.api_log (
     id bigserial PRIMARY KEY,
     at timestamptz NOT NULL DEFAULT now(),
     key_id bigint,
     method text,
     path text,
     status int
   )`,
  `CREATE INDEX IF NOT EXISTS api_log_key ON mirror.api_log (key_id, at DESC)`,
];

const PER_HOUR = 1000, GATEWAY_PER_HOUR = 10000; // Make scenarios on the gateway can be busy
const hash = k => crypto.createHash("sha256").update(String(k)).digest("hex");
const isId = v => /^\d{1,19}$/.test(String(v || ""));

export function adminToken(secret, email) {
  return crypto.createHmac("sha256", String(secret) + "|eco-apikeys-v1").update(String(email)).digest("base64url").slice(0, 32);
}

// Returns the new key, or null if this form (nonce) already made one.
export async function createKey(name, departments, boards, email, nonce, gateway, linked, jobs) {
  const key = "eco_" + crypto.randomBytes(24).toString("base64url");
  const made = await write(`INSERT INTO mirror.api_keys (name, key_hash, key_hint, departments, boards, created_by, nonce, gateway, gateway_linked, jobs) VALUES ($1, $2, $3, $4::text[], $5::bigint[], $6, $7, $8, $9, $10)
    ON CONFLICT (nonce) DO NOTHING RETURNING id`, [String(name).slice(0, 80), hash(key), key.slice(-4), departments, boards || [], email, nonce || crypto.randomBytes(12).toString("hex"), !!gateway, !!(gateway && linked), !!jobs]);
  return made.length ? key : null;
}
export const newNonce = () => crypto.randomBytes(12).toString("base64url");
export async function revokeKey(id) {
  if (!isId(id)) return false;
  return (await write(`UPDATE mirror.api_keys SET revoked_at = now() WHERE id = $1::bigint AND revoked_at IS NULL RETURNING id`, [id])).length > 0;
}
export async function listKeys() {
  return read(`SELECT k.id::text AS id, k.name, k.key_hint, k.departments, k.boards::text[] AS boards, k.gateway, k.gateway_linked, k.jobs, k.created_by,
    (SELECT count(*) FROM mirror.gateway_log g WHERE g.key_id = k.id AND g.at > now() - interval '24 hours')::int AS gateway_24h, k.created_at, k.last_used_at, k.revoked_at,
    (SELECT count(*) FROM mirror.api_log l WHERE l.key_id = k.id AND l.at > now() - interval '24 hours')::int AS calls_24h
    FROM mirror.api_keys k ORDER BY k.revoked_at NULLS FIRST, k.created_at DESC`);
}
export const isOwner = email => OWNERS.has(String(email || "").toLowerCase());

// ---------- serving the API ----------

const json = (status, body) => ({ status, body });
const one = v => String(Array.isArray(v) ? v[0] : v == null ? "" : v);

async function keyFor(req) {
  const m = /^Bearer\s+(eco_[A-Za-z0-9_-]{20,60})$/.exec(String((req.headers && req.headers.authorization) || ""));
  if (!m) return null;
  return (await read(`SELECT id::text AS id, name, departments, boards::text[] AS boards, gateway, gateway_linked, jobs FROM mirror.api_keys WHERE key_hash = $1 AND revoked_at IS NULL`, [hash(m[1])]))[0] || null;
}

const boardOut = b => ({ id: b.id, name: b.name, department: b.department, folder: b.folder_path || null, workspace: b.workspace_name || null,
  columns: (b.columns || []).map(c => ({ id: c.id, title: c.title, type: c.type, labels: c.labels ? Object.values(c.labels).map(l => l && l[0]).filter(Boolean) : undefined, options: c.options })),
  groups: (b.groups || []).map(g => ({ id: g.id, title: g.title })), items: b.mirror_items, copied_at: b.synced_at });
const itemOut = it => ({ id: it.id, board_id: it.board_id, name: it.name, group_id: it.group_id || null, parent_id: it.parent_id || null,
  created_at: it.created_at, updated_at: it.updated_at,
  values: Object.fromEntries(Object.entries(it.vals || {}).map(([k, [text, raw]]) => [k, { text: text == null ? null : text, value: (() => { try { return raw ? JSON.parse(raw) : null; } catch (e) { return raw; } })() }])) });

// Returns { status, body }. path is everything after /api/v1/.
export async function serveApi(req, path, mondayToken) {
  const key = await keyFor(req);
  // Calls without a valid key, and calls refused for being over the limit, are not logged: anyone on the internet
  // can send them, and they must not fill the database or keep a key locked out.
  if (!key) return json(401, { error: "A valid Ecosystem API key is required (Authorization: Bearer eco_...)." });
  if (path === "monday") { // the monday gateway (gateway.js): its own log and a higher hourly limit
    const g = (await read(`SELECT count(*)::int AS n FROM mirror.gateway_log WHERE key_id = $1::bigint AND at > now() - interval '1 hour'`, [key.id]))[0].n;
    if (g >= GATEWAY_PER_HOUR) return json(429, { errors: [{ message: "Too many gateway calls this hour for this key." }] });
    if (!mondayToken) return json(503, { errors: [{ message: "The gateway is not connected to monday." }] });
    await write(`UPDATE mirror.api_keys SET last_used_at = now() WHERE id = $1::bigint`, [key.id]).catch(() => {});
    if (Math.random() < 0.01) await write(`DELETE FROM mirror.gateway_log WHERE at < now() - interval '30 days'`).catch(() => {});
    return gatewayCall(req, key, mondayToken);
  }
  const n = (await read(`SELECT count(*)::int AS n FROM mirror.api_log WHERE key_id = $1::bigint AND at > now() - interval '1 hour'`, [key.id]))[0].n;
  if (n >= PER_HOUR) return json(429, { error: "Too many calls this hour for this key." });
  const done = async (status, body) => {
    await write(`INSERT INTO mirror.api_log (key_id, method, path, status) VALUES ($1::bigint, $2, $3, $4)`, [key.id, String(req.method || "").slice(0, 8), String(path).slice(0, 200), status]).catch(() => {});
    if (status < 400) await write(`UPDATE mirror.api_keys SET last_used_at = now() WHERE id = $1::bigint`, [key.id]).catch(() => {});
    if (Math.random() < 0.01) await write(`DELETE FROM mirror.api_log WHERE at < now() - interval '30 days'`).catch(() => {});
    return json(status, body);
  };
  const jm = /^jobs\/([A-Za-z0-9-]{1,30})$/.exec(path);
  if (jm) { // Make jobs (jobs.js): POST only, keys allowed to run jobs only
    if (!key.jobs) return done(403, { error: "This key may not run jobs." });
    if (req.method !== "POST") return done(405, { error: "Jobs are run with POST." });
    if (!JOB_NAMES.includes(jm[1])) return done(404, { error: "No such job." });
    const body = typeof req.body === "string" ? (() => { try { return JSON.parse(req.body); } catch (e) { return null; } })() : req.body;
    const out = await runJob(jm[1], body && body.input);
    await done(out.status, null);
    return out.raw != null ? { status: out.status, raw: out.raw } : json(out.status, out.body);
  }
  try { return await answer(req, path, key, done); }
  catch (e) { console.error("eco-api", e); return done(500, { error: "Something went wrong." }); }
}

async function answer(req, path, key, done) {
  if (req.method !== "GET") return done(405, { error: "Version 1 of the Ecosystem API is read only." });
  const q = req.query || {};
  const BOARD_COLS = `id::text AS id, name, department, folder_path, workspace_name, columns, groups, mirror_items, synced_at, access`;
  // A section's whole-team boards, except money, legal and private ones; anything else only if named on the key.
  const allowed = b => !!b && ((key.boards || []).includes(String(b.id)) || (key.departments.includes(b.department) && b.access === "team" && !editLocked(b)));
  let m;
  if (path === "boards") {
    const rows = (await read(`SELECT ${BOARD_COLS} FROM mirror.boards WHERE board_type = 'board' AND NOT gone AND (department = ANY($1::text[]) OR id = ANY($2::bigint[])) ORDER BY name`, [key.departments, key.boards || []])).filter(allowed);
    return done(200, { boards: rows.map(boardOut) });
  }
  if ((m = /^boards\/(\d{1,19})$/.exec(path))) {
    const b = (await read(`SELECT ${BOARD_COLS} FROM mirror.boards WHERE id = $1::bigint AND board_type = 'board' AND NOT gone`, [m[1]]))[0];
    return allowed(b) ? done(200, { board: boardOut(b) }) : done(404, { error: "No such board for this key." });
  }
  if ((m = /^boards\/(\d{1,19})\/items$/.exec(path))) {
    const b = (await read(`SELECT ${BOARD_COLS} FROM mirror.boards WHERE id = $1::bigint AND board_type = 'board' AND NOT gone`, [m[1]]))[0];
    if (!allowed(b)) return done(404, { error: "No such board for this key." });
    const limit = Math.max(1, Math.min(500, parseInt(one(q.limit), 10) || 100));
    const since = one(q.updated_since), cursor = one(q.cursor), group = one(q.group_id);
    if (since && (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(since) || isNaN(Date.parse(since)))) return done(400, { error: "updated_since must be a date and time, for example 2026-10-01T00:00:00Z." });
    if (cursor && !isId(cursor)) return done(400, { error: "Bad cursor." });
    const params = [b.id]; const arg = x => { params.push(x); return "$" + params.length; };
    let where = `board_id = $1::bigint AND NOT deleted AND parent_id IS NULL`;
    if (since) where += ` AND updated_at >= ${arg(since)}::timestamptz`;
    if (cursor) where += ` AND id > ${arg(cursor)}::bigint`;
    if (group) where += ` AND group_id = ${arg(group.slice(0, 100))}`;
    const rows = await read(`SELECT id::text AS id, board_id::text AS board_id, name, group_id, parent_id::text AS parent_id, created_at, updated_at, vals FROM mirror.items
      WHERE ${where} ORDER BY id LIMIT ${limit + 1}`, params);
    const more = rows.length > limit;
    return done(200, { items: rows.slice(0, limit).map(itemOut), next_cursor: more ? rows[limit - 1].id : null, copied_at: b.synced_at });
  }
  if ((m = /^items\/(\d{1,19})$/.exec(path))) {
    const it = (await read(`SELECT i.id::text AS id, i.board_id::text AS board_id, i.name, i.group_id, i.parent_id::text AS parent_id, i.created_at, i.updated_at, i.vals,
        g.id::text AS gid, g.name AS gname, g.department, g.access, g.folder_path, g.workspace_name
      FROM mirror.items i JOIN mirror.boards b ON b.id = i.board_id
      LEFT JOIN mirror.boards p ON p.id = b.parent_board_id
      JOIN mirror.boards g ON g.id = CASE WHEN b.board_type = 'board' THEN b.id ELSE p.id END
      LEFT JOIN mirror.items pi ON pi.id = i.parent_id
      WHERE i.id = $1::bigint AND NOT i.deleted AND NOT b.gone AND NOT g.gone AND g.board_type = 'board'
        AND (i.parent_id IS NULL OR (pi.id IS NOT NULL AND NOT pi.deleted))`, [m[1]]))[0];
    if (!it || !allowed({ id: it.gid, name: it.gname, department: it.department, access: it.access, folder_path: it.folder_path, workspace_name: it.workspace_name })) return done(404, { error: "No such item for this key." });
    const subs = await read(`SELECT id::text AS id, board_id::text AS board_id, name, group_id, parent_id::text AS parent_id, created_at, updated_at, vals FROM mirror.items
      WHERE parent_id = $1::bigint AND NOT deleted ORDER BY pos NULLS LAST, created_at`, [it.id]);
    // The copy's updates only (the latest 10, kept in step with monday, so deleted ones disappear); the backup is not served.
    const ups = await read(`SELECT id::text AS id, body AS text, creator, created_at FROM mirror.updates WHERE item_id = $1::bigint ORDER BY created_at DESC LIMIT 50`, [it.id]);
    return done(200, { item: Object.assign(itemOut(it), { subitems: subs.map(itemOut), updates: ups }) });
  }
  return done(404, { error: "Unknown address. See /api/v1/boards, /api/v1/boards/<id>, /api/v1/boards/<id>/items, /api/v1/items/<id>." });
}
