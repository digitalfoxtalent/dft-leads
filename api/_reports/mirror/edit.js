// Editing in the Ecosystem (pilot: Marketing and Website boards only). Started 22 Oct 2026.
//
// HOW IT STAYS SAFE WHILE MONDAY AND THE ECOSYSTEM RUN SIDE BY SIDE
//   An edit here is WRITTEN TO MONDAY FIRST (change_multiple_column_values), then the item is re-read from monday
//   and saved to our copy. monday stays the master, the two never disagree, and every Make scenario, automation
//   and report that reads monday sees the change exactly as if it had been made there.
//
// GUARDS
//   - Only signed-in teammates who can see the board (same rules as reading), only boards in EDIT_DEPTS, only
//     plain column types (EDITABLE). Formula, mirror, connect, people, file and subitem columns stay read-only.
//   - A form carries a fingerprint of each field as the editor saw it. If someone changed that field in monday
//     since, the edit is refused and the page shows the newer value instead of overwriting it.
//   - Posts must come from this site (Origin check, SameSite cookie) and carry a signed form token.
//   - At most 60 changes an hour per person.
//   - Every change is logged in mirror.edits: who, when, which field, old value and new value. Any change can be
//     undone from the item page, which writes the old value back to monday the same way.

import crypto from "node:crypto";
import { read, write } from "./db.js";
import { canSee } from "./policy.js";

export const EDIT_DEPTS = new Set(["marketing"]);
export const EDITABLE = new Set(["name", "text", "long_text", "numbers", "status", "date", "email", "link", "checkbox"]);
const ORIGIN = "https://ecosystem.digitalfoxtalent.com";
const API = "https://api.monday.com/v2";
const VERSION = "2025-04";
const PER_HOUR = 60;
const LIMITS = { name: 255, text: 2000, long_text: 20000, email: 200, link: 1000 };

let fetchImpl = (...a) => fetch(...a);
export function setFetch(f) { fetchImpl = f; }

