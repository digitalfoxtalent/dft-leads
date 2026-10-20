// Replays Margot's Displate case (20 Oct 2026). Gmail files a teammate's draft outside the brand's thread unless it
// accepts the reply headers, and the reply to the create call can still name the thread it was asked for. So teamDraft
// must read each draft back (the draft and the thread) and only keep one the thread really lists.
// Run: node test/team-draft-thread.mjs
import assert from "node:assert/strict";
import crypto from "node:crypto";
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.GMAIL_DELEGATE_KEY = JSON.stringify({ client_email: "t@x", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) });
process.env.MONDAY_API_KEY = "x";
const { teamDraft, teamDraftReady } = await import("../api/roster.js");
const realTimeout = globalThis.setTimeout; globalThis.setTimeout = (f) => realTimeout(f, 0); // no real waits in tests

const T = "thr1", SUBJ = "Re: Displate x Colton Ogburn";
const b64 = s => Buffer.from(s, "utf8").toString("base64url");
const msg = (id, labels, mid, refs) => ({ id, threadId: T, labelIds: labels, payload: { headers: [{ name: "Message-ID", value: mid }, { name: "Subject", value: "Displate x Colton Ogburn" }].concat(refs ? [{ name: "References", value: refs }] : []) } });

// accepts(h): does Gmail really join the draft to the thread? echo: does the create reply claim the thread regardless?
function run(accepts, { echo = false, existing = [] } = {}) {
  const thread = { id: T, messages: [msg("a", ["INBOX"], "<a@x>"), msg("b", ["INBOX"], "<b@x>", "<a@x>"), msg("c", ["SENT"], "<c@x>", "<a@x> <b@x>")] };
  const drafts = new Map(existing.map(d => [d.id, d]));
  const log = { created: [], deleted: [], trashed: [] }; let n = 0;
  globalThis.fetch = async (url, opt = {}) => {
    const ok = j => ({ ok: true, status: 200, text: async () => JSON.stringify(j), json: async () => j });
    if (/oauth2/.test(url)) return ok({ access_token: "tok" });
    const u = String(url).replace("https://gmail.googleapis.com/gmail/v1/users/me", "");
    if (u.startsWith("/messages?")) return ok({ messages: [{ id: "c", threadId: T }] });
    if (u.startsWith("/threads/")) return ok({ id: T, messages: thread.messages.concat([...drafts.values()].filter(d => d.message.threadId === T).map(d => ({ id: d.message.id, threadId: T, labelIds: ["DRAFT"] }))) });
    if (u.startsWith("/drafts?")) return ok({ drafts: [...drafts.values()].map(d => ({ id: d.id, message: { id: d.message.id, threadId: d.message.threadId } })) });
    if (u === "/drafts" && opt.method === "POST") {
      const raw = Buffer.from(JSON.parse(opt.body).message.raw, "base64url").toString("utf8");
      const hdr = k => (raw.match(new RegExp("^" + k + ": (.*)$", "mi")) || [])[1] || "";
      const h = { irt: hdr("In-Reply-To"), refs: hdr("References"), subject: hdr("Subject") };
      log.created.push(h); n++;
      const real = accepts(h) ? T : "elsewhere" + n;
      const d = { id: "d" + n, message: { id: "m" + n, threadId: real, payload: { headers: [{ name: "Subject", value: h.subject }] } } };
      drafts.set(d.id, d);
      return ok({ id: d.id, message: { id: d.message.id, threadId: echo ? T : real } });
    }
    const dm = u.match(/^\/drafts\/(\w+)(\?.*)?$/);
    if (dm && opt.method === "DELETE") { drafts.delete(dm[1]); log.deleted.push(dm[1]); return ok({}); }
    if (dm) return ok(drafts.get(dm[1]) || {});
    if (/\/trash$/.test(u)) { log.trashed.push(u); return ok({}); }
    throw new Error("unexpected " + u);
  };
  const o = { search: "in:sent x", to: "gautier@influblast.agency", cc: "", subject: SUBJ, html: "<p>hi</p>", text: "hi" };
  return { log, drafts, o, go: () => teamDraft("margot@digitalfoxtalent.com", o) };
}

