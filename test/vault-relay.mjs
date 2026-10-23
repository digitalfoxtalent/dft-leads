// Tests for the key vault (vault.js) and the relay (relay.js, /api/v1/relay/...). In-memory Postgres, fake services.
//   npm install --no-save @electric-sql/pglite@0.3.15 && node test/vault-relay.mjs

import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setExecutor, read, write } from "../api/_reports/mirror/db.js";
import { ensureSchema } from "../api/_reports/mirror/schema.js";
import { vaultKeys, vaultStatus, _resetVaultMemo } from "../api/_reports/mirror/vault.js";
import { relay, findRoute } from "../api/_reports/mirror/relay.js";
import { serveApi, createKey } from "../api/_reports/mirror/apikeys.js";

const pg = new PGlite();
setExecutor({
  read: async (t, p) => (await pg.query(t, p)).rows,
  write: async (t, p) => (await pg.query(t, p)).rows,
  batch: async list => { const out = []; for (const [t, p] of list) out.push((await pg.query(t, p)).rows); return out; },
});
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
await ensureSchema();
process.env.CRON_SECRET = "test-cron-secret-0123456789-abcdefghijklmnop";
const ANT = "sk-ant-vault-000000000000000", YT = "AIzaVAULT0000000000000000000000", HUN = "huntervault00000000000", APIFY = "apify_api_vault0000000000000";

// ---------- vault ----------
let mondayCalls = 0;
const board = { "12562178538": ANT, "13142175799": YT, "12561999483": HUN, "12634208127": APIFY };
const fakeMonday = async (token, q) => { mondayCalls++; assert.ok(/text_mm5bcxe7/.test(q) && !/mutation/.test(q), "reads only the key column, never writes");
  return { items: Object.entries(board).map(([id, v]) => ({ id, column_values: [{ text: v }] })) }; };
let k = await vaultKeys({ env: {}, mondayImpl: fakeMonday, token: "tok" });
ok(k.anthropic === ANT && k.youtube === YT && k.hunter === HUN && k.apify === APIFY && mondayCalls === 1, "first use copies the keys from the monday board");
const rows = await read(`SELECT name, data, iv, tag FROM mirror.vault`);
ok(rows.length === 4 && rows.every(r => !r.data.includes("vault") && !Object.values(board).some(v => r.data.includes(v))), "stored encrypted, never as plain text");
_resetVaultMemo();
k = await vaultKeys({ env: {}, mondayImpl: fakeMonday, token: "tok" });
ok(k.youtube === YT && mondayCalls === 1, "later uses read the vault, not monday");
_resetVaultMemo();
k = await vaultKeys({ env: {}, mondayImpl: async () => { throw new Error("monday is gone"); }, token: "tok", now: () => Date.now() + 2 * 86400000 });
ok(k.anthropic === ANT && k.apify === APIFY, "if monday is gone, the stored keys keep working");
_resetVaultMemo();
k = await vaultKeys({ env: { YOUTUBE_API_KEY_JOBS: "AIzaFROMVERCEL000000000000000000" }, mondayImpl: fakeMonday, token: "tok" });
ok(k.youtube === "AIzaFROMVERCEL000000000000000000", "a Vercel setting wins over the vault");
await write(`UPDATE mirror.vault SET data = 'AAAA' || data WHERE name = 'hunter'`);
_resetVaultMemo();
k = await vaultKeys({ env: {}, mondayImpl: async () => ({ items: [] }), token: "tok" });
ok(!k.hunter && k.anthropic === ANT, "a tampered row is ignored");
const saved = process.env.CRON_SECRET; process.env.CRON_SECRET = "a-different-secret-entirely-xx-0123456789abc";
_resetVaultMemo();
k = await vaultKeys({ env: {}, mondayImpl: async () => ({ items: [] }), token: "" });
ok(!k.anthropic && !k.youtube, "without the right Vercel secret the vault cannot be read");
process.env.CRON_SECRET = saved;
const st = await vaultStatus();
ok(st.length === 4 && st.every(s => !("value" in s)) && JSON.stringify(st).indexOf(ANT) < 0, "status shows which keys are held, never the values");

