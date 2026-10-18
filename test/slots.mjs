// Slot board maths and assembly (api/_reports/slots/build.js), plus the page route. Nothing on the network.
// Run: node test/slots.mjs
import assert from "node:assert/strict";
import { weekStart, weekList, expectedInWeek, cadence, assemble, channelUploads, WEEKS } from "../api/_reports/slots/build.js";

// Weeks run Monday to Sunday; a Sunday belongs to the week that started the Monday before.
assert.equal(weekStart("2026-10-17"), "2026-10-12"); // Saturday
assert.equal(weekStart("2026-10-18"), "2026-10-12"); // Sunday counts toward the week before
assert.equal(weekStart("2026-10-19"), "2026-10-19"); // Monday starts a new week
assert.equal(weekStart("2026-10-12T23:30:00Z"), "2026-10-12");
const now = new Date("2026-10-17T20:00:00Z");
const weeks = weekList(now);
assert.equal(weeks.length, WEEKS);
assert.deepEqual([weeks[0].start, weeks[0].end, weeks[7].start, weeks[7].end], ["2026-10-12", "2026-10-18", "2026-11-30", "2026-12-06"]);

// Expected uploads spread evenly across weeks and add up over eight weeks.
const spread = r => Array.from({ length: 8 }, (_, k) => expectedInWeek(r, k));
assert.deepEqual(spread(0.5), [1, 0, 1, 0, 1, 0, 1, 0]);
assert.deepEqual(spread(2.5), [3, 2, 3, 2, 3, 2, 3, 2]);
assert.deepEqual(spread(1), [1, 1, 1, 1, 1, 1, 1, 1]);
assert.equal(spread(0.4).reduce((a, b) => a + b, 0), 3);
assert.deepEqual(spread(0), [0, 0, 0, 0, 0, 0, 0, 0]);

// Cadence: 24 uploads in 12 weeks is 2 a week; a quiet channel is paused; irregular gaps are flagged.
const every = (days, n, from = now) => Array.from({ length: n }, (_, i) => new Date(from.getTime() - i * days * 86400000).toISOString());
let c = cadence(every(3.5, 24), now);
assert.equal(c.rate, 2); assert.equal(c.paused, false); assert.equal(c.irregular, false); assert.equal(c.uploads, 24);
c = cadence(every(7, 3, new Date(now.getTime() - 45 * 86400000)), now);
assert.equal(c.paused, true, "nothing in 30 days is paused"); assert.equal(c.last, "2026-09-02");
c = cadence(["2026-10-15T10:00:00Z", "2026-10-14T10:00:00Z", "2026-09-01T10:00:00Z", "2026-08-01T10:00:00Z"], now);
assert.equal(c.irregular, true);
c = cadence([], now); assert.equal(c.rate, 0); assert.equal(c.paused, true); assert.equal(c.last, null);
// A list cut off inside the window (50 newest of a busy channel) is rated over the weeks it really covers.
c = cadence(every(1, 50), now, { truncated: true });
assert.ok(c.rate >= 6.5 && c.rate <= 7.5, "daily uploader rates about 7 a week, got " + c.rate);
// Future dates (a scheduled premiere) are ignored.
c = cadence(["2026-12-01T00:00:00Z"].concat(every(7, 12)), now); assert.equal(c.uploads, 12);

