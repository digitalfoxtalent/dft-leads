// The nightly full backup of monday into the Ecosystem database. Like the mirror it is READ ONLY on monday:
// it only runs queries. It keeps what the 30-minute copy leaves out:
//   - every update and reply on every copied board, with its formatted body (the copy keeps the latest 10);
//   - every monday doc, block by block, with a plain-text version;
//   - a register of every file (on file columns and attached to updates): name, size, where it hangs. The
//     files themselves are copied by a second stage once a file store exists.
//
// It works in passes. A pass visits every board and every doc; each run (cron every hour) carries on where the
// last one stopped, within a time and call budget of its own, so it never crowds out the copy, Make or the
// reports. A finished pass starts again after 20 hours, so in steady state it runs once a night and only
// fetches what changed. Boards and docs that hold credentials are never backed up (same rule as the copy).

import { read, write, batch } from "./db.js";
import { ensureSchema } from "./schema.js";
import { makeClient } from "./sync.js";
import { isExcluded } from "./policy.js";
export { BACKUP_SCHEMA } from "./backup-schema.js";

const RUN_MS = 230000;
const MAX_CALLS = 90;
const DAY_CALLS = 1200;
const PASS_EVERY_MS = 20 * 3600000;
const PAGE = 100;


const clean = s => (s == null ? null : String(s).replace(/\u0000/g, ""));
const isId = v => /^\d{1,19}$/.test(String(v || ""));
const ms = v => (v instanceof Date ? v.getTime() : v ? Date.parse(v) : 0);
const parse = s => { try { return typeof s === "string" ? JSON.parse(s) : s; } catch (e) { return null; } };

// ---------- one board: updates (with replies and their files), and the files on file columns ----------

const UPD_Q = `query ($b: [ID!], $l: Int, $p: Int) { boards (ids: $b) { updates (limit: $l, page: $p) {
  id item_id body text_body created_at updated_at creator { name }
  assets { id name file_extension file_size created_at }
  replies { id body text_body created_at updated_at creator { name } } } } }`;
const FILES_Q = `query ($b: [ID!], $c: String) { boards (ids: $b) { items_page (limit: 200, cursor: $c) { cursor items { id assets { id name file_extension file_size created_at } } } } }`;

async function backupBoard(gql, boardId, page, deadline, budgetLeft, incremental) {
  let updates = 0, files = 0, calls = 0;
  for (;;) {
    if (Date.now() > deadline || calls >= budgetLeft()) return { page, done: false, updates, files, calls };
    const list = (((await gql(UPD_Q, { b: [String(boardId)], l: PAGE, p: page })).boards || [])[0] || {}).updates || [];
    calls++;
    const rows = [], fileRows = [];
    for (const u of list) {
      rows.push({ id: String(u.id), board_id: String(boardId), item_id: isId(u.item_id) ? String(u.item_id) : null, reply_to: null, body_html: clean(u.body), body_text: clean(u.text_body),
        creator: clean(u.creator && u.creator.name), created_at: u.created_at || null, updated_at: u.updated_at || null });
      for (const r of u.replies || []) rows.push({ id: String(r.id), board_id: String(boardId), item_id: isId(u.item_id) ? String(u.item_id) : null, reply_to: String(u.id),
        body_html: clean(r.body), body_text: clean(r.text_body), creator: clean(r.creator && r.creator.name), created_at: r.created_at || null, updated_at: r.updated_at || null });
      for (const a of u.assets || []) fileRows.push({ id: String(a.id), name: clean(a.name), extension: clean(a.file_extension), size_bytes: Number(a.file_size) || null,
        board_id: String(boardId), item_id: isId(u.item_id) ? String(u.item_id) : null, update_id: String(u.id), column_id: null, created_at: a.created_at || null });
    }
    // Newest first: on a nightly pass, reaching an update that is already backed up means every older one is too.
    const known = incremental && list.length ? (await read(`SELECT count(*)::int AS n FROM mirror.backup_updates WHERE id = ANY($1::bigint[])`, [list.map(u => String(u.id))]))[0].n : 0;
    if (rows.length) await write(`INSERT INTO mirror.backup_updates (id, board_id, item_id, reply_to, body_html, body_text, creator, created_at, updated_at, backed_up_at)
      SELECT (r->>'id')::bigint, (r->>'board_id')::bigint, (r->>'item_id')::bigint, (r->>'reply_to')::bigint, r->>'body_html', r->>'body_text', r->>'creator',
        (r->>'created_at')::timestamptz, (r->>'updated_at')::timestamptz, now() FROM jsonb_array_elements($1::jsonb) r
      ON CONFLICT (id) DO UPDATE SET body_html = EXCLUDED.body_html, body_text = EXCLUDED.body_text, updated_at = EXCLUDED.updated_at, backed_up_at = now()`, [JSON.stringify(rows)]);
    files += await saveFiles(fileRows);
    updates += rows.length;
    if (list.length < PAGE || (incremental && known > 0)) break;
    page++;
  }
  // Files on file columns, from the items' assets.
  let cursor = null;
  for (let guard = 0; guard < 50; guard++) {
    if (Date.now() > deadline || calls >= budgetLeft()) return { page, done: false, updates, files, calls };
    const ip = ((((await gql(FILES_Q, { b: [String(boardId)], c: cursor })).boards || [])[0] || {}).items_page) || {};
    calls++;
    const fileRows = [];
    for (const it of ip.items || []) for (const a of it.assets || []) fileRows.push({ id: String(a.id), name: clean(a.name), extension: clean(a.file_extension),
      size_bytes: Number(a.file_size) || null, board_id: String(boardId), item_id: String(it.id), update_id: null, column_id: null, created_at: a.created_at || null });
    files += await saveFiles(fileRows);
    if (!ip.cursor) break;
    cursor = ip.cursor;
  }
  return { page, done: true, updates, files, calls };
}

