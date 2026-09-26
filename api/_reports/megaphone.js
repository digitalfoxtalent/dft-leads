// Megaphone access for the reports. READ ONLY.
//
// WHERE THE TOKEN LIVES: the monday board "API Keys (Private)" 18422548864, item "Megaphone"
// 12925987261, column "Key (paste here)". It is read at run time with the server's monday
// token, so there is one copy of it, nobody pastes it anywhere, and replacing it on monday
// takes effect on the next run. It is never logged or returned.

import { monday } from "./monday.js";

const KEY_ITEM = 12925987261;
const KEY_COL = "text_mm5bcxe7";
export const ORG = "1a3d0cba-a905-11f0-aed3-1f65e974f33e";
const CMS = "https://cms.megaphone.fm";

export async function megaphoneToken(mondayTok) {
  const d = await monday(mondayTok, "query { items(ids:[" + KEY_ITEM + "]) { column_values(ids:[\"" + KEY_COL + "\"]) { text } } }");
  const t = d && d.items && d.items[0] && d.items[0].column_values[0] && d.items[0].column_values[0].text;
  return String(t || "").trim();
}

const authStyles = t => ({ token: 'Token token="' + t + '"', bearer: "Bearer " + t });

// One health check of every way the collector could talk to Megaphone. Returns only
// status codes, counts and short error text with the token scrubbed out.
export async function probe(mondayTok) {
  const out = { at: new Date().toISOString(), steps: [] };
  const step = (name, o) => { out.steps.push(Object.assign({ name }, o)); };
  let tok = "";
  try {
    tok = await megaphoneToken(mondayTok);
    step("token on monday", { ok: tok.length > 10, note: tok.length > 10 ? "found" : "empty or too short" });
  } catch (e) {
    step("token on monday", { ok: false, note: String(e.message || e).slice(0, 160) });
  }
  if (tok.length <= 10) return out;
  const scrub = s => String(s || "").split(tok).join("[token]").replace(/\s+/g, " ").slice(0, 160);
  const call = async (name, url, init, count) => {
    const t0 = Date.now();
    try {
      const r = await fetch(url, init);
      const txt = await r.text();
      let j = null; try { j = JSON.parse(txt); } catch (e) { /* not json */ }
      step(name, { ok: r.ok, status: r.status, ms: Date.now() - t0,
        count: r.ok && j ? count(j) : undefined, keys: r.ok && j && !Array.isArray(j) ? Object.keys(j).slice(0, 8) : undefined,
        note: r.ok ? undefined : scrub(txt) });
    } catch (e) { step(name, { ok: false, ms: Date.now() - t0, note: scrub(e.message || e) }); }
  };
  const A = authStyles(tok);
  const end = new Date(); const start = new Date(end.getTime() - 7 * 864e5);
  const day = d => d.toISOString().slice(0, 10);
  const body = JSON.stringify({ start: day(start), end: day(end), filters: [], geofilters: { exclusions: [], inclusions: [] },
    groupBys: ["episode_id", "normalized_user_agent"], includeZeroRows: false, limit: 5, offset: 0,
    metrics: ["totalDelivery", "totalDownloads", "totalStreams"] });
  const rows = j => Array.isArray(j) ? j.length : (j.data && Array.isArray(j.data) ? j.data.length : (j.rows && j.rows.length) || null);
  const get = (name, path) => call(name, CMS + path, { headers: { Authorization: A.token, Accept: "application/json" } }, j => Array.isArray(j) ? j.length : null);
  await get("public API: networks list", "/api/networks");
  await get("public API: our network", "/api/networks/" + ORG);
  await get("public API: our network's podcasts", "/api/networks/" + ORG + "/podcasts");
  await get("public API: one podcast (Sideserf)", "/api/podcasts/aa88362a-b050-11f1-ab38-9bd072db8695");
  await get("public API: episode search by YouTube id", "/api/search/episodes?externalId=yt-30XCPHwC7t8");
  await get("metrics export", "/api/metrics_export");
  for (const [style, h] of Object.entries(A)) {
    await call("delivery report (" + style + " header)", CMS + "/api/v2/private/reports/organizations/" + ORG + "/delivery/global_delivery.json",
      { method: "POST", headers: { Authorization: h, "Content-Type": "application/json", Accept: "application/json", "X-CmsWeb-CSRF-Protection": "1" }, body }, rows);
  }
  const gql = JSON.stringify({ query: "{ __typename }" });
  for (const path of ["/graphql", "/api/graphql"]) {
    await call("GraphQL " + path + " (Token header)", CMS + path,
      { method: "POST", headers: { Authorization: A.token, "Content-Type": "application/json", Accept: "application/json", "X-CmsWeb-CSRF-Protection": "1" }, body: gql }, () => null);
  }
  out.ok = out.steps.some(s => s.name.startsWith("delivery report") && s.ok);
  return out;
}
