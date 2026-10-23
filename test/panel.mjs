// Tests for the item side panel and posting updates (pages.js renderPanel, edit.js liveUpdates/postUpdate).
// In-memory Postgres (PGlite) and a fake monday API, so nothing real is touched.
//   npm install --no-save @electric-sql/pglite@0.3.15 && node test/panel.mjs

import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setExecutor, read, write } from "../api/_reports/mirror/db.js";
import { ensureSchema } from "../api/_reports/mirror/schema.js";
import { setFetch, boardToken } from "../api/_reports/mirror/edit.js";
import { mirrorPage } from "../api/_reports/mirror/route.js";

const pg = new PGlite();
setExecutor({
  read: async (t, p) => (await pg.query(t, p)).rows,
  write: async (t, p) => (await pg.query(t, p)).rows,
  batch: async list => { const out = []; for (const [t, p] of list) out.push((await pg.query(t, p)).rows); return out; },
});
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const TOKEN = "monday-token-test";
const TOM = "tom@digitalfoxtalent.com", MARGOT = "margot@digitalfoxtalent.com";
const SITE = "https://ecosystem.digitalfoxtalent.com";

// ---------- fake monday ----------
let down = false, nextId = 9000;
const created = [];
const liveUpd = {
  "500": { board: "100", updates: [{ id: "8001", text_body: "Draft is in the doc <script>alert(1)</script>", created_at: "2026-10-22T10:00:00Z", creator: { name: "Vivianne Lee" },
    replies: [{ id: "8002", text_body: "Looks good", created_at: "2026-10-22T11:00:00Z", creator: { name: "Tom James" } }] }] },
  "600": { board: "200", updates: [] },
};
setFetch(async (url, opts) => {
  if (down) throw new Error("timeout");
  const body = JSON.parse(opts.body);
  assert.equal(opts.headers.Authorization, TOKEN);
  if (/create_update/.test(body.query)) {
    const id = String(nextId++);
    created.push(body.variables);
    liveUpd[body.variables.i].updates.unshift({ id, text_body: body.variables.b.replace(/<br>/g, "\n").replace(/<\/p><p>/g, "\n").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"),
      created_at: new Date().toISOString(), creator: { name: "Tom James" }, replies: [] });
    return { ok: true, json: async () => ({ data: { create_update: { id, created_at: new Date().toISOString() } } }) };
  }
  if (/updates \(limit/.test(body.query)) {
    const it = liveUpd[body.variables.i[0]];
    return { ok: true, json: async () => ({ data: { items: it ? [{ id: body.variables.i[0], board: { id: it.board }, updates: it.updates }] : [] } }) };
  }
  throw new Error("unexpected monday call " + body.query.slice(0, 60));
});

// ---------- seed ----------
await ensureSchema();
const COLS = [{ id: "t1", title: "Type", type: "text" }, { id: "s1", title: "Draft status", type: "status", labels: { "1": ["Brief ready", "#00c875"] } }];
await write(`INSERT INTO mirror.boards (id, name, board_type, department, access, allowed_emails, columns, groups) VALUES
  (100, 'Editorial Plan', 'board', 'marketing', 'team', '{}', $1::jsonb, '[{"id":"topics","title":"Priority","color":"#fdab3d"}]'),
  (200, 'Partner Pay Cap', 'board', 'finance', 'listed', '{tom@digitalfoxtalent.com}', $1::jsonb, '[]'),
  (300, 'Ops Notes', 'board', 'content', 'team', '{}', $1::jsonb, '[]')`, [JSON.stringify(COLS)]);
await write(`INSERT INTO mirror.items (id, board_id, group_id, name, vals) VALUES
  (500, 100, 'topics', 'Kikoff case study', $1::jsonb), (600, 200, null, 'Cap <b>x</b>', '{}'), (700, 300, null, 'Ops item', '{}'), (501, 100, 'topics', 'Child', '{}')`,
  [JSON.stringify({ t1: ["Pitch", "\"Pitch\""], s1: ["Brief ready", JSON.stringify({ index: 1 })] })]);
await write(`UPDATE mirror.items SET parent_id = 500 WHERE id = 501`);
await write(`INSERT INTO mirror.team (email, name) VALUES ($1, 'Tom James'), ($2, 'Margot <M>')`, [TOM, MARGOT]);
await write(`INSERT INTO mirror.updates (id, item_id, body, creator, created_at) VALUES (7001, 700, 'Old copy update', 'Alex', now())`);

const res = { setHeader() {} };
const get = (r, who) => mirrorPage(r, { method: "GET", headers: {}, query: {} }, res, who, TOKEN);
const postJ = (r, who, body, origin = SITE) => mirrorPage(r, { method: "POST", headers: { origin }, query: {}, body }, res, who, TOKEN);
const J = out => JSON.parse(out.body);

// ---------- the panel ----------
let out = await get("boards/100/items/500/panel", MARGOT);
let d = J(out);
ok(out.status === 200 && /json/.test(out.type) && out.cache === "no-store" && d.ok, "panel answers as JSON, never cached");
ok(/Kikoff case study/.test(d.html) && /Vivianne Lee/.test(d.html) && /class="rep"/.test(d.html) && /Looks good/.test(d.html), "live updates with their replies");
ok(!/<script>alert/.test(d.html) && /&lt;script&gt;alert/.test(d.html), "update text escaped");
ok(/data-eco-post/.test(d.html) && /data-tab="f"/.test(d.html) && /Pitch/.test(d.html) && /Child/.test(d.html), "Marketing: update box, fields tab with values and subitems");
ok(d.count === 1 && (await read(`SELECT count(*)::int AS n FROM mirror.updates WHERE item_id = 500`))[0].n === 1, "live updates saved to our copy");

out = await get("boards/200/items/600/panel", MARGOT); d = J(out);
ok(!d.ok && !/Cap/.test(out.body), "private board: panel refuses without naming the item");
out = await get("boards/200/items/600/panel", TOM); d = J(out);
ok(d.ok && !/data-eco-post/.test(d.html) && /Cap &lt;b&gt;x&lt;\/b&gt;/.test(d.html), "Tom sees the finance item read-only, name escaped");
out = await get("boards/100/items/600/panel", TOM); d = J(out);
ok(!d.ok, "item asked for under the wrong board is refused");

down = true;
out = await get("boards/300/items/700/panel", MARGOT); d = J(out);
ok(d.ok && /Old copy update/.test(d.html) && /did not answer in time/.test(d.html) && !/data-eco-post/.test(d.html), "monday down: our copy, said plainly; non-pilot board has no update box");
down = false;
liveUpd["700"] = { board: "999", updates: [{ id: "8100", text_body: "from another board", created_at: "2026-10-22T10:00:00Z", creator: { name: "X" }, replies: [] }] };
out = await get("boards/300/items/700/panel", MARGOT); d = J(out);
ok(!/from another board/.test(d.html), "live reply for an item on a different board is ignored");

// ---------- posting ----------
const K = boardToken(TOKEN, MARGOT, "100");
out = await get("boards/100/items/500/update", MARGOT);
ok(out.status === 405, "GET to the update address does nothing");
out = await postJ("boards/100/items/500/panel", MARGOT, { k: K, t: "x" });
ok(out.status === 405, "POST to the panel address does nothing");
d = J(await postJ("boards/100/items/500/update", MARGOT, { k: K, t: "hi" }, "https://evil.example"));
ok(!d.ok && /did not come from/.test(d.message) && created.length === 0, "post from another site refused");
d = J(await postJ("boards/100/items/500/update", MARGOT, { k: "x".repeat(K.length), t: "hi" }));
ok(!d.ok && /expired/.test(d.message) && created.length === 0, "bad token refused");
d = J(await postJ("boards/100/items/500/update", MARGOT, { k: boardToken(TOKEN, TOM, "100"), t: "hi" }));
ok(!d.ok && created.length === 0, "someone else's token refused");
d = J(await postJ("boards/100/items/500/update", MARGOT, { k: K, t: "   " }));
ok(!d.ok && /Write something/.test(d.message), "empty update refused");
d = J(await postJ("boards/100/items/500/update", MARGOT, { k: K, t: "a".repeat(5001) }));
ok(!d.ok && /too long/.test(d.message) && created.length === 0, "over-long update refused");
d = J(await postJ("boards/200/items/600/update", TOM, { k: boardToken(TOKEN, TOM, "200"), t: "hi" }));
ok(!d.ok && created.length === 0, "no posting on boards outside the pilot");

d = J(await postJ("boards/100/items/500/update", MARGOT, { k: K, t: "Sent to <Kikoff>\nsecond line" }));
ok(d.ok && /posted/.test(d.message), "update posted");
ok(created.length === 1 && created[0].i === "500" && created[0].b === "<p><strong>Margot &lt;M&gt;</strong> via the Ecosystem</p><p>Sent to &lt;Kikoff&gt;<br>second line</p>", "monday gets the author's name and escaped text");
ok(/Margot &lt;M&gt;/.test(d.html) && /Sent to &lt;Kikoff&gt;/.test(d.html) && !/via the Ecosystem/.test(d.html) && d.count === 2, "panel shows it under the author's name, without the prefix");
let row = (await read(`SELECT * FROM mirror.posts ORDER BY id DESC LIMIT 1`))[0];
ok(row.ok && row.email === MARGOT && String(row.update_id) === String(nextId - 1), "post logged with who and the monday id");
ok((await read(`SELECT posted_by FROM mirror.updates WHERE id = $1`, [nextId - 1]))[0].posted_by === "Margot <M>", "author kept on our copy");
await write(`UPDATE mirror.updates SET creator = 'Tom James', body = 'Margot <M> via the Ecosystem Sent' WHERE id = $1`, [nextId - 1]); // what the sync writes back
out = await get("boards/100/items/500", MARGOT);
ok(/Margot &lt;M&gt;/.test(out.html) && !/via the Ecosystem/.test(out.html), "after the sync rewrites it, the item page still shows the real author");

down = true;
d = J(await postJ("boards/100/items/500/update", MARGOT, { k: K, t: "while down" }));
ok(!d.ok && /Check the item in monday/.test(d.message), "monday failure reported, not claimed as posted");
ok((await read(`SELECT ok, error FROM mirror.posts ORDER BY id DESC LIMIT 1`))[0].ok === false, "failed post logged");
down = false;

await write(`INSERT INTO mirror.posts (email, board_id, item_id, ok) SELECT $1, 100, 500, true FROM generate_series(1, 30)`, [MARGOT]);
d = J(await postJ("boards/100/items/500/update", MARGOT, { k: K, t: "one more" }));
ok(!d.ok && /Too many updates/.test(d.message), "30 updates an hour per person");

// ---------- board rows ----------
out = await get("boards/100", MARGOT);
ok(/<script src="\/assets\/eco-board.js" defer>/.test(out.html) && /class="ub has"[^>]*>.*?<span>2<\/span>/.test(out.html), "board row shows the update count bubble");
ok(/1 subitem/.test(out.html), "subitem count still shown");
out = await get("boards/300", MARGOT);
ok(/<script src="\/assets\/eco-board.js" defer>/.test(out.html) && !/data-k=/.test(out.html) && /data-eco-board data-b="300"/.test(out.html), "read-only boards get the panel but no edit token");
out = await get("assets/eco-board.js", MARGOT);
ok(/\/panel"/.test(out.body) && /history\.replaceState/.test(out.body) && /if \(!ED\) return;/.test(out.body), "script opens the panel and only edits where allowed");

console.log("panel tests passed: " + pass);