// ---------- relay ----------
const keysImpl = async () => ({ anthropic: ANT, youtube: YT, hunter: HUN, apify: APIFY });
const lookup = async () => [{ address: "93.184.216.34" }];
const sent = [];
const svc = async (url, o = {}) => {
  sent.push({ url, o });
  if (url.startsWith("https://files-monday-com.s3.amazonaws.com/")) return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 });
  return new Response(JSON.stringify({ echo: true, note: "key " + ANT }), { status: 200, headers: { "content-type": "application/json" } });
};
const go = (method, path, extra = {}) => relay(Object.assign({ method, headers: {}, query: {} }, extra), path, { keysImpl, realFetch: svc, lookup });
ok(findRoute("anthropic", "v1/messages", "POST") && !findRoute("anthropic", "v1/messages", "GET") && !findRoute("anthropic", "v1/files", "POST") && !findRoute("youtube", "youtube/v3/../x", "GET"), "only the exact endpoints Make uses are open");
let r = await go("POST", "relay/anthropic/v1/messages", { body: { model: "m", messages: [] }, headers: { "anthropic-version": "2023-06-01" } });
ok(r.status === 200 && sent.at(-1).url === "https://api.anthropic.com/v1/messages" && sent.at(-1).o.headers["x-api-key"] === ANT, "Claude call goes out with the vault key");
ok(!r.raw.includes(ANT) && r.raw.includes("[key]"), "answers are scrubbed");
r = await go("GET", "relay/youtube/youtube/v3/videos", { query: { part: "statistics", id: "abc", key: "attacker-key" } });
const yu = new URL(sent.at(-1).url);
ok(r.status === 200 && yu.searchParams.get("key") === YT && yu.searchParams.getAll("key").length === 1 && yu.searchParams.get("id") === "abc", "YouTube: the caller's key is dropped and ours added");
r = await go("PUT", "relay/apify/v2/key-value-stores/mAoEUgaYmHtFXFd1T/records/msn-rejections.json", { body: { a: 1 }, query: { token: "x" } });
ok(r.status === 200 && sent.at(-1).o.headers.authorization === "Bearer " + APIFY && !sent.at(-1).url.includes("token="), "Apify: bearer added, token in the address dropped");
r = await go("POST", "relay/apify/v2/acts/clockworks~tiktok-video-scraper/run-sync-get-dataset-items", { body: { postURLs: [] }, query: { maxTotalChargeUsd: "0.5", fields: "id,playCount" } });
ok(r.status === 200 && /maxTotalChargeUsd=0.5/.test(sent.at(-1).url), "Apify actor run with its options");
r = await go("DELETE", "relay/apify/v2/key-value-stores/x/records/y");
ok(r.status === 404, "other methods are closed");
r = await go("POST", "relay/anthropic/v1/messages", { body: "{\"x\":\"" + YT + "\"}" });
ok(r.status === 400, "a body carrying one of our keys is refused");
// a contract by address
const n0 = sent.length;
r = await go("POST", "relay/anthropic/v1/messages", { body: JSON.stringify({ d: "__PDF_B64__" }), headers: { "x-eco-pdf-url": "https://files-monday-com.s3.amazonaws.com/123/contract.pdf?X-Amz=1" } });
ok(r.status === 200 && sent.length === n0 + 2 && JSON.parse(sent.at(-1).o.body).d === Buffer.from("%PDF").toString("base64"), "a contract link is downloaded here and put into the Claude request");
r = await go("POST", "relay/anthropic/v1/messages", { body: JSON.stringify({ d: "__PDF_B64__" }), headers: { "x-eco-pdf-url": "https://evil.example/x.pdf" } });
ok(r.status === 400, "file links must be monday files");
r = await relay({ method: "POST", headers: {}, query: {}, body: {} }, "relay/anthropic/v1/messages", { keysImpl: async () => ({}), realFetch: svc, lookup });
ok(r.status === 503, "no key held yet: clear answer, nothing sent");

// ---------- through the API ----------
const TOM = "tom@digitalfoxtalent.com";
const plain = await createKey("Make: reader", ["marketing"], [], TOM, "r1");
const jobsKey = await createKey("Make: jobs", [], [], TOM, "r2", false, false, true);
const call = (kk, method, path, body) => serveApi({ method, headers: { authorization: "Bearer " + kk }, query: {}, body }, path, "tok");
ok((await call(plain, "POST", "relay/anthropic/v1/messages", {})).status === 403, "keys without the jobs tick cannot use the relay");
ok((await call(jobsKey, "POST", "relay/nope/x", {})).status === 404, "unknown relay address");
ok((await serveApi({ method: "POST", headers: {}, query: {}, body: {} }, "relay/anthropic/v1/messages", "tok")).status === 401, "no key, no relay");

console.log("vault and relay tests passed: " + pass);
