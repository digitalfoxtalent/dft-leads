export const config = { maxDuration: 300 };
// RELEASE FINDER (Tom, 17 Oct 2026). Keeps the two release boards stocked with upcoming releases so the pitch pipeline
// (creator matcher, Hunter contact research, alert emails) always has something to work on.
//   ?niche=game | series | tech  -> Tom's Games, TV & Tech board 18435939296
//   ?niche=film                  -> George's Studio/Dev Upcoming Releases board 18415007170
// Replaces "Duty 2 Release sourcing" of the old Head of Brand Partnerships scheduled task, which stopped running after
// 5 Oct 2026 (no rows were added after that). One niche per call so each run fits in Vercel's 300 seconds.
// Rules kept from that task: US releases, today to +183 days, dedupe against BOTH boards (archive included), never invent
// a title or date, approximate dates flagged in Notes, never set "Reach out now" (the matcher and the monday 30-day
// automation own that flip), never write contact columns (the Hunter scenario does that).
// ?dry=1 returns what it would add without writing. Calls need the Vercel cron user agent or ?key=CRON_SECRET.

const TOM_BOARD = "18435939296", GEORGE_BOARD = "18415007170";
const NICHES = {
  game: { board: TOM_BOARD, label: "Game", what: "video games (console, PC and major mobile launches, including big remasters, ports and expansions)", bar: "AAA or high-profile releases and indie games with real buzz, the kind YouTube gaming creators cover" },
  series: { board: TOM_BOARD, label: "Series", what: "TV and streaming series (new shows and new seasons, including anime)", bar: "series with a fan following that pop-culture YouTube creators review, recap or react to" },
  tech: { board: TOM_BOARD, label: "Tech", what: "consumer tech launches (phones, laptops, consoles and handhelds, GPUs and CPUs, VR/XR headsets, cameras, drones, wearables)", bar: "launches from major brands that tech YouTube creators review" },
  film: { board: GEORGE_BOARD, label: "Film", what: "feature films (theatrical and streaming premieres)", bar: "wide releases and notable genre films that movie YouTube creators review or react to" }
};
const COL = { date: "date_mm3rpkm4", studio: "text_mm3rtkxq", domain: "text_mm5baenw", type: "color_mm5bqrxh", budget: "color_mm5b7whx", genre: "text_mm3r8f5b", status: "color_mm5bmek5", window: "color_mm5cpevg", notes: "long_text_mm3rkxtq" };
const MODELS = ["claude-opus-5-5", "claude-sonnet-4-5"];
const MAX_NEW = 15; // per niche per run, so a bad answer can never flood a board
const DAY = 86400000;

const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\b(the|a|an)\b/g, " ").replace(/\s+/g, " ").trim();
// Same release if the names match after normalising, or one contains the other and they share a type
// ("Stellar Blade Complete Edition (Switch 2)" vs "Stellar Blade Complete Edition"). When unsure, skip: a duplicate
// splits the contact work and double-fires the alert.
// A trailing bracket is a platform or year tag, not part of the title, so "Ocarina of Time (Switch 2)" and
// "Ocarina of Time (2026)" are the same release (Tom, 20 Oct 2026: the second one came in as a new row without the
// Golin contact, so his email to Golin never marked it). Compared within the same type only, so a film and a game
// that share a name stay separate.
export const coreName = s => norm(String(s || "").replace(/(\s*\([^()]*\))+\s*$/, ""));
export function isDupe(name, type, existing) {
  const n = norm(name); if (!n) return true;
  const core = coreName(name);
  for (const e of existing) {
    if (e.n === n) return true;
    if (e.type === type && (e.n.includes(n) || n.includes(e.n)) && Math.min(e.n.length, n.length) >= 6) return true;
    const ec = e.core != null ? e.core : e.n;
    if (e.type === type && core.length >= 6 && ec === core) return true;
  }
  return false;
}