async function saveFiles(rows) {
  if (!rows.length) return 0;
  await write(`INSERT INTO mirror.backup_files (id, name, extension, size_bytes, board_id, item_id, update_id, column_id, created_at, seen_at)
    SELECT (r->>'id')::bigint, r->>'name', r->>'extension', (r->>'size_bytes')::bigint, (r->>'board_id')::bigint, (r->>'item_id')::bigint, (r->>'update_id')::bigint,
      r->>'column_id', (r->>'created_at')::timestamptz, now() FROM jsonb_array_elements($1::jsonb) r
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, size_bytes = EXCLUDED.size_bytes, item_id = COALESCE(EXCLUDED.item_id, mirror.backup_files.item_id),
      update_id = COALESCE(EXCLUDED.update_id, mirror.backup_files.update_id), seen_at = now()`, [JSON.stringify(rows)]);
  return rows.length;
}

// ---------- docs ----------

const DOCS_Q = `query ($l: Int, $p: Int) { docs (limit: $l, page: $p, order_by: created_at) { id object_id name workspace_id url created_at updated_at created_by { name } } }`;
const BLOCKS_Q = `query ($d: [ID!], $l: Int, $p: Int) { docs (ids: $d) { blocks (limit: $l, page: $p) { id type content parent_block_id position } } }`;

// A block's text, from monday's delta format ({"deltaFormat":[{"insert":"..."}]}).
export function blockText(content) {
  const c = parse(content);
  if (!c) return "";
  if (Array.isArray(c.deltaFormat)) return c.deltaFormat.map(d => (typeof d.insert === "string" ? d.insert : "")).join("");
  if (typeof c.text === "string") return c.text;
  return "";
}

async function backupDocs(gql, page, deadline, budgetLeft) {
  let docs = 0, calls = 0;
  for (;;) {
    if (Date.now() > deadline || calls >= budgetLeft()) return { page, done: false, docs, calls };
    const list = (await gql(DOCS_Q, { l: 25, p: page })).docs || [];
    calls++;
    for (const d of list) {
      if (!isId(d.id) || isExcluded({ id: d.object_id, name: d.name })) continue;
      const known = (await read(`SELECT updated_at FROM mirror.backup_docs WHERE id = $1::bigint`, [d.id]))[0];
      if (known && ms(known.updated_at) >= ms(d.updated_at)) continue; // unchanged since the last backup
      const blocks = [];
      for (let bp = 1; bp < 40; bp++) {
        if (Date.now() > deadline || calls >= budgetLeft()) return { page, done: false, docs, calls };
        const bl = (((await gql(BLOCKS_Q, { d: [String(d.id)], l: 100, p: bp })).docs || [])[0] || {}).blocks || [];
        calls++;
        blocks.push(...bl.map(b => ({ id: b.id, type: b.type, content: clean(b.content), parent: b.parent_block_id || null, position: b.position })));
        if (bl.length < 100) break;
      }
      const text = blocks.map(b => blockText(b.content)).filter(Boolean).join("\n");
      await write(`INSERT INTO mirror.backup_docs (id, object_id, name, workspace_id, url, created_by, created_at, updated_at, blocks, body_text, backed_up_at)
        VALUES ($1::bigint, $2::bigint, $3, $4::bigint, $5, $6, $7::timestamptz, $8::timestamptz, $9::jsonb, $10, now())
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, url = EXCLUDED.url, updated_at = EXCLUDED.updated_at, blocks = EXCLUDED.blocks, body_text = EXCLUDED.body_text, backed_up_at = now()`,
        [d.id, isId(d.object_id) ? d.object_id : null, clean(d.name), isId(d.workspace_id) ? d.workspace_id : null, clean(d.url), clean(d.created_by && d.created_by.name),
          d.created_at || null, d.updated_at || null, JSON.stringify(blocks), clean(text)]);
      docs++;
    }
    if (list.length < 25) return { page, done: true, docs, calls };
    page++;
  }
}

// ---------- a run ----------

