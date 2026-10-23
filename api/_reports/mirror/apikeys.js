// The Ecosystem API (ecosystem.digitalfoxtalent.com/api/v1/...) for Make and other systems, so they can move off
// monday one scenario at a time while monday is still the master copy. Version 1 is READ ONLY.
//
// KEYS: only Tom creates and revokes keys, at /data/api-keys. A key is shown once and stored only as a SHA-256
// hash. Each key is limited to the sections (departments) Tom picks when he makes it, and sees boards limited to
// listed people only if he ticks that too; credential boards are never in the copy at all. Every call is logged and each key may make at most 1,000 calls an hour.

import crypto from "node:crypto";
import { read, write } from "./db.js";
import { OWNERS } from "./switch.js";

export const API_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS mirror.api_keys (
     id bigserial PRIMARY KEY,
     name text NOT NULL,
     key_hash text NOT NULL UNIQUE,
     key_hint text NOT NULL,                           -- the last 4 characters, to tell keys apart
     departments text[] NOT NULL DEFAULT '{}',
     include_private boolean NOT NULL DEFAULT false,   -- boards limited to listed people (off unless Tom ticks it)
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

const PER_HOUR = 1000;
const hash = k => crypto.createHash("sha256").update(String(k)).digest("hex");
const isId = v => /^\d{1,19}$/.test(String(v || ""));

export function adminToken(secret, email) {
  return crypto.createHmac("sha256", String(secret) + "|eco-apikeys-v1").update(String(email)).digest("base64url").slice(0, 32);
}

export async function createKey(name, departments, includePrivate, email) {
  const key = "eco_" + crypto.randomBytes(24).toString("base64url");
  await write(`INSERT INTO mirror.api_keys (name, key_hash, key_hint, departments, include_private, created_by) VALUES ($1, $2, $3, $4::text[], $5, $6)`,
    [String(name).slice(0, 80), hash(key), key.slice(-4), departments, !!includePrivate, email]);
  return key;
}
export async function revokeKey(id) {
  if (!isId(id)) return false;
  return (await write(`UPDATE mirror.api_keys SET revoked_at = now() WHERE id = $1::bigint AND revoked_at IS NULL RETURNING id`, [id])).length > 0;
}
export async function listKeys() {
  return read(`SELECT k.id::text AS id, k.name, k.key_hint, k.departments, k.include_private, k.created_by, k.created_at, k.last_used_at, k.revoked_at,
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
  return (await read(`SELECT id::text AS id, name, departments, include_private FROM mirror.api_keys WHERE key_hash = $1 AND revoked_at IS NULL`, [hash(m[1])]))[0] || null;
}

const boardOut = b => ({ id: b.id, name: b.name, department: b.department, folder: b.folder_path || null, workspace: b.workspace_name || null,
  columns: (b.columns || []).map(c => ({ id: c.id, title: c.title, type: c.type, labels: c.labels ? Object.values(c.labels).map(l => l && l[0]).filter(Boolean) : undefined, options: c.options })),
  groups: (b.groups || []).map(g => ({ id: g.id, title: g.title })), items: b.mirror_items, copied_at: b.synced_at });
const itemOut = it => ({ id: it.id, board_id: it.board_id, name: it.name, group_id: it.group_id || null, parent_id: it.parent_id || null,
  created_at: it.created_at, updated_at: it.updated_at,
  values: Object.fromEntries(Object.entries(it.vals || {}).map(([k, [text, raw]]) => [k, { text: text == null ? null : text, value: (() => { try { return raw ? JSON.parse(raw) : null; } catch (e) { return raw; } })() }])) });

// Returns { status, body }. path is everything after /api/v1/.
export async function serveApi(req, path) {
  const key = await keyFor(req);
  const done = async (status, body) => {
    await write(`INSERT INTO mirror.api_log (key_id, method, path, status) VALUES ($1::bigint, $2, $3, $4)`, [key ? key.id : null, String(req.method || "").slice(0, 8), String(path).slice(0, 200), status]).catch(() => {});
    if (key && status < 400) await write(`UPDATE mirror.api_keys SET last_used_at = now() WHERE id = $1::bigint`, [key.id]).catch(() => {});
    return json(status, body);
  };
  if (!key) return done(401, { error: "A valid Ecosystem API key is required (Authorization: Bearer eco_...)." });
  const n = (await read(`SELECT count(*)::int AS n FROM mirror.api_log WHERE key_id = $1::bigint AND at > now() - interval '1 hour'`, [key.id]))[0].n;
  if (n >= PER_HOUR) return done(429, { error: "Too many calls this hour for this key." });
  if (req.method !== "GET") return done(405, { error: "Version 1 of the Ecosystem API is read only." });
  const q = req.query || {};
  const BOARD_COLS = `id::text AS id, name, department, folder_path, workspace_name, columns, groups, mirror_items, synced_at, access`;
  const allowed = b => b && key.departments.includes(b.department) && (b.access === "team" || key.include_private);
  let m;
  if (path === "boards") {
    const rows = (await read(`SELECT ${BOARD_COLS} FROM mirror.boards WHERE board_type = 'board' AND NOT gone AND department = ANY($1::text[]) ORDER BY name`, [key.departments])).filter(allowed);
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
    if (since && isNaN(Date.parse(since))) return done(400, { error: "updated_since must be a date and time, for example 2026-10-01T00:00:00Z." });
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
        COALESCE(p.department, b.department) AS department, COALESCE(p.access, b.access) AS access
      FROM mirror.items i JOIN mirror.boards b ON b.id = i.board_id LEFT JOIN mirror.boards p ON p.id = b.parent_board_id
      WHERE i.id = $1::bigint AND NOT i.deleted AND NOT b.gone`, [m[1]]))[0];
    if (!it || !allowed(it)) return done(404, { error: "No such item for this key." });
    const subs = await read(`SELECT id::text AS id, board_id::text AS board_id, name, group_id, parent_id::text AS parent_id, created_at, updated_at, vals FROM mirror.items
      WHERE parent_id = $1::bigint AND NOT deleted ORDER BY pos NULLS LAST, created_at`, [it.id]);
    const ups = await read(`SELECT id::text AS id, body_text AS text, creator, created_at, reply_to::text AS reply_to FROM mirror.backup_updates WHERE item_id = $1::bigint
      UNION ALL SELECT u.id::text, u.body, u.creator, u.created_at, NULL FROM mirror.updates u WHERE u.item_id = $1::bigint AND NOT EXISTS (SELECT 1 FROM mirror.backup_updates x WHERE x.id = u.id)
      ORDER BY created_at DESC LIMIT 200`, [it.id]);
    return done(200, { item: Object.assign(itemOut(it), { subitems: subs.map(itemOut), updates: ups }) });
  }
  return done(404, { error: "Unknown address. See /api/v1/boards, /api/v1/boards/<id>, /api/v1/boards/<id>/items, /api/v1/items/<id>." });
}
