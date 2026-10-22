// Tests for request access on Engaged views links (api/_reports/access-requests.js). In-memory Postgres
// (PGlite) and fake monday calls, so nothing real is touched.
//   npm install --no-save @electric-sql/pglite@0.3.15 && node test/access.mjs

import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setExecutor, read } from "../api/_reports/mirror/db.js";
import { setDeps, requestForm, submitRequest, outsiderView, decide, reviewPage, requestIdFromCookie } from "../api/_reports/access-requests.js";

const pg = new PGlite();
setExecutor({
  read: async (t, p) => (await pg.query(t, p)).rows,
  write: async (t, p) => (await pg.query(t, p)).rows,
  batch: async list => { const out = []; for (const [t, p] of list) out.push((await pg.query(t, p)).rows); return out; },
});
const SECRET = "test-secret-not-real";
const CH = "UCLJvwQ-173AlbFt7zvPl-CQ", OFF = "UCaaaaaaaaaaaaaaaaaaaaaa";
const notes = [];
setDeps({
  creators: async () => [{ id: "111", name: "The Perfect Mix", channel: CH, connected: true }, { id: "222", name: "Not Connected", channel: OFF, connected: false }],
  brandLink: async (s, ch) => "https://connect.digitalfoxtalent.com/api/views?k=" + ch + "&t=sig",
  notify: async (s, user, item, text) => { notes.push({ user, item, text }); },
  lookupUsers: async (s, email) => email === "margot@digitalfoxtalent.com" ? [999] : [],
});

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const reqOf = (o = {}) => Object.assign({ method: "GET", headers: { "x-real-ip": o.ip || "1.2.3.4", cookie: o.cookie || "", origin: o.origin }, body: o.body || {} }, o.method ? { method: o.method } : {});
const cookieVal = c => c.split(";")[0];

// form
const f = requestForm();
ok(/name="website"/.test(f) && /action="\/reporting\/request-access"/.test(f), "form posts to request-access with a honeypot");
ok(/location\.hash/.test(f), "form reads the creator from the link");

// no cookie -> form
let out = await outsiderView(reqOf(), SECRET);
ok(out.status === 401 && /Request access/.test(out.html), "outsider without a request sees the form");

// a good request
out = await submitRequest(reqOf({ method: "POST", body: { name: "Irina <b>Popel</b>", email: "I.Popel@zorka.agency", company: "Zorka.Agency", contact: "Margot margot@digitalfoxtalent.com", ch: CH } }), SECRET);
ok(out.status === 200 && out.cookie && /HttpOnly/.test(out.cookie) && /SameSite=Lax/.test(out.cookie), "request stored, signed cookie set");
ok(!/<b>Popel/.test(out.html), "requester name escaped");
const cookie = cookieVal(out.cookie);
const id = requestIdFromCookie(reqOf({ cookie }), SECRET);
let row = (await read(`SELECT * FROM access.requests WHERE id = $1`, [id]))[0];
ok(row && row.status === "pending" && row.email === "i.popel@zorka.agency" && row.creator === "The Perfect Mix", "row saved, email lowercased, creator named");
ok(notes.length === 2 && notes.some(n => n.user === 40241658) && notes.some(n => n.user === 999) && notes.every(n => n.item === "111"), "Tom and the named teammate notified on the creator's row");
ok(row.notified === 2, "notification count recorded");

// pending view
out = await outsiderView(reqOf({ cookie }), SECRET);
ok(out.status === 200 && /with the Digital Fox Talent team/.test(out.html), "pending request says it is with the team");

// tampered cookie
out = await outsiderView(reqOf({ cookie: cookie.slice(0, -2) + "xx" }), SECRET);
ok(out.status === 401 && /Request access/.test(out.html), "tampered cookie is ignored");
ok(requestIdFromCookie(reqOf({ cookie }), "other-secret") === null, "cookie signed with the server secret");

// same person again: no new row, no new notification
const before = notes.length;
out = await submitRequest(reqOf({ method: "POST", body: { name: "Irina", email: "i.popel@zorka.agency", ch: CH } }), SECRET);
ok(cookieVal(out.cookie) === cookie && notes.length === before, "repeat request reuses the first one");
ok((await read(`SELECT count(*)::int AS n FROM access.requests`))[0].n === 1, "still one row");