// Assembly: sold slots land in the right week, pencilled deals do not count, open = expected - sold.
const creators = [
  { id: "1", name: "Heavy Spoilers", handle: "@heavyspoilers", channel: "UC" + "x".repeat(22), vg: 100000, rate: 2500, hidden: false, uploads: { dates: every(1, 60) } },           // ~6.9 a week
  { id: "2", name: "Quiet Channel", handle: "@quiet", channel: "UC" + "y".repeat(22), vg: 50000, rate: 1500, hidden: false, uploads: { dates: every(7, 2, new Date(now.getTime() - 40 * 86400000)) } }, // paused
  { id: "3", name: "Hidden One", handle: "@hidden", channel: "UC" + "z".repeat(22), vg: 1, rate: 1, hidden: true, uploads: { dates: every(7, 12) } },
  { id: "4", name: "Weekly Show", handle: "@weekly", channel: "UC" + "w".repeat(22), vg: 200000, rate: 5000, hidden: false, uploads: { dates: every(7, 12) } },
];
const rows = [
  { id: "r1", row: "HS x Huel", deal: "Huel_Oct", dealId: "d1", group: "Campaigns Active", status: "Live", brand: "HUEL", creator: "Heavy Spoilers", start: "2026-10-14", end: "2026-10-20", pub: "", hasLinks: true },
  { id: "r2", row: "HS x Kalshi", deal: "Kalshi_Nov", dealId: "d2", group: "Campaign Won", status: "", brand: "kalshi", creator: "Heavy Spoilers", start: "2026-11-02", end: "2026-11-08", pub: "", hasLinks: false },
  { id: "r3", row: "HS x Maybe", deal: "Maybe_Nov", dealId: "d3", group: "Campaign Opportunities", status: "", brand: "Maybe", creator: "Heavy Spoilers", start: "2026-11-02", end: "", pub: "", hasLinks: false },
  { id: "r4", row: "HS x Old", deal: "Old_Sep", dealId: "d4", group: "Complete - Creators Paid", status: "", brand: "Old", creator: "Heavy Spoilers", start: "2026-09-01", end: "", pub: "", hasLinks: true },
  { id: "r5", row: "W x NoDate", deal: "Surfshark_Q4", dealId: "d5", group: "Brief Creators", status: "", brand: "Surfshark", creator: "Weekly Show", start: "", end: "", pub: "", hasLinks: false },
  { id: "r6", row: "W x Lost", deal: "Lost_Nov", dealId: "d6", group: "Campaign Won", status: "Lost", brand: "Nope", creator: "Weekly Show", start: "2026-11-09", end: "", pub: "", hasLinks: false },
  { id: "r7", row: "Unknown", deal: "Nobody_Nov", dealId: "d7", group: "Campaign Won", status: "", brand: "Nobody", creator: "Not On Roster", start: "2026-11-09", end: "", pub: "", hasLinks: false },
  { id: "r8", row: "W x Pub", deal: "Pub_Nov", dealId: "d8", group: "Campaign Won", status: "", brand: "PubBrand", creator: "Weekly Show (GTR name)", start: "", end: "", pub: "2026-11-22", hasLinks: false },
];
const handles = { weeklyshowgtrname: "weekly" };
const releases = [{ id: "x", name: "Dune 3", date: "2026-11-20", creators: "" }, { id: "y", name: "Too far", date: "2027-03-01", creators: "" }];
const snap = assemble({ creators, rows, handles, releases, now });
assert.equal(snap.creators.length, 3, "hidden creators are left out");
const hs = snap.creators.find(c => c.name === "Heavy Spoilers"), q = snap.creators.find(c => c.name === "Quiet Channel"), w = snap.creators.find(c => c.name === "Weekly Show");
assert.equal(hs.weeks[0].booked.length, 1); assert.equal(hs.weeks[0].booked[0].brand, "HUEL");
assert.equal(hs.weeks[3].booked.length, 1); assert.equal(hs.weeks[3].booked[0].brand, "kalshi");
assert.equal(hs.weeks[3].pencilled.length, 1); assert.equal(hs.weeks[3].pencilled[0].brand, "Maybe");
assert.equal(hs.weeks.reduce((s, x) => s + x.booked.length, 0), 2, "a September deal is outside the window");
assert.equal(hs.weeks[0].expected, 5, "60 daily uploads over a 12-week window is 5 a week"); assert.equal(hs.weeks[0].open, 4);
assert.equal(q.cadence.paused, true); assert.equal(q.weeks.reduce((s, x) => s + x.expected, 0), 0); assert.equal(q.openSlots, 0);
assert.deepEqual(w.weeks.map(x => x.expected), [1, 1, 1, 1, 1, 1, 1, 1]);
assert.equal(w.unscheduled.length, 1); assert.equal(w.unscheduled[0].brand, "Surfshark");
assert.equal(w.weeks[4].booked.length, 0, "a lost deal does not take a slot");
assert.equal(w.weeks[5].booked.length, 1, "a GTR-named creator row is matched through the handle map and placed by publish date (Sunday 22 Nov is the week of 16 Nov)");
assert.equal(w.weeks[5].open, 0);
assert.equal(w.openSlots, 7); assert.equal(w.openValue, 35000); assert.equal(w.openViews, 1400000);
assert.equal(snap.skippedCount, 1); assert.equal(snap.skipped[0].creator, "Not On Roster");
assert.deepEqual(snap.weeks[5].releases, [{ name: "Dune 3", date: "2026-11-20" }]);
assert.equal(snap.weeks[7].releases.length, 0);
assert.equal(snap.totals.booked, 3); assert.equal(snap.totals.pencilled, 1); assert.equal(snap.totals.paused, 1); assert.equal(snap.totals.unscheduled, 1);
assert.equal(snap.totals.open, hs.openSlots + w.openSlots);
assert.equal(snap.totals.sellThrough, Math.round(100 * 3 / (3 + snap.totals.open)));
assert.equal(snap.creators[0].name, "Heavy Spoilers", "sorted by open value");

