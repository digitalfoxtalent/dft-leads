// Make jobs: the Make "Code" programs that need API keys (YouTube, Hunter, Claude) run here instead of inside
// Make, so the keys never pass through Make or monday. A Make scenario posts the same inputs it used to give its
// Code module to /api/v1/jobs/<code-X> with an Ecosystem key that is allowed to run jobs, and gets back the same
// result the Code module returned.
//
// SECURITY
// - Only the programs in jobs-code.js can run. They are source code: reviewed and changed in git, never copied
//   back in from Make. A request only supplies inputs.
// - Programs run in their own JavaScript context (node:vm) that holds only their inputs, a guarded fetch and the
//   standard built-ins: no process, no environment, no database, no plain fetch.
// - Keys come from the vault (vault.js, encrypted) and are handed to the program exactly where it used to read them
//   from the monday API Keys board. Nothing in a request can choose which key goes where.
// - Every outgoing request is checked: a key may only travel to its own service (YouTube key to Google, Claude key
//   to Anthropic, Hunter key to Hunter), in any spelling (encoded, split by whitespace). Bodies must be plain text.
//   Requests carrying a key are never redirected. Private, local and bare-IP addresses are refused, after DNS too.
//   Each request has a time limit and a size limit. Blocked attempts are recorded.
// - The answer is scrubbed of every key value before it leaves.
// - Limits per key: three jobs at once, and the email finder's batch size is capped.

import vm from "node:vm";
import dns from "node:dns/promises";
import { JOB_CODE } from "./jobs-code.js";
import { vaultKeys, SECRETS } from "./vault.js";

// Keys come from the vault (vault.js): read once from the monday API Keys board, kept encrypted.
// Where each program read its keys from in the monday reply it was given.
const KEY_SLOT = { "code-A": "items", "code-B": "items", "code-C": "items", "code-E": "items", "code-F": "items", "code-H": "keys" };
export const JOB_NAMES = Object.keys(KEY_SLOT);
// Claude calls get longer: screening 20 channels in one request takes well over 20 seconds (23 Oct 2026).
const RUN_MS = 280000, FETCH_MS = 20000, AI_FETCH_MS = 150000, MAX_BYTES = 5 * 1024 * 1024, MAX_CAP = 50;
const AI_HOSTS = new Set(["api.anthropic.com"]);

const parse = v => { if (typeof v === "string") { try { return JSON.parse(v); } catch (e) { return {}; } } return v && typeof v === "object" ? v : {}; };

// { name: value } -> the list the guard and the programs use: monday item id, value, allowed hosts.
export function keyList(values) {
  return Object.entries(values || {}).filter(([n, v]) => SECRETS[n] && String(v || "").length >= 8).map(([n, v]) => ({ id: SECRETS[n].item, name: n, value: String(v), hosts: SECRETS[n].hosts }));
}

const PRIVATE_NAME = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa)$/i;
const isPrivateIp = ip => {
  const s = String(ip).toLowerCase();
  if (s.includes(":")) return s === "::1" || s === "::" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^::ffff:/.test(s);
  const p = s.split(".").map(Number);
  if (p.length !== 4 || p.some(n => !(n >= 0 && n <= 255))) return true;
  return p[0] === 0 || p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
    || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || p[0] >= 224;
};

// Every spelling of the request we can think of, to find a key in it however it is written.
function spellings(u, headers, body) {
  const raw = [u.href, headers, body].join("\n");
  const out = [raw, raw.replace(/\s+/g, "")];
  for (const s of [u.href, body]) { try { out.push(decodeURIComponent(s)); out.push(decodeURIComponent(s).replace(/\s+/g, "")); } catch (e) { /* not encoded */ } }
  return out.join("\n");
}

async function check(keys, url, opts, lookup) {
  if (typeof url !== "string" && !(url instanceof URL)) throw new Error("blocked: give fetch an address as text");
  let u;
  try { u = new URL(String(url)); } catch (e) { throw new Error("blocked: bad address"); }
  if (u.protocol !== "https:") throw new Error("blocked: only https");
  if (u.username || u.password) throw new Error("blocked: address with a user name");
  const host = u.hostname.toLowerCase().replace(/\.+$/, "");
  if (PRIVATE_NAME.test(host) || /^[\d.]+$/.test(host) || /^0x/i.test(host) || host.includes(":") || host.startsWith("[")) throw new Error("blocked: private or bare IP address");
  if (opts.body != null && typeof opts.body !== "string") throw new Error("blocked: request bodies must be text");
  const h = opts.headers || {};
  const hdr = typeof h.entries === "function" ? [...h.entries()].map(x => x.join(":")).join("\n") : JSON.stringify(h);
  const all = spellings(u, hdr, opts.body || "");
  const carries = keys.filter(k => all.includes(k.value));
  for (const k of carries) if (!k.hosts.includes(host)) throw new Error("blocked: a key may not be sent to " + host);
  let addrs = [];
  try { addrs = await lookup(host); } catch (e) { throw new Error("blocked: address does not resolve"); }
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address || a))) throw new Error("blocked: address resolves to a private network");
  return { u, carries: carries.length > 0 };
}

