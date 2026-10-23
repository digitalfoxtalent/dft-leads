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
  // Updates posted from the Ecosystem: monday shows them under the account that owns the API token, so we
  // keep who really wrote each one (posted_by, which the sync never overwrites) and log every post.
  `ALTER TABLE mirror.updates ADD COLUMN IF NOT EXISTS posted_by text`,
  `CREATE TABLE IF NOT EXISTS mirror.posts (
     id bigserial PRIMARY KEY,
     at timestamptz NOT NULL DEFAULT now(),
     email text NOT NULL,
     board_id bigint NOT NULL,
     item_id bigint NOT NULL,
     update_id bigint,
     name text,                                        -- the author's name as it went into monday
     ok boolean NOT NULL,
     error text
   )`,
  `CREATE INDEX IF NOT EXISTS posts_email ON mirror.posts (email, at DESC)`,
  `CREATE INDEX IF NOT EXISTS posts_update ON mirror.posts (update_id) WHERE update_id IS NOT NULL`,
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

async function monday(token, query, variables, ms) {
  const r = await fetchImpl(API, { method: "POST", headers: { "Content-Type": "application/json", Authorization: token, "API-Version": VERSION }, body: JSON.stringify({ query, variables }),
    signal: ms ? AbortSignal.timeout(ms) : undefined });
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
  const rows = await read(`SELECT id::text AS id, at, email, column_id, column_title, old_text, new_text, ok, error, undo_of::text AS undo_of, undone_by::text AS undone_by
    FROM mirror.edits WHERE item_id = $1::bigint AND board_id = $2::bigint ORDER BY at DESC LIMIT 25`, [item.id, board.id]);
  if (!rows.length) return `<p class="muted">No edits made in the Ecosystem yet.</p>`;
  const tok = formToken(secret, email, item.id);
  const clip = s => esc(String(s == null || s === "" ? "(empty)" : s).slice(0, 140));
  return `<div class="tw"><table><thead><tr><th>When</th><th>Who</th><th>Field</th><th>From</th><th>To</th><th></th></tr></thead><tbody>${rows.map(r => `<tr>
<td>${esc(new Date(r.at).toISOString().slice(0, 16).replace("T", " "))} UTC</td><td>${esc(r.email)}</td><td>${esc(r.column_title)}${r.undo_of ? " (undo)" : ""}</td>
<td>${clip(r.old_text)}</td><td>${r.ok ? clip(r.new_text) : `<span class="bad">Not saved: ${esc(r.error || "")}</span>`}</td>
<td>${r.ok && !r.undone_by && !r.undo_of && !String(r.column_id).startsWith("_") ? `<form method="post" action="/boards/${esc(board.id)}/items/${esc(item.id)}/undo"><input type="hidden" name="t" value="${esc(tok)}"><input type="hidden" name="e" value="${esc(r.id)}"><button class="btn sm" type="submit">Undo</button></form>` : r.undone_by ? `<span class="muted sm">Undone</span>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
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
  if (!e || !e.ok || e.undo_of || e.undone_by || String(e.column_id).startsWith("_")) return { ok: false, message: "That change cannot be undone." };
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

// ---------- updates: read live for the side panel, and post one ----------

const POSTS_PER_HOUR = 30;
const UPDATE_MAX = 5000;
const LIVE_TTL = 60000; // one monday read per item per minute per server instance, so panels never eat the sync's budget
const UPD_Q = `query ($i: [ID!]) { items (ids: $i) { id state board { id } updates (limit: 25) { id text_body created_at creator { name }
  replies { id text_body created_at creator { name } } } } }`;
const liveCache = new Map();
const clean = v => String(v == null ? "" : v).replace(/\u0000/g, "");

// Who really wrote each update posted from the Ecosystem, from our post log (survives the sync trimming updates).
export async function authors(ids) {
  if (!ids.length) return {};
  return Object.fromEntries((await read(`SELECT p.update_id::text AS id, COALESCE(p.name, t.name, p.email) AS name FROM mirror.posts p
    LEFT JOIN mirror.team t ON t.email = p.email WHERE p.ok AND p.update_id = ANY($1::bigint[])`, [ids])).map(r => [r.id, r.name]));
}

async function fetchLive(token, itemId, ms) {
  const it = ((await monday(token, UPD_Q, { i: [String(itemId)] }, ms)).items || [])[0];
  if (!it || it.state === "deleted") return null;
  const one = u => ({ id: String(u.id), body: clean(u.text_body), creator: clean(u.creator && u.creator.name), created_at: u.created_at });
  return { board_id: String(it.board && it.board.id), ups: (it.updates || []).map(u => Object.assign(one(u), { replies: (u.replies || []).map(one) })) };
}

// The item's latest updates straight from monday (so the panel is never 30 minutes behind), saved to our copy.
// Returns null if monday is slow or unreachable; the panel then shows our copy instead.
export async function liveUpdates(token, board, item, fresh) {
  const key = String(item.id), hit = liveCache.get(key);
  let got = !fresh && hit && Date.now() - hit.at < LIVE_TTL ? hit.got : null;
  if (!got) {
    try { got = await fetchLive(token, item.id, 3000); } catch (e) { return null; }
    if (!got) return null;
    liveCache.set(key, { at: Date.now(), got });
    if (liveCache.size > 500) liveCache.delete(liveCache.keys().next().value);
    if (got.board_id === String(board.id) && got.ups.length) await write(`INSERT INTO mirror.updates (id, item_id, body, creator, created_at)
      SELECT (u->>'id')::bigint, $1::bigint, u->>'body', u->>'creator', (u->>'created_at')::timestamptz FROM jsonb_array_elements($2::jsonb) u
      ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, creator = EXCLUDED.creator`, [item.id, JSON.stringify(got.ups)]).catch(() => {});
  }
  if (got.board_id !== String(board.id)) return null;
  const by = await authors(got.ups.map(u => u.id));
  return got.ups.map(u => (by[u.id] ? Object.assign({}, u, { posted_by: by[u.id] }) : u));
}

const htmlText = v => String(v).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]); // monday shows &#39; literally
const prefix = name => `${name} via the Ecosystem`;
const updateHtml = (name, text) => `<p><strong>${htmlText(name)}</strong> via the Ecosystem</p><p>${htmlText(text).replace(/\n/g, "<br>")}</p>`;
const NOT_TAKEN = "monday did not confirm the update. Check the item in monday before posting again.";

export async function postUpdate(req, token, email, board, item, team) {
  if (req.method !== "POST") return { ok: false, message: "Not allowed." };
  if (!fromSite(req)) return { ok: false, message: "That request did not come from the Ecosystem." };
  if (!canEdit(board, email, team)) return { ok: false, message: "Updates cannot be posted on this board here yet." };
  const b = jsonBody(req), tok = one(b.k), want = boardToken(token, email, board.id);
  if (tok.length !== want.length || !crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(want))) return { ok: false, message: "This page has expired. Refresh it and try again." };
  const text = clean(typeof b.t === "string" ? b.t : "").replace(/\r\n/g, "\n").trim();
  if (!text) return { ok: false, message: "Write something first." };
  if (text.length > UPDATE_MAX) return { ok: false, message: "That update is too long (5,000 characters at most)." };
  const n = (await read(`SELECT count(*)::int AS n FROM mirror.posts WHERE email = $1 AND at > now() - interval '1 hour'`, [email]))[0].n;
  if (n >= POSTS_PER_HOUR) return { ok: false, message: "Too many updates in the last hour. Please wait a little." };
  // monday is the master: the item must still be on this board there (our copy can be half an hour behind).
  let before;
  try { before = await fetchLive(token, item.id, 5000); } catch (e) { return { ok: false, message: "Could not reach monday. Nothing was posted; try again in a moment." }; }
  if (!before || before.board_id !== String(board.id)) return { ok: false, message: "This item is no longer on this board in monday. Nothing was posted." };
  const name = clean(((await read(`SELECT name FROM mirror.team WHERE email = $1`, [email]))[0] || {}).name || email).slice(0, 200);
  // Logged before monday is called, so even a request cut off mid-way leaves a record.
  const logId = (await write(`INSERT INTO mirror.posts (email, board_id, item_id, name, ok, error) VALUES ($1, $2::bigint, $3::bigint, $4, false, 'pending') RETURNING id::text AS id`,
    [email, board.id, item.id, name]))[0].id;
  let u = null, err = null;
  try {
    u = (await monday(token, `mutation ($i: ID!, $b: String!) { create_update (item_id: $i, body: $b) { id created_at } }`,
      { i: String(item.id), b: updateHtml(name, text) }, 15000)).create_update;
  } catch (e) { err = String(e.message || e).slice(0, 300); }
  if (!u || !isId(u.id)) {
    // A timeout can arrive after monday saved it: look for it before telling anyone to post again.
    const seen = new Set(before.ups.map(x => x.id)), head = prefix(name), start = text.slice(0, 60).replace(/\s+/g, " ");
    const after = await fetchLive(token, item.id, 5000).catch(() => null);
    const found = after && after.ups.find(x => !seen.has(x.id) && x.body.replace(/\s+/g, " ").startsWith(head) && x.body.replace(/\s+/g, " ").includes(start));
    if (found) u = { id: found.id, created_at: found.created_at };
    else { await write(`UPDATE mirror.posts SET error = $2 WHERE id = $1::bigint`, [logId, err || "no update id returned"]); return { ok: false, message: NOT_TAKEN }; }
  }
  await write(`UPDATE mirror.posts SET ok = true, error = NULL, update_id = $2::bigint WHERE id = $1::bigint`, [logId, u.id]);
  await write(`INSERT INTO mirror.updates (id, item_id, body, creator, created_at, posted_by) VALUES ($1::bigint, $2::bigint, $3, $4, COALESCE($5::timestamptz, now()), $4)
    ON CONFLICT (id) DO UPDATE SET posted_by = EXCLUDED.posted_by`, [u.id, item.id, text, name, u.created_at || null]).catch(() => {});
  liveCache.delete(String(item.id));
  return { ok: true, message: "Update posted to monday." };
}

// ---------- add an item, move an item to another group (board click-to-edit and side panel) ----------
// Logged in mirror.edits like any edit (column "_create" or "_group"), so they count towards the hourly limit and
// show in the item's change log. Neither has an Undo button: an added item is archived in monday, a move is
// reversed by moving it back.

const groupOf = (board, g) => (board.groups || []).find(x => x.id === g) || null;

async function boardGuard(req, token, email, board, team) {
  if (req.method !== "POST") return "Not allowed.";
  if (!fromSite(req)) return "That request did not come from the Ecosystem.";
  if (!canEdit(board, email, team)) return "This board cannot be edited here yet.";
  const b = jsonBody(req), tok = one(b.k), want = boardToken(token, email, board.id);
  if (tok.length !== want.length || !crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(want))) return "This page has expired. Refresh it and try again.";
  const n = (await read(`SELECT count(*)::int AS n FROM mirror.edits WHERE email = $1 AND at > now() - interval '1 hour'`, [email]))[0].n;
  if (n >= PER_HOUR) return "Too many changes in the last hour. Please wait a little.";
  return null;
}
async function insertLive(live, board) {
  const pos = ((await read(`SELECT COALESCE(max(pos), 0)::int + 1 AS p FROM mirror.items WHERE board_id = $1::bigint`, [board.id]))[0] || {}).p || 1;
  await write(`INSERT INTO mirror.items (id, board_id, group_id, name, vals, created_at, updated_at, pos) VALUES ($1::bigint, $2::bigint, $3, $4, $5::jsonb, now(), $6::timestamptz, $7)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, vals = EXCLUDED.vals, group_id = EXCLUDED.group_id, deleted = false, synced_at = now()`,
    [live.id, board.id, live.group_id || null, live.name, JSON.stringify(live.vals), live.updated_at || null, pos]);
}

// Returns { ok, message, item } where item is our copy of the new row (for the board to draw it).
export async function createItem(req, token, email, board, team) {
  const bad = await boardGuard(req, token, email, board, team);
  if (bad) return { ok: false, message: bad };
  const b = jsonBody(req), g = groupOf(board, one(b.g));
  if (!g) return { ok: false, message: "That group is not on this board." };
  let name;
  try { name = mondayValue({ id: "name", title: "Name", type: "name" }, b.name); } catch (e) { return { ok: false, message: String(e.message || e) }; }
  const base = { email, board_id: board.id, column_id: "_create", column_title: "Item added", old_text: null, new_text: name };
  const LOOK = `query ($b: ID!, $n: String!) { items_page_by_column_values (board_id: $b, limit: 25, columns: [{ column_id: "name", column_values: [$n] }]) { items { id created_at group { id } } } }`;
  const same = async () => ((await monday(token, LOOK, { b: String(board.id), n: name }, 5000)).items_page_by_column_values || {}).items || [];
  // Items with this name that already exist, so a lost reply can only ever be matched to the item this call made.
  let existing;
  try { existing = new Set((await same()).map(x => String(x.id))); } catch (e) { return { ok: false, message: "Could not reach monday. Nothing was added; try again in a moment." }; }
  let id = null, err = null;
  try {
    const d = await monday(token, `mutation ($b: ID!, $g: String!, $n: String!) { create_item (board_id: $b, group_id: $g, item_name: $n) { id } }`,
      { b: String(board.id), g: g.id, n: name }, 15000);
    id = d.create_item && d.create_item.id;
  } catch (e) { err = String(e.message || e).slice(0, 300); }
  if (!isId(id) && err && !/^monday:/.test(err)) {
    // The connection dropped or timed out (not a refusal from monday): it may have made the item anyway. Only an
    // item that was not there before this call, in this group, made in the last two minutes, counts.
    try {
      const known = new Set((await read(`SELECT id::text AS id FROM mirror.items WHERE board_id = $1::bigint AND name = $2`, [board.id, name])).map(r => r.id));
      const hit = (await same()).find(x => !existing.has(String(x.id)) && !known.has(String(x.id)) && x.group && x.group.id === g.id && Date.now() - Date.parse(x.created_at) < 120000);
      if (hit) id = hit.id;
    } catch (e) { /* fall through */ }
  }
  if (!isId(id)) {
    await logEdits([Object.assign({ item_id: 0, ok: false, error: err || "no item id returned" }, base)]);
    return { ok: false, message: "monday did not confirm the new item. Check the board in monday before adding it again." };
  }
  await logEdits([Object.assign({ item_id: id, ok: true }, base)]);
  try { // monday has it now: whatever happens to our copy, report it as added so nobody adds it twice
    const live = await liveItem(token, id).catch(() => null);
    await insertLive(live || { id: String(id), name, vals: {}, group_id: g.id }, board);
    const item = (await read(`SELECT id::text AS id, name, group_id, vals FROM mirror.items WHERE id = $1::bigint`, [id]))[0];
    return { ok: true, message: "Added to monday: " + name + ".", item };
  } catch (e) { console.error("create copy", e); return { ok: true, message: "Added to monday: " + name + ". Refresh to see it here." }; }
}

export async function moveItem(req, token, email, board, item, team) {
  const bad = await boardGuard(req, token, email, board, team);
  if (bad) return { ok: false, message: bad };
  const b = jsonBody(req), to = groupOf(board, one(b.g));
  if (!to) return { ok: false, message: "That group is not on this board." };
  const live = await liveItem(token, item.id).catch(() => null);
  if (!live || live.board_id !== String(board.id)) return { ok: false, message: "This item is no longer on this board in monday." };
  if (live.group_id !== one(b.f)) { await saveLive(live).catch(() => {}); return { ok: false, message: "Someone moved this item in monday since the page loaded. Refresh to see where it is now." }; }
  if (live.group_id === to.id) return { ok: true, message: "Already in " + to.title + "." };
  const from = groupOf(board, live.group_id);
  const base = { email, board_id: board.id, item_id: item.id, column_id: "_group", column_title: "Group", old_text: from ? from.title : live.group_id, new_text: to.title };
  let err = null;
  try { await monday(token, `mutation ($i: ID!, $g: String!) { move_item_to_group (item_id: $i, group_id: $g) { id } }`, { i: String(item.id), g: to.id }, 15000); }
  catch (e) { err = String(e.message || e).slice(0, 300); }
  const after = await liveItem(token, item.id).catch(() => null);
  const landed = after && after.group_id === to.id;
  await logEdits([Object.assign({ ok: !!landed, error: landed ? null : (err || "not moved") }, base)]);
  if (after) await saveLive(after).catch(() => {});
  return landed ? { ok: true, message: "Moved to " + to.title + "." } : { ok: false, message: "monday did not move the item. Check it in monday before trying again." };
}