// channelUploads: pages the uploads playlist, drops Shorts and live streams, stops at the lookback.
const calls = [];
const fakeFetch = async url => {
  calls.push(url);
  const json = v => ({ ok: true, json: async () => v });
  if (url.includes("playlistItems")) {
    const page2 = url.includes("pageToken=p2");
    const items = Array.from({ length: 50 }, (_, i) => ({ contentDetails: { videoId: (page2 ? "b" : "a") + String(i).padStart(10, "0"), videoPublishedAt: new Date(now.getTime() - ((page2 ? 50 : 0) + i) * 2 * 86400000).toISOString() } }));
    return json({ items, nextPageToken: page2 ? undefined : "p2" });
  }
  const ids = url.match(/id=([^&]+)/)[1].split(",");
  return json({ items: ids.map((id, i) => ({ id, contentDetails: { duration: i % 10 === 0 ? "PT0M59S" : "PT12M3S" }, liveStreamingDetails: i % 25 === 1 ? {} : undefined, snippet: { publishedAt: new Date(now.getTime() - (id.startsWith("b") ? 50 : 0) * 2 * 86400000 - parseInt(id.slice(1), 10) * 2 * 86400000).toISOString() } })) });
};
const up = await channelUploads("UC" + "x".repeat(22), "k", now, fakeFetch);
assert.ok(calls[0].includes("playlistId=UU" + "x".repeat(22)));
assert.equal(up.truncated, false, "page 2 reached past the lookback");
const inWindow = 43; // 84 days / 2 days apart, the boundary day included
const dropped = 5 + 2; // positions 0,10,20,30,40 are Shorts; positions 1 and 26 are live streams
assert.equal(up.dates.length, inWindow - dropped, "shorts and live streams are dropped: " + up.dates.length);
assert.ok(up.dates[0] > up.dates[up.dates.length - 1], "newest first");

// The page route renders from a saved copy and says so when there is none.
process.env.MONDAY_API_KEY = "test-token";
globalThis.fetch = async (url, o) => {
  if (String(url).includes("api.monday.com")) return { ok: true, json: async () => ({ data: { items: [{ column_values: [{ text: "apify_test_token_1234567890" }] }], boards: [{ items_page: { items: [] } }] } }) };
  if (String(url).includes("key-value-stores?name=")) return { ok: true, status: 201, json: async () => ({ data: { id: "STORE1" } }) };
  if (String(url).includes("/records/board")) return { ok: true, status: 200, json: async () => snap };
  return { ok: false, status: 404, json: async () => ({}) };
};
const { default: handler } = await import("../api/reports.js");
const { setTeamCookie } = await import("../api/_reports/access.js");
const team = setTeamCookie(null, "test-token", "tom@digitalfoxtalent.com").split(";")[0];
async function hit(path, cookie) {
  const req = { method: "GET", headers: { host: "ecosystem.digitalfoxtalent.com", cookie }, query: { r: path }, url: "/" + path };
  const res = { code: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; }, status(c) { this.code = c; return this; }, send(b) { this.body = String(b); return this; }, json(b) { this.body = JSON.stringify(b); return this; }, end() { return this; } };
  await handler(req, res); return res;
}
let r = await hit("partnerships/slot-board", "");
assert.equal(r.code, 401); assert.match(r.body, /DFT Ecosystem/);
r = await hit("partnerships/slot-board", team);
assert.equal(r.code, 200);
assert.match(r.body, /Slot <em>board<\/em>/);
assert.match(r.body, /<a href="\/"[^>]*>Ecosystem<\/a> \/ <a href="\/partnerships"[^>]*>Brand Partnerships<\/a> \/ Slot board/);
assert.ok(r.body.includes('"name":"Heavy Spoilers"'), "the saved copy is embedded");
r = await hit("slots-data", team);
assert.equal(r.code, 200); assert.equal(JSON.parse(r.body).totals.booked, 3);
console.log("slots: all checks passed");
