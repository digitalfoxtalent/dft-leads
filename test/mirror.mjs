// Tests for the monday mirror (api/_reports/mirror). Runs against an in-memory Postgres (PGlite) and a
// fake monday API, so it touches nothing real.
//   npm install --no-save @electric-sql/pglite@0.3.15 && node test/mirror.mjs

import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setExecutor, read } from "../api/_reports/mirror/db.js";
import { runSync } from "../api/_reports/mirror/sync.js";
import { renderBoard, renderItem, renderDepartment, renderStatus, cell } from "../api/_reports/mirror/pages.js";
import { isMirrorRoute } from "../api/_reports/mirror/route.js";
import { accessFor, departmentFor, isExcluded, canSee } from "../api/_reports/mirror/policy.js";

const pg = new PGlite();
setExecutor({
  read: async (t, p) => (await pg.query(t, p)).rows,
  write: async (t, p) => (await pg.query(t, p)).rows,
  batch: async list => { const out = []; for (const [t, p] of list) out.push((await pg.query(t, p)).rows); return out; },
});

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };

// ---------- policy ----------
ok(isExcluded({ id: "18422548864", name: "API Keys (Private)" }), "API Keys board is never copied");
ok(isExcluded({ id: "1", name: "Passwords" }) && isExcluded({ id: "2", name: "Logins" }), "credential boards by name");
ok(!isExcluded({ id: "3", name: "Editorial Plan" }), "ordinary board copied");
ok(departmentFor({ workspaceName: "@digitalfoxtalent", folderPath: "Marketing & Publicity (Agency) / Agency Marketing & Publicity" }) === "marketing", "marketing folder");
ok(departmentFor({ workspaceName: "@digitalfoxtalent", folderPath: "Platform Monetization / Articles", boardName: "Articles — Review Queue" }) === "content", "articles to content");
ok(departmentFor({ workspaceName: "@heavyspoilers", folderPath: "" }) === "talent", "creator workspace to talent");
let a = accessFor({ boardKind: "public", workspaceKind: "open", workspaceName: "@digitalfoxtalent", folderPath: "Marketing & Publicity (Agency)", boardName: "Editorial Plan" });
ok(a.access === "team", "public marketing board is whole team");
a = accessFor({ boardKind: "public", workspaceKind: "open", workspaceName: "@digitalfoxtalent", folderPath: "Finance", boardName: "Partner Pay Cap",
  owners: [{ email: "tom@digitalfoxtalent.com" }], subscribers: [{ email: "Amy@digitalfoxtalent.com" }, { email: "someone@gmail.com" }] });
ok(a.access === "listed" && a.allowed.includes("amy@digitalfoxtalent.com") && !a.allowed.includes("someone@gmail.com"), "finance listed, outside emails dropped");
a = accessFor({ boardKind: "private", workspaceKind: "open", workspaceName: "@digitalfoxtalent", folderPath: "Marketing & Publicity (Agency)", boardName: "x", subscribers: [] });
ok(a.access === "listed" && a.allowed.includes("tom@digitalfoxtalent.com"), "private board listed, Tom always included");
ok(!canSee({ access: "team" }, "x@gmail.com"), "outside email never sees anything");
ok(accessFor({ boardType: "sub_items_board", boardKind: "public", workspaceKind: "open", workspaceName: "@digitalfoxtalent", folderPath: "" }).access === "listed", "a subitems board starts Tom-only");
ok(!canSee({ access: "team" }, "left@digitalfoxtalent.com", new Set(["tom@digitalfoxtalent.com"])), "someone no longer on monday sees nothing");
ok(!canSee({ access: "listed", allowed_emails: ["tom@digitalfoxtalent.com"] }, "margot@digitalfoxtalent.com"), "listed board hidden from others");
ok(canSee({ access: "listed", allowed_emails: ["tom@digitalfoxtalent.com"] }, "Tom@digitalfoxtalent.com"), "listed board visible to Tom");
ok(isMirrorRoute("boards/123") && isMirrorRoute("boards/123/items/45") && isMirrorRoute("marketing/boards") && isMirrorRoute("data/mirror"), "routes");
ok(!isMirrorRoute("boards/abc") && !isMirrorRoute("evil/boards") && !isMirrorRoute("boards/1;drop"), "bad routes refused");

