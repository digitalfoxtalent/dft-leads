// The monday -> Ecosystem mirror. ONE WAY and READ ONLY on the monday side: it only ever runs GraphQL
// queries against monday, never a mutation, so it cannot change anything in monday.
//
// Each run (cron every 30 minutes, see api/mirror-sync.js):
//   1. Reads the list of active boards (with folder, owners and subscribers) and records where each
//      belongs and who may see it (policy.js). Boards that disappeared from monday are marked gone.
//   2. Copies boards that changed since their last copy, newest changes first, then fills boards never
//      copied, then re-checks any board whose item count differs or whose full check is a day old.
//   3. Stops well inside Vercel's 300 second limit and a call budget, so it never crowds out Make,
//      Apify or the reports, which share the same monday account.
// A full check copies every item and marks any item no longer in monday as deleted (kept, not erased).

import { read, write } from "./db.js";
import { ensureSchema } from "./schema.js";
import { isExcluded, departmentFor, accessFor } from "./policy.js";

const API = "https://api.monday.com/v2";
const VERSION = "2025-04";
const RUN_MS = 230000;            // stop starting new work after this
const MAX_CALLS = 120;            // per run; at 48 runs a day this caps the mirror well below monday's limits
const MIN_GAP_MS = 20 * 60000;    // a second trigger within 20 minutes does nothing
const DAY_CALLS = 2000;           // never more than this many monday calls in any 24 hours
const FULL_EVERY_MS = 24 * 3600000;
const MISMATCH_RETRY_MS = 6 * 3600000; // a board whose counts still differ after a full copy is retried at most this often
const SAFETY_MS = 10 * 60000;     // incremental copies look back this far past the last copy

const VALUE_FIELDS = `id type text value
  ... on MirrorValue { display_value }
  ... on BoardRelationValue { display_value linked_item_ids }
  ... on DependencyValue { display_value }
  ... on FormulaValue { display_value }`;
const ITEM_FIELDS = `id name created_at updated_at state group { id } parent_item { id } creator { name }
  column_values { ${VALUE_FIELDS} }
  updates (limit: 10) { id text_body created_at creator { name } }`;

const ms = v => (v instanceof Date ? v.getTime() : v ? Date.parse(v) : 0);
const clean = s => (s == null ? s : String(s).replace(/\u0000/g, ""));

export function makeClient(token, fetchImpl = fetch) {
  const state = { calls: 0, lowBudget: false };
  async function gql(query, variables = {}) {
    state.calls++;
    const r = await fetchImpl(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token, "API-Version": VERSION },
      body: JSON.stringify({ query: query.replace(/^\s*query/, "query").replace(/\{/, "{ complexity { after reset_in_x_seconds } "), variables }),
    });
    const d = await r.json();
    if (!r.ok || d.errors) throw new Error("monday: " + JSON.stringify(d.errors || r.status).slice(0, 300));
    const c = d.data && d.data.complexity;
    if (c && c.after < 4000000) state.lowBudget = true; // leave most of the minute's budget to everything else
    return d.data;
  }
  return { gql, state };
}

// ---------- 1. the board list ----------

async function listAll(gql) {
  const ws = (await gql(`query { workspaces (limit: 200) { id name kind } }`)).workspaces || [];
  const wsById = Object.fromEntries(ws.map(w => [String(w.id), w]));
  const folders = [];
  for (let page = 1; page < 20; page++) {
    const f = (await gql(`query ($w: [ID], $p: Int) { folders (workspace_ids: $w, limit: 100, page: $p) { id name parent { id } } }`,
      { w: ws.map(w => w.id), p: page })).folders || [];
    folders.push(...f);
    if (f.length < 100) break;
  }
  const fById = Object.fromEntries(folders.map(f => [String(f.id), f]));
  const pathOf = id => { const parts = []; let f = fById[String(id)], guard = 0;
    while (f && guard++ < 10) { parts.unshift(f.name); f = f.parent && fById[String(f.parent.id)]; }
    return parts.join(" / "); };
  const boards = [];
  for (let page = 1; page < 50; page++) {
    const b = (await gql(`query ($p: Int) { boards (limit: 100, page: $p, state: active) {
        id name description type board_kind updated_at items_count board_folder_id
        workspace { id } owners { email } subscribers { email } } }`, { p: page })).boards || [];
    boards.push(...b);
    if (b.length < 100) break;
  }
  return boards.filter(b => b.type === "board" || b.type === "sub_items_board").map(b => {
    const w = wsById[String(b.workspace && b.workspace.id)] || {};
    const folderPath = b.board_folder_id ? pathOf(b.board_folder_id) : "";
    const department = departmentFor({ workspaceName: w.name, folderPath, boardName: b.name });
    const acc = accessFor({ boardKind: b.board_kind, workspaceKind: w.kind, workspaceName: w.name, folderPath,
      boardName: b.name, department, owners: b.owners, subscribers: b.subscribers });
    return { id: String(b.id), name: clean(b.name), description: clean(b.description), board_type: b.type,
      board_kind: b.board_kind, workspace_id: w.id || null, workspace_name: w.name || null, workspace_kind: w.kind || null,
      folder_id: b.board_folder_id || null, folder_path: folderPath, department, access: acc.access,
      allowed_emails: acc.allowed, monday_items: b.items_count || 0, monday_updated_at: b.updated_at || null,
      excluded: isExcluded(b) };
  });
}

