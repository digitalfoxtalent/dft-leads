// The Ecosystem's key vault: the few service keys Make used to read from the monday API Keys (Private) board,
// kept encrypted in the Ecosystem database so Make jobs and the relay can use them without Make or monday
// ever handling them again.
//
// - Keys are read server side, straight from the monday board, only for the items named below. Nobody sees them.
// - Stored with AES-256-GCM. The encryption key is derived from CRON_SECRET, which lives only in Vercel's
//   encrypted settings, so a copy of the database alone does not reveal any key.
// - Refreshed from monday at most once a day, so a key changed on the board reaches the Ecosystem. If monday is
//   unreachable (or gone), the stored copy keeps working.
// - A Vercel setting with the same purpose (env below) always wins, so keys can later be managed in Vercel only.

import crypto from "node:crypto";
import { read, write } from "./db.js";
import { monday, mondayToken } from "../monday.js";

export const VAULT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS mirror.vault (
     name text PRIMARY KEY,
     iv text NOT NULL,
     tag text NOT NULL,
     data text NOT NULL,
     source text NOT NULL,
     fetched_at timestamptz NOT NULL DEFAULT now()
   )`,
];

// name -> monday API Keys board item, the Vercel setting that overrides it, and where the key may be sent.
export const SECRETS = {
  anthropic: { item: "12562178538", env: "ANTHROPIC_API_KEY_JOBS", hosts: ["api.anthropic.com"] },
  youtube: { item: "13142175799", env: "YOUTUBE_API_KEY_JOBS", hosts: ["www.googleapis.com", "youtube.googleapis.com"] },
  hunter: { item: "12561999483", env: "HUNTER_API_KEY", hosts: ["api.hunter.io"] },
  apify: { item: "12634208127", env: "APIFY_TOKEN_JOBS", hosts: ["api.apify.com"] },
};
const KEY_COL = "text_mm5bcxe7";
const REFRESH_MS = 24 * 3600000, MEMO_MS = 10 * 60000;

const vaultKey = () => {
  const s = String(process.env.CRON_SECRET || "");
  if (s.length < 16) return null;
  return crypto.createHmac("sha256", s).update("eco-vault-v1").digest();
};
function seal(plain) {
  const key = vaultKey(); if (!key) throw new Error("vault key missing");
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return { iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") };
}
function open(row) {
  const key = vaultKey(); if (!key) return "";
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(row.iv, "base64"));
    d.setAuthTag(Buffer.from(row.tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(row.data, "base64")), d.final()]).toString("utf8");
  } catch (e) { return ""; } // wrong key or tampered row: treat as missing
}

let memo = { at: 0, values: null };
export const _resetVaultMemo = () => { memo = { at: 0, values: null }; };

async function fromMonday(token, mondayImpl) {
  const ids = Object.values(SECRETS).map(s => s.item);
  const d = await mondayImpl(token, `query { items(ids:[${ids.join(",")}]) { id column_values(ids:["${KEY_COL}"]) { text } } }`);
  const out = {};
  for (const it of (d && d.items) || []) {
    const v = String((((it.column_values || [])[0] || {}).text) || "").trim();
    const name = Object.keys(SECRETS).find(n => SECRETS[n].item === String(it.id));
    if (name && v.length >= 8 && v.length <= 400 && !/\s/.test(v)) out[name] = v;
  }
  return out;
}

// Returns { name: value } for every key available. Never logs or returns anything else.
export async function vaultKeys({ env = process.env, now = Date.now, mondayImpl = monday, token = mondayToken() } = {}) {
  if (memo.values && now() - memo.at < MEMO_MS) return Object.assign({}, memo.values, envOverrides(env));
  const rows = await read(`SELECT name, iv, tag, data, fetched_at FROM mirror.vault`).catch(() => []);
  const stored = {}; let oldest = Infinity;
  for (const r of rows) { const v = open(r); if (v) { stored[r.name] = v; oldest = Math.min(oldest, new Date(r.fetched_at).getTime()); } }
  const missing = Object.keys(SECRETS).some(n => !stored[n] && !envOverrides(env)[n]);
  if ((missing || now() - oldest > REFRESH_MS) && token && vaultKey()) {
    try {
      const fresh = await fromMonday(token, mondayImpl);
      for (const [name, value] of Object.entries(fresh)) {
        const s = seal(value);
        await write(`INSERT INTO mirror.vault (name, iv, tag, data, source, fetched_at) VALUES ($1, $2, $3, $4, 'monday board', now())
          ON CONFLICT (name) DO UPDATE SET iv = EXCLUDED.iv, tag = EXCLUDED.tag, data = EXCLUDED.data, source = EXCLUDED.source, fetched_at = now()`, [name, s.iv, s.tag, s.data]);
        stored[name] = value;
      }
    } catch (e) { console.warn("vault: monday refresh failed, using the stored keys", String(e && e.message || e).slice(0, 120)); }
  }
  memo = { at: now(), values: stored };
  return Object.assign({}, stored, envOverrides(env));
}

function envOverrides(env) {
  const o = {};
  for (const [name, s] of Object.entries(SECRETS)) { const v = String(env[s.env] || "").trim(); if (v.length >= 8) o[name] = v; }
  return o;
}

// For /data/mirror: which keys the vault holds and how fresh, never the values.
export async function vaultStatus() {
  const rows = await read(`SELECT name, source, fetched_at FROM mirror.vault ORDER BY name`).catch(() => []);
  return Object.keys(SECRETS).map(n => { const r = rows.find(x => x.name === n); return { name: n, held: !!r, fetched_at: r ? r.fetched_at : null, override: !!String(process.env[SECRETS[n].env] || "").trim() }; });
}
