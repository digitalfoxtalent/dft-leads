// Replays the 19 Oct 2026 Volrusk case. Run: node test/creator-sent-check.mjs
// Tom emailed volrusk@gmail.com at 11:35am Denver; the creator alert still went out at 4pm because nothing marked the
// Target Creators row. Fixed: tom-sent-sync marks rows Tom has emailed (Outreach Status Done + Outreach Sent), and runs
// at 1:10pm on weekdays, before the 1:30pm creator alerts.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.GMAIL_DELEGATE_KEY = JSON.stringify({ client_email: "t@x.iam", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) });
process.env.MONDAY_API_KEY = "k"; process.env.CRON_SECRET = "s";

let creatorRows = [
  { id: "13320544987", name: "Volrusk", column_values: [{ text: "volrusk@gmail.com" }] },
  { id: "13320521848", name: "Snook", column_values: [{ text: "officialsnook23@gmail.com" }] },
  { id: "1", name: "No email yet", column_values: [{ text: "" }] },
];
const sent = { id: "m1", threadId: "1a15067613a587e0", internalDate: String(Date.parse("2026-10-19T17:35:57Z")), snippet: "",
  payload: { headers: [{ name: "To", value: "Volrusk <volrusk@gmail.com>" }, { name: "Cc", value: "alex@digitalfoxtalent.com" }, { name: "Subject", value: "Representation from Digital Fox Talent" }],
    mimeType: "text/plain", body: { data: Buffer.from("Hi Volrusk, I'm Tom James from Digital Fox Talent.").toString("base64url") } } };
// A late-evening Denver send that is already the next day in UTC: Outreach Sent must use the Denver date.
const late = { id: "m2", threadId: "t2", internalDate: String(Date.parse("2026-10-20T04:30:00Z")), snippet: "",
  payload: { headers: [{ name: "To", value: "officialsnook23@gmail.com" }, { name: "Subject", value: "Representation from Digital Fox Talent" }],
    mimeType: "text/plain", body: { data: Buffer.from("Hi Snook").toString("base64url") } } };
let messages = [sent];
const writes = [];
globalThis.fetch = async (url, opt = {}) => {
  const json = d => ({ ok: true, json: async () => d });
  if (String(url).includes("oauth2.googleapis.com")) return json({ access_token: "tok" });
  if (String(url).includes("/messages?")) return json({ messages: messages.map(m => ({ id: m.id })) });
  const mm = String(url).match(/\/messages\/(\w+)/); if (mm) return json(messages.find(m => m.id === mm[1]));
  const { query, variables } = JSON.parse(opt.body);
  if (query.includes("boards(ids:[18415381478])")) return json({ data: { boards: [{ items_page: { items: creatorRows } }] } });
  if (/boards\(ids:\[\d+\]\)/.test(query)) return json({ data: { boards: [{ groups: [{ items_page: { items: [] } }] }] } });
  writes.push({ query, variables }); return json({ data: {} });
};
const { default: handler, matchCreators } = await import("../api/tom-sent-sync.js");
const run = async () => { let out; await handler({ headers: { authorization: "Bearer s" }, query: {} }, { status() { return this; }, json(o) { out = o; return o; } }); return out; };

// Pure match
assert.deepEqual(matchCreators([{ id: "a", name: "A", email: " Volrusk@Gmail.com " }, { id: "b", name: "B", email: "" }], { "volrusk@gmail.com": { at: "2026-10-19", thread: "x" } }).map(c => c.id), ["a"]);
console.log("ok  exact address match, case and spaces ignored, blank emails skipped");

const out = await run();
assert.equal(out.creatorBoardRead, true);
assert.deepEqual(out.creators, [{ name: "Volrusk", email: "volrusk@gmail.com", date: "2026-10-19" }]);
const w = writes.find(x => x.variables && x.variables.b === "18415381478");
assert.equal(w.variables.i, "13320544987");
assert.deepEqual(JSON.parse(w.variables.v), { color_mm3tzck8: { label: "Done" }, date_mm7g7kp9: { date: "2026-10-19" } }, "same two columns the I've emailed them button writes");
assert.equal(writes.filter(x => x.variables && x.variables.b === "18415381478").length, 1, "Snook and the no-email row are left alone");
console.log("ok  Volrusk marked Done with Outreach Sent 19 Oct; Snook untouched");

// Denver date for a late-evening send
messages = [late]; writes.length = 0;
const out2 = await run();
assert.deepEqual(out2.creators.map(c => [c.name, c.date]), [["Snook", "2026-10-19"]], "9:30pm Denver on 19 Oct is recorded as 19 Oct");
console.log("ok  Outreach Sent uses the Denver date");

// Dry run writes nothing
writes.length = 0;
await handler({ headers: { authorization: "Bearer s" }, query: { dry: "1" } }, { status() { return this; }, json(o) { return o; } });
assert.equal(writes.length, 0);
console.log("ok  dry run writes nothing");

// The 1:10pm weekday run exists, and both runs fall before the 1:30pm Denver alert (19:30 UTC MDT, 20:30 UTC MST)
const crons = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url))).crons.filter(c => c.path.startsWith("/api/tom-sent-sync"));
assert.deepEqual(crons.map(c => c.schedule).sort(), ["10 19 * * 1-5", "20 13 * * *"]);
console.log("ok  runs at 13:20 daily and 19:10 UTC on weekdays");
console.log("all passed");