async function saveBoardList(list) {
  const keep = list.filter(b => !b.excluded);
  await write(`INSERT INTO mirror.boards (id, name, description, board_type, board_kind, workspace_id, workspace_name,
      workspace_kind, folder_id, folder_path, department, access, allowed_emails, monday_items, monday_updated_at, seen_at, gone)
    SELECT (r->>'id')::bigint, r->>'name', r->>'description', r->>'board_type', r->>'board_kind',
      NULLIF(r->>'workspace_id','')::bigint, r->>'workspace_name', r->>'workspace_kind', NULLIF(r->>'folder_id','')::bigint,
      r->>'folder_path', r->>'department', r->>'access',
      ARRAY(SELECT jsonb_array_elements_text(r->'allowed_emails')), (r->>'monday_items')::int,
      NULLIF(r->>'monday_updated_at','')::timestamptz, now(), false
    FROM jsonb_array_elements($1::jsonb) r
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
      board_type = EXCLUDED.board_type, board_kind = EXCLUDED.board_kind, workspace_id = EXCLUDED.workspace_id,
      workspace_name = EXCLUDED.workspace_name, workspace_kind = EXCLUDED.workspace_kind, folder_id = EXCLUDED.folder_id,
      folder_path = EXCLUDED.folder_path,
      department = CASE WHEN mirror.boards.parent_board_id IS NULL THEN EXCLUDED.department ELSE mirror.boards.department END,
      access = CASE WHEN mirror.boards.parent_board_id IS NULL THEN EXCLUDED.access ELSE mirror.boards.access END,
      allowed_emails = CASE WHEN mirror.boards.parent_board_id IS NULL THEN EXCLUDED.allowed_emails ELSE mirror.boards.allowed_emails END,
      monday_items = EXCLUDED.monday_items, monday_updated_at = EXCLUDED.monday_updated_at, seen_at = now(), gone = false`,
    [JSON.stringify(keep)]);
  // Gone from monday's active list (archived, deleted, or now excluded): hide, keep the copy.
  await write(`UPDATE mirror.boards SET gone = true WHERE NOT (id = ANY($1::bigint[]))`, [keep.map(b => b.id)]);
  // A board that is now excluded must not keep any copied content at all.
  const excluded = list.filter(b => b.excluded).map(b => b.id);
  if (excluded.length) {
    await write(`DELETE FROM mirror.updates WHERE item_id IN (SELECT id FROM mirror.items WHERE board_id = ANY($1::bigint[]))`, [excluded]);
    await write(`DELETE FROM mirror.items WHERE board_id = ANY($1::bigint[])`, [excluded]);
    await write(`DELETE FROM mirror.boards WHERE id = ANY($1::bigint[])`, [excluded]);
  }
}

// ---------- 2. copying one board ----------

function parseColumns(cols) {
  return (cols || []).map(c => {
    let s = {}; try { s = JSON.parse(c.settings_str || "{}"); } catch (e) {}
    const out = { id: c.id, title: clean(c.title), type: c.type };
    if (c.type === "status" && s.labels) {
      out.labels = {};
      for (const [i, label] of Object.entries(s.labels)) {
        const col = s.labels_colors && s.labels_colors[i] && s.labels_colors[i].color;
        out.labels[i] = [clean(label), col || null];
      }
    }
    if (c.type === "subtasks" && Array.isArray(s.boardIds)) out.subBoards = s.boardIds.map(String);
    return out;
  });
}

function rowOf(it, boardId, pos) {
  const vals = {};
  for (const v of it.column_values || []) {
    const text = v.display_value != null ? v.display_value : v.text;
    if ((text == null || text === "") && v.value == null) continue;
    vals[v.id] = [clean(text), clean(v.value)];
  }
  return { id: String(it.id), board_id: boardId, parent_id: it.parent_item ? String(it.parent_item.id) : null,
    group_id: it.group && it.group.id, name: clean(it.name), vals, created_at: it.created_at, updated_at: it.updated_at,
    creator: it.creator && clean(it.creator.name), pos };
}