// ---------- a fake monday ----------
const WS = [{ id: "4961784", name: "@digitalfoxtalent", kind: "open" }];
const FOLDERS = [{ id: "20780936", name: "Marketing & Publicity (Agency)", parent: null }, { id: "20868399", name: "Finance", parent: null }];
const owner = [{ email: "tom@digitalfoxtalent.com" }];
let BOARDS = [
  { id: "100", name: "Editorial Plan", description: "", type: "board", board_kind: "public", updated_at: "2026-10-20T00:00:00Z", items_count: 3, board_folder_id: "20780936", workspace: { id: "4961784" }, owners: owner, subscribers: owner },
  { id: "101", name: "Subitems of Editorial Plan", description: "", type: "sub_items_board", board_kind: "public", updated_at: "2026-10-20T00:00:00Z", items_count: 1, board_folder_id: null, workspace: { id: "4961784" }, owners: owner, subscribers: owner },
  { id: "200", name: "Brand Invoices", description: "", type: "board", board_kind: "private", updated_at: "2026-10-20T00:00:00Z", items_count: 1, board_folder_id: "20868399", workspace: { id: "4961784" }, owners: owner, subscribers: owner },
  { id: "18422548864", name: "API Keys (Private)", description: "", type: "board", board_kind: "public", updated_at: "2026-10-20T00:00:00Z", items_count: 1, board_folder_id: null, workspace: { id: "4961784" }, owners: owner, subscribers: owner },
];
const cv = (id, type, text, value) => ({ id, type, text, value });
let ITEMS = {
  "100": [
    { id: "1001", name: "Guide <script>alert(1)</script>", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-19T00:00:00Z", state: "active", group: { id: "g1" }, parent_item: null, creator: { name: "Vivianne Lee" },
      column_values: [cv("status", "status", "Done", '{"index":1}'), cv("link", "link", "x", '{"url":"javascript:alert(1)","text":"bad link"}'), cv("link2", "link", "y", '{"url":"https://digitalfoxtalent.com","text":"site"}')],
      updates: [{ id: "9001", text_body: "First note <b>bold</b>", created_at: "2026-10-02T00:00:00Z", creator: { name: "Tom James" } }] },
    { id: "1002", name: "Case study", created_at: "2026-10-02T00:00:00Z", updated_at: "2026-10-18T00:00:00Z", state: "active", group: { id: "g2" }, parent_item: null, creator: { name: "Tom James" }, column_values: [], updates: [] },
    { id: "1003", name: "Old idea", created_at: "2026-10-03T00:00:00Z", updated_at: "2026-10-17T00:00:00Z", state: "active", group: { id: "g2" }, parent_item: null, creator: null, column_values: [], updates: [] },
  ],
  "101": [{ id: "5001", name: "Write it", created_at: "2026-10-04T00:00:00Z", updated_at: "2026-10-19T00:00:00Z", state: "active", group: { id: "topics" }, parent_item: { id: "1001" }, creator: null, column_values: [], updates: [] }],
  "200": [{ id: "2001", name: "Invoice 6585", created_at: "2026-10-04T00:00:00Z", updated_at: "2026-10-19T00:00:00Z", state: "active", group: { id: "topics" }, parent_item: null, creator: null, column_values: [], updates: [] }],
  "18422548864": [{ id: "3001", name: "SECRET KEY", created_at: "2026-10-04T00:00:00Z", updated_at: "2026-10-19T00:00:00Z", state: "active", group: { id: "topics" }, parent_item: null, creator: null, column_values: [cv("k", "text", "sk-live-123", null)], updates: [] }],
};
const COLS = {
  "100": [{ id: "name", title: "Name", type: "name", settings_str: "{}" },
    { id: "status", title: "Status", type: "status", settings_str: JSON.stringify({ labels: { "0": "Working", "1": "Done" }, labels_colors: { "1": { color: "#00c875" } } }) },
    { id: "link", title: "Link", type: "link", settings_str: "{}" }, { id: "link2", title: "Site", type: "link", settings_str: "{}" },
    { id: "subitems", title: "Subitems", type: "subtasks", settings_str: JSON.stringify({ boardIds: [101] }) }],
  "101": [{ id: "name", title: "Name", type: "name", settings_str: "{}" }],
  "200": [{ id: "name", title: "Name", type: "name", settings_str: "{}" }],
  "18422548864": [{ id: "name", title: "Name", type: "name", settings_str: "{}" }],
};
const GROUPS = { "100": [{ id: "g1", title: "Planned", color: "#579bfc", position: "1" }, { id: "g2", title: "Ideas", color: "#ff642e", position: "2" }] };
const USERS = [{ email: "tom@digitalfoxtalent.com", name: "Tom James", enabled: true }, { email: "margot@digitalfoxtalent.com", name: "Margot", enabled: true },
  { email: "left@digitalfoxtalent.com", name: "Left", enabled: false }];
