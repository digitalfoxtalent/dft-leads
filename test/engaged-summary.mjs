// Engaged views, All creators: row maths, roster averages, the nightly build and the saved copy,
// with monday, Channel Connect and Apify stubbed. Nothing on the network.
// Run: node test/engaged-summary.mjs
import assert from "node:assert/strict";
import { creatorRow, summarise, median, buildSummary, readSummary, writeSummary } from "../api/_reports/engaged/summary.js";
import { renderEngaged } from "../api/_reports/engaged/load.js";

assert.equal(median([]), null);
assert.equal(median([5, 1, 3]), 3);
assert.equal(median([4, 1, 3, 2]), 2.5);

// A creator row: averages come from Channel Connect's summary; share uses only videos 7+ days old.
const vids = [
  { id: "a", engagedViews: 800, views: 1000, ageDays: 20 },
  { id: "b", engagedViews: 600, views: 1000, ageDays: 10 },
  { id: "c", engagedViews: 10, views: 900, ageDays: 2 }, // too new: left out of the share
  { id: "d", engagedViews: null, views: 500, ageDays: 30 }, // no figure: left out
];
const ok = creatorRow({ name: "Heavy Spoilers", channel: "UCq3hT5JPPKy87JGbDls_5BQ" },
  { title: "Heavy Spoilers", asOf: "2026-10-19", summary: { avgEngagedViews: 700, medianEngagedViews: 700, avgViews: 1000, videos: 2 }, videos: vids });
assert.equal(ok.avgEngaged, 700); assert.equal(ok.videos, 2); assert.equal(ok.share, 0.7); assert.equal(ok.unavailable, undefined);
// Not connected / revoked / no answer / nothing old enough: listed with a reason, never averaged.
assert.match(creatorRow({ name: "X", channel: "c" }, { unavailable: "This creator removed our access." }).unavailable, /removed/);
assert.match(creatorRow({ name: "X", channel: "c" }, null).unavailable, /No answer/);
assert.match(creatorRow({ name: "X", channel: "c" }, { summary: { avgEngagedViews: null, videos: 0 }, videos: [] }).unavailable, /No long-form/);

// Roster: every creator counts once (average of averages); the median sits beside it.
const rows = [
  { name: "Big", channel: "1", avgEngaged: 100000, medianEngaged: 90000, avgViews: 150000, share: 0.6, videos: 12 },
  { name: "Mid", channel: "2", avgEngaged: 10000, medianEngaged: 9000, avgViews: 20000, share: 0.5, videos: 12 },
  { name: "Small", channel: "3", avgEngaged: 1000, medianEngaged: 800, avgViews: 2000, share: 0.5, videos: 8 },
  { name: "Gone", channel: "4", unavailable: "This creator removed our access." },
];
const s = summarise(rows, [{ name: "Not yet" }], "2026-10-20T12:40:00Z");
assert.equal(s.roster.creators, 3); assert.equal(s.roster.connected, 4);
assert.equal(s.roster.avgEngaged, 37000);
assert.equal(s.roster.medianEngaged, 10000);
assert.ok(Math.abs(s.roster.share - 0.5333) < 0.001);
assert.deepEqual(s.creators.map(r => r.name), ["Big", "Mid", "Small", "Gone"], "highest first, unavailable last");
assert.deepEqual(s.notConnected, ["Not yet"]);
const none = summarise([], [], "t");
assert.equal(none.roster.avgEngaged, null); assert.equal(none.roster.creators, 0);