async function saveItems(rows, updates) {
  if (rows.length) await write(`INSERT INTO mirror.items (id, board_id, parent_id, group_id, name, vals, created_at, updated_at, creator, pos, deleted, synced_at)
      SELECT (r->>'id')::bigint, (r->>'board_id')::bigint, NULLIF(r->>'parent_id','')::bigint, r->>'group_id', r->>'name',
        COALESCE(r->'vals', '{}'::jsonb), NULLIF(r->>'created_at','')::timestamptz, NULLIF(r->>'updated_at','')::timestamptz,
        r->>'creator', NULLIF(r->>'pos','')::int, false, now()
      FROM jsonb_array_elements($1::jsonb) r
      ON CONFLICT (id) DO UPDATE SET board_id = EXCLUDED.board_id, parent_id = EXCLUDED.parent_id, group_id = EXCLUDED.group_id,
        name = EXCLUDED.name, vals = EXCLUDED.vals, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at,
        creator = EXCLUDED.creator, pos = COALESCE(EXCLUDED.pos, mirror.items.pos), deleted = false, synced_at = now()`,
    [JSON.stringify(rows)]);
  if (updates.length) await write(`INSERT INTO mirror.updates (id, item_id, body, creator, created_at)
      SELECT (r->>'id')::bigint, (r->>'item_id')::bigint, r->>'body', r->>'creator', NULLIF(r->>'created_at','')::timestamptz
      FROM jsonb_array_elements($1::jsonb) r
      ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, creator = EXCLUDED.creator`, [JSON.stringify(updates)]);
}

const updatesOf = items => items.flatMap(it => (it.updates || []).map(u => ({ id: String(u.id), item_id: String(it.id),
  body: clean(u.text_body), creator: u.creator && clean(u.creator.name), created_at: u.created_at })));

// Copy one board. full=true copies every item and marks the rest deleted; otherwise only items changed
// since `since`. Returns { items, done } where done=false means it ran out of time or budget part way.
export async function syncBoard(client, board, { full, since, deadline, small = false }) {
  const { gql, state } = client;
  const id = String(board.id);
  const pageSize = small ? 20 : full ? 100 : 50; // wide boards can exceed monday's per-query budget; retried with 20
  const order = full ? "" : `, query_params: { order_by: [{ column_id: "__last_updated__", direction: desc }] }`;
  const first = await gql(`query ($b: [ID!]) { boards (ids: $b) { columns { id title type settings_str }
      groups { id title color position } items_page (limit: ${pageSize}${order}) { cursor items { ${ITEM_FIELDS} } } } }`, { b: [id] });
  const b = first.boards && first.boards[0];
  if (!b) return { items: 0, done: true };
  const columns = parseColumns(b.columns);
  const groups = (b.groups || []).map(g => ({ id: g.id, title: clean(g.title), color: g.color, position: Number(g.position) || 0 }))
    .sort((x, y) => x.position - y.position);
  await write(`UPDATE mirror.boards SET columns = $2::jsonb, groups = $3::jsonb WHERE id = $1::bigint`, [id, JSON.stringify(columns), JSON.stringify(groups)]);
  // A subitems board takes the department and access of the board it belongs to.
  const subs = columns.flatMap(c => c.subBoards || []);
  if (subs.length) await write(`UPDATE mirror.boards SET parent_board_id = $1::bigint, department = p.department, access = p.access,
      allowed_emails = p.allowed_emails FROM mirror.boards p WHERE p.id = $1::bigint AND mirror.boards.id = ANY($2::bigint[])`, [id, subs]);

  const seen = [];
  let page = b.items_page, n = 0, pos = 0, stop = false, done = true;
  const sinceMs = since ? ms(since) - SAFETY_MS : 0;
  while (true) {
    let items = page.items || [];
    if (!full && sinceMs) {
      const fresh = items.filter(it => Date.parse(it.updated_at) >= sinceMs);
      if (fresh.length < items.length) stop = true;
      items = fresh;
    }
    const rows = items.map(it => rowOf(it, id, full ? pos++ : null));
    await saveItems(rows, updatesOf(items));
    rows.forEach(r => seen.push(r.id));
    n += rows.length;
    if (stop || !page.cursor) break;
    if (Date.now() > deadline || state.calls >= MAX_CALLS || state.lowBudget) { done = false; break; }
    page = (await gql(`query ($c: String!) { next_items_page (limit: ${pageSize}, cursor: $c) { cursor items { ${ITEM_FIELDS} } } }`, { c: page.cursor })).next_items_page;
  }
  if (full && done) {
    await write(`UPDATE mirror.items SET deleted = true WHERE board_id = $1::bigint AND NOT deleted AND NOT (id = ANY($2::bigint[]))`, [id, seen]);
  }
  return { items: n, done };
}

