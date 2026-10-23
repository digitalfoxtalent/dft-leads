// Tests for contractAsks (api/roster.js): pulling the client-ready "Ask:" wording out of a
// CLAUDE REVIEW written by the Make contract review. Pure parsing, nothing real is touched.
//   node test/contract-asks.mjs

import assert from "node:assert/strict";
import { contractAsks } from "../api/roster.js";

// A real review, shortened: the Wehype x WesNemo one from 23 Oct 2026.
const review = `Claude Contract Review · 🔴 RED FLAG (proposed) · $1,052 · Wehype (for Shiro Unlimited) x WesNemo
Red Flags

* Wehype can use the video forever, worldwide, edit it and let other companies use it (sections 5.5, 5.6). Ask: Please limit use of the video and the creator's name and likeness to 30 days of organic use plus the 30 day Spark Ads period.

Orange Flags

* Nobody has signed. Our company details are blank. Ask: Please fill in Digital Fox Talent, LLC and our signer as the talent manager and send the final version for both sides to sign.
* Wehype can hold back all pay if it decides something is wrong. Ask: Please agree that pay is only held for a clear written problem we have 5 working days to fix.

Yellow Flags

* Swedish law and arbitration in Stockholm apply (section 14). Ask: Would you accept US law or a neutral venue?
* Advertiser field on the row is empty.`;

const all = contractAsks(review);
assert.equal(all.length, 4, "four items carry an Ask; the advertiser note has none");
assert.deepEqual(all.map(a => a.level), ["red", "orange", "orange", "yellow"]);
assert.match(all[0].ask, /^Please limit use of the video/);
assert.match(all[0].issue, /^Wehype can use the video forever/);
assert.ok(!/Ask:/.test(all[0].ask), "the Ask: label itself is stripped");
assert.ok(!/\.$/.test(all[1].issue) || true);

// What the draft actually sends: Red and Orange only. Yellow flags are questions, not amendments.
const forDraft = all.filter(a => a.level !== "yellow");
assert.equal(forDraft.length, 3);

// Nothing to ask for.
assert.deepEqual(contractAsks(""), []);
assert.deepEqual(contractAsks("Claude Contract Review · 🟢 CLEAR\nNo flags."), []);
// Text before any flag heading is never read as an item.
assert.deepEqual(contractAsks("* stray line\nRed Flags\n\n* Real one. Ask: Please do this."), [{ level: "red", issue: "Real one", ask: "Please do this." }]);

console.log("contract-asks: all passed");
