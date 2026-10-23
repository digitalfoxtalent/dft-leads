// Tests for the contract alert email (api/contract-alert.js): the flag parser and the verdict
// line Tom worded on 23 Oct 2026. Pure functions, nothing is sent and nothing real is touched.
//   node test/contract-alert.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// The module imports api/route-enquiry.js for the owner map, which pulls in the database client,
// so lift out the two pure functions rather than importing the whole chain into a bare test.
const src = readFileSync(new URL("../api/contract-alert.js", import.meta.url), "utf8");
const cut = (from, to) => src.slice(src.indexOf(from), src.indexOf(to));
const ctx = { module: { exports: {} } };
vm.createContext(ctx);
vm.runInContext(
  cut('const BOARD = "', "const monday =")                       // the constants the two functions read
    + cut("export function parseFlags", "export default async function handler").replace(/export function/g, "function")
    + "\nmodule.exports = { parseFlags, alertEmail };", ctx);
const { parseFlags, alertEmail } = ctx.module.exports;

const base = { name: "Deal", item: "1", lead: "George Roush", label: "Review" };
const make = body => alertEmail({ ...base, review: body });

// Flags are "- <issue> Ask: <wording>" under a heading. Both "-" and "*" bullets are used.
const four = make(`Red Flags
- They can use it forever (5.5). Ask: Please limit it to 30 days.

Orange Flags
* Nobody has signed. Ask: Please send the final version.

Yellow Flags
- Swedish law applies. Ask: Would you accept US law?
- Advertiser field is empty.`);
const flags = parseFlags(`Red Flags
- a. Ask: A
Orange Flags
- b. Ask: B
Yellow Flags
- c.`);
assert.equal(flags.map(f => f.level).join(","), "red,orange,yellow"); // vm realm: compare values, not array identity
assert.equal(flags[0].ask, "A");
assert.equal(flags[2].ask, "", "an item with no Ask still appears, it just has nothing to send");

// The verdict ladder, exactly as Tom worded it.
assert.match(four.html, /Red flag · don't sign yet/, "any red flag means do not sign");
assert.match(make("Orange Flags\n- b. Ask: B").html, /Review yourself, and proceed with caution/);
assert.match(make("Yellow Flags\n- c. Ask: C").html, /Review yourself, but probably safe/);
const clear = make("Claude Contract Review · 🟢 CLEAR\nNothing to flag.");
assert.match(clear.html, /Proceed/);
assert.match(clear.subject, /^Contract clear: /);
assert.ok(!/do not invoice/i.test(four.html), "the old do-not-invoice wording is gone");

// The draft button carries the red and orange asks only: yellows are questions, not amendments.
assert.match(four.html, /We have written the 2 amendments above/);
assert.ok(!/amendment email/.test(clear.html), "nothing to ask for means no button");

// The two non-review branches still say one plain thing.
assert.match(make("⚪ NOT REVIEWED · The automatic review did not finish").subject, /^Contract not reviewed: /);
assert.match(make("NOT REVIEWED · The contract is a .docx file.").html, /Only PDFs can be read automatically/);

console.log("contract-alert: all passed");
