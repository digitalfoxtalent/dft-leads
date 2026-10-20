// Replays Margot's Displate case (20 Oct 2026): Gmail files a teammate's draft outside the brand's thread unless it
// accepts the reply headers. teamDraft must read each draft back and only keep one that landed in the thread.
// Run: node test/team-draft-thread.mjs
import assert from "node:assert/strict";
import crypto from "node:crypto";
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.GMAIL_DELEGATE_KEY = JSON.stringify({ client_email: "t@x", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) });
process.env.MONDAY_API_KEY = "x";
const { teamDraft } = await import("../api/roster.js");

const T = "thr1";
const msg = (id, labels, mid, refs) => ({ id, labelIds: labels, payload: { headers: [{ name: "Message-ID", value: mid }, { name: "Subject", value: "Re: Displate x Colton Ogburn" }].concat(refs ? [{ name: "References", value: refs }] : []) } });
const thread = { id: T, messages: [msg("a", ["INBOX"], "<a@x>"), msg("b", ["INBOX"], "<b@x>", "<a@x>"), msg("c", ["SENT"], "<c@x>", "<a@x> <b@x>")] };

function run(acceptsWhen) {
  const log = { created: [], deleted: [], trashed: [] }; let n = 0;
  globalThis.fetch = async (url, opt = {}) => {
    const ok = j => ({ ok: true, status: 200, text: async () => JSON.stringify(j), json: async () => j });
    if (/oauth2/.test(url)) return ok({ access_token: "tok" });
    const u = String(url).replace("https://gmail.googleapis.com/gmail/v1/users/me", "");
    if (u.startsWith("/messages?")) return ok(/in%3Asent.*newer_than%3A7d$/.test(u) && !/subject/.test(u) ? { messages: [{ id: "c", threadId: T }] } : { messages: [{ id: "c", threadId: T }] });
    if (u.startsWith("/threads/")) return ok(thread);
    if (u.startsWith("/drafts?")) return ok({ drafts: [] });
    if (u === "/drafts" && opt.method === "POST") {
      const raw = Buffer.from(JSON.parse(opt.body).message.raw, "base64url").toString("utf8");
      const hdr = n => (raw.match(new RegExp("^" + n + ": (.*)$", "mi")) || [])[1] || "";
      const h = { irt: hdr("In-Reply-To"), refs: hdr("References"), subject: hdr("Subject") };
      log.created.push(h); n++;
      return ok({ id: "d" + n, message: { id: "m" + n, threadId: acceptsWhen(h) ? T : "elsewhere" + n } });
    }
    if (/^\/drafts\/d\d+$/.test(u) && opt.method === "DELETE") { log.deleted.push(u); return ok({}); }
    if (/\/trash$/.test(u)) { log.trashed.push(u); return ok({}); }
    throw new Error("unexpected " + u);
  };
  return { log, go: () => teamDraft("margot@digitalfoxtalent.com", { search: "in:sent x", to: "gautier@influblast.agency", cc: "", subject: "Re: Displate x Colton Ogburn", html: "<p>hi</p>", text: "hi" }) };
}

// 1. Gmail accepts the first headers: one draft, nothing deleted, forward trashed.
{ const { log, go } = run(() => true); assert.equal(await go(), true); assert.equal(log.created.length, 1); assert.equal(log.deleted.length, 0); assert.equal(log.trashed.length, 1);
  assert.equal(log.created[0].irt, "<b@x>"); assert.equal(log.created[0].refs, "<a@x> <b@x>", "replies to the brand's last message with its own chain, no duplicate id"); }
// 2. Gmail splits the first draft off but accepts the second: the stray one is deleted, the threaded one kept.
{ const { log, go } = run(h => h.refs === "<b@x>"); assert.equal(await go(), true); assert.equal(log.created.length, 2); assert.deepEqual(log.deleted, ["/drafts/d1"]); }
// 3. Gmail splits every attempt: exactly one draft survives (the last), and the board is told it is outside the thread.
{ const { log, go } = run(() => false); const r = await go(); assert.equal(r, "outside the thread"); assert.equal(log.deleted.length, log.created.length - 1); }
console.log("team-draft-thread: all 3 cases pass");
