// The contract Draft page builds its POST body in the browser. This checks the body it would
// send actually carries the op: a JSON string spread with Object.assign loses every key, which
// is how the first version shipped and answered "unknown op" (23 Oct 2026).
//   node test/contract-page.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../api/roster.js", import.meta.url), "utf8");
const page = src.slice(src.indexOf("function contractPage(q)"));
const body = page.slice(0, page.indexOf("\nfunction "));

assert.ok(/const args=\$\{args\};/.test(body), "args is injected as an object literal, never as a quoted string");
assert.ok(!/const args=\$\{JSON\.stringify\(args\)\};/.test(body), "double-encoding args is the bug this test exists for");

// Prove the shape: spreading the object keeps op, spreading the string does not.
const asObject = Object.assign({}, { op: "contract-draft", item: "1", all: false }, { to: "a@b.com" });
assert.equal(asObject.op, "contract-draft");
assert.equal(Object.assign({}, JSON.stringify({ op: "contract-draft" }), {}).op, undefined);

console.log("contract-page: all passed");