const asked = [];
async function fakeFetch(url, opts) {
  const { query, variables } = JSON.parse(opts.body);
  assert.ok(!/mutation/.test(query), "the mirror never sends a mutation to monday");
  asked.push(query);
  const data = { complexity: { after: 19000000, reset_in_x_seconds: 30 } };
  if (/users \(kind: non_guests/.test(query)) data.users = USERS;
  else if (/workspaces/.test(query)) data.workspaces = WS;
  else if (/folders/.test(query)) data.folders = FOLDERS;
  else if (/boards \(limit: 100, page/.test(query)) data.boards = variables.p === 1 ? BOARDS : [];
  else if (/boards \(ids: \$b\)/.test(query)) {
    const id = variables.b[0];
    data.boards = [{ columns: COLS[id] || [], groups: GROUPS[id] || [{ id: "topics", title: "Group", color: "#579bfc", position: "1" }],
      items_page: { cursor: null, items: (ITEMS[id] || []).slice().sort((x, y) => /__last_updated__/.test(query) ? Date.parse(y.updated_at) - Date.parse(x.updated_at) : 0) } }];
  } else throw new Error("unexpected query " + query.slice(0, 80));
  return { ok: true, json: async () => ({ data }) };
}

// ---------- first run: full copy ----------
let r = await runSync("tok", { force: true, fetchImpl: fakeFetch });
ok(r.ok, "first run ok: " + JSON.stringify(r));
const boards = await read(`SELECT id::text AS id, department, access, allowed_emails, parent_board_id::text AS parent, mirror_items FROM mirror.boards ORDER BY id`);
ok(!boards.find(b => b.id === "18422548864"), "API Keys board not in the database");
ok(!(await read(`SELECT 1 FROM mirror.items WHERE name = 'SECRET KEY'`)).length, "no credential rows copied");
ok(!asked.some(q => q.includes("18422548864")), "credential board never even queried");
const ep = boards.find(b => b.id === "100");
ok(ep.department === "marketing" && ep.access === "team" && ep.mirror_items === 3, "Editorial Plan copied as marketing, whole team");
const inv = boards.find(b => b.id === "200");
ok(inv.access === "listed" && inv.allowed_emails.length === 1, "Brand Invoices listed only");
ok(boards.find(b => b.id === "101").parent === "100", "subitems board tied to its parent");
const sub = await read(`SELECT parent_id::text AS p FROM mirror.items WHERE id = 5001`);
ok(sub[0].p === "1001", "subitem keeps its parent");

// ---------- pages ----------
let page = await renderBoard("margot@digitalfoxtalent.com", "100", "", "1");
ok(page.status === 200 && page.html.includes("Planned") && page.html.includes("Ideas"), "board shows its groups");
ok(!page.html.includes("<script>alert(1)") && page.html.includes("&lt;script&gt;"), "item names are escaped");
ok(!page.html.includes('href="javascript:') && page.html.includes('href="https://digitalfoxtalent.com/"'), "only http(s) links are linked");
ok(page.html.includes("background:#00c875"), "status colour from monday");
ok(page.html.includes("1 subitem<"), "subitem count shown");
page = await renderBoard("margot@digitalfoxtalent.com", "200", "", "1");
ok(page.status === 404, "a listed board looks like a missing one to others");
page = await renderBoard("tom@digitalfoxtalent.com", "200", "", "1");
ok(page.status === 200, "Tom sees Brand Invoices");
page = await renderBoard("hacker@gmail.com", "100", "", "1");
ok(page.status === 404, "outside account sees nothing");
page = await renderBoard("margot@digitalfoxtalent.com", "100", "case", "1");
ok(page.status === 200 && page.html.includes("Case study") && !page.html.includes("Old idea"), "search filters");
page = await renderBoard("margot@digitalfoxtalent.com", "100", "%' OR 1=1 --", "1");
ok(page.status === 200 && page.html.includes("No items match"), "search input cannot break the query");
page = await renderItem("margot@digitalfoxtalent.com", "100", "1001");
ok(page.status === 200 && page.html.includes("Write it") && page.html.includes("First note &lt;b&gt;bold&lt;/b&gt;"), "item page shows subitems and escaped updates");
page = await renderItem("margot@digitalfoxtalent.com", "100", "2001");
ok(page.status === 404, "an item from another board is not shown through this one");
page = await renderItem("margot@digitalfoxtalent.com", "101", "5001");
ok(page.status === 404, "a subitems board cannot be opened directly");
page = await renderBoard("left@digitalfoxtalent.com", "100", "", "1");
ok(page.status === 404, "a deactivated monday user sees nothing");
page = await renderDepartment("margot@digitalfoxtalent.com", "marketing", "");
ok(page.status === 200 && page.html.includes("Editorial Plan") && !page.html.includes("Brand Invoices"), "department list");
page = await renderStatus("margot@digitalfoxtalent.com");
ok(page.status === 200 && page.html.includes("boards you can see are copied") && !page.html.includes("Brand Invoices"), "status page hides boards you cannot see");
const log = await read(`SELECT count(*)::int AS n, count(*) FILTER (WHERE NOT allowed)::int AS denied FROM mirror.access_log`);
ok(log[0].n > 5 && log[0].denied >= 3, "views logged, refusals included");

// ---------- second run: incremental, deletion, newly excluded ----------
const r0 = await runSync("tok", { fetchImpl: fakeFetch });
ok(r0.skipped, "a second trigger inside 20 minutes does nothing");
ITEMS["100"] = ITEMS["100"].filter(i => i.id !== "1003");
ITEMS["100"][0] = { ...ITEMS["100"][0], name: "Guide renamed", updated_at: new Date().toISOString() };
BOARDS[0] = { ...BOARDS[0], updated_at: new Date(Date.now() + 1000).toISOString(), items_count: 2 };
BOARDS = BOARDS.filter(b => b.id !== "200"); // archived in monday
r = await runSync("tok", { force: true, fetchImpl: fakeFetch });
ok(r.ok, "second run ok");
ok((await read(`SELECT name FROM mirror.items WHERE id = 1001`))[0].name === "Guide renamed", "incremental picks up the change");
ok((await read(`SELECT gone FROM mirror.boards WHERE id = 200`))[0].gone === true, "archived board hidden");
page = await renderBoard("tom@digitalfoxtalent.com", "200", "", "1");
ok(page.status === 404, "gone board not shown");
// The count differs (1003 deleted in monday) so the next run re-checks fully and marks it deleted.
await read(`SELECT 1`);
ITEMS["100"][0] = { ...ITEMS["100"][0], updates: [] };
const later = Date.now() + 7 * 3600000;
r = await runSync("tok", { force: true, fetchImpl: fakeFetch, now: () => later });
ok((await read(`SELECT deleted FROM mirror.items WHERE id = 1003`))[0].deleted === true, "item removed in monday marked deleted, not erased");
ok(!(await read(`SELECT 1 FROM mirror.updates WHERE id = 9001`)).length, "an update deleted in monday leaves the copy on the next full check");
ok(!(await read(`SELECT note FROM mirror.sync_runs WHERE note ILIKE '%Invoices%'`)).length, "run notes never carry board names");
ok(cell({ type: "status", labels: {} }, ["<i>x</i>", null]).includes("&lt;i&gt;"), "status text escaped");

console.log("mirror tests passed:", pass);
