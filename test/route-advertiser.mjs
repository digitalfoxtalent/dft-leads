// Tests for the router's advertiser check (route-enquiry.js advertiserCheck). In-memory Postgres, monday and Gmail faked.
//   npm install --no-save @electric-sql/pglite@0.3.15 && node test/route-advertiser.mjs

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { setExecutor, write } from "../api/_reports/mirror/db.js";

const pg = new PGlite();
setExecutor({
  read: async (t, p) => (await pg.query(t, p)).rows,
  write: async (t, p) => (await pg.query(t, p)).rows,
  batch: async list => { const out = []; for (const [t, p] of list) out.push((await pg.query(t, p)).rows); return out; },
});
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.GMAIL_DELEGATE_KEY = JSON.stringify({ client_email: "x@y", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) });
process.env.MONDAY_API_KEY = "k";

const ALEX = 54957240, TOM = 40241658;
const person = id => JSON.stringify({ personsAndTeams: [{ id, kind: "person" }] });
let items = [
  { id: "1", name: "Quince_TRR_November_2026", created_at: "2026-10-12T15:00:00Z", group: { title: "Campaigns Active" }, column_values: [{ value: person(ALEX) }] },
  { id: "2", name: "WesNemo_Northgard_Oct2026", created_at: "2026-10-12T15:00:00Z", group: { title: "Campaign Contract Review Stage" }, column_values: [{ value: person(ALEX) }] },
  { id: "3", name: "Tom's own deal", created_at: "2026-10-12T15:00:00Z", group: { title: "Campaigns Active" }, column_values: [{ value: person(TOM) }] },
  { id: "4", name: "Old_2025", created_at: "2025-12-18T09:00:00Z", group: { title: "Campaigns Active" }, column_values: [{ value: person(ALEX) }] },
  { id: "5", name: "Paid_Deal", created_at: "2026-10-12T15:00:00Z", group: { title: "Complete - Creators Paid" }, column_values: [{ value: person(ALEX) }] },
  { id: "6", name: "Brand new deal", created_at: new Date().toISOString(), group: { title: "Campaign Opportunities" }, column_values: [{ value: person(ALEX) }] }
];
const sent = [];
globalThis.fetch = async (url, opt = {}) => {
  const u = String(url);
  const res = j => ({ ok: true, status: 200, json: async () => j });
  if (u.includes("oauth2.googleapis.com")) return res({ access_token: "t" });
  if (u.includes("api.monday.com")) return res({ data: { boards: [{ columns: [{ settings_str: JSON.stringify({ labels: [{ id: 146, name: "Quince" }, { id: 1, name: "Displate" }] }) }], items_page: { items } }] } });
  if (u.includes("/messages/send")) {
    const raw = Buffer.from(JSON.parse(opt.body).raw, "base64url").toString();
    const to = raw.match(/^To: (.*)$/m)[1];
    const subj = Buffer.from(raw.match(/^Subject: =\?UTF-8\?B\?(.*)\?=$/m)[1], "base64").toString();
    const html = Buffer.from(raw.split("\r\n\r\n")[1], "base64").toString();
    sent.push({ to, subj, html });
    return res({ id: "s" });
  }
  throw new Error("unexpected fetch " + u);
};
const { advertiserCheck } = await import("../api/route-enquiry.js");
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const run = async dry => { const report = []; await advertiserCheck({ dry, report, forceAdv: true }); return report; };

// Dry run: reports, sends nothing, records nothing.
let rep = await run(true);
ok(rep.length === 2 && sent.length === 0, "dry run reports the two due deals and sends nothing");

// First pass: Alex gets two emails, Tom gets none, the old, paid, Tom-led and brand-new deals are skipped.
rep = await run(false);
ok(sent.length === 2, "two asks sent");
ok(sent.every(s => s.to === "alex@digitalfoxtalent.com"), "only the sales lead, never Tom");
const q = sent.find(s => s.subj.includes("Quince"));
ok(q.subj === "Please add the advertiser: Quince_TRR_November_2026", "clear subject");
ok(/ADVERTISER/.test(q.html) && /looks like <b>Quince<\/b>/.test(q.html) && /pulses\/1/.test(q.html), "says what to set, suggests Quince, links the deal");
const w = sent.find(s => s.subj.includes("WesNemo"));
ok(!/looks like/.test(w.html) && /type its name and press Enter/.test(w.html), "no guess when the name has no known advertiser");
ok(!sent.some(s => /[—–]/.test(s.html + s.subj)), "no dashes");

// Same day again: nothing new.
rep = await run(false);
ok(sent.length === 2 && rep.length === 0, "nothing repeats inside a working day");

// A working day later: one reminder each, then never again.
await write("UPDATE router_seen SET at = now() - interval '7 days' WHERE msg_id LIKE 'adv1:%'");
rep = await run(false);
ok(sent.length === 4 && sent.slice(2).every(s => s.subj.startsWith("Reminder, advertiser still missing: ")), "one reminder each");
rep = await run(false);
ok(sent.length === 4, "no third email");

// Advertiser set: the board stops returning it, so nothing is sent for it.
items = items.filter(i => i.id !== "6");
await pg.query("DELETE FROM router_seen");
items = items.filter(i => i.id !== "1");
rep = await run(false);
ok(sent.length === 5 && sent[4].subj.includes("WesNemo"), "a deal with the advertiser set is never chased");

console.log("route-advertiser: " + pass + " checks passed");
