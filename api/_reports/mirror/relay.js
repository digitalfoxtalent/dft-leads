// The relay: lets a Make HTTP module call YouTube, Claude (Anthropic), Apify or Hunter through the Ecosystem,
// which adds the service key from the vault (vault.js). Make then holds no service keys at all, only its
// Ecosystem key (which can be revoked on /data/api-keys at any time).
//
// Only the exact endpoints Make uses are open, each with its method. The key is always added here and only ever
// sent to its own service; a key supplied in the request is stripped. Answers are scrubbed of key values.
// A contract PDF can be passed by address (header x-eco-pdf-url, monday file links only) instead of in the body,
// so large files never have to fit through the 4.5 MB request limit.

import { vaultKeys } from "./vault.js";
import { keyList, guardedFetch, scrub } from "./jobs.js";

const ROUTES = [
  { service: "anthropic", method: "POST", re: /^v1\/messages$/, base: "https://api.anthropic.com/" },
  { service: "apify", method: "PUT", re: /^v2\/key-value-stores\/[A-Za-z0-9~_-]{3,60}\/records\/[A-Za-z0-9._-]{1,100}$/, base: "https://api.apify.com/" },
  { service: "apify", method: "GET", re: /^v2\/key-value-stores\/[A-Za-z0-9~_-]{3,60}\/records\/[A-Za-z0-9._-]{1,100}$/, base: "https://api.apify.com/" },
  { service: "apify", method: "POST", re: /^v2\/acts\/[A-Za-z0-9~_.-]{3,80}\/run-sync-get-dataset-items$/, base: "https://api.apify.com/" },
  { service: "youtube", method: "GET", re: /^youtube\/v3\/(search|videos|channels|playlistItems|playlists)$/, base: "https://www.googleapis.com/" },
  { service: "hunter", method: "GET", re: /^v2\/(domain-search|email-finder|email-verifier)$/, base: "https://api.hunter.io/" },
];
const STRIP_QS = new Set(["key", "token", "api_key", "access_token"]);
const PDF_HOSTS = /(^|\.)monday\.com$|^files-monday-com\.s3\.amazonaws\.com$|^files-monday-com\.s3\.[a-z0-9-]+\.amazonaws\.com$/i;
const MAX_PDF = 30 * 1024 * 1024;

export function findRoute(service, rest, method) {
  return ROUTES.find(r => r.service === service && r.method === String(method || "").toUpperCase() && r.re.test(rest)) || null;
}

// Returns { status, raw, type }.
export async function relay(req, path, { keysImpl = vaultKeys, realFetch = fetch, lookup } = {}) {
  const m = /^relay\/([a-z]+)\/(.+)$/.exec(path);
  if (!m) return { status: 404, raw: JSON.stringify({ error: "No such relay address." }) };
  const route = findRoute(m[1], m[2], req.method);
  if (!route) return { status: 404, raw: JSON.stringify({ error: "That address and method are not open on the relay." }) };
  const keys = keyList(await keysImpl());
  const key = keys.find(k => k.name === route.service);
  if (!key) return { status: 503, raw: JSON.stringify({ error: "The Ecosystem does not hold a " + route.service + " key yet." }) };
  const g = lookup ? { lookup } : {};
  const f = guardedFetch(keys, realFetch, Object.assign({ timeoutMs: 290000, maxBytes: 20 * 1024 * 1024 }, g));
  const fPdf = guardedFetch(keys, realFetch, Object.assign({ timeoutMs: 60000, maxBytes: MAX_PDF + 1 }, g));

  const url = new URL(route.base + m[2]);
  for (const [k, v] of Object.entries(req.query || {})) if (!STRIP_QS.has(k.toLowerCase())) url.searchParams.set(k, Array.isArray(v) ? v[0] : String(v));
  const headers = { "content-type": "application/json" };
  const h = req.headers || {};
  if (route.service === "anthropic") { headers["x-api-key"] = key.value; headers["anthropic-version"] = String(h["anthropic-version"] || "2023-06-01"); if (h["anthropic-beta"]) headers["anthropic-beta"] = String(h["anthropic-beta"]); }
  if (route.service === "apify") headers.authorization = "Bearer " + key.value;
  if (route.service === "youtube") url.searchParams.set("key", key.value);
  if (route.service === "hunter") url.searchParams.set("api_key", key.value);

  let body;
  if (route.method !== "GET") {
    body = typeof req.body === "string" ? req.body : req.body == null ? "" : JSON.stringify(req.body);
    // A key the caller put in the body is never forwarded.
    for (const k of keys) if (body.includes(k.value)) return { status: 400, raw: JSON.stringify({ error: "Do not send service keys to the relay." }) };
    const pdfUrl = String(h["x-eco-pdf-url"] || "");
    if (pdfUrl && route.service === "anthropic") {
      let pu; try { pu = new URL(pdfUrl); } catch (e) { return { status: 400, raw: JSON.stringify({ error: "x-eco-pdf-url is not an address." }) }; }
      if (pu.protocol !== "https:" || !PDF_HOSTS.test(pu.hostname)) return { status: 400, raw: JSON.stringify({ error: "x-eco-pdf-url must be a monday file link." }) };
      if (!body.includes("__PDF_B64__")) return { status: 400, raw: JSON.stringify({ error: "The body has no __PDF_B64__ placeholder." }) };
      const pdf = await fPdf(pu.toString(), {});
      if (!pdf.ok) return { status: 502, raw: JSON.stringify({ error: { type: "pdf_fetch", message: "Could not download the contract file (" + pdf.status + ")." } }) };
      const buf = Buffer.from(await pdf.arrayBuffer());
      if (buf.length > MAX_PDF) return { status: 413, raw: JSON.stringify({ error: { type: "pdf_too_large", message: "The contract file is over 30 MB." } }) };
      body = body.split("__PDF_B64__").join(buf.toString("base64"));
    }
  }
  const res = await f(url.toString(), { method: route.method, headers, body });
  const text = await res.text();
  return { status: res.status, raw: scrub(text, keys), type: (res.headers && res.headers.get && res.headers.get("content-type")) || "application/json" };
}