async function capped(res, max = MAX_BYTES) {
  const len = Number(res.headers && res.headers.get && res.headers.get("content-length"));
  if (len > max) throw new Error("response too large");
  if (!res.body || typeof res.body.getReader !== "function") return res;
  const reader = res.body.getReader(); const parts = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { try { await reader.cancel(); } catch (e) { /* ignore */ } break; } // keep the first part only
    parts.push(value);
  }
  const buf = Buffer.concat(parts.map(p => Buffer.from(p)));
  return new Response(res.status === 204 || res.status === 304 ? null : buf, { status: res.status, statusText: res.statusText, headers: res.headers });
}

const dnsLookup = host => dns.lookup(host, { all: true });

export function guardedFetch(keys, realFetch = fetch, { lookup = dnsLookup, onBlock = () => {}, maxBytes = MAX_BYTES, timeoutMs = FETCH_MS } = {}) {
  return async (url, opts = {}) => {
    try {
      let { u, carries } = await check(keys, url, opts, lookup);
      for (let hop = 0; ; hop++) {
        const ms = AI_HOSTS.has(u.hostname.toLowerCase().replace(/\.+$/, "")) ? Math.max(timeoutMs, AI_FETCH_MS) : timeoutMs;
        const res = await realFetch(u.toString(), Object.assign({}, opts, { redirect: "manual", signal: opts.signal || AbortSignal.timeout(ms) }));
        const loc = res.status >= 300 && res.status < 400 && res.headers && typeof res.headers.get === "function" ? res.headers.get("location") : null;
        if (!loc || opts.redirect === "manual") return capped(res, maxBytes);
        if (carries) throw new Error("blocked: redirect on a request carrying a key");
        if (hop >= 5) throw new Error("too many redirects");
        opts = Object.assign({}, opts, { method: "GET", body: undefined });
        ({ u, carries } = await check(keys, new URL(loc, u).toString(), opts, lookup));
      }
    } catch (e) {
      if (/^blocked/.test(e.message)) onBlock(e.message);
      throw e;
    }
  };
}

export function scrub(text, keys) {
  let s = String(text);
  for (const k of keys) { s = s.split(k.value).join("[key]"); s = s.split(encodeURIComponent(k.value)).join("[key]"); }
  return s;
}

// Give the program the keys exactly where it used to find them (the monday reply's `items` or `keys` list).
export function withKeys(name, input, keys) {
  const inp = Object.assign({}, input);
  let outer = parse(inp.mon);
  let data = outer;
  if (data.body) { outer = Object.assign({}, outer, { body: parse(data.body) }); data = outer.body; }
  if (data.data) { data = Object.assign({}, data.data); }
  data[KEY_SLOT[name]] = keys.map(k => ({ id: k.id, column_values: [{ text: k.value }] }));
  inp.mon = { data };
  if (name === "code-F") inp.cap = String(Math.min(MAX_CAP, Math.max(1, parseInt(inp.cap || "15", 10) || 15)));
  return inp;
}

export async function runJob(name, input, { keysImpl = vaultKeys, realFetch = fetch, lookup = dnsLookup } = {}) {
  if (!Object.prototype.hasOwnProperty.call(JOB_CODE, name)) return { status: 404, body: { error: "No such job." } };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { status: 400, body: { error: "Send JSON: {\"input\": {...the Code module's inputs...}}." } };
  const keys = keyList(await keysImpl());
  const blocked = [];
  const sandbox = vm.createContext({
    input: withKeys(name, input, keys),
    fetch: guardedFetch(keys, realFetch, { lookup, onBlock: m => blocked.push(m) }),
    URL, URLSearchParams, setTimeout, clearTimeout, TextEncoder, TextDecoder,
    console: { log() {}, warn() {}, error() {} },
  }, { codeGeneration: { strings: false, wasm: false } });
  let timer;
  try {
    const run = vm.runInContext("(async () => {\n" + JOB_CODE[name] + "\n})()", sandbox, { filename: name + ".js" });
    const result = await Promise.race([run, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("the job ran out of time")), RUN_MS); })]);
    return { status: 200, raw: scrub(JSON.stringify({ ok: true, result: result == null ? null : result }), keys), blocked };
  } catch (e) {
    return { status: 500, raw: scrub(JSON.stringify({ ok: false, error: String(e && e.message || e).slice(0, 300) }), keys), blocked };
  } finally { clearTimeout(timer); }
}
