// Routing for the read-only monday copy on the Ecosystem host. api/reports.js calls this only after the
// visitor is signed in with a DFT Google account, and only on ecosystem.digitalfoxtalent.com (never on
// the reports host or a preview build).

import { ensureSchema } from "./schema.js";
import { hasDatabase } from "./db.js";
import { securityHeaders, renderDepartment, renderBoard, renderItem, renderStatus, DEPT_NAMES } from "./pages.js";
import { read } from "./db.js";
import { saveEdit, undoEdit } from "./edit.js";

const BOARD = /^boards\/(\d{1,19})$/;
const ITEM = /^boards\/(\d{1,19})\/items\/(\d{1,19})$/;
const ACT = /^boards\/(\d{1,19})\/items\/(\d{1,19})\/(edit|undo)$/; // POST only (edit.js)
const DEPT = /^([a-z]+)\/boards$/;

export function isMirrorRoute(route) {
  const r = String(route || "");
  if (BOARD.test(r) || ITEM.test(r) || ACT.test(r) || r === "data/mirror") return true;
  const m = r.match(DEPT);
  return !!(m && DEPT_NAMES[m[1]]);
}

const one = v => String(Array.isArray(v) ? v[0] : v == null ? "" : v);

export async function mirrorPage(route, req, res, email, token) {
  securityHeaders(res);
  const act = route.match(ACT);
  if (req.method && req.method !== "GET" && req.method !== "HEAD" && !(act && req.method === "POST")) return { status: 405, html: "Method not allowed" };
  if (!email) return { status: 401, html: "Sign in required" };
  if (!hasDatabase()) return { status: 503, html: "The Ecosystem database is not connected yet." };
  await ensureSchema();
  const q = one(req.query && req.query.q).slice(0, 100).trim();
  const page = one(req.query && req.query.page);
  let m;
  if (act) {
    if (req.method !== "POST" || !token) return { status: 405, html: "Method not allowed" };
    const [, boardId, itemId, kind] = act;
    const b = (await read(`SELECT id::text AS id, board_type, department, access, allowed_emails, gone, columns FROM mirror.boards WHERE id = $1::bigint`, [boardId]))[0];
    const it = b && (await read(`SELECT id::text AS id, name, vals FROM mirror.items WHERE id = $1::bigint AND board_id = $2::bigint AND NOT deleted`, [itemId, boardId]))[0];
    const team = new Set((await read(`SELECT email FROM mirror.team`)).map(r => r.email));
    if (!b || !it) return renderItem(email, boardId, itemId, { secret: token }); // looks exactly like a missing item
    let note;
    try { note = kind === "edit" ? await saveEdit(req, token, email, b, it, team) : await undoEdit(req, token, email, b, it, team); }
    catch (e) { note = { ok: false, message: "Something went wrong. Check the item in monday before trying again. " + String(e.message || e).slice(0, 160) }; }
    const out = await renderItem(email, boardId, itemId, { secret: token, note });
    return note.ok ? out : Object.assign(out, { status: out.status === 200 ? 400 : out.status });
  }
  if ((m = route.match(ITEM))) return renderItem(email, m[1], m[2], { secret: token });
  if ((m = route.match(BOARD))) return renderBoard(email, m[1], q, page);
  if (route === "data/mirror") return renderStatus(email);
  if ((m = route.match(DEPT))) return renderDepartment(email, m[1], q);
  return { status: 404, html: "Not found" };
}
