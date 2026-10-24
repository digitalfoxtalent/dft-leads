// Tests for the second backup stage: copying monday files into the private file store, and opening them
// (api/_reports/mirror/files.js). In-memory Postgres (PGlite), a fake monday and a fake file store.
//   npm install --no-save @electric-sql/pglite@0.3.15 && node test/files.mjs

import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setExecutor, read, write } from "../api/_reports/mirror/db.js";
import { ensureSchema } from "../api/_reports/mirror/schema.js";
import { copyFiles, serveFile, blobPath, MAX_FILE } from "../api/_reports/mirror/files.js";
import { backupStatus } from "../api/_reports/mirror/backup.js";
import { isMirrorRoute, mirrorPage } from "../api/_reports/mirror/route.js";

const pg = new PGlite();
setExecutor({
  read: async (t, p) => (await pg.query(t, p)).rows,
  write: async (t, p) => (await pg.query(t, p)).rows,
  batch: async list => { const out = []; for (const [t, p] of list) out.push((await pg.query(t, p)).rows); return out; },
});
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const TOM = "tom@digitalfoxtalent.com", MARGOT = "margot@digitalfoxtalent.com";

await ensureSchema();
await write(`INSERT INTO mirror.boards (id, name, board_type, department, access, allowed_emails) VALUES
  (100, 'Editorial Plan', 'board', 'marketing', 'team', '{}'),
  (150, 'Subitems of Pay Cap', 'sub_items_board', 'finance', 'team', '{}'),
  (200, 'Pay Cap', 'board', 'finance', 'listed', '{tom@digitalfoxtalent.com}'),
  (300, 'Team API keys', 'board', 'data', 'listed', '{tom@digitalfoxtalent.com}')`);
await write(`UPDATE mirror.boards SET parent_board_id = 200 WHERE id = 150`);
await write(`INSERT INTO mirror.team (email, name) VALUES ($1, 'Tom James'), ($2, 'Margot')`, [TOM, MARGOT]);
await write(`INSERT INTO mirror.backup_files (id, name, extension, size_bytes, board_id, item_id, created_at) VALUES
  (701, 'brief.pdf', 'pdf', 2048, 100, 500, '2026-10-20'),
  (702, 'invoice <script>.html', 'html', 100, 200, 600, '2026-10-19'),
  (703, 'keys.txt', 'txt', 10, 300, 700, '2026-10-18'),
  (704, 'huge.mov', 'mov', ${MAX_FILE + 1}, 100, 500, '2026-10-17'),
  (705, 'deleted.png', 'png', 10, 100, 500, '2026-10-16'),
  (706, 'sub receipt.pdf', 'pdf', 10, 150, 601, '2026-10-15')`);

// ---------- fakes ----------
const store = new Map();
let monday = [];
const fake = async (url, opts) => {
  if (url === "https://api.monday.com/v2") {
    const body = JSON.parse(opts.body);
    assert.ok(!/mutation/.test(body.query), "never writes to monday");
    monday.push(body.variables.ids);
    const assets = body.variables.ids.filter(id => id !== "705").map(id => ({ id, public_url: "https://files.monday.test/" + id }));
    return { ok: true, json: async () => ({ data: { complexity: { after: 9000000, reset_in_x_seconds: 30 }, assets } }) };
  }
  const id = url.split("/").pop();
  const bytes = new TextEncoder().encode("file " + id);
  return { ok: true, status: 200, body: new Blob([bytes]).stream(), headers: new Headers({ "content-length": String(bytes.length), "content-type": id === "702" ? "text/html" : "application/pdf" }) };
};
const putFake = async (pathname, body, o) => {
  assert.equal(o.access, "private", "every file is stored private");
  store.set(pathname, { text: await new Response(body).text(), contentType: o.contentType });
  return { pathname, url: "https://store.private.blob.vercel-storage.com/" + pathname };
};
const getFake = async (pathname, o) => {
  assert.equal(o.access, "private");
  const f = store.get(pathname);
  return f ? { statusCode: 200, stream: new Blob([f.text]).stream(), blob: { contentType: f.contentType } } : null;
};

