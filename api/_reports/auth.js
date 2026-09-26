// Sign in with Google for the team. Only a verified @digitalfoxtalent.com account is let in.
//
//   /auth/login?next=/path  -> Google's sign-in page (Workspace accounts only, via hd=)
//   /auth/callback          -> checks the answer and sets the team cookie
//   /auth/logout            -> signs out
//
// Uses the DFT Google OAuth client already in Vercel (GOOGLE_OAUTH_CLIENT_ID / _SECRET), with
// https://reports.digitalfoxtalent.com/auth/callback as an authorised redirect URI.
// The id_token comes straight from Google's token endpoint over TLS, so its claims are checked
// (audience, issuer, expiry, verified email, domain) without a separate signature fetch.

import crypto from "node:crypto";
import { TEAM_DOMAIN, setTeamCookie, clearTeamCookie, gatePage } from "./access.js";

const REDIRECT = "https://reports.digitalfoxtalent.com/auth/callback";
const STATE_COOKIE = "dft_oauth";
const safeNext = n => (typeof n === "string" && /^\/(?!\/)[^\s]*$/.test(n) && !n.startsWith("/auth/")) ? n : "/";
const hsign = (v, secret) => crypto.createHmac("sha256", secret + "|oauth-state").update(v).digest("base64url");

function readCookie(req, name) {
  const m = String(req.headers.cookie || "").split(/;\s*/).find(p => p.startsWith(name + "="));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : "";
}
const page = (res, code, body, cookies) => { if (cookies) res.setHeader("Set-Cookie", cookies); res.setHeader("Content-Type", "text/html; charset=utf-8"); return res.status(code).send(body); };

export async function handleAuth(req, res, route, secret) {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID, key = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (route === "auth/logout") { res.setHeader("Set-Cookie", clearTeamCookie()); res.setHeader("Location", "/"); return res.status(302).end(); }
  if (!id || !key) return page(res, 500, gatePage("/", "Sign-in is not set up on the server yet."));

  if (route === "auth/login") {
    const nonce = crypto.randomBytes(18).toString("base64url");
    const next = safeNext(req.query && req.query.next);
    const state = nonce + "." + Buffer.from(next).toString("base64url");
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.search = new URLSearchParams({ client_id: id, redirect_uri: REDIRECT, response_type: "code", scope: "openid email", hd: TEAM_DOMAIN, prompt: "select_account", state: state + "." + hsign(state, secret) }).toString();
    res.setHeader("Set-Cookie", STATE_COOKIE + "=" + nonce + "; Path=/auth; Max-Age=600; HttpOnly; Secure; SameSite=Lax");
    res.setHeader("Location", u.toString());
    return res.status(302).end();
  }

  if (route === "auth/callback") {
    const q = req.query || {};
    const parts = String(q.state || "").split(".");
    const [nonce, nextB64, sig] = parts;
    const okState = parts.length === 3 && nonce === readCookie(req, STATE_COOKIE) && sig === hsign(nonce + "." + nextB64, secret);
    const next = okState ? safeNext(Buffer.from(nextB64, "base64url").toString()) : "/";
    const clearState = STATE_COOKIE + "=; Path=/auth; Max-Age=0; HttpOnly; Secure; SameSite=Lax";
    if (!okState || !q.code) return page(res, 400, gatePage(next, q.error ? "Sign-in was cancelled." : "That sign-in link expired. Please try again."), clearState);
    const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: String(q.code), client_id: id, client_secret: key, redirect_uri: REDIRECT, grant_type: "authorization_code" }).toString() });
    const t = await r.json().catch(() => ({}));
    let c = {};
    try { c = JSON.parse(Buffer.from(String(t.id_token || "").split(".")[1] || "", "base64url").toString()); } catch (e) {}
    const email = String(c.email || "").toLowerCase();
    const ok = r.ok && c.aud === id && /^(https:\/\/)?accounts\.google\.com$/.test(c.iss || "") && Number(c.exp) * 1000 > Date.now()
      && c.email_verified === true && c.hd === TEAM_DOMAIN && email.endsWith("@" + TEAM_DOMAIN);
    if (!ok) return page(res, 403, gatePage(next, email ? "Signed in as " + email.replace(/[<>&"]/g, "") + ". Only @" + TEAM_DOMAIN + " accounts can open these reports." : "Google did not confirm a Digital Fox Talent account."), clearState);
    res.setHeader("Set-Cookie", [clearState, setTeamCookie(res, secret, email)]);
    res.setHeader("Location", next);
    return res.status(302).end();
  }
  return null;
}
