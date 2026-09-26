// Sign in with Google for the team. Only a verified @digitalfoxtalent.com account is let in.
//
// The sign-in page shows Google's own button (Google Identity Services, redirect mode, so it works
// in the same tab with no pop-up). Google posts a signed ID token to /auth/google, and the server has Google check it
// (tokeninfo: signature and expiry) before looking at the claims: our client, a verified email,
// the digitalfoxtalent.com Workspace, and the one-time nonce this browser was given.
// No client secret is involved, so nothing secret is stored for this.
//
// Google client: "DFT Channel Connect (web)" in Google Cloud project dft-creator-access, with
// https://reports.digitalfoxtalent.com as an authorised JavaScript origin and
// https://reports.digitalfoxtalent.com/auth/google as an authorised redirect URI (added 26 Sep 2026).
//
//   POST /auth/google   {credential}  -> sets the team cookie
//   /auth/logout                      -> signs out

import crypto from "node:crypto";
import { TEAM_DOMAIN, setTeamCookie, clearTeamCookie, gatePage } from "./access.js";

export const GOOGLE_CLIENT_ID = "488652876117-tn5bghe93loqvqcapulvvdb41t8a9oug.apps.googleusercontent.com";
const NONCE_COOKIE = "dft_nonce";

function readCookie(req, name) {
  const m = String(req.headers.cookie || "").split(/;\s*/).find(p => p.startsWith(name + "="));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : "";
}
// A fresh one-time value for the sign-in page; the token Google returns must carry it.
// The cookie also remembers where to go afterwards. SameSite=None because Google posts back cross-site.
const safeNext = n => (typeof n === "string" && /^\/(?!\/)[^\s]*$/.test(n) && !n.startsWith("/auth/")) ? n : "/";
export function newNonce(next) {
  const n = crypto.randomBytes(18).toString("base64url");
  return { nonce: n, cookie: NONCE_COOKIE + "=" + n + "." + Buffer.from(safeNext(next)).toString("base64url") + "; Path=/auth; Max-Age=900; HttpOnly; Secure; SameSite=None" };
}
const CLEAR = NONCE_COOKIE + "=; Path=/auth; Max-Age=0; HttpOnly; Secure; SameSite=None";
const html = (res, code, body, cookies) => { res.setHeader("Set-Cookie", cookies); res.setHeader("Content-Type", "text/html; charset=utf-8"); return res.status(code).send(body); };

export async function handleAuth(req, res, route, secret) {
  if (route === "auth/logout") { res.setHeader("Set-Cookie", clearTeamCookie()); res.setHeader("Location", "/"); return res.status(302).end(); }
  if (route !== "auth/google") return null;
  if (req.method !== "POST") { res.setHeader("Location", "/"); return res.status(302).end(); }
  const body = typeof req.body === "string" ? Object.fromEntries(new URLSearchParams(req.body)) : (req.body || {});
  const cred = String(body.credential || "");
  const [nonce, nextB64] = readCookie(req, NONCE_COOKIE).split(".");
  const next = safeNext(nextB64 ? Buffer.from(nextB64, "base64url").toString() : "/");
  // Google's own double-submit check for redirect mode.
  const csrfOk = body.g_csrf_token && body.g_csrf_token === readCookie(req, "g_csrf_token");
  const retry = (msg) => { const n = newNonce(next); return html(res, 403, gatePage(next, msg, n.nonce, GOOGLE_CLIENT_ID), n.cookie); };
  if (!cred || !nonce || !csrfOk) return retry("That sign-in expired. Please try again.");
  let c = {};
  try {
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(cred));
    if (r.ok) c = await r.json();
  } catch (e) {}
  const email = String(c.email || "").toLowerCase();
  const ok = c.aud === GOOGLE_CLIENT_ID && /^(https:\/\/)?accounts\.google\.com$/.test(c.iss || "") && Number(c.exp) * 1000 > Date.now()
    && String(c.email_verified) === "true" && c.hd === TEAM_DOMAIN && email.endsWith("@" + TEAM_DOMAIN) && c.nonce === nonce;
  if (!ok) return retry(email && !email.endsWith("@" + TEAM_DOMAIN) ? "Signed in as " + email.replace(/[<>&"]/g, "") + ". Only @" + TEAM_DOMAIN + " accounts can open these reports." : "Google did not confirm a Digital Fox Talent account. Please try again.");
  res.setHeader("Set-Cookie", [CLEAR, setTeamCookie(res, secret, email)]);
  res.setHeader("Location", next);
  return res.status(303).end();
}
