// The second stage of the nightly backup: copies the files themselves (on file columns and attached to updates)
// from monday into the Ecosystem's private file store (Vercel Blob store "dft-monday-files", private access).
// Like the rest of the backup it is READ ONLY on monday: one query per batch asks monday for short-lived
// download links, and the file is streamed straight into the store.
//
// The store is private: a stored file can only be read with the store's token, which only the Ecosystem has.
// People open files through /files/<monday file id>, which checks they can see the file's board first (same
// rule as the boards), so a finance file stays visible only to the people on that finance board.

import { put, get } from "@vercel/blob";
import { read, write } from "./db.js";
import { ensureSchema } from "./schema.js";
import { makeClient } from "./sync.js";
import { isExcluded, canSee } from "./policy.js";

const RUN_MS = 230000;          // stop starting new work after this
const MIN_LEFT_MS = 60000;      // never start a file with less than a minute left
const MAX_CALLS = 20;           // monday calls per run (one per batch of 25 files)
const DAY_CALLS = 240;          // file runs' own allowance (about 10 a day at most); the backup passes have theirs (backup.js)
const RUN_BYTES = 2 * 1024 ** 3;
export const MAX_FILE = 1024 ** 3; // files over 1 GB are listed but not copied
const BATCH = 25;
const TRIES = 3;

const ASSET_Q = `query ($ids: [ID!]!) { assets (ids: $ids) { id public_url } }`;

export const hasStore = () => !!process.env.BLOB_READ_WRITE_TOKEN;

export function blobPath(f) {
  const safe = String(f.name || "file").replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "file";
  return "monday/" + (f.board_id || "0") + "/" + f.id + "/" + safe;
}

async function fail(id, msg) {
  await write(`UPDATE mirror.backup_files SET attempts = attempts + 1, last_error = $2,
    skipped = CASE WHEN attempts + 1 >= $3 THEN $2 ELSE skipped END WHERE id = $1::bigint`, [id, String(msg).slice(0, 200), TRIES]);
}

