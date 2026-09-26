// Access for every DFT report.
//
// TEAM: sign in with Google, and only a verified @digitalfoxtalent.com account gets in
// (see auth.js). A signed-in team member gets an HttpOnly cookie for 30 days, carrying their email,
// signed with the server's monday token so it cannot be forged. There is no shareable team link:
// a forwarded URL is useless to anyone outside the Google Workspace.
// PARTNERS: their own link, which opens only their page (partners.js).

import crypto from "node:crypto";
import { PARTNERS } from "./partners.js";

export const TEAM_DOMAIN = "digitalfoxtalent.com";
const COOKIE = "dft_team";
const COOKIE_DAYS = 30;
const PARTNER_DAYS = 90;

export const hostOf = req => String((req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0])
  .toLowerCase().trim().replace(/^www\./, "").split(":")[0];
export const isPreview = h => /^dft-leads-[a-z0-9-]+\.vercel\.app$/.test(h);

const tsign = (v, secret) => crypto.createHmac("sha256", secret + "|team-v2").update(String(v)).digest("base64url");
function readCookie(req, name) {
  const raw = String(req.headers.cookie || "");
  const m = raw.split(/;\s*/).find(p => p.startsWith(name + "="));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : "";
}
// The signed-in team member's email, or null.
export function teamEmail(req, secret) {
  const v = readCookie(req, COOKIE), i = v.lastIndexOf(".");
  if (i < 1) return null;
  const body = v.slice(0, i), sig = v.slice(i + 1), j = body.indexOf(".");
  const exp = Number(body.slice(0, j)), email = Buffer.from(body.slice(j + 1), "base64url").toString();
  if (!(exp > Date.now()) || !email.toLowerCase().endsWith("@" + TEAM_DOMAIN)) return null;
  const want = tsign(body, secret);
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want)) ? email : null;
}
export const cookieOk = (req, secret) => !!teamEmail(req, secret);
export function setTeamCookie(res, secret, email) {
  const body = (Date.now() + COOKIE_DAYS * 864e5) + "." + Buffer.from(email).toString("base64url");
  return COOKIE + "=" + encodeURIComponent(body + "." + tsign(body, secret)) + "; Path=/; Max-Age=" + (COOKIE_DAYS * 86400) + "; HttpOnly; Secure; SameSite=Lax";
}
export const clearTeamCookie = () => COOKIE + "=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax";
export const cleanUrl = url => String(url || "/").replace(/([?&])k=[^&]*(&|$)/, "$1").replace(/[?&]$/, "") || "/";

// The sign-in page: one button that goes to Google's sign-in, then back to next.
export const gatePage = (next, note) => '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>DFT Reports</title><link rel="icon" type="image/png" href="https://digitalfoxtalent.com/dft/favicon.png">' +
  '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F2F3F6;color:#3A3F49;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:24px}' +
  '@media (prefers-color-scheme:dark){body{background:#0E1014;color:#C8CCD4}h1{color:#F2F3F6!important}}' +
  'main{max-width:420px;text-align:center}h1{font-size:26px;color:#14161B;margin:14px 0 8px}.m{height:44px;width:auto;margin:0 auto;display:block}@media (prefers-color-scheme:dark){.m{background:#fff;border-radius:8px;padding:2px 6px}}' +
  '.btn{display:inline-flex;align-items:center;gap:10px;margin-top:20px;background:#14161B;color:#fff;text-decoration:none;font-weight:600;padding:11px 20px 11px 14px;border-radius:999px}.btn svg{background:#fff;border-radius:50%;padding:3px;width:24px;height:24px}.note{margin-top:12px;color:#B23A2A;font-size:14px}@media (prefers-color-scheme:dark){.btn{background:#F2F3F6;color:#14161B}}</style></head>' +
  '<body><main><img class="m" src="https://df-cdn.b-cdn.net/GeneralLendingConfigs/landing_logo/DigitalFoxTalent-TextLogoBLACK-VECTOR.svg" alt="Digital Fox Talent"><h1>DFT Reports</h1>' +
  '<p class="lead">These reports are for the Digital Fox Talent team. Sign in with your @digitalfoxtalent.com Google account.</p>' +
  '<a class="btn" href="/auth/login?next=' + encodeURIComponent(next || "/") + '"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Sign in with Google</a>' +
  (note ? '<p class="note">' + String(note).replace(/[<>&]/g, "") + '</p>' : '') +
  '</main></body></html>';

// ---------- partner links (see partners.js) ----------
const PCOOKIE = "dft_partner";
const psign = (v, secret) => crypto.createHmac("sha256", secret + "|partner-v1").update(String(v)).digest("base64url");
export function partnerKey(k) {
  if (!k) return null;
  const h = crypto.createHash("sha256").update(String(k)).digest("hex");
  for (const id in PARTNERS) if (crypto.timingSafeEqual(Buffer.from(h), Buffer.from(PARTNERS[id].keySha))) return id;
  return null;
}
export function setPartnerCookie(res, secret, id) {
  const exp = Date.now() + PARTNER_DAYS * 864e5, v = exp + "." + id;
  res.setHeader("Set-Cookie", PCOOKIE + "=" + encodeURIComponent(v + "." + psign(v, secret)) +
    "; Path=/; Max-Age=" + (PARTNER_DAYS * 86400) + "; HttpOnly; Secure; SameSite=Lax");
}
export function partnerCookie(req, secret) {
  const v = readCookie(req, PCOOKIE), i = v.lastIndexOf(".");
  if (i < 1) return null;
  const body = v.slice(0, i), sig = v.slice(i + 1), [exp, id] = body.split(".");
  if (!PARTNERS[id] || !(Number(exp) > Date.now())) return null;
  const want = psign(body, secret);
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want)) ? id : null;
}
export const partnerGate = name => gatePage("/").replace("These reports are for the Digital Fox Talent team. Sign in with your @digitalfoxtalent.com Google account.", "This report is shared with " + name + " by Digital Fox Talent. Open it with the link you were sent, and your browser will remember you for 90 days.").replace(/<a class="btn"[\s\S]*?<\/a>/, "");
