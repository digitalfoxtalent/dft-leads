// Vercel serverless function — returns the DFT creator roster from monday.com.
// Reads the Monday token server-side (MONDAY_API_KEY) so it is never exposed to the browser.
const BOARD = 18417663127;
const GROUPS = ["topics", "group_mm4av3kr", "group_mm4a1fe0", "group_mm4bd5tk"];
const PCOLS = ["numeric_mm49cx8f", "numeric_mm497vsg", "numeric_mm49rr3n", "numeric_mm49bb66", "text_mm4944gw", "text_mm49j2nf", "text_mm49s85f", "text_mm49w81b", "long_text_mm492hxg", "text_mm499xez", "text_mm5nmtz1", "text_mm5n7q86", "text_mm5n8zh3", "long_text_mm5n8f4t", "link_mm5n1zej", "numeric_mm5nn2wj", "long_text_mm5nw1s9", "text_mm5nkdfn", "text_mm5nb2t7", "text_mm5n6m90", "text_mm5n69hv", "text_mm5nbatb", "text_mm5n7syq", "text_mm5n5cc8", "text_mm5nzj3n", "text_mm5nsagz", "text_mm5n7ybc"];
const SCOLS = ["numeric_mm495xbb", "numeric_mm49tej8", "numeric_mm49fe4b", "text_mm49bb5z"];

// State / Region is NOT on the rates board. The rates board's own Location column
// (text_mm49s85f) is country-level — 99 of 132 rows read exactly "United States" —
// so the state cannot be split out of it. The value lives on Global Talent Roster
// (board 6160485039) in column dup__of_email (title "State"; the id is a leftover
// from a duplicated email column). We reach it through the single-valued board
// relation "Creator" that already exists on the rates board, then flatten the
// linked creator's State onto the row as a synthetic column value so the page can
// read it exactly like any other column. Adding CREATOR_STATE_COL to PCOLS would
// NOT work — that column is not on the board being fetched.
const REL_COL = "board_relation_mm49w1a4";   // "Creator" → board 6160485039, allowMultipleItems: false
const CREATOR_STATE_COL = "dup__of_email";   // "State" on 6160485039
const STATE_KEY = "__creator_state";         // synthetic column id emitted on each row
const CREATOR_BOARD = 6160485039;           // Global Talent Roster, where State lives

// This endpoint returns the whole rates board - names, rates, view guarantees, CPMs,
// locations - and nothing about it is public. It is reachable on EVERY host attached to
// this Vercel project, so it must decide for itself who may read it rather than relying
// on a rewrite to hide it. On 4 Sep 2026 it was answering unauthenticated on subplot.tv,
// wordie.media and dft-leads.vercel.app because only the "/" rewrite had been
// host-conditioned. Guard fails CLOSED: an unrecognised or absent host gets a 404.
const ROSTER_HOSTS = new Set(["roster-viewguarantee.digitalfoxtalent.com"]);
const hostOf = req => String(
  (req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0]
).toLowerCase().trim().replace(/^www\./, "").split(":")[0];

