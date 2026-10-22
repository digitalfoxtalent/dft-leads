// Request access: someone outside DFT opens an Engaged views link (ecosystem.digitalfoxtalent.com/
// reporting/engaged-views#UC...) that a teammate sent them. Instead of a dead end at the Google sign-in, they can
// ask for access. A teammate approves it, and from then on the same link takes them straight to that
// one creator's brand-safe engaged views page on connect.digitalfoxtalent.com (the page each panel
// already offers to copy into a reply). Built 22 Oct 2026 after Zorka.Agency asked how to open a link
// Margot had sent.
//
// WHAT AN OUTSIDER CAN EVER SEE: only the brand-safe page for the one creator they asked about, and only
// after a teammate approves. Never the team report, other creators, or anything else in the Ecosystem.
//
// FLOW
//   GET  /reporting/engaged-views (not signed in)   -> the request form (the creator comes from the #UC... part
//                                                      of the link, which only the browser sees, so a few lines
//                                                      of script copy it into the form)
//   POST /reporting/request-access                  -> stores the request, tells Tom (and the teammate they name)
//                                                      in monday, and sets a signed cookie in their browser
//   GET  /reporting/engaged-views again             -> pending: "with the team"; approved: straight to the
//                                                      brand-safe page; declined: says so
//   GET  /reporting/access-requests (team only)     -> pending and recent requests with Approve and Decline
//   POST /reporting/access-requests (team only)     -> records the decision
//
// SAFETY
//   - Requests are stored in the Ecosystem database (schema "access"), parameterised queries only.
//   - At most 5 requests an hour from one network, 300 pending in total and 10 monday notifications an hour;
//     a hidden field catches bots.
//   - The cookie only carries a random request id, signed so it cannot be guessed or altered.
//   - Team decisions need the team sign-in cookie (SameSite=Lax, so other sites cannot post with it)
//     and a same-origin Origin header.
//   - No email is sent to anyone. The teammate replies to the requester themselves.

import crypto from "node:crypto";
import { read, write, batch, hasDatabase } from "./mirror/db.js";
import { allCreators, brandLink } from "./engaged/load.js";
import { mondayCall } from "./runlog.js";

export const REQUEST_PATH = "/reporting/request-access";
export const REVIEW_PATH = "/reporting/access-requests";
const ORIGIN = "https://ecosystem.digitalfoxtalent.com";
const COOKIE = "dft_req";
const COOKIE_DAYS = 90;
const TOM = 40241658;
const CH_RE = /^UC[A-Za-z0-9_-]{22}$/;
const EMAIL_RE = /^[^\s@<>"]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
const PER_HOUR = 5, MAX_PENDING = 300, NOTIFY_PER_HOUR = 10;

// Swappable for tests.
let deps = { creators: allCreators, brandLink, notify: mondayNotify, lookupUsers: mondayUsers, postUpdate: mondayUpdate };
export function setDeps(d) { deps = Object.assign({}, deps, d); }

const SCHEMA = [
  `CREATE SCHEMA IF NOT EXISTS access`,
  `CREATE TABLE IF NOT EXISTS access.requests (
     id text PRIMARY KEY,
     created_at timestamptz NOT NULL DEFAULT now(),
     name text NOT NULL,
     email text NOT NULL,
     company text,
     contact text,
     page text NOT NULL DEFAULT 'engaged-views',
     channel text NOT NULL,
     creator text,
     status text NOT NULL DEFAULT 'pending',      -- pending | approved | declined
     decided_by text,
     decided_at timestamptz,
     ip_hash text,
     notified int NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX IF NOT EXISTS requests_status ON access.requests (status, created_at)`,
  `CREATE INDEX IF NOT EXISTS requests_ip ON access.requests (ip_hash, created_at)`,
];
let ready = false;
async function ensure() { if (!ready) { await batch(SCHEMA.map(s => [s, []])); ready = true; } }
export const _reset = () => { ready = false; };

const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const clean = (v, max) => String(v == null ? "" : Array.isArray(v) ? v[0] : v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const sign = (v, secret) => crypto.createHmac("sha256", secret + "|access-req-v1").update(String(v)).digest("base64url");
function readCookie(req, name) {
  const m = String(req.headers.cookie || "").split(/;\s*/).find(p => p.startsWith(name + "="));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : "";
}
export function requestIdFromCookie(req, secret) {
  const v = readCookie(req, COOKIE), i = v.lastIndexOf(".");
  if (i < 1) return null;
  const id = v.slice(0, i), sig = v.slice(i + 1), want = sign(id, secret);
  return /^[A-Za-z0-9_-]{22}$/.test(id) && sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want)) ? id : null;
}
const cookieFor = (id, secret) => COOKIE + "=" + encodeURIComponent(id + "." + sign(id, secret)) + "; Path=/; Max-Age=" + (COOKIE_DAYS * 86400) + "; HttpOnly; Secure; SameSite=Lax";
const ipHash = (req, secret) => {
  const ip = String(req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || "").split(",")[0].trim(); // Vercel sets x-real-ip itself
  return crypto.createHmac("sha256", secret + "|ip").update(ip || "none").digest("base64url").slice(0, 22);
};
function body(req) {
  if (typeof req.body === "string") return Object.fromEntries(new URLSearchParams(req.body));
  return req.body && typeof req.body === "object" ? req.body : {};
}
const sameOrigin = req => { const o = String(req.headers.origin || ""); return !o || o === ORIGIN; };