export async function runBackup(token, { force = false, fetchImpl, now = Date.now } = {}) {
  await ensureSchema();
  if (!force) {
    const got = await write(`UPDATE mirror.locks SET until = now() + interval '20 minutes' WHERE name = 'backup' AND until < now() RETURNING name`);
    if (!got.length) return { skipped: "a backup run started less than 20 minutes ago" };
  }
  const used = (await read(`SELECT COALESCE(sum(api_calls), 0)::int AS n FROM mirror.backup_runs WHERE started_at > now() - interval '24 hours'`))[0].n;
  if (used >= DAY_CALLS) return { skipped: "daily backup call budget used (" + used + ")" };
  const run = (await write(`INSERT INTO mirror.backup_runs DEFAULT VALUES RETURNING id`))[0].id;
  const client = makeClient(token, fetchImpl);
  const deadline = now() + RUN_MS;
  const budgetLeft = () => (client.state.lowBudget ? 0 : Math.min(MAX_CALLS, DAY_CALLS - used) - client.state.calls);
  let updates = 0, docs = 0, files = 0, note = "";
  try {
    // Every copied board, plus the docs, is one unit of work; a unit is due when its last pass is 20 hours old.
    await write(`INSERT INTO mirror.backup_state (kind, ref) SELECT 'board', id FROM mirror.boards WHERE NOT gone ON CONFLICT DO NOTHING`);
    await write(`INSERT INTO mirror.backup_state (kind, ref) VALUES ('docs', 0) ON CONFLICT DO NOTHING`);
    const due = await read(`SELECT s.kind, s.ref::text AS ref, s.page, s.done_at, s.full_at, b.monday_updated_at FROM mirror.backup_state s
      LEFT JOIN mirror.boards b ON s.kind = 'board' AND b.id = s.ref
      WHERE (s.kind = 'docs' OR (b.id IS NOT NULL AND NOT b.gone)) AND (s.done_at IS NULL OR s.done_at < now() - ($1::int * interval '1 millisecond'))
      ORDER BY s.done_at NULLS FIRST, s.kind DESC, s.ref`, [PASS_EVERY_MS]);
    for (const u of due) {
      if (now() > deadline || budgetLeft() <= 0) { note = "stopped at the run budget; continues next run"; break; }
      const weekly = !u.full_at || ms(u.full_at) < now() - 7 * 24 * 3600000;
      if (u.kind === "board" && !weekly && u.done_at && ms(u.monday_updated_at) <= ms(u.done_at)) { // nothing changed on this board since its last pass
        await write(`UPDATE mirror.backup_state SET done_at = now() WHERE kind = 'board' AND ref = $1::bigint`, [u.ref]);
        continue;
      }
      const r = u.kind === "docs" ? await backupDocs(client.gql, u.page, deadline, budgetLeft) : await backupBoard(client.gql, u.ref, u.page, deadline, budgetLeft, !weekly);
      updates += r.updates || 0; docs += r.docs || 0; files += r.files || 0;
      await write(`UPDATE mirror.backup_state SET page = $3, pass_started_at = COALESCE(pass_started_at, now()), done_at = CASE WHEN $4 THEN now() ELSE done_at END
        WHERE kind = $1 AND ref = $2::bigint`, [u.kind, u.ref, r.done ? 1 : r.page, r.done]);
      if (r.done) await write(`UPDATE mirror.backup_state SET pass_started_at = NULL, full_at = CASE WHEN $3 THEN now() ELSE full_at END WHERE kind = $1 AND ref = $2::bigint`, [u.kind, u.ref, weekly || u.kind === "docs"]);
      else { note = "stopped part way through " + (u.kind === "docs" ? "the docs" : "board " + u.ref) + "; continues next run"; break; }
    }
    await write(`UPDATE mirror.backup_runs SET finished_at = now(), updates_written = $2, docs_written = $3, files_seen = $4, api_calls = $5, ok = true, note = $6 WHERE id = $1`,
      [run, updates, docs, files, client.state.calls, note || null]);
    return { ok: true, updates, docs, files, calls: client.state.calls, note };
  } catch (e) {
    const msg = String(e && e.message || e).slice(0, 300);
    await write(`UPDATE mirror.backup_runs SET finished_at = now(), updates_written = $2, docs_written = $3, files_seen = $4, api_calls = $5, ok = false, note = $6 WHERE id = $1`,
      [run, updates, docs, files, client.state.calls, msg]);
    return { ok: false, error: msg };
  }
}

// For /data/mirror: how complete the backup is.
export async function backupStatus() {
  const [c] = await read(`SELECT (SELECT count(*) FROM mirror.backup_updates)::int AS updates, (SELECT count(*) FROM mirror.backup_docs)::int AS docs,
    (SELECT count(*) FROM mirror.backup_files)::int AS files, (SELECT COALESCE(sum(size_bytes), 0) FROM mirror.backup_files)::bigint AS bytes,
    (SELECT count(*) FROM mirror.backup_files WHERE stored_at IS NOT NULL)::int AS stored,
    (SELECT count(*) FROM mirror.backup_state WHERE done_at > now() - interval '24 hours')::int AS fresh, (SELECT count(*) FROM mirror.backup_state)::int AS units`);
  const runs = await read(`SELECT started_at, ok, updates_written, docs_written, files_seen, api_calls, note FROM mirror.backup_runs ORDER BY id DESC LIMIT 5`);
  return Object.assign({}, c, { runs });
}
