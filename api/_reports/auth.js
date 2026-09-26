// Sign in with Google for the team. Only a verified @digitalfoxtalent.com account is let in.
//
// The sign-in page shows Google's own button (Google Identity Services). Google hands the browser
// a signed ID token, the page posts it to /auth/google, and the server has Google check it
// (tokeninfo: signature and expiry) before looking at the claims: our client, a verified email,
// the digitalfoxtalent.com Workspace, and the one-time nonce this browser was given.
// No client secret is involved, so nothing secret is stored for this.
//
// Google client: "DFT Channel Connect (web)" in Google Cloud project dft-creator-access, with
// https://reports.digitalfoxtalent.com as an authorised JavaScript origin (added 26 Sep 2026).
//
//   POST /auth/google   {credential}  -> sets the team cookie
//   /auth/logout                      -> signs out

import crypto from "node:crypto";
import { TEAM_DOMAIN, setTeamCookie, clearTeamCookie } from "./access.js";

export const GOOGLE_CLIENT_ID = "488652876117-tn5bghe93loqvqcapulvvdb41t8a9oug.apps.googleusercontent.com";
const NONCE_COOKIE = "dft_nonce";

function readCookie(req, name) {
  const m = String(req.headers.cookie || "").split(/;\s*/).find(p => p.startsWith(name + "="));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : "";
}
// A fresh one-time value for the sign-in page; the token Google returns must carry it.
export function newNonce() {
  const n = crypto.randomBytes(18).toString("base64url");
  return { nonce: n, cookie: NONCE_COOKIE + "=" + n + "; Path=/auth; Max-Age=900; HttpOnly; Secure; SameSite=Strict" };
}

export async function handleAuth(req, res, route, secret) {
  if (route === "auth/logout") { res.setHeader("Set-Cookie", clearTeamCookie()); res.setHeader("Location", "/"); return res.status(302).end(); }
  if (route !== "auth/google") return null;
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const body = typeof req.body === "string" ? (() => { try { return JSON.parse(req.body); } catch (e) { return {}; } })() : (req.body || {});
  const cred = String(body.credential || "");
  const clear = NONCE_COOKIE + "=; Path=/auth; Max-Age=0; HttpOnly; Secure; SameSite=Strict";
  const nonce = readCookie(req, NONCE_COOKIE);
  if (!cred || !nonce) { res.setHeader("Set-Cookie", clear); return res.status(400).json({ error: "This sign-in page has expired. Reload and try again." }); }
  let c = {};
  try {
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(cred));
    if (r.ok) c = await r.json();
  } catch (e) {}
  const email = String(c.email || "").toLowerCase();
  const ok = c.aud === GOOGLE_CLIENT_ID && /^(https:\/\/)?accounts\.google\.com$/.test(c.iss || "") && Number(c.exp) * 1000 > Date.now()
    && String(c.email_verified) === "true" && c.hd === TEAM_DOMAIN && email.endsWith("@" + TEAM_DOMAIN) && c.nonce === nonce;
  if (!ok) {
    res.setHeader("Set-Cookie", clear);
    return res.status(403).json({ error: email && !email.endsWith("@" + TEAM_DOMAIN) ? "Signed in as " + email + ". Only @" + TEAM_DOMAIN + " accounts can open these reports." : "Google did not confirm a Digital Fox Talent account. Please try again." });
  }
  res.setHeader("Set-Cookie", [clear, setTeamCookie(res, secret, email)]);
  return res.status(200).json({ ok: true, email });
}
