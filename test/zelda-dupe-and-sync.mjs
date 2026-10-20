// Replays the 20 Oct 2026 Zelda case. Run: node test/zelda-dupe-and-sync.mjs
// Tom emailed Christian Cooper at Golin on 19 Oct about "The Legend of Zelda: Ocarina of Time (Switch 2)", the row on
// George's Studio board. The release finder had added "...Ocarina of Time (2026)" to Tom's board the same morning
// without the Golin contact, and the sent-mail sync only read Tom's board, so nothing was marked and the 2:30pm alert
// said nobody had contacted Nintendo.
// Fixed: (1) the duplicate check ignores a trailing platform/year bracket; (2) the sync also reads Game rows on
// George's board and flips them to Contacted with a note.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { isDupe, coreName } from "../api/release-finder.js";

// 1. Duplicate check
// Built the way the release finder builds its list of existing rows (same norm as api/release-finder.js).
const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\b(the|a|an)\b/g, " ").replace(/\s+/g, " ").trim();
const ex = (name, type) => ({ n: norm(name), core: coreName(name), type });
const board = [ex("The Legend of Zelda: Ocarina of Time (Switch 2)", "Game"), ex("Resident Evil 2 (Switch 2)", "Game"), ex("Dune (2026)", "Film")];
assert.equal(isDupe("The Legend of Zelda: Ocarina of Time (2026)", "Game", board), true, "the Zelda pair is one release");
assert.equal(isDupe("Resident Evil 3 (Switch 2)", "Game", board), false, "RE3 is not RE2");
assert.equal(isDupe("Dune (PS5)", "Game", board), false, "a game is not the film of the same name");
assert.equal(isDupe("Resident Evil 2", "Game", board), true, "the old contains rule still holds");
assert.equal(isDupe("Halo (2026)", "Game", [ex("Halo Infinite (Xbox)", "Game")]), false, "different titles stay apart");
console.log("ok  duplicate check");

// 2. Sent-mail sync, with monday and Gmail mocked
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.GMAIL_DELEGATE_KEY = JSON.stringify({ client_email: "t@x.iam", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) });
process.env.MONDAY_API_KEY = "k"; process.env.CRON_SECRET = "s";
const cv = o => Object.entries(o).map(([id, text]) => ({ id, text }));
const boards = {
  "18435939296": [{ id: "13325694817", name: "The Legend of Zelda: Ocarina of Time (2026)", column_values: cv({ color_mm5bmek5: "Not started", text_mm5baenw: "nintendo.com", long_text_mm7v8xhz: "Checked 2026-10-20 | nothing\nNONE", color_mm5bqrxh: "Game" }) }],
  "18415007170": [
    { id: "13150756636", name: "The Legend of Zelda: Ocarina of Time (Switch 2)", column_values: cv({ color_mm5bmek5: "Not started", text_mm5baenw: "nintendo.com", email_mm5bfw35: "ccooper@golin.com", color_mm5bqrxh: "Game" }) },
    { id: "12569715674", name: "Apple MacBook Pro (OLED, M6)", column_values: cv({ color_mm5bmek5: "Not started", text_mm5baenw: "apple.com", email_mm5bfw35: "mcalleja@apple.com", color_mm5bqrxh: "Tech" }) },
    { id: "999", name: "The Legend of Zelda (film)", column_values: cv({ color_mm5bmek5: "Not started", email_mm5bfw35: "ccooper@golin.com", color_mm5bqrxh: "Film" }) },
  ],
};
const writes = [];
const sent = { id: "m1", threadId: "1a154c92505946f1", internalDate: String(Date.parse("2026-10-19T17:33:34Z")), snippet: "",
  payload: { headers: [{ name: "To", value: "ccooper@golin.com" }, { name: "Cc", value: "alex@digitalfoxtalent.com, george@digitalfoxtalent.com" }, { name: "Subject", value: "Creator partnerships for The Legend of Zelda: Ocarina of Time (Switch 2)" }],
    mimeType: "text/plain", body: { data: Buffer.from("Hi Christian, I hope you had a lovely weekend. The Legend of Zelda: Ocarina of Time (Switch 2) is right in our creators' wheelhouse.").toString("base64url") } } };