// ---------- pages ----------
const shell = (title, inner, script) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><link rel="icon" type="image/png" href="https://digitalfoxtalent.com/dft/favicon.png">
<style>
:root{--bg:#F2F3F6;--card:#fff;--ink:#14161B;--body:#3A3F49;--muted:#687080;--line:#DFE2E8;--accent:#C05600;--bad:#B23A2A;--good:#2C7A4B}
@media (prefers-color-scheme:dark){:root{--bg:#0E1014;--card:#171A20;--ink:#F2F3F6;--body:#C8CCD4;--muted:#8B919D;--line:#2A2F38;--accent:#FF9A2E;--bad:#F08A7A;--good:#6FC48E}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--bg);color:var(--body);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:48px 16px}
main{max-width:560px;margin:0 auto}main.wide{max-width:1040px}
.logo{height:40px;width:auto;display:block;margin:0 0 28px}@media (prefers-color-scheme:dark){.logo{background:#fff;border-radius:8px;padding:2px 6px}}
h1{font-size:28px;line-height:1.15;color:var(--ink);margin:0 0 10px}h2{font-size:18px;color:var(--ink);margin:36px 0 12px}
p{margin:0 0 14px}.muted{color:var(--muted);font-size:14px}.bad{color:var(--bad)}.good{color:var(--good)}
form.card,.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px;margin:22px 0}
label{display:block;font-size:14px;font-weight:600;color:var(--ink);margin:0 0 6px}
input[type=text],input[type=email]{width:100%;font:inherit;padding:11px 13px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink);margin:0 0 16px}
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
button,.btn{display:inline-block;font:inherit;font-weight:600;border:0;border-radius:999px;padding:11px 22px;background:var(--ink);color:var(--bg);cursor:pointer;text-decoration:none}
button.ghost{background:transparent;color:var(--body);border:1px solid var(--line)}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:12px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600}
td form{display:inline;margin:0}td button{padding:7px 14px;font-size:13px;margin:0 6px 6px 0}
code{word-break:break-all;font-size:13px}
</style></head><body>${inner}${script ? `<script>${script}</script>` : ""}</body></html>`;
const LOGO = `<img class="logo" src="https://df-cdn.b-cdn.net/GeneralLendingConfigs/landing_logo/DigitalFoxTalent-TextLogoBLACK-VECTOR.svg" alt="Digital Fox Talent">`;
const teamSignIn = next => `<p class="muted">Digital Fox Talent team: <a href="/auth/login?next=${encodeURIComponent(next)}">sign in with Google</a>.</p>`;

// The page an outsider sees on an Engaged views link.
export function requestForm(note) {
  const script = `(function(){var h=location.hash.slice(1),f=document.getElementById("f"),m=document.getElementById("nohash");
if(/^UC[A-Za-z0-9_-]{22}$/.test(h)){document.getElementById("ch").value=h;}else{f.style.display="none";m.style.display="block";}})();`;
  return shell("Request access", `<main>${LOGO}<h1>Request access to engaged views</h1>
<p>This report belongs to Digital Fox Talent. If someone at DFT shared a creator's engaged views with you, ask for access below. Once a teammate approves it, this same link opens the report for you.</p>
${note ? `<p class="bad">${esc(note)}</p>` : ""}
<form class="card" id="f" method="post" action="${REQUEST_PATH}">
<input type="hidden" name="ch" id="ch" value="">
<label for="n">Your name</label><input type="text" id="n" name="name" required maxlength="100" autocomplete="name">
<label for="e">Work email</label><input type="email" id="e" name="email" required maxlength="200" autocomplete="email">
<label for="c">Company</label><input type="text" id="c" name="company" maxlength="120" autocomplete="organization">
<label for="w">Who at Digital Fox Talent shared this with you?</label><input type="text" id="w" name="contact" maxlength="200" placeholder="Name or email">
<div class="hp" aria-hidden="true"><label for="site">Website</label><input type="text" id="site" name="website" tabindex="-1" autocomplete="off"></div>
<button type="submit">Request access</button>
</form>
<div class="card" id="nohash" style="display:none"><p>This link does not say which creator it is for. Please ask your contact at Digital Fox Talent for the full link.</p></div>
${teamSignIn("/reporting/engaged-views")}</main>`, script);
}

const statusPage = (r, msg) => shell("Request access", `<main>${LOGO}<h1>${esc(msg.title)}</h1>${msg.body}${teamSignIn("/reporting/engaged-views")}</main>`);
const pendingBody = r => `<p>Thanks${r.name ? ", " + esc(r.name.split(" ")[0]) : ""}. Your request to see ${esc(r.creator || "this creator")}'s engaged views is with the Digital Fox Talent team.</p>
<p>Once it is approved, open the same link again in this browser and it takes you straight to the report. There is nothing else to do.</p>`;

// GET of the Engaged views page by someone who is not signed in.
export async function outsiderView(req, secret) {
  if (!hasDatabase()) return { status: 401, html: requestForm() };
  const id = requestIdFromCookie(req, secret);
  if (!id) return { status: 401, html: requestForm() };
  await ensure();
  const r = (await read(`SELECT id, name, channel, creator, status FROM access.requests WHERE id = $1`, [id]))[0];
  if (!r) return { status: 401, html: requestForm() };
  if (r.status === "approved") return { status: 302, location: await deps.brandLink(secret, r.channel) };
  if (r.status === "declined") return { status: 403, html: statusPage(r, { title: "Request not approved", body: `<p>Your request to see ${esc(r.creator || "this creator")}'s engaged views was not approved. Please reply to your contact at Digital Fox Talent.</p>` }) };
  return { status: 200, html: statusPage(r, { title: "Request sent", body: pendingBody(r) }) };
}

// POST of the request form.
export async function submitRequest(req, secret) {
  if (req.method !== "POST") return { status: 405, html: "Method not allowed" };
  if (!hasDatabase()) return { status: 503, html: requestForm("Requests are not available just now. Please reply to your contact at Digital Fox Talent.") };
  const b = body(req);
  if (clean(b.website, 200)) return { status: 200, html: statusPage({}, { title: "Request sent", body: pendingBody({}) }) }; // bot: say nothing
  const name = clean(b.name, 100), email = clean(b.email, 200).toLowerCase(), company = clean(b.company, 120), contact = clean(b.contact, 200), ch = clean(b.ch, 40);
  if (!name || !EMAIL_RE.test(email)) return { status: 400, html: requestForm("Please give your name and a valid work email.") };
  if (!CH_RE.test(ch)) return { status: 400, html: requestForm("This link does not say which creator it is for. Please ask your contact at Digital Fox Talent for the full link.") };
  let creator;
  try { creator = (await deps.creators(secret)).find(c => c.channel === ch && c.connected); }
  catch (e) { return { status: 503, html: requestForm("We could not check that creator just now. Please try again in a minute.") }; }
  if (!creator) return { status: 404, html: requestForm("We could not find a report for this creator. Please ask your contact at Digital Fox Talent for a new link.") };
  await ensure();
  const ip = ipHash(req, secret);
  // The same person asking again for the same creator: reuse their request, notify nobody twice.
  const again = (await read(`SELECT id, name, creator, status FROM access.requests WHERE email = $1 AND channel = $2 AND status <> 'declined' ORDER BY created_at DESC LIMIT 1`, [email, ch]))[0];
  if (again) return { status: 200, cookie: cookieFor(again.id, secret), html: statusPage(again, { title: "Request sent", body: pendingBody(again) }) };
  const [recent, pending] = await Promise.all([
    read(`SELECT count(*)::int AS n FROM access.requests WHERE ip_hash = $1 AND created_at > now() - interval '1 hour'`, [ip]),
    read(`SELECT count(*)::int AS n FROM access.requests WHERE status = 'pending'`),
  ]);
  if (recent[0].n >= PER_HOUR || pending[0].n >= MAX_PENDING) return { status: 429, html: requestForm("Too many requests just now. Please try again later, or reply to your contact at Digital Fox Talent.") };
  const id = crypto.randomBytes(16).toString("base64url");
  await write(`INSERT INTO access.requests (id, name, email, company, contact, channel, creator, ip_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, name, email, company || null, contact || null, ch, creator.name, ip]);
  const r = { id, name, email, company, contact, channel: ch, creator: creator.name };
  // A flood from many networks still reaches Tom at most NOTIFY_PER_HOUR times an hour; the rest wait on the review page.
  const lastHour = (await read(`SELECT count(*)::int AS n FROM access.requests WHERE notified > 0 AND created_at > now() - interval '1 hour'`))[0].n;
  let notified = 0;
  if (lastHour < NOTIFY_PER_HOUR) { try { notified = await notifyTeam(secret, r, creator.id); } catch (e) {} }
  if (notified) await write(`UPDATE access.requests SET notified = $2 WHERE id = $1`, [id, notified]);
  return { status: 200, cookie: cookieFor(id, secret), html: statusPage(r, { title: "Request sent", body: pendingBody(r) }) };
}

// The notification text becomes the subject of monday's email, so it is one short sentence. The details and the
// review link go in an update on the creator's Creator YouTube Access row, which the notification opens.
export function notificationText(r) {
  return (clean(r.name, 100) + (r.company ? " from " + clean(r.company, 120) : "") + " wants to see engaged views for " + clean(r.creator, 100)).slice(0, 250);
}
export function updateBody(r) {
  const line = (k, v) => v ? `${k}: ${esc(v)}<br>` : "";
  return `<p><b>Access request for engaged views</b></p><p>${line("Name", r.name)}${line("Company", r.company)}${line("Email", r.email)}${line("Shared by", r.contact)}</p>`
    + `<p><a href="${ORIGIN + REVIEW_PATH}">Approve or decline</a></p>`;
}
async function notifyTeam(secret, r, itemId) {
  const users = new Set([TOM]);
  const m = String(r.contact || "").toLowerCase().match(/[a-z0-9._%+-]+@digitalfoxtalent\.com/);
  if (m) { try { for (const u of await deps.lookupUsers(secret, m[0])) users.add(Number(u)); } catch (e) {} }
  let postId = null;
  try { postId = await deps.postUpdate(secret, itemId, updateBody(r)); } catch (e) {}
  const text = notificationText(r);
  let n = 0;
  for (const u of users) { try { await deps.notify(secret, u, postId || itemId, text, postId ? "Post" : "Project"); n++; } catch (e) {} }
  return n;
}
async function mondayNotify(token, user, targetId, text, type) {
  const t = type === "Post" ? "Post" : "Project";
  await mondayCall(token, `mutation ($u: ID!, $t: ID!, $x: String!) { create_notification(user_id:$u, target_id:$t, target_type:${t}, text:$x) { text } }`, { u: String(user), t: String(targetId), x: text });
}
async function mondayUpdate(token, itemId, body) {
  const d = await mondayCall(token, "mutation ($i: ID!, $b: String!) { create_update(item_id:$i, body:$b) { id } }", { i: String(itemId), b: body });
  return d && d.create_update && d.create_update.id;
}
async function mondayUsers(token, email) {
  const d = await mondayCall(token, "query ($e: [String]) { users(emails:$e, kind:non_guests) { id enabled } }", { e: [email] });
  return ((d && d.users) || []).filter(u => u.enabled).map(u => u.id);
}

// ---------- team review ----------
export async function reviewPage(req, secret, email, flash) {
  if (!hasDatabase()) return { status: 503, html: "The Ecosystem database is not connected yet." };
  await ensure();
  const [pending, recent] = await Promise.all([
    read(`SELECT id, created_at, name, email, company, contact, creator FROM access.requests WHERE status = 'pending' ORDER BY created_at`),
    read(`SELECT id, created_at, name, email, company, creator, status, decided_by, decided_at FROM access.requests WHERE status <> 'pending' ORDER BY decided_at DESC NULLS LAST LIMIT 25`),
  ]);
  const when = d => esc(new Date(d).toISOString().slice(0, 16).replace("T", " ")) + " UTC";
  const who = r => `<b>${esc(r.name)}</b><br><span class="muted">${esc(r.email)}${r.company ? " · " + esc(r.company) : ""}</span>`;
  const rows = pending.map(r => `<tr><td>${who(r)}</td><td>${esc(r.creator)}</td><td>${esc(r.contact || "")}</td><td>${when(r.created_at)}</td><td>
<form method="post" action="${REVIEW_PATH}"><input type="hidden" name="id" value="${esc(r.id)}"><input type="hidden" name="do" value="approve"><button type="submit">Approve</button></form>
<form method="post" action="${REVIEW_PATH}"><input type="hidden" name="id" value="${esc(r.id)}"><input type="hidden" name="do" value="decline"><button class="ghost" type="submit">Decline</button></form></td></tr>`).join("");
  const done = recent.map(r => `<tr><td>${who(r)}</td><td>${esc(r.creator)}</td><td class="${r.status === "approved" ? "good" : "bad"}">${r.status === "approved" ? "Approved" : "Declined"}</td><td>${esc(r.decided_by || "")}<br><span class="muted">${r.decided_at ? when(r.decided_at) : ""}</span></td></tr>`).join("");
  return { status: 200, html: shell("Access requests", `<main class="wide"><p class="muted"><a href="/">Ecosystem</a> / <a href="/reporting">Reporting</a> / Access requests</p>
<h1>Access requests</h1><p>People outside DFT asking to see a creator's engaged views from a link we sent them. Approving shares only that creator's brand-safe engaged views page, the same one each panel offers to copy into a reply. Nothing is emailed: reply to them yourself and tell them to open the link again.</p>
${flash || ""}
<h2>Waiting (${pending.length})</h2>${pending.length ? `<div class="card"><table><thead><tr><th>Who</th><th>Creator</th><th>Shared by</th><th>Asked</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="muted">Nothing waiting.</p>`}
<h2>Recent decisions</h2>${recent.length ? `<div class="card"><table><thead><tr><th>Who</th><th>Creator</th><th>Decision</th><th>By</th></tr></thead><tbody>${done}</tbody></table></div>` : `<p class="muted">None yet.</p>`}
</main>`) };
}

export async function decide(req, secret, email) {
  if (req.method !== "POST") return reviewPage(req, secret, email);
  if (!sameOrigin(req)) return { status: 403, html: "Forbidden" };
  if (!hasDatabase()) return { status: 503, html: "The Ecosystem database is not connected yet." };
  await ensure();
  const b = body(req), id = clean(b.id, 40), what = clean(b.do, 10);
  if (!/^[A-Za-z0-9_-]{22}$/.test(id) || !/^(approve|decline)$/.test(what)) return { status: 400, html: "Bad request" };
  const status = what === "approve" ? "approved" : "declined";
  const r = (await write(`UPDATE access.requests SET status = $2, decided_by = $3, decided_at = now() WHERE id = $1 AND status = 'pending' RETURNING name, email, channel, creator`, [id, status, email]))[0];
  if (!r) return reviewPage(req, secret, email, `<p class="bad">That request was already decided.</p>`);
  let flash = `<div class="card"><p class="${status === "approved" ? "good" : "bad"}"><b>${status === "approved" ? "Approved" : "Declined"}:</b> ${esc(r.name)} (${esc(r.email)}) for ${esc(r.creator)}.</p>`;
  if (status === "approved") {
    let link = "";
    try { link = await deps.brandLink(secret, r.channel); } catch (e) {}
    flash += `<p>Reply to them: "You're approved. Open the same link again and it will take you to the report." ${link ? `They will land on this page, which you can also send directly: <code>${esc(link)}</code>` : ""}</p>`;
  }
  return reviewPage(req, secret, email, flash + `</div>`);
}
