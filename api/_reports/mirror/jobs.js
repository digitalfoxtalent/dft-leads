// Make jobs: the Make "Code" programs that need API keys (YouTube, Hunter, Claude) run here instead of inside
// Make, so the keys never pass through Make or monday. A Make scenario posts the same inputs it used to give its
// Code module to /api/v1/jobs/<code-X> with an Ecosystem key that is allowed to run jobs, and gets back the same
// result the Code module returned.
//
// SECURITY
// - Only the programs in jobs-code.js can run (copied from Make, reviewed, in git). A request only supplies inputs.
// - Keys come from Vercel's encrypted settings and are handed to the program exactly where it used to read them
//   from the monday API Keys board. Nothing in a request can choose which key goes where.
// - Every outgoing request is checked: a key may only travel to its own service (YouTube key to Google, Claude key
//   to Anthropic, Hunter key to Hunter). Anything else carrying a key is refused, so neither a bug nor text a
//   program reads (a channel description, an AI reply) can send a key anywhere else. Requests to private or local
//   addresses are refused.
// - The answer is scrubbed of every key value before it leaves.

import { JOB_CODE } from "./jobs-code.js";

// monday API Keys board item -> Vercel setting, and the services each key may be sent to.
const KEYS = {
  "12562178538": { env: "ANTHROPIC_API_KEY", hosts: ["api.anthropic.com"] },
  "13142175799": { env: "YOUTUBE_API_KEY_JOBS", hosts: ["www.googleapis.com", "youtube.googleapis.com"] },
  "12561999483": { env: "HUNTER_API_KEY", hosts: ["api.hunter.io"] },
};
// Where each program read its keys from in the monday reply it was given.
const KEY_SLOT = { "code-A": "items", "code-B": "items", "code-C": "items", "code-E": "items", "code-F": "items", "code-H": "keys" };
export const JOB_NAMES = Object.keys(KEY_SLOT);
const RUN_MS = 280000;

const parse = v => { if (typeof v === "string") { try { return JSON.parse(v); } catch (e) { return {}; } } return v && typeof v === "object" ? v : {}; };

function keyValues(env) {
  const out = [];
  for (const [id, k] of Object.entries(KEYS)) { const v = String(env[k.env] || "").trim(); if (v.length >= 8) out.push({ id, value: v, hosts: k.hosts }); }
  return out;
}

const PRIVATE = /^(localhost|.*\.local|.*\.internal|metadata\.google\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[?::1\]?|\[?f[cd][0-9a-f:]*\]?)$/i;

function check(keys, url, opts) {
  let u;
  try { u = new URL(String(url)); } catch (e) { throw new Error("blocked: bad address"); }
  if (u.protocol !== "https:") throw new Error("blocked: only https");
  if (PRIVATE.test(u.hostname) || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) || u.hostname.includes(":")) throw new Error("blocked: private or bare IP address");
  const h = opts.headers || {};
  const hdrText = typeof h.entries === "function" ? [...h.entries()].map(x => x.join(":")).join("\n") : JSON.stringify(h);
  const carried = String(url) + "\n" + hdrText + "\n" + (typeof opts.body === "string" ? opts.body : "");
  const carries = keys.filter(k => carried.includes(k.value));
  for (const k of carries) if (!k.hosts.includes(u.hostname.toLowerCase())) throw new Error("blocked: a key may not be sent to " + u.hostname);
  return { u, carries: carries.length > 0 };
}

export function guardedFetch(keys, realFetch = fetch) {
  return async (url, opts = {}) => {
    let { u, carries } = check(keys, url, opts);
    // Redirects are followed by hand, each hop checked, and never for a request that carries a key.
    for (let hop = 0; ; hop++) {
      const res = await realFetch(u.toString(), Object.assign({}, opts, { redirect: "manual" }));
      const loc = res.status >= 300 && res.status < 400 && res.headers && typeof res.headers.get === "function" ? res.headers.get("location") : null;
      if (!loc || opts.redirect === "manual") return res;
      if (carries) throw new Error("blocked: redirect on a request carrying a key");
      if (hop >= 5) throw new Error("too many redirects");
      const next = new URL(loc, u).toString();
      opts = Object.assign({}, opts, { method: "GET", body: undefined });
      ({ u, carries } = check(keys, next, opts));
    }
  };
}

export function scrub(text, keys) {
  let s = String(text);
  for (const k of keys) s = s.split(k.value).join("[key]");
  return s;
}

// Give the program the keys exactly where it used to find them (the monday reply's `items` or `keys` list).
export function withKeys(name, input, keys) {
  const inp = Object.assign({}, input);
  let outer = parse(inp.mon);
  let data = outer;
  if (data.body) { outer = Object.assign({}, outer, { body: parse(data.body) }); data = outer.body; }
  if (data.data) { data = Object.assign({}, data.data); }
  const list = keys.map(k => ({ id: k.id, column_values: [{ text: k.value }] }));
  data[KEY_SLOT[name]] = list;
  inp.mon = { data };
  return inp;
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

export async function runJob(name, input, { env = process.env, realFetch = fetch } = {}) {
  if (!Object.prototype.hasOwnProperty.call(JOB_CODE, name)) return { status: 404, body: { error: "No such job." } };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { status: 400, body: { error: "Send JSON: {\"input\": {...the Code module's inputs...}}." } };
  const keys = keyValues(env);
  const fn = new AsyncFunction("input", "fetch", JOB_CODE[name]);
  let timer;
  try {
    const result = await Promise.race([
      fn(withKeys(name, input, keys), guardedFetch(keys, realFetch)),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("the job ran out of time")), RUN_MS); }),
    ]);
    return { status: 200, raw: scrub(JSON.stringify({ ok: true, result: result == null ? null : result }), keys) };
  } catch (e) {
    return { status: 500, raw: scrub(JSON.stringify({ ok: false, error: String(e && e.message || e).slice(0, 300) }), keys) };
  } finally { clearTimeout(timer); }
}