// 1. Gmail accepts the first headers: one draft, read back in the thread, forward trashed.
{ const { log, drafts, go } = run(() => true); assert.equal(await go(), true); assert.equal(log.created.length, 1); assert.equal(log.deleted.length, 0); assert.equal(log.trashed.length, 1); assert.equal(drafts.size, 1);
  assert.equal(log.created[0].irt, "<b@x>"); assert.equal(log.created[0].refs, "<a@x> <b@x>", "replies to the brand's last message with its own chain"); }
// 2. Gmail splits the first draft off but accepts the second: the stray is deleted, the threaded one kept.
{ const { log, drafts, go } = run(h => h.refs === "<b@x>"); assert.equal(await go(), true); assert.equal(log.created.length, 2); assert.deepEqual(log.deleted, ["d1"]); assert.equal(drafts.size, 1); }
// 3. THE BUG: the create reply names the thread, but Gmail really filed the first draft elsewhere. The read-back
//    must catch it and move on to headers Gmail accepts (the old check trusted the create reply and stopped).
{ const { log, drafts, o, go } = run(h => h.refs === "<b@x>", { echo: true }); assert.equal(await go(), true); assert.equal(log.created.length, 2, "read-back caught the split draft"); assert.deepEqual(log.deleted, ["d1"]); assert.equal([...drafts.values()][0].message.threadId, T);
  assert.ok(o.draftLog.some(l => /try 1 .*NOT in the thread/.test(l)) && o.draftLog.some(l => /try 2 .*IN the thread/.test(l)), "row update explains each try"); }
// 4. Gmail splits every attempt: exactly one draft survives, the board is told, and the forward is NOT binned.
{ const { log, drafts, go } = run(() => false, { echo: true }); const r = await go(); assert.equal(r, "outside the thread"); assert.equal(drafts.size, 1); assert.equal(log.trashed.length, 0, "forward stays when the draft did not land"); }
// 5. Strays from earlier runs (same subject, our list link, outside the thread) are cleared; a hand-written draft is not.
{ const html = b64("<a href=\"https://roster-viewguarantee.digitalfoxtalent.com/r/displate-mg-b2d9a4\">Displate creator list</a>");
  const stray = { id: "old1", message: { id: "om1", threadId: "lost", payload: { headers: [{ name: "Subject", value: SUBJ }], parts: [{ body: { data: html } }] } } };
  const own = { id: "own1", message: { id: "om2", threadId: "lost2", payload: { headers: [{ name: "Subject", value: SUBJ }], parts: [{ body: { data: b64("my own note") } }] } } };
  const { log, drafts, go } = run(() => true, { existing: [stray, own] }); assert.equal(await go(), true);
  assert.ok(log.deleted.includes("old1"), "stray pitch draft removed"); assert.ok(!log.deleted.includes("own1"), "hand-written draft kept"); assert.ok(drafts.has("own1")); }
// 6. The teammate gets one email with a link that opens the draft itself; Tom gets none.
{ const { o, go } = run(() => true); await go();
  assert.match(o.draftUrl, /authuser=margot%40digitalfoxtalent\.com#drafts\?compose=/);
  const sent = []; const f0 = globalThis.fetch;
  globalThis.fetch = async (url, opt = {}) => { if (/messages\/send/.test(url)) { sent.push(Buffer.from(JSON.parse(opt.body).raw, "base64url").toString("utf8")); return { ok: true, status: 200, text: async () => "{}", json: async () => ({}) }; } return f0(url, opt); };
  await teamDraftReady("margot@digitalfoxtalent.com", Object.assign(o, { listUrl: "https://roster-viewguarantee.digitalfoxtalent.com/r/x", title: "Displate" }));
  await teamDraftReady("tom@digitalfoxtalent.com", o);
  assert.equal(sent.length, 1, "one email, to the teammate only");
  assert.match(sent[0], /^To: margot@digitalfoxtalent\.com$/m);
  const body = Buffer.from(sent[0].split("\r\n\r\n")[1], "base64").toString("utf8");
  assert.ok(body.includes(o.draftUrl.replace(/&/g, "&amp;")) && /Open the draft/.test(body) && /\/r\/x/.test(body)); }
console.log("team-draft-thread: all 6 cases pass");