// ---------- 3. one run ----------

export async function runSync(token, { force = false, onlyBoards = null, fetchImpl, now = Date.now } = {}) {
  await ensureSchema();
  const t0 = now();
  const deadline = t0 + RUN_MS;
  if (!force) {
    const last = (await read(`SELECT started_at FROM mirror.sync_runs ORDER BY id DESC LIMIT 1`))[0];
    if (last && t0 - ms(last.started_at) < MIN_GAP_MS) return { skipped: "ran less than 20 minutes ago" };
  }
  const used = (await read(`SELECT COALESCE(sum(api_calls), 0)::int AS n FROM mirror.sync_runs WHERE started_at > now() - interval '24 hours'`))[0].n;
  if (used >= DAY_CALLS) return { skipped: "daily monday call budget used (" + used + ")" };
  const run = (await write(`INSERT INTO mirror.sync_runs (mode) VALUES ($1) RETURNING id`, [onlyBoards ? "boards" : "scheduled"]))[0].id;
  const client = makeClient(token, fetchImpl);
  let boardsSynced = 0, itemsWritten = 0, note = "";
  try {
    const list = await listAll(client.gql);
    await saveBoardList(list);
    const rows = await read(`SELECT id::text AS id, name, monday_items, mirror_items, monday_updated_at, synced_at, full_synced_at
      FROM mirror.boards WHERE NOT gone` + (onlyBoards ? ` AND id = ANY($1::bigint[])` : ``), onlyBoards ? [onlyBoards] : []);
    const ts = ms;
    // A changed board whose counts already differ gets a full copy, which also catches deletions.
    const needsFull = r => (r.mirror_items !== r.monday_items && t0 - ts(r.full_synced_at) > MISMATCH_RETRY_MS) || t0 - ts(r.full_synced_at) > FULL_EVERY_MS;
    const changed = rows.filter(r => r.synced_at && ts(r.monday_updated_at) > ts(r.synced_at))
      .sort((a, b) => ts(b.monday_updated_at) - ts(a.monday_updated_at));
    const fresh = rows.filter(r => !r.synced_at).sort((a, b) => (a.monday_items || 0) - (b.monday_items || 0));
    const recheck = rows.filter(r => r.synced_at && !changed.includes(r) && needsFull(r))
      .sort((a, b) => ts(a.full_synced_at) - ts(b.full_synced_at));
    const queue = [...changed.map(r => [r, needsFull(r)]), ...fresh.map(r => [r, true]), ...recheck.map(r => [r, true])];
    for (const [r, full] of queue) {
      if (now() > deadline || client.state.calls >= MAX_CALLS || client.state.lowBudget) { note = "stopped at the run budget; continues next run"; break; }
      const startedAt = new Date(now()).toISOString();
      try {
        let res;
        try { res = await syncBoard(client, r, { full, since: r.synced_at, deadline }); }
        catch (e) {
          if (!/complexity|budget|too large|timeout/i.test(String(e && e.message))) throw e;
          res = await syncBoard(client, r, { full, since: r.synced_at, deadline, small: true });
        }
        itemsWritten += res.items;
        if (!res.done) { note = "stopped part way through " + r.name + "; continues next run"; break; }
        const cnt = (await read(`SELECT count(*)::int AS n FROM mirror.items WHERE board_id = $1::bigint AND NOT deleted`, [r.id]))[0].n;
        await write(`UPDATE mirror.boards SET synced_at = $2::timestamptz, mirror_items = $3,
            full_synced_at = CASE WHEN $4 THEN $2::timestamptz ELSE full_synced_at END, sync_error = NULL WHERE id = $1::bigint`,
          [r.id, startedAt, cnt, full]);
        boardsSynced++;
      } catch (e) {
        await write(`UPDATE mirror.boards SET sync_error = $2 WHERE id = $1::bigint`, [r.id, String(e && e.message || e).slice(0, 300)]);
      }
    }
    await write(`UPDATE mirror.sync_runs SET finished_at = now(), boards_synced = $2, items_written = $3, api_calls = $4, ok = true, note = $5 WHERE id = $1`,
      [run, boardsSynced, itemsWritten, client.state.calls, note || null]);
    return { ok: true, boards: boardsSynced, items: itemsWritten, calls: client.state.calls, queue: queue.length, note };
  } catch (e) {
    const msg = String(e && e.message || e).slice(0, 300);
    await write(`UPDATE mirror.sync_runs SET finished_at = now(), boards_synced = $2, items_written = $3, api_calls = $4, ok = false, note = $5 WHERE id = $1`,
      [run, boardsSynced, itemsWritten, client.state.calls, msg]);
    return { ok: false, error: msg };
  }
}