// ---------- copying ----------
ok(blobPath({ id: "9", board_id: "1", name: "../../a b<>.pdf" }) === "monday/1/9/.._.._a b_.pdf" && !blobPath({ id: "9", board_id: "1", name: "x/y" }).includes("x/y"), "store paths never take slashes from file names");
let r = await copyFiles("tok", { fetchImpl: fake, putImpl: putFake });
ok(r.ok && r.stored === 3, "copies the files it can: " + JSON.stringify(r));
ok(monday.length === 1 && !monday[0].includes("703") && !monday[0].includes("704"), "one monday call per batch; credential boards and huge files never asked for");
const rows = Object.fromEntries((await read(`SELECT id::text AS id, stored_at, stored_url, skipped, attempts, last_error FROM mirror.backup_files`)).map(x => [x.id, x]));
ok(rows["701"].stored_at && rows["701"].stored_url === "monday/100/701/brief.pdf" && store.get("monday/100/701/brief.pdf").text === "file 701", "file streamed into the store under its board");
ok(rows["703"].skipped === "board not backed up" && !rows["703"].stored_at, "a file on a board that holds credentials is never copied");
ok(rows["704"].skipped === "over 1 GB", "files over 1 GB are listed, not copied");
ok(rows["705"].attempts === 1 && !rows["705"].skipped && /no download link/.test(rows["705"].last_error), "a missing file is retried on later runs");
ok(rows["706"].stored_at, "subitem files copied too");
await copyFiles("tok", { fetchImpl: fake, putImpl: putFake, force: true });
await copyFiles("tok", { fetchImpl: fake, putImpl: putFake, force: true });
const gone = (await read(`SELECT attempts, skipped FROM mirror.backup_files WHERE id = 705`))[0];
ok(gone.attempts === 3 && /no download link/.test(gone.skipped), "after three failed tries a file is set aside");
monday = [];
r = await copyFiles("tok", { fetchImpl: fake, putImpl: putFake, force: true });
ok(r.ok && r.stored === 0 && monday.length === 0, "nothing left: no monday calls");
r = await copyFiles("tok", { fetchImpl: fake, putImpl: putFake });
ok(r.skipped && /less than 20 minutes/.test(r.skipped), "one file run at a time");
const st = await backupStatus();
ok(st.stored === 3 && st.skipped === 3 && Number(st.stored_bytes) > 0 && st.runs[0].stage === "files", "status page counts copied and set-aside files");

// ---------- opening ----------
ok(isMirrorRoute("files/701") && !isMirrorRoute("files/abc"), "the /files/<id> address");
let f = await serveFile(MARGOT, "701", { getImpl: getFake });
ok(f.status === 200 && (await new Response(f.stream).text()) === "file 701" && f.headers["Content-Disposition"].startsWith("inline") && f.headers["Cache-Control"] === "private, no-store", "a team member opens a file on a team board");
f = await serveFile(MARGOT, "702", { getImpl: getFake });
ok(f.status === 404 && !f.stream, "a finance file is hidden from someone not on that board");
f = await serveFile(TOM, "702", { getImpl: getFake });
ok(f.status === 200 && f.headers["Content-Type"] === "application/octet-stream" && /^attachment; filename="invoice _script_.html"$/.test(f.headers["Content-Disposition"]) && /sandbox/.test(f.headers["Content-Security-Policy"]), "html and other files always download, never run in the page");
f = await serveFile(MARGOT, "706", { getImpl: getFake });
ok(f.status === 404, "a subitem file follows its parent board's access");
f = await serveFile(TOM, "706", { getImpl: getFake });
ok(f.status === 200, "and Tom, on the parent board, can open it");
f = await serveFile("someone@gmail.com", "701", { getImpl: getFake });
ok(f.status === 404, "outside accounts see nothing");
f = await serveFile(TOM, "704", { getImpl: getFake });
ok(f.status === 404, "a file not copied yet says so");
ok((await read(`SELECT count(*)::int AS n FROM mirror.access_log WHERE path LIKE '/files/%' AND NOT allowed`))[0].n >= 3, "every refused open is logged");
const res = { setHeader() {} };
const out = await mirrorPage("files/701", { method: "POST", headers: {}, query: {} }, res, TOM, "tok");
ok(out.status === 405, "files are read only");

// The file runs have their own daily allowance: a busy night of backup passes must not stop them (24 Oct 2026).
await write(`INSERT INTO mirror.backup_runs (stage, api_calls, started_at) VALUES ('pass', 1300, now() - interval '1 hour')`);
r = await copyFiles("tok", { fetchImpl: fake, putImpl: putFake, force: true });
ok(!r.skipped, "backup passes using their whole allowance do not stop the file runs: " + JSON.stringify(r).slice(0, 120));
await write(`INSERT INTO mirror.backup_runs (stage, api_calls, started_at) VALUES ('files', 240, now() - interval '1 hour')`);
r = await copyFiles("tok", { fetchImpl: fake, putImpl: putFake, force: true });
ok(/file-copy call budget/.test(r.skipped || ""), "the file runs stop at their own daily allowance");

console.log("files tests passed: " + pass);
