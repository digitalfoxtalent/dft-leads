// Every Ecosystem address and every old address that redirects (17 Oct 2026 move to /<department>/<tool>).
// monday and every other network call are mocked, so this only checks routing, redirects and access.
// Run: node test/ecosystem-routes.mjs
import assert from "node:assert/strict";

process.env.MONDAY_API_KEY = "test-token";
globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: { boards: [{ items_page: { items: [] } }] } }) });

const { default: handler } = await import("../api/reports.js");
const { setTeamCookie, setPartnerCookie } = await import("../api/_reports/access.js");

const team = setTeamCookie(null, "test-token", "tom@digitalfoxtalent.com").split(";")[0];
const pres = { h: {}, setHeader(k, v) { this.h[k] = v; } };
setPartnerCookie(pres, "test-token", "rhapsody");
const partner = pres.h["Set-Cookie"].split(";")[0];

async function hit(host, path, { cookie = "", method = "GET" } = {}) {
  const u = new URL("https://" + host + path);
  const query = { r: u.pathname.replace(/^\//, "") };
  u.searchParams.forEach((v, k) => { query[k] = v; });
  const req = { method, headers: { host, cookie }, query, url: path };
  const res = { code: 0, headers: {}, body: "",
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    status(c) { this.code = c; return this; },
    send(b) { this.body = String(b); return this; }, json(b) { this.body = JSON.stringify(b); return this; }, end() { return this; } };
  await handler(req, res);
  return res;
}
const ECO = "ecosystem.digitalfoxtalent.com", REP = "reports.digitalfoxtalent.com";
let n = 0;
async function redirects(host, path, to, code = 301, opts) {
  const r = await hit(host, path, opts); n++;
  assert.equal(r.code, code, host + path + " status"); assert.equal(r.headers.location, to, host + path + " location");
}
async function status(host, path, code, opts, check) {
  const r = await hit(host, path, opts); n++;
  assert.equal(r.code, code, host + path + " status " + r.code + " " + (r.headers.location || ""));
  if (check) check(r.body);
  return r;
}

// Old Ecosystem addresses -> new ones, signed in or not, query kept.
for (const opts of [{}, { cookie: team }]) {
  await redirects(ECO, "/sales", "/partnerships", 301, opts);
  await redirects(ECO, "/home", "/", 301, opts);
  await redirects(ECO, "/reports", "/reporting/campaign-reach", 301, opts);
  await redirects(ECO, "/reports/", "/reporting/campaign-reach", 301, opts);
  await redirects(ECO, "/reports/campaigns", "/reporting/campaign-reach", 301, opts);
  await redirects(ECO, "/reports/platforms?tier=written", "/reporting/platform-monetization?tier=written", 301, opts);
  await redirects(ECO, "/reports/distribution", "/reporting/video-distribution", 301, opts);
  await redirects(ECO, "/reports/coverage", "/reporting/creator-distribution", 301, opts);
  await redirects(ECO, "/reports/engaged", "/reporting/engaged-views", 301, opts);
  await redirects(ECO, "/reports/refresh", "/reporting/refresh", 301, opts);
  await redirects(ECO, "/marketing/earnings", "/marketing/earnings-calculator", 301, opts);
}

// New addresses: signed out -> the Ecosystem sign-in page, coming back to the same address.
for (const p of ["/", "/partnerships", "/platforms", "/shows", "/talent", "/reporting", "/content", "/finance", "/data", "/marketing",
  "/reporting/campaign-reach", "/reporting/platform-monetization", "/reporting/video-distribution", "/reporting/creator-distribution",
  "/reporting/engaged-views", "/reporting/refresh", "/marketing/earnings-calculator"]) {
  await status(ECO, p, 401, {}, b => { assert.match(b, /DFT Ecosystem/); assert.ok(b.includes(encodeURIComponent(p === "/" ? "/" : p)) || b.includes(p), p + " next"); });
}
// Signed in: the map on every department, the tools with a breadcrumb that matches the map.
for (const p of ["/", "/partnerships", "/reporting", "/data"]) await status(ECO, p, 200, { cookie: team }, b => assert.match(b, /DFT Ecosystem Map/));
await status(ECO, "/reporting/refresh", 200, { cookie: team }, b => {
  assert.match(b, /<a href="\/"[^>]*>Ecosystem<\/a> \/ <a href="\/reporting"[^>]*>Reporting<\/a> \/ Refresh/);
  assert.doesNotMatch(b, /Back to the Ecosystem/);
});
await status(ECO, "/marketing/earnings-calculator", 200, { cookie: team }, b => assert.match(b, /Earnings calculator/));
const map = await status(ECO, "/reporting", 200, { cookie: team });
assert.ok(!/\/reports\//.test(map.body.replace(/reports\.digitalfoxtalent\.com/g, "")), "map links no old /reports/ addresses");
assert.match(map.body, /slug:"reporting"/); assert.match(map.body, /slug:"partnerships"/);
// Sign-in on the Ecosystem still goes through the reports host.
await redirects(ECO, "/auth/login?next=%2Freporting", "https://reports.digitalfoxtalent.com/eco-signin?next=%2Freporting", 302);

// The old reports host: team pages move to the Ecosystem.
for (const opts of [{}, { cookie: team }]) {
  await redirects(REP, "/", "https://ecosystem.digitalfoxtalent.com/reporting/campaign-reach", 301, opts);
  await redirects(REP, "/campaigns", "https://ecosystem.digitalfoxtalent.com/reporting/campaign-reach", 301, opts);
  await redirects(REP, "/platforms?tier=written", "https://ecosystem.digitalfoxtalent.com/reporting/platform-monetization?tier=written", 301, opts);
  await redirects(REP, "/distribution", "https://ecosystem.digitalfoxtalent.com/reporting/video-distribution", 301, opts);
  await redirects(REP, "/coverage", "https://ecosystem.digitalfoxtalent.com/reporting/creator-distribution", 301, opts);
  await redirects(REP, "/engaged", "https://ecosystem.digitalfoxtalent.com/reporting/engaged-views", 301, opts);
  await redirects(REP, "/refresh", "https://ecosystem.digitalfoxtalent.com/reporting/refresh", 301, opts);
}
// ...but partner links, sign-in and data routes stay exactly where they were.
await status(REP, "/campaigns/rhapsody", 401, {}, b => assert.match(b, /Rhapsody/));
await redirects(REP, "/", "/campaigns/rhapsody", 302, { cookie: partner });
await redirects(REP, "/platforms", "/campaigns/rhapsody", 302, { cookie: partner });
await redirects(REP, "/campaigns/rhapsody?k=wrong", "/campaigns/rhapsody", 303);
await status(REP, "/eco-signin?next=%2Freporting", 302);
await status(REP, "/roster-signin", 302);
await status(REP, "/status", 401);
await status(REP, "/gaps", 401);
// The roster site's first home of Campaign reach still points at the reports host (which now forwards on).
await redirects("roster-viewguarantee.digitalfoxtalent.com", "/campaigns", "https://reports.digitalfoxtalent.com/", 302);

// Live, Vercel adds path (the rewrite's capture) and host (the host match) to the query. They must not ride along on a redirect.
await redirects(ECO, "/reports/platforms?path=reports%2Fplatforms&host=" + ECO, "/reporting/platform-monetization", 301);
await redirects(ECO, "/sales?path=sales&host=" + ECO + "&from=email", "/partnerships?from=email", 301);
await redirects(REP, "/platforms?path=platforms&host=" + REP, "https://ecosystem.digitalfoxtalent.com/reporting/platform-monetization", 301, { cookie: team });

console.log("ecosystem routes: " + n + " checks passed");