export default async function handler(req, res) {
  const MK = process.env.MONDAY_API_KEY, ANT = process.env.ANTHROPIC_API_KEY;
  if (!MK || !ANT) return res.status(500).json({ error: "Missing env vars" });
  const ua = String(req.headers["user-agent"] || "");
  const secret = process.env.CRON_SECRET;
  const bearer = String(req.headers.authorization || "") === "Bearer " + secret;
  if (!/vercel-cron/i.test(ua) && !(secret && (bearer || req.query.key === secret))) return res.status(401).json({ error: "Not allowed" });
  const niche = NICHES[String(req.query.niche || "")];
  if (!niche) return res.status(400).json({ error: "niche must be one of " + Object.keys(NICHES).join(", ") });
  const dry = req.query.dry === "1";

  async function monday(q, variables) {
    const r = await fetch("https://api.monday.com/v2", { method: "POST", headers: { "Content-Type": "application/json", Authorization: MK }, body: JSON.stringify({ query: q, variables: variables || {} }) });
    return r.json();
  }

  // 1. Every existing title on both boards, all groups, for dedupe.
  const existing = [];
  for (const board of [TOM_BOARD, GEORGE_BOARD]) {
    let cursor = null;
    for (let p = 0; p < 10; p++) {
      const q = cursor
        ? `query { next_items_page(limit:500, cursor:${JSON.stringify(cursor)}) { cursor items { name column_values(ids:["${COL.type}"]) { text } } } }`
        : `query { boards(ids:[${board}]) { items_page(limit:500) { cursor items { name column_values(ids:["${COL.type}"]) { text } } } } }`;
      const d = await monday(q);
      const page = cursor ? (d.data || {}).next_items_page : ((((d.data || {}).boards || [])[0] || {}).items_page);
      if (!page) return res.status(502).json({ error: "Could not read board " + board + " for dedupe; nothing written", detail: d.errors || null });
      for (const it of page.items || []) existing.push({ n: norm(it.name), core: coreName(it.name), type: ((it.column_values || [])[0] || {}).text || "" });
      cursor = page.cursor; if (!cursor) break;
    }
  }

  // 2. Research with Claude + web search, in two windows so later months are not crowded out.
  const today = new Date(); const iso = d => d.toISOString().slice(0, 10);
  const windows = [[0, 90], [91, 183]].map(([a, b]) => [iso(new Date(today.getTime() + a * DAY)), iso(new Date(today.getTime() + b * DAY))]);
  const found = [], errors = [];
  for (const [from, to] of windows) {
    const prompt = [
      `You research upcoming US ${niche.what} for Digital Fox Talent, a creator management agency that pitches its YouTube creators to the companies behind each release.`,
      `List releases coming out in the US between ${from} and ${to}. Include only ${niche.bar}. Use web search; check release dates against official or reliable trade sources.`,
      "Never invent a title or a date. If only a month or season is announced, give the 15th of that month and set date_confidence to \"approximate\". Leave out anything with no date at all or that is clearly delayed out of the window.",
      "For each release give the company that markets it in the US (publisher, studio, network or brand) and that company's main website domain.",
      "Reply with ONLY a JSON array, no prose, at most 25 items, each: {\"title\":\"\",\"release_date\":\"YYYY-MM-DD\",\"date_confidence\":\"firm|approximate\",\"company\":\"\",\"company_domain\":\"\",\"budget_tier\":\"Tentpole/AAA|Mid|Indie\",\"genre\":\"short, e.g. Action / RPG\",\"source_url\":\"\"}"
    ].join("\n");
    let arr = null;
    for (const model of MODELS) {
      try {
        const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": ANT, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model, max_tokens: 6000, tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }], messages: [{ role: "user", content: prompt }] }) });
        const d = await r.json();
        if (!r.ok || !d.content) { errors.push(model + ": " + ((d.error || {}).message || r.status)); continue; }
        const text = d.content.filter(x => x.type === "text").map(x => x.text).join("\n");
        const m = text.match(/\[[\s\S]*\]/);
        arr = m ? JSON.parse(m[0]) : [];
        break;
      } catch (e) { errors.push(model + ": " + e.message); }
    }
    if (Array.isArray(arr)) for (const x of arr) found.push(Object.assign({}, x, { window: from + " to " + to }));
  }

  // 3. Validate, dedupe, cap, write.
  const start = iso(today), end = iso(new Date(today.getTime() + 183 * DAY));
  const added = [], skipped = [];
  const BUDGETS = new Set(["Tentpole/AAA", "Mid", "Indie"]);
  for (const x of found) {
    const title = String(x.title || "").trim().slice(0, 200);
    const date = String(x.release_date || "").slice(0, 10);
    if (!title || !/^\d{4}-\d\d-\d\d$/.test(date) || isNaN(Date.parse(date))) { skipped.push((title || "?") + ": no usable date"); continue; }
    if (date < start || date > end) { skipped.push(title + ": outside window (" + date + ")"); continue; }
    if (isDupe(title, niche.label, existing)) { skipped.push(title + ": already on a board"); continue; }
    if (added.length >= MAX_NEW) { skipped.push(title + ": over the per-run cap"); continue; }
    const days = Math.round((Date.parse(date + "T12:00:00Z") - Date.parse(start + "T12:00:00Z")) / DAY);
    const approx = /approx/i.test(String(x.date_confidence || ""));
    const domain = String(x.company_domain || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].slice(0, 100);
    const cols = {};
    cols[COL.date] = { date };
    cols[COL.studio] = String(x.company || "").slice(0, 200);
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) cols[COL.domain] = domain;
    cols[COL.type] = { label: niche.label };
    if (BUDGETS.has(String(x.budget_tier || ""))) cols[COL.budget] = { label: x.budget_tier };
    cols[COL.genre] = String(x.genre || "").slice(0, 100);
    cols[COL.status] = { label: "Not started" };
    cols[COL.window] = { label: days > 120 ? "Too early" : "Prep window" };
    cols[COL.notes] = { text: (approx ? "Date approximate, confirm later. " : "") + "Added by the release finder " + start + (x.source_url ? ". Source: " + String(x.source_url).slice(0, 300) : "") };
    existing.push({ n: norm(title), core: coreName(title), type: niche.label });
    if (dry) { added.push({ title, date, company: cols[COL.studio], approx }); continue; }
    const d = await monday("mutation ($b: ID!, $n: String!, $v: JSON!) { create_item(board_id: $b, group_id: \"topics\", item_name: $n, column_values: $v, create_labels_if_missing: true) { id } }", { b: niche.board, n: title, v: JSON.stringify(cols) });
    if (d.data && d.data.create_item) added.push({ id: d.data.create_item.id, title, date });
    else skipped.push(title + ": monday refused (" + JSON.stringify(d.errors || d).slice(0, 160) + ")");
  }
  return res.json({ niche: req.query.niche, board: niche.board, dry, found: found.length, added, skipped, errors });
}
