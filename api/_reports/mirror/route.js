// Routing for the read-only monday copy on the Ecosystem host. api/reports.js calls this only after the
// visitor is signed in with a DFT Google account, and only on ecosystem.digitalfoxtalent.com (never on
// the reports host or a preview build).

import { ensureSchema } from "./schema.js";
import { hasDatabase } from "./db.js";
import { securityHeaders, renderDepartment, renderBoard, renderItem, renderStatus, renderPanel, itemUpdates, updatesList, newRowHtml, DEPT_NAMES, cellHtml } from "./pages.js";
import { BOARD_JS } from "./client.js";
import { read } from "./db.js";
import { saveEdit, undoEdit, saveCell, postUpdate, createItem, moveItem, canEdit, currentText, editableColumns, fp } from "./edit.js";

const BOARD = /^boards\/(\d{1,19})$/;
const ITEM = /^boards\/(\d{1,19})\/items\/(\d{1,19})$/;
const ACT = /^boards\/(\d{1,19})\/items\/(\d{1,19})\/(edit|undo)$/; // POST only (edit.js)
const CELL = /^boards\/(\d{1,19})\/items\/(\d{1,19})\/cell$/;  // POST JSON from the board's click-to-edit
const PANEL = /^boards\/(\d{1,19})\/items\/(\d{1,19})\/panel$/; // GET JSON: the item side panel
const POSTU = /^boards\/(\d{1,19})\/items\/(\d{1,19})\/update$/; // POST JSON: post an update to monday
const NEWI = /^boards\/(\d{1,19})\/items\/new$/;            // POST JSON: add an item to a group
const MOVE = /^boards\/(\d{1,19})\/items\/(\d{1,19})\/move$/; // POST JSON: move an item to another group
const ASSET = "assets/eco-board.js";
const DEPT = /^([a-z]+)\/boards$/;

export function isMirrorRoute(route) {
  const r = String(route || "");
  if (BOARD.test(r) || ITEM.test(r) || ACT.test(r) || CELL.test(r) || PANEL.test(r) || POSTU.test(r) || NEWI.test(r) || MOVE.test(r) || r === ASSET || r === "data/mirror") return true;
  const m = r.match(DEPT);
  return !!(m && DEPT_NAMES[m[1]]);
}

const one = v => String(Array.isArray(v) ? v[0] : v == null ? "" : v);