export const EDIT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS mirror.edits (
     id bigserial PRIMARY KEY,
     at timestamptz NOT NULL DEFAULT now(),
     email text NOT NULL,
     board_id bigint NOT NULL,
     item_id bigint NOT NULL,
     column_id text NOT NULL,
     column_title text,
     old_text text,
     new_text text,
     ok boolean NOT NULL,
     error text,
     undo_of bigint,
     undone_by bigint
   )`,
  `CREATE INDEX IF NOT EXISTS edits_item ON mirror.edits (item_id, at DESC)`,
  `CREATE INDEX IF NOT EXISTS edits_email ON mirror.edits (email, at DESC)`,
];

const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const isId = v => /^\d{1,19}$/.test(String(v || ""));
const one = v => String(Array.isArray(v) ? v[0] : v == null ? "" : v);
export const fp = t => crypto.createHash("sha256").update(String(t == null ? "" : t)).digest("base64url").slice(0, 16);
const sign = (secret, v) => crypto.createHmac("sha256", String(secret) + "|eco-edit-v1").update(String(v)).digest("base64url").slice(0, 32);
const parse = s => { try { return typeof s === "string" ? JSON.parse(s) : s; } catch (e) { return null; } };

export function canEdit(board, email, team) {
  return !!board && board.board_type === "board" && EDIT_DEPTS.has(board.department) && canSee(board, email, team);
}
export const editableColumns = board => [{ id: "name", title: "Name", type: "name" }].concat((board.columns || []).filter(c => EDITABLE.has(c.type) && c.type !== "name"));
const statusLabels = col => Object.values(col.labels || {}).map(l => l && l[0]).filter(Boolean);

// What a field currently says, as plain text (what the editor sees and edits).
export function currentText(col, item) {
  if (col.type === "name") return item.name || "";
  const pair = item.vals && item.vals[col.id];
  if (!pair) return "";
  const [text, raw] = pair;
  if (col.type === "checkbox") { const v = parse(raw); return v && String(v.checked) === "true" ? "true" : ""; }
  if (col.type === "link") { const v = parse(raw); return (v && v.url) || text || ""; }
  if (col.type === "date") return String(text || "").slice(0, 10);
  return text == null ? "" : String(text);
}

// The monday value for a field, from what the editor typed. Throws a plain-English reason when it is not valid.
export function mondayValue(col, input) {
  const v = String(input == null ? "" : input).replace(/\r\n/g, "\n").replace(/\u0000/g, ""); // Postgres refuses null bytes
  const t = col.type === "long_text" ? v : v.trim();
  if (LIMITS[col.type] && t.length > LIMITS[col.type]) throw new Error(col.title + " is too long.");
  switch (col.type) {
    case "name": if (!t) throw new Error("The name cannot be empty."); return t;
    case "text": return t;
    case "long_text": return t ? { text: t } : {};
    case "numbers": if (t && !/^-?\d+(\.\d+)?$/.test(t.replace(/,/g, ""))) throw new Error(col.title + " must be a number."); return t.replace(/,/g, "");
    case "status": if (t && !statusLabels(col).includes(t)) throw new Error(col.title + ": choose one of the listed options."); return t ? { label: t } : {};
    case "date": if (t && !/^\d{4}-\d{2}-\d{2}$/.test(t)) throw new Error(col.title + " must be a date."); return t ? { date: t } : {};
    case "email": if (t && !/^[^\s@<>"]+@[^\s@<>"]+\.[A-Za-z]{2,}$/.test(t)) throw new Error(col.title + " must be an email address."); return t ? { email: t, text: t } : {};
    case "link": { if (!t) return {}; let u; try { u = new URL(t); } catch (e) { throw new Error(col.title + " must be a web address starting https://"); }
      if (!/^https?:$/.test(u.protocol)) throw new Error(col.title + " must be a web address starting https://"); return { url: u.href, text: t }; }
    case "checkbox": return t === "true" ? { checked: "true" } : null;
    default: throw new Error(col.title + " cannot be edited here.");
  }
}
const same = (col, a, b) => col.type === "numbers" ? (a === "" && b === "") || (a !== "" && b !== "" && Number(String(a).replace(/,/g, "")) === Number(String(b).replace(/,/g, ""))) : String(a) === String(b);

async function monday(token, query, variables) {
  const r = await fetchImpl(API, { method: "POST", headers: { "Content-Type": "application/json", Authorization: token, "API-Version": VERSION }, body: JSON.stringify({ query, variables }) });
  const d = await r.json();
  if (!r.ok || d.errors || d.error_message) throw new Error("monday: " + JSON.stringify(d.errors || d.error_message || r.status).slice(0, 300));
  return d.data;
}
const ITEM_Q = `query ($i: [ID!]) { items (ids: $i) { id name created_at updated_at state group { id } parent_item { id } creator { name } board { id }
  column_values { id type text value ... on MirrorValue { display_value } ... on BoardRelationValue { display_value } ... on FormulaValue { display_value } } } }`;
async function liveItem(token, itemId) {
  const it = ((await monday(token, ITEM_Q, { i: [String(itemId)] })).items || [])[0];
  if (!it || it.state === "deleted") return null;
  const vals = {};
  for (const v of it.column_values || []) {
    const text = v.display_value != null ? v.display_value : v.text;
    if ((text == null || text === "") && v.value == null) continue;
    vals[v.id] = [text, v.value];
  }
  return { id: String(it.id), board_id: String(it.board && it.board.id), name: it.name, vals, group_id: it.group && it.group.id, updated_at: it.updated_at };
}
async function saveLive(live) {
  await write(`UPDATE mirror.items SET name = $2, vals = $3::jsonb, group_id = COALESCE($4, group_id), updated_at = $5::timestamptz, synced_at = now() WHERE id = $1::bigint`,
    [live.id, live.name, JSON.stringify(live.vals), live.group_id || null, live.updated_at || null]);
}

// ---------- the form ----------

export function formToken(secret, email, itemId) { return sign(secret, email + "|" + itemId); }
export function boardToken(secret, email, boardId) { return sign(secret, email + "|board|" + boardId); }

export function editForm(board, item, email, secret, note) {
  const cols = editableColumns(board);
  const field = c => {
    const cur = currentText(c, item), name = "f_" + c.id, base = `<input type="hidden" name="b_${esc(c.id)}" value="${esc(fp(cur))}">`;
    let input;
    if (c.type === "long_text") input = `<textarea name="${esc(name)}" rows="5" maxlength="${LIMITS.long_text}">${esc(cur)}</textarea>`;
    else if (c.type === "status") input = `<select name="${esc(name)}"><option value=""${cur ? "" : " selected"}>(empty)</option>${statusLabels(c).map(l => `<option value="${esc(l)}"${l === cur ? " selected" : ""}>${esc(l)}</option>`).join("")}${cur && !statusLabels(c).includes(cur) ? `<option value="${esc(cur)}" selected>${esc(cur)}</option>` : ""}</select>`;
    else if (c.type === "checkbox") input = `<select name="${esc(name)}"><option value=""${cur ? "" : " selected"}>No</option><option value="true"${cur ? " selected" : ""}>Yes</option></select>`;
    else input = `<input name="${esc(name)}" value="${esc(cur)}" type="${c.type === "date" ? "date" : c.type === "numbers" ? "text\" inputmode=\"decimal" : c.type === "email" ? "email" : c.type === "link" ? "url" : "text"}"${LIMITS[c.type] ? ` maxlength="${LIMITS[c.type]}"` : ""}>`;
    return `<label><span>${esc(c.title)}</span>${input}${base}</label>`;
  };
  return `<form class="edit" method="post" action="/boards/${esc(board.id)}/items/${esc(item.id)}/edit">
<input type="hidden" name="t" value="${esc(formToken(secret, email, item.id))}">
${note || ""}
<div class="fields">${cols.map(field).join("")}</div>
<div class="acts"><button class="btn fox" type="submit">Save to monday</button><span class="muted sm">Saves straight to monday, then shows here. Every change is logged and can be undone.</span></div>
</form>`;
}

