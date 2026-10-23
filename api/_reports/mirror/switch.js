// Editing switch per section (department). Tom can turn editing in the Ecosystem on or off for a whole
// department from /data/editing, and it takes effect at once: every write (cell edit, form edit, undo, update,
// new item, move) re-reads the switch from the database before doing anything. Pages re-read it every 10 seconds.
//
// Turning a section off only stops writes FROM the Ecosystem. monday itself, Make and the 30-minute copy carry on.
// Finance boards are never editable here, whatever the switch says.

import crypto from "node:crypto";
import { read, write } from "./db.js";

export const NEVER = new Set(["finance"]);                     // money boards stay read-only in the Ecosystem
export const OWNERS = new Set(["tom@digitalfoxtalent.com"]);  // who may flip the switch
const TTL = 10000;

export const SWITCH_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS mirror.edit_switch (
     department text PRIMARY KEY,
     is_on boolean NOT NULL,
     changed_by text,
     changed_at timestamptz NOT NULL DEFAULT now()
   )`,
  `INSERT INTO mirror.edit_switch (department, is_on, changed_by) VALUES ('marketing', true, 'editing pilot, 23 Oct 2026') ON CONFLICT (department) DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS mirror.switch_log (
     id bigserial PRIMARY KEY,
     at timestamptz NOT NULL DEFAULT now(),
     email text NOT NULL,
     department text NOT NULL,
     turned_on boolean NOT NULL
   )`,
];

let onSet = new Set(), loadedAt = 0; // fails closed: nothing is editable until the switch has been read

export async function loadSwitches(force) {
  if (!force && Date.now() - loadedAt < TTL) return;
  const rows = await read(`SELECT department FROM mirror.edit_switch WHERE is_on`);
  onSet = new Set(rows.map(r => r.department).filter(d => !NEVER.has(d)));
  loadedAt = Date.now();
}
export const isOn = dept => onSet.has(dept) && !NEVER.has(dept);
export const _resetSwitches = () => { onSet = new Set(); loadedAt = 0; };

export function switchToken(secret, email) {
  return crypto.createHmac("sha256", String(secret) + "|eco-switch-v1").update(String(email)).digest("base64url").slice(0, 32);
}

export async function switchRows() {
  return read(`SELECT department, is_on, changed_by, changed_at FROM mirror.edit_switch`);
}
export async function switchLog() {
  return read(`SELECT at, email, department, turned_on FROM mirror.switch_log ORDER BY id DESC LIMIT 20`);
}

// Flip one department. Returns { ok, message }. The caller has already checked the visitor is signed in.
export async function flip(req, secret, email, depts, fromSite) {
  if (req.method !== "POST") return { ok: false, message: "Not allowed." };
  if (!fromSite(req)) return { ok: false, message: "That request did not come from the Ecosystem." };
  if (!OWNERS.has(String(email || "").toLowerCase())) return { ok: false, message: "Only Tom can change the editing switch." };
  const b = typeof req.body === "string" ? Object.fromEntries(new URLSearchParams(req.body)) : (req.body || {});
  const one = v => String(Array.isArray(v) ? v[0] : v == null ? "" : v);
  const tok = one(b.t), want = switchToken(secret, email);
  if (tok.length !== want.length || !crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(want))) return { ok: false, message: "That page has expired. Open it again." };
  const d = one(b.d);
  if (!depts[d]) return { ok: false, message: "Unknown section." };
  const turnOn = one(b.on) === "1";
  if (turnOn && NEVER.has(d)) return { ok: false, message: depts[d] + " stays read-only in the Ecosystem." };
  await write(`INSERT INTO mirror.edit_switch (department, is_on, changed_by, changed_at) VALUES ($1, $2, $3, now())
    ON CONFLICT (department) DO UPDATE SET is_on = EXCLUDED.is_on, changed_by = EXCLUDED.changed_by, changed_at = now()`, [d, turnOn, email]);
  await write(`INSERT INTO mirror.switch_log (email, department, turned_on) VALUES ($1, $2, $3)`, [email, d, turnOn]);
  await loadSwitches(true);
  return { ok: true, message: depts[d] + (turnOn ? ": editing is on. Changes save straight to monday." : ": editing is off. The boards are read-only in the Ecosystem from now.") };
}
