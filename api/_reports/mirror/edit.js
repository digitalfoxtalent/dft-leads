// Editing in the Ecosystem (pilot: Marketing and Website boards only). Started 22 Oct 2026.
//
// HOW IT STAYS SAFE WHILE MONDAY AND THE ECOSYSTEM RUN SIDE BY SIDE
//   An edit here is WRITTEN TO MONDAY FIRST (change_multiple_column_values), then the item is re-read from monday
//   and saved to our copy. monday stays the master, the two never disagree, and every Make scenario, automation
//   and report that reads monday sees the change exactly as if it had been made there.
//
// GUARDS
//   - Only signed-in teammates who can see the board (same rules as reading), only sections whose editing switch is
//     on (switch.js, re-read before every write), only
//     plain column types (EDITABLE: text, numbers, status, dates, people, dropdowns and so on). Formula, mirror,
//     connect and file columns stay read-only.
//   - A form carries a fingerprint of each field as the editor saw it. If someone changed that field in monday
//     since, the edit is refused and the page shows the newer value instead of overwriting it.
//   - Posts must come from this site (Origin check, SameSite cookie) and carry a signed form token.
//   - At most 60 changes an hour per person.
//   - Every change is logged in mirror.edits: who, when, which field, old value and new value. Any change can be
//     undone from the item page, which writes the old value back to monday the same way.

import crypto from "node:crypto";
import { read, write } from "./db.js";
import { canSee, editLocked } from "./policy.js";
import { isOn, loadSwitches } from "./switch.js";

export const EDITABLE = new Set(["name", "text", "long_text", "numbers", "status", "date", "email", "link", "checkbox", "people", "dropdown", "timeline", "rating"]);
const MULTI = new Set(["people", "dropdown"]); // several values, written as "A, B"; order does not matter
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
  return !!board && board.board_type === "board" && isOn(board.department) && !editLocked(board) && canSee(board, email, team);
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
  if (col.type === "timeline") { const v = parse(raw); return v && v.from && v.to ? String(v.from).slice(0, 10) + " - " + String(v.to).slice(0, 10) : String(text || ""); }
  if (MULTI.has(col.type)) return splitList(text).join(", ");
  return text == null ? "" : String(text);
}
const splitList = t => String(t == null ? "" : t).split(",").map(x => x.trim()).filter(Boolean);

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
    case "dropdown": {
      const want = splitList(t), known = new Set(col.options || []);
      if (known.size) { const bad = want.filter(x => !known.has(x)); if (bad.length) throw new Error(col.title + ": choose from the listed options (" + bad[0] + " is not one)."); }
      return want.length ? { labels: want } : {};
    }
    case "timeline": {
      if (!t) return {};
      const m = t.match(/^(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})$/);
      if (!m || m[1] > m[2]) throw new Error(col.title + " needs a start and end date, start first.");
      return { from: m[1], to: m[2] };
    }
    case "rating": {
      if (!t || t === "0") return {};
      const n = Number(t), max = col.max || 5;
      if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(col.title + " must be a whole number from 1 to " + max + ".");
      return { rating: n };
    }
    case "people": throw new Error("people values are resolved by peopleValue"); // async: needs monday user ids
    default: throw new Error(col.title + " cannot be edited here.");
  }
}
const uniq = t => [...new Set(splitList(t).map(x => x.toLowerCase()))].sort();
const same = (col, a, b) => MULTI.has(col.type) ? JSON.stringify(uniq(a)) === JSON.stringify(uniq(b)) : col.type === "rating" ? String(a || "0") === String(b || "0") : col.type === "numbers" ? (a === "" && b === "") || (a !== "" && b !== "" && Number(String(a).replace(/,/g, "")) === Number(String(b).replace(/,/g, ""))) : String(a) === String(b);

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
  const it = ((await monday(token, ITEM_Q, { i: [String(itemId)] }, 8000)).items || [])[0];
  if (!it || it.state === "deleted") return null;
  const vals = {};
  for (const v of it.column_values || []) {
    const text = v.display_value != null ? v.display_value : v.text;
    if ((text == null || text === "") && v.value == null) continue;
    vals[v.id] = [text, v.value];
  }
  return { id: String(it.id), board_id: String(it.board && it.board.id), parent_id: it.parent_item ? String(it.parent_item.id) : null, name: it.name, vals, group_id: it.group && it.group.id, updated_at: it.updated_at };
}
async function saveLive(live) {
  await write(`UPDATE mirror.items SET name = $2, vals = $3::jsonb, group_id = COALESCE($4, group_id), updated_at = $5::timestamptz, synced_at = now() WHERE id = $1::bigint`,
    [live.id, live.name, JSON.stringify(live.vals), live.group_id || null, live.updated_at || null]);
}