export async function copyFiles(token, { force = false, fetchImpl = fetch, putImpl = put, now = Date.now } = {}) {
  await ensureSchema();
  if (!hasStore() && putImpl === put) return { skipped: "file store not connected" };
  if (!force) {
    const got = await write(`UPDATE mirror.locks SET until = now() + interval '20 minutes' WHERE name = 'backup_files' AND until < now() RETURNING name`);
    if (!got.length) return { skipped: "a file run started less than 20 minutes ago" };
  }
  // Counted separately from the backup passes: on 23 to 24 Oct they used the shared allowance overnight and the
  // hourly file runs were skipped for six hours, though each needs only a handful of calls.
  const used = (await read(`SELECT COALESCE(sum(api_calls), 0)::int AS n FROM mirror.backup_runs WHERE started_at > now() - interval '24 hours' AND stage = 'files'`))[0].n;
  if (used >= DAY_CALLS) return { skipped: "daily file-copy call budget used (" + used + ")" };
  const run = (await write(`INSERT INTO mirror.backup_runs (stage) VALUES ('files') RETURNING id`))[0].id;
  const client = makeClient(token, fetchImpl);
  const deadline = now() + RUN_MS;
  let stored = 0, bytes = 0, note = "";
  const tried = new Set();
  try {
    for (;;) {
      if (client.state.calls >= Math.min(MAX_CALLS, DAY_CALLS - used) || client.state.lowBudget) { note = "stopped at the run budget; continues next run"; break; }
      if (deadline - now() < MIN_LEFT_MS || bytes >= RUN_BYTES) { note = "stopped at the run budget; continues next run"; break; }
      // Newest first: recent contracts and invoices are the ones most likely to be needed.
      const batch = await read(`SELECT f.id::text AS id, f.name, f.extension, f.size_bytes, f.board_id::text AS board_id, b.name AS board_name
        FROM mirror.backup_files f LEFT JOIN mirror.boards b ON b.id = f.board_id
        WHERE f.stored_at IS NULL AND f.skipped IS NULL AND NOT (f.id = ANY($2::bigint[])) ORDER BY f.created_at DESC NULLS LAST, f.id DESC LIMIT $1`, [BATCH, [...tried]]);
      if (!batch.length) break;
      for (const f of batch) tried.add(f.id); // a file that fails waits for the next run
      const todo = [];
      for (const f of batch) {
        if (!f.board_name || isExcluded({ id: f.board_id, name: f.board_name }) || isExcluded({ id: f.board_id, name: String(f.board_name).replace(/^Subitems of /, "") })) { await write(`UPDATE mirror.backup_files SET skipped = 'board not backed up' WHERE id = $1::bigint`, [f.id]); continue; }
        if (Number(f.size_bytes) > MAX_FILE) { await write(`UPDATE mirror.backup_files SET skipped = 'over 1 GB' WHERE id = $1::bigint`, [f.id]); continue; }
        todo.push(f);
      }
      if (!todo.length) continue;
      const links = Object.fromEntries(((await client.gql(ASSET_Q, { ids: todo.map(f => f.id) })).assets || []).map(a => [String(a.id), a.public_url]));
      for (const f of todo) {
        if (deadline - now() < MIN_LEFT_MS || bytes >= RUN_BYTES) { note = "stopped at the run budget; continues next run"; break; }
        const url = links[f.id];
        if (!url || !/^https:\/\//.test(url)) { await fail(f.id, "monday gave no download link (file deleted?)"); continue; }
        try {
          const signal = AbortSignal.timeout(Math.max(1000, deadline + 40000 - now()));
          const res = await fetchImpl(url, { signal });
          if (!res.ok || !res.body) { await fail(f.id, "download failed: " + res.status); continue; }
          const size = Number(res.headers.get("content-length")) || Number(f.size_bytes) || 0;
          if (size > MAX_FILE) { await write(`UPDATE mirror.backup_files SET skipped = 'over 1 GB' WHERE id = $1::bigint`, [f.id]); continue; }
          const blob = await putImpl(blobPath(f), res.body, { access: "private", allowOverwrite: true, addRandomSuffix: false, multipart: size > 50 * 1024 ** 2,
            contentType: res.headers.get("content-type") || undefined, abortSignal: signal });
          await write(`UPDATE mirror.backup_files SET stored_at = now(), stored_url = $2, stored_bytes = $3, last_error = NULL WHERE id = $1::bigint`, [f.id, blob.pathname, size || null]);
          stored++; bytes += size;
        } catch (e) { await fail(f.id, String(e && e.message || e)); }
      }
      if (note) break;
    }
    await write(`UPDATE mirror.backup_runs SET finished_at = now(), files_seen = $2, bytes_stored = $3, api_calls = $4, ok = true, note = $5 WHERE id = $1`,
      [run, stored, bytes, client.state.calls, note || null]);
    return { ok: true, stored, bytes, calls: client.state.calls, note };
  } catch (e) {
    const msg = String(e && e.message || e).slice(0, 300);
    await write(`UPDATE mirror.backup_runs SET finished_at = now(), files_seen = $2, bytes_stored = $3, api_calls = $4, ok = false, note = $5 WHERE id = $1`,
      [run, stored, bytes, client.state.calls, msg]);
    return { ok: false, error: msg };
  }
}

// ---------- /files/<id>: open one stored file, for people who can see its board ----------

const INLINE = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/; // everything else downloads, never runs in the page

export async function serveFile(email, id, { getImpl = get } = {}) {
  const missing = { status: 404, html: "That file is not in the Ecosystem's backup yet." };
  if (!/^\d{1,19}$/.test(String(id))) return missing;
  const f = (await read(`SELECT id::text AS id, name, board_id::text AS board_id, stored_url FROM mirror.backup_files WHERE id = $1::bigint`, [id]))[0];
  if (!f) return missing;
  const team = new Set((await read(`SELECT email FROM mirror.team`)).map(r => r.email));
  let b = (await read(`SELECT id::text AS id, name, board_type, access, allowed_emails, gone, parent_board_id::text AS parent_board_id FROM mirror.boards WHERE id = $1::bigint`, [f.board_id]))[0];
  // A subitems board takes its parent board's access: check the parent too.
  const parent = b && b.board_type === "sub_items_board" && b.parent_board_id
    ? (await read(`SELECT id::text AS id, name, board_type, access, allowed_emails, gone FROM mirror.boards WHERE id = $1::bigint`, [b.parent_board_id]))[0] : null;
  const allowed = !!b && !isExcluded({ id: b.id, name: b.name }) && !isExcluded({ id: b.id, name: String(b.name || "").replace(/^Subitems of /, "") }) && !(parent && isExcluded(parent)) && canSee(b, email, team) && (b.board_type !== "sub_items_board" || (parent && canSee(parent, email, team)));
  try { await write(`INSERT INTO mirror.access_log (email, path, board_id, allowed) VALUES ($1, $2, $3, $4)`, [String(email || "").slice(0, 200), "/files/" + f.id, f.board_id, allowed]); } catch (e) { /* never blocks */ }
  if (!allowed || !f.stored_url) return missing;
  const r = await getImpl(f.stored_url, { access: "private", useCache: false });
  if (!r || r.statusCode !== 200 || !r.stream) return missing;
  const type = String(r.blob && r.blob.contentType || "application/octet-stream").split(";")[0].trim().toLowerCase();
  const name = String(f.name || "file").replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";
  return { status: 200, stream: r.stream, headers: {
    "Content-Type": INLINE.test(type) ? type : "application/octet-stream",
    "Content-Disposition": (INLINE.test(type) ? "inline" : "attachment") + "; filename=\"" + name + "\"",
    "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  } };
}