// invalid input
out = await submitRequest(reqOf({ method: "POST", body: { name: "A", email: "nope", ch: CH } }), SECRET);
ok(out.status === 400, "bad email refused");
out = await submitRequest(reqOf({ method: "POST", body: { name: "A", email: "a@b.co", ch: "javascript:alert(1)" } }), SECRET);
ok(out.status === 400, "bad channel refused");
out = await submitRequest(reqOf({ method: "POST", body: { name: "A", email: "a@b.co", ch: OFF } }), SECRET);
ok(out.status === 404, "creator not connected: refused, nothing stored");
out = await submitRequest(reqOf({ method: "POST", body: { name: "Bot", email: "bot@b.co", ch: CH, website: "http://spam" } }), SECRET);
ok(out.status === 200 && !out.cookie && (await read(`SELECT count(*)::int AS n FROM access.requests`))[0].n === 1, "honeypot: looks fine, stores nothing");
out = await submitRequest(reqOf({ body: {} }), SECRET);
ok(out.status === 405, "GET to the request endpoint refused");

// rate limit: 5 an hour from one network
for (let i = 0; i < 4; i++) await submitRequest(reqOf({ method: "POST", ip: "9.9.9.9", body: { name: "P" + i, email: "p" + i + "@x.co", ch: CH } }), SECRET);
out = await submitRequest(reqOf({ method: "POST", ip: "9.9.9.9", body: { name: "P5", email: "p5@x.co", ch: CH } }), SECRET);
ok(out.status === 200, "fifth request from one network allowed");
out = await submitRequest(reqOf({ method: "POST", ip: "9.9.9.9", body: { name: "P6", email: "p6@x.co", ch: CH } }), SECRET);
ok(out.status === 429, "sixth in an hour refused");

// team review
out = await reviewPage(reqOf(), SECRET, "tom@digitalfoxtalent.com");
ok(out.status === 200 && /Waiting \(6\)/.test(out.html) && !/<b>Popel/.test(out.html) && /Irina &lt;b&gt;Popel/.test(out.html), "review page lists pending, escaped");
out = await decide(reqOf({ method: "POST", origin: "https://evil.example", body: { id, do: "approve" } }), SECRET, "tom@digitalfoxtalent.com");
ok(out.status === 403, "decision from another site refused");
out = await decide(reqOf({ method: "POST", origin: "https://ecosystem.digitalfoxtalent.com", body: { id: "x' OR 1=1 --", do: "approve" } }), SECRET, "tom@digitalfoxtalent.com");
ok(out.status === 400, "bad id refused");
out = await decide(reqOf({ method: "POST", origin: "https://ecosystem.digitalfoxtalent.com", body: { id, do: "approve" } }), SECRET, "margot@digitalfoxtalent.com");
ok(out.status === 200 && /Approved/.test(out.html) && /connect\.digitalfoxtalent\.com/.test(out.html), "approve shows the brand link to send");
row = (await read(`SELECT * FROM access.requests WHERE id = $1`, [id]))[0];
ok(row.status === "approved" && row.decided_by === "margot@digitalfoxtalent.com", "decision and who recorded");
out = await decide(reqOf({ method: "POST", origin: "https://ecosystem.digitalfoxtalent.com", body: { id, do: "decline" } }), SECRET, "tom@digitalfoxtalent.com");
ok(/already decided/.test(out.html) && (await read(`SELECT status FROM access.requests WHERE id = $1`, [id]))[0].status === "approved", "a decided request cannot be flipped by a second click");

// approved -> straight to that creator's brand-safe page
out = await outsiderView(reqOf({ cookie }), SECRET);
ok(out.status === 302 && out.location === "https://connect.digitalfoxtalent.com/api/views?k=" + CH + "&t=sig", "approved request opens only that creator's brand page");

// declined
const other = (await read(`SELECT id FROM access.requests WHERE email = 'p0@x.co'`))[0].id;
await decide(reqOf({ method: "POST", body: { id: other, do: "decline" } }), SECRET, "tom@digitalfoxtalent.com");
const signC = (await submitRequest(reqOf({ method: "POST", ip: "7.7.7.7", body: { name: "P0", email: "p0@x.co", ch: CH } }), SECRET));
ok(signC.status === 200, "after a decline the person can ask again");

console.log("access tests passed: " + pass);
