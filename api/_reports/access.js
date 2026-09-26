// Team access for every DFT report. One key, one cookie, shared by all reports on the
// host, so the team opens one link once and every report works for 90 days.
//
// - <any report>?k=<key> checks the key, sets an HttpOnly cookie, redirects to the clean URL.
// - Only the SHA-256 of the key lives here. To revoke every link, change KEY_SHA256.
// - The cookie is an expiry time signed with the server's monday token, so it cannot be forged
//   and it never contains the key itself.

import crypto from "node:crypto";

export const KEY_SHA256 = "3a1334ac1b147ed68598623dd15de31332e44bdc0b977419bd621ee32d027e7c";
const COOKIE = "dft_reach";
const COOKIE_DAYS = 90;

export const hostOf = req => String((req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0])
  .toLowerCase().trim().replace(/^www\./, "").split(":")[0];
export const isPreview = h => /^dft-leads-[a-z0-9-]+\.vercel\.app$/.test(h);

function sign(exp, secret) {
  return crypto.createHmac("sha256", secret + "|campaign-reach-v1").update(String(exp)).digest("base64url");
}
function readCookie(req) {
  const raw = String(req.headers.cookie || "");
  const m = raw.split(/;\s*/).find(p => p.startsWith(COOKIE + "="));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : "";
}
export function cookieOk(req, secret) {
  const v = readCookie(req); const i = v.indexOf(".");
  if (i < 1) return false;
  const exp = Number(v.slice(0, i)); const sig = v.slice(i + 1);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const want = sign(exp, secret);
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}
export function keyOk(k) {
  if (!k) return false;
  const h = crypto.createHash("sha256").update(String(k)).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(KEY_SHA256));
}
export function setCookie(res, secret) {
  const exp = Date.now() + COOKIE_DAYS * 864e5;
  res.setHeader("Set-Cookie", COOKIE + "=" + encodeURIComponent(exp + "." + sign(exp, secret)) +
    "; Path=/; Max-Age=" + (COOKIE_DAYS * 86400) + "; HttpOnly; Secure; SameSite=Lax");
}
export const cleanUrl = url => String(url || "/").replace(/([?&])k=[^&]*(&|$)/, "$1").replace(/[?&]$/, "") || "/";

export const gatePage = () => '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>DFT Reports</title>' +
  '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F2F3F6;color:#3A3F49;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:24px}' +
  '@media (prefers-color-scheme:dark){body{background:#0E1014;color:#C8CCD4}h1{color:#F2F3F6!important}}' +
  'main{max-width:420px;text-align:center}h1{font-size:26px;color:#14161B;margin:14px 0 8px}.m{width:40px;height:40px;border-radius:10px;background:#FF8800;margin:0 auto}</style></head>' +
  '<body><main><div class="m"></div><h1>DFT Reports</h1><p>These reports are for the Digital Fox Talent team. Open them with the team link Tom shared, and your browser will remember you for 90 days.</p></main></body></html>';