export async function historyHtml(board, item, email, secret) {
  const rows = await read(`SELECT id::text AS id, at, email, column_title, old_text, new_text, ok, error, undo_of::text AS undo_of, undone_by::text AS undone_by
    FROM mirror.edits WHERE item_id = $1::bigint AND board_id = $2::bigint ORDER BY at DESC LIMIT 25`, [item.id, board.id]);
  if (!rows.length) return `<p class="muted">No edits made in the Ecosystem yet.</p>`;
  const tok = formToken(secret, email, item.id);
  const clip = s => esc(String(s == null || s === "" ? "(empty)" : s).slice(0, 140));
  return `<div class="tw"><table><thead><tr><th>When</th><th>Who</th><th>Field</th><th>From</th><th>To</th><th></th></tr></thead><tbody>${rows.map(r => `<tr>
<td>${esc(new Date(r.at).toISOString().slice(0, 16).replace("T", " "))} UTC</td><td>${esc(r.email)}</td><td>${esc(r.column_title)}${r.undo_of ? " (undo)" : ""}</td>
<td>${clip(r.old_text)}</td><td>${r.ok ? clip(r.new_text) : `<span class="bad">Not saved: ${esc(r.error || "")}</span>`}</td>
<td>${r.ok && !r.undone_by && !r.undo_of ? `<form method="post" action="/boards/${esc(board.id)}/items/${esc(item.id)}/undo"><input type="hidden" name="t" value="${esc(tok)}"><input type="hidden" name="e" value="${esc(r.id)}"><button class="btn sm" type="submit">Undo</button></form>` : r.undone_by ? `<span class="muted sm">Undone</span>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
}

// ---------- saving ----------

function formBody(req) {
  if (typeof req.body === "string") return Object.fromEntries(new URLSearchParams(req.body));
  return req.body && typeof req.body === "object" ? req.body : {};
}
const fromSite = req => { const o = String(req.headers.origin || ""); return o === ORIGIN || (!o && /^https:\/\/ecosystem\.digitalfoxtalent\.com\//.test(String(req.headers.referer || ""))); };

async function guard(req, email, secret, board, item, team) {
  if (req.method !== "POST") return "Use the form on the item page.";
  if (!fromSite(req)) return "That request did not come from the Ecosystem.";
  if (!canEdit(board, email, team)) return "This board cannot be edited here yet.";
  const b = formBody(req), tok = one(b.t), want = formToken(secret, email, item.id);
  if (tok.length !== want.length || !crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(want))) return "That form has expired. Open the item again.";
  const n = (await read(`SELECT count(*)::int AS n FROM mirror.edits WHERE email = $1 AND at > now() - interval '1 hour'`, [email]))[0].n;
  if (n >= PER_HOUR) return "Too many changes in the last hour. Please wait a little.";
  return null;
}

async function logEdits(rows) {
  for (const r of rows) await write(`INSERT INTO mirror.edits (email, board_id, item_id, column_id, column_title, old_text, new_text, ok, error, undo_of)
    VALUES ($1, $2::bigint, $3::bigint, $4, $5, $6, $7, $8, $9, $10::bigint)`,
    [r.email, r.board_id, r.item_id, r.column_id, r.column_title, r.old_text, r.new_text, r.ok, r.error || null, r.undo_of || null]);
}

// Apply a set of { col, from, to } changes: check monday has not moved on, write, log, then refresh our copy.
// The log is written as soon as monday has the change, so a later failure can never leave an unlogged edit.
async function apply(token, board, item, email, changes, undoOf) {
  const base = { email, board_id: board.id, item_id: item.id, undo_of: undoOf || null };
  const n = (await read(`SELECT count(*)::int AS n FROM mirror.edits WHERE email = $1 AND at > now() - interval '1 hour'`, [email]))[0].n;
  if (n + changes.length > PER_HOUR) return { ok: false, message: "Too many changes in the last hour. Please wait a little." };
  const live = await liveItem(token, item.id);
  if (!live || live.board_id !== String(board.id)) return { ok: false, message: "This item is no longer on this board in monday." };
  const moved = changes.filter(c => !same(c.col, currentText(c.col, live), c.from));
  if (moved.length) {
    await logEdits(moved.map(c => Object.assign({ column_id: c.col.id, column_title: c.col.title, old_text: currentText(c.col, live), new_text: c.to, ok: false, error: "changed in monday first; not overwritten" }, base)));
    await saveLive(live).catch(() => {});
    return { ok: false, message: "Someone changed " + moved.map(c => c.col.title).join(", ") + " in monday since you opened this item. The page now shows the latest values; make your change again if it is still needed." };
  }
  const values = {};
  for (const c of changes) values[c.col.id] = mondayValue(c.col, c.to);
  let err = null;
  try {
    await monday(token, `mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values (board_id: $b, item_id: $i, column_values: $v) { id } }`,
      { b: String(board.id), i: String(item.id), v: JSON.stringify(values) });
  } catch (e) { err = String(e.message || e).slice(0, 300); }
  const after = await liveItem(token, item.id).catch(() => null);
  // A timeout or odd reply can arrive after monday applied the change: trust what monday now holds.
  const landed = c => after && same(c.col, currentText(c.col, after), mondayText(c.col, c.to));
  const done = err ? changes.filter(landed) : changes;
  const failed = err ? changes.filter(c => !landed(c)) : [];
  await logEdits(done.map(c => Object.assign({ column_id: c.col.id, column_title: c.col.title, old_text: c.from, new_text: after ? currentText(c.col, after) : c.to, ok: true }, base))
    .concat(failed.map(c => Object.assign({ column_id: c.col.id, column_title: c.col.title, old_text: c.from, new_text: c.to, ok: false, error: err }, base))));
  if (after) await saveLive(after).catch(() => {});
  if (failed.length) return { ok: false, message: "monday did not accept " + failed.map(c => c.col.title).join(", ") + (done.length ? " (the other fields were saved)" : "") + ": " + String(err).slice(0, 200) };
  return { ok: true, message: "Saved to monday: " + changes.map(c => c.col.title).join(", ") + "." };
}
// What a field should read once monday has the new value (for checking a write landed).
const mondayText = (col, to) => col.type === "checkbox" ? (to === "true" ? "true" : "") : String(to == null ? "" : to).replace(/\u0000/g, "");

export async function saveEdit(req, token, email, board, item, team) {
  const bad = await guard(req, email, token, board, item, team);
  if (bad) return { ok: false, message: bad };
  const b = formBody(req), changes = [];
  try {
    for (const col of editableColumns(board)) {
      const key = "f_" + col.id;
      if (!(key in b)) continue;
      const from = currentText(col, item);
      if (one(b["b_" + col.id]) !== fp(from)) return { ok: false, message: "This item changed since you opened it. Please check the latest values and try again." };
      const to = col.type === "long_text" ? one(b[key]).replace(/\r\n/g, "\n") : one(b[key]).trim();
      if (same(col, from, to)) continue;
      mondayValue(col, to); // validate before anything is written
      changes.push({ col, from, to });
    }
  } catch (e) { return { ok: false, message: String(e.message || e) }; }
  if (!changes.length) return { ok: true, message: "Nothing changed." };
  return apply(token, board, item, email, changes, null);
}

export async function undoEdit(req, token, email, board, item, team) {
  const bad = await guard(req, email, token, board, item, team);
  if (bad) return { ok: false, message: bad };
  const id = one(formBody(req).e);
  if (!isId(id)) return { ok: false, message: "Unknown change." };
  const e = (await read(`SELECT id::text AS id, column_id, old_text, new_text, ok, undo_of, undone_by FROM mirror.edits WHERE id = $1::bigint AND item_id = $2::bigint AND board_id = $3::bigint`, [id, item.id, board.id]))[0];
  if (!e || !e.ok || e.undo_of || e.undone_by) return { ok: false, message: "That change cannot be undone." };
  const col = editableColumns(board).find(c => c.id === e.column_id);
  if (!col) return { ok: false, message: "That field can no longer be edited here." };
  const r = await apply(token, board, item, email, [{ col, from: e.new_text == null ? "" : e.new_text, to: e.old_text == null ? "" : e.old_text }], e.id);
  if (r.ok) await write(`UPDATE mirror.edits SET undone_by = (SELECT max(id) FROM mirror.edits WHERE undo_of = $1::bigint) WHERE id = $1::bigint`, [e.id]);
  return r.ok ? { ok: true, message: "Undone: " + col.title + " is back to its previous value in monday." } : r;
}

// ---------- one cell, from the board's click-to-edit (client.js) ----------

function jsonBody(req) {
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return req.body && typeof req.body === "object" ? req.body : {};
}

export async function saveCell(req, token, email, board, item, team) {
  if (req.method !== "POST") return { ok: false, message: "Not allowed." };
  if (!fromSite(req)) return { ok: false, message: "That request did not come from the Ecosystem." };
  if (!canEdit(board, email, team)) return { ok: false, message: "This board cannot be edited here yet." };
  const b = jsonBody(req), tok = one(b.k), want = boardToken(token, email, board.id);
  if (tok.length !== want.length || !crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(want))) return { ok: false, message: "This page has expired. Refresh it and try again." };
  const col = editableColumns(board).find(c => c.id === one(b.c));
  if (!col) return { ok: false, message: "This field cannot be edited here." };
  const from = currentText(col, item);
  if (one(b.f) !== fp(from)) return { ok: false, message: "This changed since the board loaded. It now shows the latest value; make your change again if it is still needed." };
  const raw = typeof b.v === "string" ? b.v : "";
  const to = col.type === "long_text" ? raw.replace(/\r\n/g, "\n") : raw.trim();
  if (same(col, from, to)) return { ok: true, message: "No change." };
  try { mondayValue(col, to); } catch (e) { return { ok: false, message: String(e.message || e) }; }
  return apply(token, board, item, email, [{ col, from, to }], null);
}