const sent2 = { id: "m2", threadId: "1a156471cd83f7b4", internalDate: String(Date.parse("2026-10-19T22:47:06Z")), snippet: "",
  payload: { headers: [{ name: "To", value: "mr_delrio@apple.com" }, { name: "Cc", value: "alex@digitalfoxtalent.com" }, { name: "Subject", value: "Creator partnerships for Apple MacBook Pro (OLED, M6)" }],
    mimeType: "text/plain", body: { data: Buffer.from("Hi Michelle, We'd love to help get Apple MacBook Pro (OLED, M6) in front of their audiences.").toString("base64url") } } };
globalThis.fetch = async (url, opt = {}) => {
  const json = d => ({ ok: true, json: async () => d });
  if (String(url).includes("oauth2.googleapis.com")) return json({ access_token: "tok" });
  if (String(url).includes("/messages?")) return json({ messages: [{ id: "m1" }, { id: "m2" }] });
  if (String(url).includes("/messages/m2")) return json(sent2);
  if (String(url).includes("/messages/m1")) return json(sent);
  const { query, variables } = JSON.parse(opt.body);
  const m = query.match(/boards\(ids:\[(\d+)\]\)/);
  if (m) return json({ data: { boards: [{ groups: [{ items_page: { items: boards[m[1]] } }] }] } });
  writes.push({ query, variables }); return json({ data: {} });
};
const { default: handler } = await import("../api/tom-sent-sync.js");
const run = async () => { let out; await handler({ headers: { authorization: "Bearer s" }, query: {} }, { status() { return this; }, json(o) { out = o; return o; } }); return out; };

const out = await run();
assert.deepEqual(out.written.map(w => w.title).sort(), ["Apple MacBook Pro (OLED, M6)", "The Legend of Zelda: Ocarina of Time (Switch 2)"], "the Zelda game row and the MacBook tech row: " + JSON.stringify(out.written));
assert.ok(out.written.every(w => w.board === "studio"));
const flip = writes.find(w => w.query.includes("change_multiple_column_values") && w.variables.i === "13150756636");
assert.equal(flip.variables.b, "18415007170"); assert.equal(flip.variables.i, "13150756636");
assert.deepEqual(JSON.parse(flip.variables.v), { color_mm5bmek5: { label: "Contacted" } }, "only the status changes on George's board");
const note = writes.find(w => w.query.includes("create_update"));
assert.match(note.variables.t, /Tom emailed ccooper@golin\.com about this title on 2026-10-19/);
assert.ok(!writes.some(w => w.variables && w.variables.i === "999"), "the film row is left alone");
console.log("ok  sync marks the game and tech rows on George's board, not the film");

// Once the row is Contacted, the next day's run leaves it (no second note)
boards["18415007170"][0].column_values = cv({ color_mm5bmek5: "Contacted", text_mm5baenw: "nintendo.com", email_mm5bfw35: "ccooper@golin.com", color_mm5bqrxh: "Game" });
boards["18415007170"][1].column_values = cv({ color_mm5bmek5: "Contacted", text_mm5baenw: "apple.com", email_mm5bfw35: "mcalleja@apple.com", color_mm5bqrxh: "Tech" });
writes.length = 0;
assert.equal((await run()).written.length, 0); assert.equal(writes.length, 0);
console.log("ok  no repeat on the next run");

// Tom's own board still works as before: with Christian on the row, the date and link are written
boards["18435939296"][0].column_values = cv({ color_mm5bmek5: "Not started", text_mm5baenw: "nintendo.com", email_mm5bfw35: "ccooper@golin.com", color_mm5bqrxh: "Game" });
writes.length = 0;
const out2 = await run();
const tw = writes.find(w => w.variables && w.variables.b === "18435939296");
assert.ok(tw, "Tom's row written"); const v = JSON.parse(tw.variables.v);
assert.equal(v.date_mm88ncxq.date, "2026-10-19"); assert.equal(v.color_mm5bmek5.label, "Contacted");
assert.match(v.link_mm88t2fs.url, /1a154c92505946f1$/);
console.log("ok  Tom's board unchanged in behaviour", out2.written.length);
console.log("all passed");