// Build, save and read back, with every outside call stubbed.
const CH = ["UCq3hT5JPPKy87JGbDls_5BQ", "UC7BZTnHihGgs7XZmXEBirjA", "UC7_WiJnJxpm4MRNesRttzWg", "UClG1AcuVOU5Cn-ivHm3JRoA"];
const accessRows = [
  { id: "1", name: "Heavy Spoilers", column_values: [{ id: "text_mm7df591", text: CH[0] }, { id: "color_mm7dpp3w", text: "Granted" }, { id: "date_mm7dmz8d", text: "2026-10-01" }] },
  { id: "2", name: "@thekristianharloff", column_values: [{ id: "text_mm7df591", text: CH[1] }, { id: "color_mm7dpp3w", text: "Granted" }, { id: "date_mm7dmz8d", text: "" }] },
  { id: "3", name: "@reelrejects", column_values: [{ id: "text_mm7df591", text: CH[2] }, { id: "color_mm7dpp3w", text: "Not requested" }, { id: "date_mm7dmz8d", text: "" }] },
  { id: "4", name: "@thecosmicwonder", column_values: [{ id: "text_mm7df591", text: CH[3] }, { id: "color_mm7dpp3w", text: "Granted" }, { id: "date_mm7dmz8d", text: "" }] },
  { id: "5", name: "Digital Fox Talent (own channel) — reference case", column_values: [{ id: "text_mm7df591", text: "UC_3vORXExH-r3IC5RSaDTNw" }, { id: "color_mm7dpp3w", text: "Granted" }, { id: "date_mm7dmz8d", text: "" }] },
];
let saved = null, connectCalls = 0;
const json = (o, status = 200) => ({ ok: status < 300, status, json: async () => o });
globalThis.fetch = async (url, opt = {}) => {
  url = String(url);
  if (url.startsWith("https://api.monday.com")) {
    const q = JSON.parse(opt.body).query;
    if (/boards\(ids:\[18432126799\]\)/.test(q)) return json({ data: { boards: [{ items_page: { items: accessRows } }] } });
    if (/items\(ids:\[13197661446\]\)/.test(q)) return json({ data: { items: [{ column_values: [{ text: "x".repeat(40) }] }] } });
    if (/items\(ids:\[12634208127\]\)/.test(q)) return json({ data: { items: [{ column_values: [{ text: "apify_token_value" }] }] } });
    throw new Error("unexpected monday query " + q.slice(0, 80));
  }
  if (url.startsWith("https://connect.digitalfoxtalent.com/api/views")) {
    connectCalls++;
    assert.ok(url.includes("&mature=1"), "asks for week-old videos");
    const ch = new URL(url).searchParams.get("k");
    if (ch === CH[3]) return json({}, 410); // Cosmic Wonder removed access
    const big = ch === CH[0];
    return json({ title: big ? "Heavy Spoilers" : "Kristian Harloff", asOf: "2026-10-20",
      summary: { avgEngagedViews: big ? 120000 : 30000, medianEngagedViews: big ? 110000 : 28000, avgViews: big ? 160000 : 50000, videos: 12 },
      videos: [{ id: "v", engagedViews: big ? 120000 : 30000, views: big ? 160000 : 50000, ageDays: 9 }] });
  }
  if (url === "https://api.apify.com/v2/key-value-stores?name=dft-engaged-views") return json({ data: { id: "store1" } });
  if (url === "https://api.apify.com/v2/key-value-stores/store1/records/summary") {
    assert.equal(opt.headers.Authorization, "Bearer apify_token_value");
    if (opt.method === "PUT") { saved = JSON.parse(opt.body); return json({}); }
    return saved ? json(saved) : json({}, 404);
  }
  throw new Error("unexpected fetch " + url);
};

assert.equal(await readSummary("tok"), null, "no copy yet reads as null, not an error");
const built = await buildSummary("tok");
assert.equal(connectCalls, 3, "only connected creators are asked, the DFT reference row is not");
assert.equal(built.roster.creators, 2); assert.equal(built.roster.connected, 3);
assert.equal(built.roster.avgEngaged, 75000);
assert.deepEqual(built.creators.map(c => c.name), ["Heavy Spoilers", "@thekristianharloff", "@thecosmicwonder"]);
assert.match(built.creators[2].unavailable, /removed our access/);
assert.deepEqual(built.notConnected, ["@reelrejects"]);
await writeSummary("tok", built);
assert.deepEqual(await readSummary("tok"), built);

// The page carries the saved copy and opens on All creators.
const html = await renderEngaged("tok");
assert.ok(html.includes('"avgEngaged":75000'), "page embeds the saved copy");
assert.ok(html.includes("<h1>Engaged views</h1>"), "one-colour headline");
assert.ok(html.includes("function showAll()") && html.includes("else if(on.length)showAll();"));
const script = html.split('<script>').pop().split('</script>')[0];
new Function(script); // the page script parses (catches escapes broken by the template literal)

console.log("engaged-summary: all checks passed");