export async function mirrorPage(route, req, res, email, token) {
  securityHeaders(res);
  const act = route.match(ACT), cellRoute = route.match(CELL), postRoute = route.match(POSTU), panelRoute = route.match(PANEL), newRoute = route.match(NEWI), moveRoute = route.match(MOVE);
  if (route === ASSET) return { status: 200, type: "text/javascript; charset=utf-8", body: BOARD_JS, cache: "private, max-age=86400" } // safe to keep: every page asks for ?v=<hash of this script>;
  if (req.method && req.method !== "GET" && req.method !== "HEAD" && !((act || cellRoute || postRoute || newRoute || moveRoute) && req.method === "POST")) return { status: 405, html: "Method not allowed" };
  if (!email) return { status: 401, html: "Sign in required" };
  if (!hasDatabase()) return { status: 503, html: "The Ecosystem database is not connected yet." };
  await ensureSchema();
  const q = one(req.query && req.query.q).slice(0, 100).trim();
  const page = one(req.query && req.query.page);
  let m;
  const json = o => ({ status: 200, type: "application/json; charset=utf-8", body: JSON.stringify(o), cache: "no-store" });
  if (panelRoute) return json(await renderPanel(email, panelRoute[1], panelRoute[2], { secret: token }));
  const BOARD_Q = `SELECT id::text AS id, board_type, department, access, allowed_emails, gone, columns, groups FROM mirror.boards WHERE id = $1::bigint`;
  if (newRoute || moveRoute) {
    if (req.method !== "POST" || !token) return Object.assign(json({ ok: false, message: "Not allowed." }), { status: 405 });
    const boardId = (newRoute || moveRoute)[1];
    const b = (await read(BOARD_Q, [boardId]))[0];
    const team = new Set((await read(`SELECT email FROM mirror.team`)).map(r => r.email));
    if (!b || !canEdit(b, email, team)) return json({ ok: false, message: "This board cannot be edited here." });
    try {
      if (newRoute) {
        const note = await createItem(req, token, email, b, team);
        return json(note.ok && note.item ? { ok: true, message: note.message, html: await newRowHtml(b, note.item) } : { ok: note.ok, message: note.message });
      }
      const it = (await read(`SELECT id::text AS id, name, group_id, vals FROM mirror.items WHERE id = $1::bigint AND board_id = $2::bigint AND NOT deleted`, [moveRoute[2], b.id]))[0];
      if (!it) return json({ ok: false, message: "This item cannot be edited here." });
      const note = await moveItem(req, token, email, b, it, team);
      const now = (await read(`SELECT group_id FROM mirror.items WHERE id = $1::bigint`, [it.id]))[0];
      return json(Object.assign({}, note, { g: now ? now.group_id : it.group_id }));
    } catch (e) { console.error("add/move", e); return json({ ok: false, message: "Something went wrong. Check the board in monday before trying again." }); }
  }
  if (postRoute) {
    if (req.method !== "POST" || !token) return Object.assign(json({ ok: false, message: "Not allowed." }), { status: 405 });
    const [, boardId, itemId] = postRoute;
    const b = (await read(`SELECT id::text AS id, board_type, department, access, allowed_emails, gone, columns FROM mirror.boards WHERE id = $1::bigint`, [boardId]))[0];
    const it = b && (await read(`SELECT id::text AS id, name, vals FROM mirror.items WHERE id = $1::bigint AND board_id = $2::bigint AND NOT deleted`, [itemId, boardId]))[0];
    const team = new Set((await read(`SELECT email FROM mirror.team`)).map(r => r.email));
    if (!b || !it || !canEdit(b, email, team)) return json({ ok: false, message: "Updates cannot be posted on this item here." });
    let note;
    try { note = await postUpdate(req, token, email, b, it, team); }
    catch (e) { console.error("post update", e); note = { ok: false, message: "Something went wrong. Check the item in monday before posting again." }; }
    const { ups } = await itemUpdates(b, it, token, note.ok ? { fresh: true } : { copyOnly: true }); // monday is read again only after a real post
    return json(Object.assign({}, note, { html: updatesList(ups), count: ups.length }));
  }
  if (cellRoute) {
    if (req.method !== "POST" || !token) return json({ ok: false, message: "Not allowed." });
    const [, boardId, itemId] = cellRoute;
    const load = async () => {
      const b = (await read(`SELECT id::text AS id, board_type, department, access, allowed_emails, gone, columns FROM mirror.boards WHERE id = $1::bigint`, [boardId]))[0];
      const it = b && (await read(`SELECT id::text AS id, name, vals FROM mirror.items WHERE id = $1::bigint AND board_id = $2::bigint AND NOT deleted`, [itemId, boardId]))[0];
      return [b, it];
    };
    const team = new Set((await read(`SELECT email FROM mirror.team`)).map(r => r.email));
    const [b, it] = await load();
    if (!b || !it || !canEdit(b, email, team)) return json({ ok: false, message: "This item cannot be edited here." });
    let note;
    try { note = await saveCell(req, token, email, b, it, team); }
    catch (e) { note = { ok: false, message: "Something went wrong. Check the item in monday before trying again. " + String(e.message || e).slice(0, 160) }; }
    // Reply with the cell as it now stands in our copy (after a save, or the newer value after a conflict).
    const [, fresh] = await load();
    const colId = String((req.body && typeof req.body === "object" ? req.body.c : (() => { try { return JSON.parse(req.body).c; } catch (e) { return ""; } })()) || "");
    const col = editableColumns(b).find(c => c.id === colId);
    if (!fresh || !col) return json(note);
    const v = currentText(col, fresh);
    return json(Object.assign({}, note, { html: await cellHtml(b, col, fresh, true), f: fp(v), v }));
  }
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
  if ((m = route.match(BOARD))) return renderBoard(email, m[1], q, page, { secret: token });
  if (route === "data/mirror") return renderStatus(email);
  if ((m = route.match(DEPT))) return renderDepartment(email, m[1], q);
  return { status: 404, html: "Not found" };
}