export default async function handler(req, res) {
  try {
    if (!ROSTER_HOSTS.has(hostOf(req))) {
      // 404 not 403: an endpoint that answers "forbidden" confirms it exists.
      res.setHeader("Cache-Control", "no-store");
      return res.status(404).json({ error: "Not found" });
    }
    const token = process.env.MONDAY_API_KEY || process.env.MONDAY_API_TOKEN;
    if (!token) return res.status(500).json({ error: "MONDAY_API_KEY env var not set" });

    // SPEED, rebuilt 23 Sep 2026. This used to be ONE query: four groups, 27 columns,
    // subitems, and the board relation expanded into the Global Talent Roster for
    // every row (linked_items). It took 5 to 10 seconds cold, and the cache it sat
    // behind is thrown away on every deploy of this project, which ships several
    // times a day for Subplot and Wordie. So a brand clicking the link often waited.
    //
    // Now: one small query per group, run in parallel, plus ONE query for every
    // creator's State on the Global Talent Roster. The relation column's own raw
    // value already carries the linked item id, so nothing is expanded per row; the
    // State is joined here in code. Same response shape as before.
    const p = PCOLS.concat([REL_COL]).map(x => '"' + x + '"').join(",");
    const s = SCOLS.map(x => '"' + x + '"').join(",");
    const ask = query => fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" },
      body: JSON.stringify({ query })
    }).then(r => r.json());

    const groupQuery = g => "query{boards(ids:[" + BOARD + "]){groups(ids:[\"" + g + "\"]){id items_page(limit:120){items{id name column_values(ids:[" + p + "]){id text value} subitems{id name column_values(ids:[" + s + "]){id text}}}}}}}";
    const stateQuery = "query{boards(ids:[" + CREATOR_BOARD + "]){items_page(limit:500){items{id column_values(ids:[\"" + CREATOR_STATE_COL + "\"]){text}}}}}";

    const results = await Promise.all(GROUPS.map(g => ask(groupQuery(g))).concat([ask(stateQuery)]));
    const failed = results.find(b => b && b.errors);
    if (failed) return res.status(502).json({ error: failed.errors });

    const stateBody = results.pop();
    const stateById = {};
    (((stateBody.data || {}).boards || [])[0] || { items_page: { items: [] } }).items_page.items
      .forEach(it => { stateById[String(it.id)] = ((it.column_values || [])[0] || {}).text || ""; });

    const groups = results.map(b => (((b.data || {}).boards || [])[0] || {}).groups || []).map(gs => gs[0]).filter(Boolean);

    // Replace the raw relation column with a flat { id: STATE_KEY, text } entry.
    // An unlinked row, or a linked creator with no State recorded, yields "" -
    // the page renders that as an empty cell. Never substitute a placeholder:
    // a blank correctly reads "not recorded", a filler value reads like a claim.
    groups.forEach(grp => {
      const items = (grp.items_page && grp.items_page.items) || [];
      items.forEach(it => {
        const cvs = it.column_values || [];
        const relIdx = cvs.findIndex(c => c && c.id === REL_COL);
        let state = "";
        if (relIdx >= 0) {
          let linkedId = "";
          try {
            const v = JSON.parse(cvs[relIdx].value || "{}");
            linkedId = String(((v.linkedPulseIds || [])[0] || {}).linkedPulseId || "");
          } catch (e) { linkedId = ""; }
          state = (linkedId && stateById[linkedId]) || "";
          cvs.splice(relIdx, 1);
        }
        cvs.push({ id: STATE_KEY, text: state, value: null });
      });
    });

    // Drop rows with nothing to sell. A row whose View Guarantee is empty or zero is
    // either BRAND NEW - created after the last sync ran, so its numbers land on the
    // next one - or DEAD, like Badd Medicine Shorts, which has published no Short
    // since 27 Jun 2026 and so is correctly written as zeros by the Shorts pass.
    // Both used to render on the public roster as a creator offering 0 views at $0,
    // which reads to a brand as a channel we cannot sell rather than a row we have
    // not finished filling in. It cannot fix itself upstream either: only the
    // long-form pass moves dormant rows into the Dormant group and it deliberately
    // skips the Shorts group, so a dead Shorts row never leaves the live tab.
    // Filtered HERE rather than in the sync on purpose - the board stays complete as
    // the internal record, and the page stays honest as the shop window.
    const guaranteeOf = it => {
      const c = (it.column_values || []).find(x => x && x.id === "numeric_mm49rr3n");
      const raw = c && c.text != null ? String(c.text).replace(/[^0-9.]/g, "") : "";
      const n = raw === "" ? NaN : parseFloat(raw);
      return Number.isFinite(n) ? n : 0;
    };
    groups.forEach(grp => {
      if (grp.items_page && Array.isArray(grp.items_page.items)) {
        grp.items_page.items = grp.items_page.items.filter(it => guaranteeOf(it) > 0);
      }
    });

    // The board is rewritten once a day by Shows View Guarantee Sync (08:30 UTC cron,
    // ~16 min run), so the data is static for ~23 hours out of 24. The query itself is
    // slow - 4 groups x 120 items x 27 columns, plus subitems, plus a per-row board
    // relation into the Global Talent Roster for State - and took 60-90s cold, which a
    // brand opening the link had to sit through. A long stale-while-revalidate means a
    // visitor is served instantly from cache and the refresh happens behind them; only
    // a link left untouched for a full day can still go cold.
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=86400");
    return res.status(200).json(groups);
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