// People columns: names (as shown in monday) to monday user ids. Our team copy first, then monday itself, so a
// guest or a renamed person still resolves; anyone monday does not know is refused rather than dropped.
let peopleCache = { at: 0, map: null };
async function peopleIds(token, names) {
  // name -> every { id, kind } with that name, so a name shared by two people is refused rather than guessed
  const map = new Map();
  const add = (n, v) => { const k = String(n).toLowerCase(); const l = map.get(k) || []; if (!l.some(x => x.id === v.id && x.kind === v.kind)) l.push(v); map.set(k, l); };
  for (const r of await read(`SELECT name, monday_id::text AS id FROM mirror.team WHERE monday_id IS NOT NULL AND name IS NOT NULL`)) add(r.name, { id: r.id, kind: "person" });
  if (names.some(n => !map.has(n.toLowerCase()))) {
    if (!peopleCache.map || Date.now() - peopleCache.at > 600000) {
      const d = await monday(token, `query { users (limit: 1000) { id name enabled } teams { id name } }`, {}, 8000);
      peopleCache = { at: Date.now(), map: [...(d.users || []).filter(u => u.enabled !== false && u.name).map(u => [u.name, { id: String(u.id), kind: "person" }]),
        ...(d.teams || []).filter(t => t.name).map(t => [t.name, { id: String(t.id), kind: "team" }])] };
    }
    for (const [n, v] of peopleCache.map) if (!map.has(String(n).toLowerCase()) || map.get(String(n).toLowerCase())[0].kind === v.kind) add(n, v);
  }
  return names.map(n => {
    const l = map.get(n.toLowerCase());
    if (!l) throw new Error(n + " is not a monday user. Pick people from the list.");
    if (l.length > 1) throw new Error("There is more than one " + n + " in monday. Change this one in monday.");
    return l[0];
  });
}
// People already in the cell keep their monday ids (so namesakes, guests and people who have left are never lost
// or swapped); only names being added are looked up.
async function peopleValue(token, col, input, live) {
  const names = [...new Map(splitList(input).map(n => [n.toLowerCase(), n])).values()];
  const raw = live ? parse((live.vals[col.id] || [])[1]) : null;
  const have = (raw && Array.isArray(raw.personsAndTeams)) ? raw.personsAndTeams : [];
  const haveNames = live ? splitList(currentText(col, live)) : [];
  if (have.length !== haveNames.length) throw new Error(col.title + ": monday lists these people in a way the Ecosystem cannot match up. Change them in monday.");
  const want = new Set(names.map(n => n.toLowerCase())), had = new Set(haveNames.map(n => n.toLowerCase()));
  const kept = have.filter((p, i) => want.has(haveNames[i].toLowerCase())).map(p => ({ id: Number(p.id), kind: p.kind || "person" }));
  const added = names.filter(n => !had.has(n.toLowerCase()));
  if (kept.length + added.length > 25) throw new Error(col.title + ": 25 people at most.");
  if (!kept.length && !added.length) return {};
  return { personsAndTeams: kept.concat((added.length ? await peopleIds(token, added) : []).map(p => ({ id: Number(p.id), kind: p.kind }))) };
}
export const valueFor = async (token, col, input, live) => col.type === "people" ? peopleValue(token, col, input, live) : mondayValue(col, input);

// Checked again immediately before every monday write, so a section Tom has just turned off stops even a write
// that was already past its first check.
const OFF = "Editing on this board has just been turned off. Nothing was changed.";
async function stillOn(board) { await loadSwitches(true); return isOn(board.department); }

// ---------- the form ----------

export function formToken(secret, email, itemId) { return sign(secret, email + "|" + itemId); }
export function boardToken(secret, email, boardId) { return sign(secret, email + "|board|" + boardId); }

const HINT = { people: "Name, Name", dropdown: "Option, Option", timeline: "2026-10-01 - 2026-10-05", rating: "1 to 5" };
export function editForm(board, item, email, secret, note) {
  const cols = editableColumns(board);
  const field = c => {
    const cur = currentText(c, item), name = "f_" + c.id, base = `<input type="hidden" name="b_${esc(c.id)}" value="${esc(fp(cur))}">`;
    let input;
    if (c.type === "long_text") input = `<textarea name="${esc(name)}" rows="5" maxlength="${LIMITS.long_text}">${esc(cur)}</textarea>`;
    else if (c.type === "status") input = `<select name="${esc(name)}"><option value=""${cur ? "" : " selected"}>(empty)</option>${statusLabels(c).map(l => `<option value="${esc(l)}"${l === cur ? " selected" : ""}>${esc(l)}</option>`).join("")}${cur && !statusLabels(c).includes(cur) ? `<option value="${esc(cur)}" selected>${esc(cur)}</option>` : ""}</select>`;
    else if (c.type === "checkbox") input = `<select name="${esc(name)}"><option value=""${cur ? "" : " selected"}>No</option><option value="true"${cur ? " selected" : ""}>Yes</option></select>`;
    else input = `<input name="${esc(name)}" value="${esc(cur)}" type="${c.type === "date" ? "date" : c.type === "numbers" ? "text\" inputmode=\"decimal" : c.type === "email" ? "email" : c.type === "link" ? "url" : "text"}"${LIMITS[c.type] ? ` maxlength="${LIMITS[c.type]}"` : ""}${HINT[c.type] ? ` placeholder="${esc(HINT[c.type])}"` : ""}>`;
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
  const rows = await read(`SELECT e.id::text AS id, e.at, e.email, e.column_id, e.column_title, e.old_text, e.new_text, e.ok, e.error, e.undo_of::text AS undo_of, e.undone_by::text AS undone_by,
      s.name AS sub_name
    FROM mirror.edits e LEFT JOIN mirror.items s ON s.id = e.item_id AND s.parent_id = $1::bigint
    WHERE (e.item_id = $1::bigint AND e.board_id = $2::bigint) OR s.id IS NOT NULL ORDER BY e.at DESC LIMIT 25`, [item.id, board.id]);
  if (!rows.length) return `<p class="muted">No edits made in the Ecosystem yet.</p>`;
  const tok = formToken(secret, email, item.id);
  const clip = s => esc(String(s == null || s === "" ? "(empty)" : s).slice(0, 140));
  return `<div class="tw"><table><thead><tr><th>When</th><th>Who</th><th>Field</th><th>From</th><th>To</th><th></th></tr></thead><tbody>${rows.map(r => `<tr>
<td>${esc(new Date(r.at).toISOString().slice(0, 16).replace("T", " "))} UTC</td><td>${esc(r.email)}</td><td>${r.sub_name ? "Subitem " + esc(r.sub_name) + ": " : ""}${esc(r.column_title)}${r.undo_of ? " (undo)" : ""}</td>
<td>${clip(r.old_text)}</td><td>${r.ok ? clip(r.new_text) : `<span class="bad">Not saved: ${esc(r.error || "")}</span>`}</td>
<td>${r.ok && !r.undone_by && !r.undo_of && !r.sub_name && !String(r.column_id).startsWith("_") ? `<form method="post" action="/boards/${esc(board.id)}/items/${esc(item.id)}/undo"><input type="hidden" name="t" value="${esc(tok)}"><input type="hidden" name="e" value="${esc(r.id)}"><button class="btn sm" type="submit">Undo</button></form>` : r.undone_by ? `<span class="muted sm">Undone</span>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
}

// ---------- saving ----------

function formBody(req) {
  if (typeof req.body === "string") return Object.fromEntries(new URLSearchParams(req.body));
  return req.body && typeof req.body === "object" ? req.body : {};
}
export const fromSite = req => { const o = String(req.headers.origin || ""); return o === ORIGIN || (!o && /^https:\/\/ecosystem\.digitalfoxtalent\.com\//.test(String(req.headers.referer || ""))); };

async function guard(req, email, secret, board, item, team) {
  if (req.method !== "POST") return "Use the form on the item page.";
  if (!fromSite(req)) return "That request did not come from the Ecosystem.";
  await loadSwitches(true);
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
  if (board._parentItem && live.parent_id !== String(board._parentItem)) return { ok: false, message: "This subitem has moved to another item in monday. Nothing was changed." };
  const moved = changes.filter(c => !same(c.col, currentText(c.col, live), c.from));
  if (moved.length) {
    await logEdits(moved.map(c => Object.assign({ column_id: c.col.id, column_title: c.col.title, old_text: currentText(c.col, live), new_text: c.to, ok: false, error: "changed in monday first; not overwritten" }, base)));
    await saveLive(live).catch(() => {});
    return { ok: false, message: "Someone changed " + moved.map(c => c.col.title).join(", ") + " in monday since you opened this item. The page now shows the latest values; make your change again if it is still needed." };
  }
  const values = {};
  try { for (const c of changes) values[c.col.id] = await valueFor(token, c.col, c.to, live); }
  catch (e) { return { ok: false, message: String(e.message || e) }; }
  if (!(await stillOn(board))) return { ok: false, message: OFF };
  let err = null;
  try {
    await monday(token, `mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values (board_id: $b, item_id: $i, column_values: $v) { id } }`,
      { b: String(board.id), i: String(item.id), v: JSON.stringify(values) });
  } catch (e) { err = String(e.message || e).slice(0, 300); }
  const after = await liveItem(token, item.id).catch(() => null);
  // A timeout or odd reply can arrive after monday applied the change: trust what monday now holds.
  // Always check what monday now holds: a write monday accepted but did not apply is reported, never called saved.
  const landed = c => !!after && same(c.col, currentText(c.col, after), mondayText(c.col, c.to));
  const done = after ? changes.filter(landed) : (err ? [] : changes);
  const failed = changes.filter(c => !done.includes(c));
  if (failed.length && !err) err = "monday accepted the change but did not apply it";
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
      if (col.type !== "people") mondayValue(col, to); // validate before anything is written (people are checked against monday)
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
  return cellChange(req, token, email, board, board, item, team);
}
// A subitem is edited with its parent board's permission and token; the write goes to the subitems board.
export async function saveSubCell(req, token, email, parent, subBoard, sub, team) {
  if (!subBoard || subBoard.board_type !== "sub_items_board" || String(subBoard.parent_board_id || "") !== String(parent.id)) return { ok: false, message: "This subitem cannot be edited here." };
  return cellChange(req, token, email, parent, Object.assign({}, subBoard, { department: parent.department, _parentItem: String(sub.parent_id || "") }), sub, team);
}
async function cellChange(req, token, email, gate, board, item, team) {
  if (req.method !== "POST") return { ok: false, message: "Not allowed." };
  if (!fromSite(req)) return { ok: false, message: "That request did not come from the Ecosystem." };
  await loadSwitches(true);
  if (!canEdit(gate, email, team)) return { ok: false, message: "This board cannot be edited here yet." };
  const b = jsonBody(req), tok = one(b.k), want = boardToken(token, email, gate.id);
  if (tok.length !== want.length || !crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(want))) return { ok: false, message: "This page has expired. Refresh it and try again." };
  const col = editableColumns(board).find(c => c.id === one(b.c));
  if (!col) return { ok: false, message: "This field cannot be edited here." };
  const from = currentText(col, item);
  if (one(b.f) !== fp(from)) return { ok: false, message: "This changed since the board loaded. It now shows the latest value; make your change again if it is still needed." };
  const raw = typeof b.v === "string" ? b.v : "";
  const to = col.type === "long_text" ? raw.replace(/\r\n/g, "\n") : raw.trim();
  if (same(col, from, to)) return { ok: true, message: "No change." };
  try { if (col.type !== "people") mondayValue(col, to); } catch (e) { return { ok: false, message: String(e.message || e) }; }
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
  await loadSwitches(true);
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
  if (!(await stillOn(board))) return { ok: false, message: OFF };
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
  await loadSwitches(true);
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
  if (!(await stillOn(board))) return { ok: false, message: OFF };
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
  if (!(await stillOn(board))) return { ok: false, message: OFF };
  let err = null;
  try { await monday(token, `mutation ($i: ID!, $g: String!) { move_item_to_group (item_id: $i, group_id: $g) { id } }`, { i: String(item.id), g: to.id }, 15000); }
  catch (e) { err = String(e.message || e).slice(0, 300); }
  const after = await liveItem(token, item.id).catch(() => null);
  const landed = after && after.group_id === to.id;
  await logEdits([Object.assign({ ok: !!landed, error: landed ? null : (err || "not moved") }, base)]);
  if (after) await saveLive(after).catch(() => {});
  return landed ? { ok: true, message: "Moved to " + to.title + "." } : { ok: false, message: "monday did not move the item. Check it in monday before trying again." };
}

// ---------- add a subitem (side panel), with the parent board's permission ----------

const SUBS_Q = `query ($i: [ID!]) { items (ids: $i) { id state board { id } subitems { id name created_at board { id } } } }`;
export async function createSubitem(req, token, email, parent, parentItem, team) {
  const bad = await boardGuard(req, token, email, parent, team);
  if (bad) return { ok: false, message: bad };
  let name;
  try { name = mondayValue({ id: "name", title: "Name", type: "name" }, jsonBody(req).name); } catch (e) { return { ok: false, message: String(e.message || e) }; }
  const look = async ms => { const p = ((await monday(token, SUBS_Q, { i: [String(parentItem.id)] }, ms)).items || [])[0]; return p && p.state !== "deleted" ? p : null; };
  let before;
  try { before = await look(5000); } catch (e) { return { ok: false, message: "Could not reach monday. Nothing was added; try again in a moment." }; }
  if (!before || String(before.board && before.board.id) !== String(parent.id)) return { ok: false, message: "This item is no longer on this board in monday." };
  const had = new Set((before.subitems || []).map(x => String(x.id)));
  if (!(await stillOn(parent))) return { ok: false, message: OFF };
  const base = { email, board_id: parent.id, column_id: "_create", column_title: "Subitem added", old_text: null, new_text: name };
  let made = null, err = null;
  try { made = (await monday(token, `mutation ($p: ID!, $n: String!) { create_subitem (parent_item_id: $p, item_name: $n) { id board { id } } }`, { p: String(parentItem.id), n: name }, 15000)).create_subitem; }
  catch (e) { err = String(e.message || e).slice(0, 300); }
  if ((!made || !isId(made.id)) && err && !/^monday:/.test(err)) {
    try { const after = await look(5000); const hit = after && (after.subitems || []).find(x => !had.has(String(x.id)) && x.name === name); if (hit) made = { id: hit.id, board: hit.board }; } catch (e) { /* fall through */ }
  }
  if (!made || !isId(made.id)) {
    await logEdits([Object.assign({ item_id: parentItem.id, ok: false, error: err || "no subitem id returned" }, base)]);
    return { ok: false, message: "monday did not confirm the new subitem. Check the item in monday before adding it again." };
  }
  await logEdits([Object.assign({ item_id: parentItem.id, ok: true }, base)]);
  const sbId = made.board && isId(made.board.id) ? String(made.board.id) : null;
  try {
    if (sbId) await write(`INSERT INTO mirror.boards (id, name, board_type, department, access, allowed_emails, parent_board_id)
      VALUES ($1::bigint, $2, 'sub_items_board', $3, $4, $5::text[], $6::bigint) ON CONFLICT (id) DO NOTHING`,
      [sbId, "Subitems of " + String(parent.name || parent.id).slice(0, 200), parent.department, parent.access, parent.allowed_emails || [], parent.id]);
    const live = await liveItem(token, made.id).catch(() => null);
    await write(`INSERT INTO mirror.items (id, board_id, parent_id, name, vals, created_at, updated_at, pos)
      VALUES ($1::bigint, $2::bigint, $3::bigint, $4, $5::jsonb, now(), now(), (SELECT COALESCE(max(pos), 0) + 1 FROM mirror.items WHERE parent_id = $3::bigint))
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, vals = EXCLUDED.vals, deleted = false, synced_at = now()`,
      [made.id, sbId || (live && live.board_id), parentItem.id, live ? live.name : name, JSON.stringify(live ? live.vals : {})]);
    const item = (await read(`SELECT id::text AS id, name, vals, board_id::text AS board_id FROM mirror.items WHERE id = $1::bigint`, [made.id]))[0];
    return { ok: true, message: "Added to monday: " + name + ".", item };
  } catch (e) { console.error("subitem copy", e); return { ok: true, message: "Added to monday: " + name + ". Reopen the item to see it here." }; }
}

// ---------- keep the copy in step after a write that came through the monday gateway (gateway.js) ----------
// Re-reads each item from monday and saves it to our copy: new items are added (if their board is copied),
// archived or deleted ones are marked deleted. At most 10 items, each with a short timeout.
export async function refreshItems(token, ids) {
  let done = 0;
  for (const id of [...new Set(ids.map(String))].filter(isId).slice(0, 10)) {
    try {
      const it = ((await monday(token, ITEM_Q, { i: [id] }, 5000)).items || [])[0];
      if (!it || it.state === "deleted" || it.state === "archived") { await write(`UPDATE mirror.items SET deleted = true, synced_at = now() WHERE id = $1::bigint`, [id]); done++; continue; }
      const vals = {};
      for (const v of it.column_values || []) { const text = v.display_value != null ? v.display_value : v.text; if ((text == null || text === "") && v.value == null) continue; vals[v.id] = [text, v.value]; }
      const r = await write(`INSERT INTO mirror.items (id, board_id, parent_id, group_id, name, vals, created_at, updated_at, creator)
        SELECT $1::bigint, b.id, $3::bigint, $4, $5, $6::jsonb, $7::timestamptz, $8::timestamptz, $9 FROM mirror.boards b WHERE b.id = $2::bigint
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, vals = EXCLUDED.vals, group_id = COALESCE(EXCLUDED.group_id, mirror.items.group_id),
          board_id = EXCLUDED.board_id, parent_id = EXCLUDED.parent_id, updated_at = EXCLUDED.updated_at, deleted = false, synced_at = now() RETURNING id`,
        [id, String(it.board && it.board.id), it.parent_item ? String(it.parent_item.id) : null, it.group && it.group.id, String(it.name || "").replace(/\u0000/g, ""),
          JSON.stringify(vals).replace(/\\u0000/g, ""), it.created_at || null, it.updated_at || null, it.creator && it.creator.name]);
      if (r.length) done++;
    } catch (e) { /* the 30-minute copy catches up */ }
  }
  return done;
}
