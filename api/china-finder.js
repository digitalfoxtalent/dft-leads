export const config = { maxDuration: 300 };
// CHINA FINDER (Tom, 20 Oct 2026). Keeps Han Yi's China Opportunities board (18436345941) stocked so her alerts
// always have something to work on. One search per call so each run fits in Vercel's 300 seconds:
//   ?type=game    -> upcoming global / US launches from Chinese game publishers and studios
//   ?type=global  -> Chinese tech, app and consumer brands launching or expanding in the US or the West
//   ?type=spend   -> Chinese brands already sponsoring English-language YouTube creators in our niches
// Win-back rows (past China buyers) are added separately from US Campaigns deals.
// Rules (same spirit as release-finder.js): never invent a company, title or date; approximate dates flagged in Notes;
// dedupe against the China board; never write contact columns (contact research does that);
// overlap with Margot's and George's boards is allowed (Tom, 20 Oct 2026), so those boards are not checked.
// ?dry=1 returns what it would add without writing. Calls need the Vercel cron user agent or ?key=CRON_SECRET.

export const BOARD = "18436345941";
export const COL = { type: "color_mm8bbmj5", status: "color_mm8bvmnm", date: "date_mm8by53f", en: "text_mm8b4kxw", cn: "text_mm8b3rp6",
  domain: "text_mm8bsc3n", niche: "text_mm8btsxz", budget: "color_mm8b2a8h", why: "long_text_mm8ba0nq", source: "link_mm8bvjcs", notes: "long_text_mm8bxwbe" };
const MODELS = ["claude-opus-5-5", "claude-sonnet-4-5"];
const MAX_NEW = 15;
const DAY = 86400000;
const FIELDS = "{\"name\":\"\",\"company_en\":\"\",\"company_cn\":\"Chinese name in Chinese characters, or empty if unknown\",\"company_domain\":\"\",\"key_date\":\"YYYY-MM-DD\",\"date_confidence\":\"firm|approximate\",\"budget_tier\":\"High|Mid|Low\",\"niche\":\"short, e.g. Gaming / RPG\",\"why\":\"one sentence on why this is a creator sponsorship opportunity\",\"source_url\":\"\"}";

export const TYPES = {
  game: { label: "Game release", dated: "future",
    ask: w => [
      `List video games from Chinese publishers or studios (for example Tencent / Level Infinite, NetEase, HoYoverse, Kuro Games, Papergames / Infold, Hypergryph, Lilith, FunPlus, Seasun, Perfect World, Game Science) launching globally or in the US between ${w[0]} and ${w[1]}, including big updates, expansions and Western launches of games already out in China.`,
      "Include only releases with a real marketing push in the West, the kind English-language YouTube gaming creators cover.",
      "name = the game title. key_date = the global or US launch date."] },
  global: { label: "Going global", dated: "future",
    ask: w => [
      `List Chinese tech, app and consumer brands (for example phones, laptops, handhelds, accessories, smart home, cameras and drones, e-commerce and apps) launching a product in the US or Europe, or entering those markets, between ${w[0]} and ${w[1]}.`,
      "Include only launches big enough that the brand is likely to pay English-language YouTube tech, gaming or lifestyle creators to promote them.",
      "name = brand plus product, e.g. \"Xiaomi 17 Ultra (global launch)\". key_date = the US or global launch date."] },
  spend: { label: "Brand spend", dated: "past",
    ask: w => [
      `List Chinese brands that sponsored English-language YouTube creators in gaming, tech, film or pop culture between ${w[0]} and ${w[1]}: sponsored segments, dedicated videos or affiliate campaigns you can find evidence for.`,
      "Give the evidence page (a sponsored video, a campaign announcement or a trade report) as source_url.",
      "name = the brand. key_date = the most recent date you found them sponsoring a creator."] }
};

const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9一-鿿]+/g, " ").replace(/\b(the|a|an)\b/g, " ").replace(/\s+/g, " ").trim();
export const coreName = s => norm(String(s || "").replace(/(\s*\([^()]*\))+\s*$/, ""));
// Same opportunity if the names match after normalising (ignoring a trailing bracket), or one contains the other,
// within the same type. A brand-spend row is keyed by the brand, so one brand is only added once per type.
export function isDupe(name, label, existing) {
  const n = norm(name), core = coreName(name);
  if (!n) return true;
  for (const e of existing) {
    if (e.label !== label) continue;
    if (e.n === n || (core.length >= 4 && e.core === core)) return true;
    if ((e.n.includes(n) || n.includes(e.n)) && Math.min(e.n.length, n.length) >= 6) return true;
  }
  return false;
}

// Turn one researched entry into monday column values, or a reason it was skipped.
export function toRow(x, type, today) {
  const t = TYPES[type];
  const iso = d => d.toISOString().slice(0, 10);
  const name = String(x.name || "").trim().slice(0, 200);
  const date = String(x.key_date || "").slice(0, 10);
  if (!name) return { skip: "?: no name" };
  if (!String(x.company_en || "").trim()) return { skip: name + ": no company" };
  if (!/^\d{4}-\d\d-\d\d$/.test(date) || isNaN(Date.parse(date))) return { skip: name + ": no usable date" };
  const start = iso(today);
  if (t.dated === "future" && (date < start || date > iso(new Date(today.getTime() + 183 * DAY)))) return { skip: name + ": outside window (" + date + ")" };
  if (t.dated === "past" && (date > start || date < iso(new Date(today.getTime() - 120 * DAY)))) return { skip: name + ": not recent (" + date + ")" };
  const domain = String(x.company_domain || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].slice(0, 100);
  const approx = /approx/i.test(String(x.date_confidence || ""));
  const src = String(x.source_url || "").trim();
  const cols = {};
  cols[COL.type] = { label: t.label };
  cols[COL.status] = { label: "Not started" };
  cols[COL.date] = { date };
  cols[COL.en] = String(x.company_en).trim().slice(0, 200);
  if (/[一-鿿]/.test(String(x.company_cn || ""))) cols[COL.cn] = String(x.company_cn).trim().slice(0, 100);
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) cols[COL.domain] = domain;
  cols[COL.niche] = String(x.niche || "").slice(0, 100);
  if (["High", "Mid", "Low"].includes(String(x.budget_tier || ""))) cols[COL.budget] = { label: x.budget_tier };
  if (x.why) cols[COL.why] = { text: String(x.why).slice(0, 600) };
  if (/^https?:\/\//.test(src)) cols[COL.source] = { url: src.slice(0, 500), text: "Source" };
  cols[COL.notes] = { text: (approx ? "Date approximate, confirm later. " : "") + "Added by the China finder " + start + "." };
  return { name, date, approx, cols };
}

export default async function handler(req, res) {
  const MK = process.env.MONDAY_API_KEY, ANT = process.env.ANTHROPIC_API_KEY;
  if (!MK || !ANT) return res.status(500).json({ error: "Missing env vars" });
  const ua = String(req.headers["user-agent"] || "");
  const secret = process.env.CRON_SECRET;
  const bearer = String(req.headers.authorization || "") === "Bearer " + secret;
  if (!/vercel-cron/i.test(ua) && !(secret && (bearer || req.query.key === secret))) return res.status(401).json({ error: "Not allowed" });
  const type = String(req.query.type || "");
  const t = TYPES[type];
  if (!t) return res.status(400).json({ error: "type must be one of " + Object.keys(TYPES).join(", ") });
  const dry = req.query.dry === "1";

  async function monday(q, variables) {
    const r = await fetch("https://api.monday.com/v2", { method: "POST", headers: { "Content-Type": "application/json", Authorization: MK }, body: JSON.stringify({ query: q, variables: variables || {} }) });
    return r.json();
  }

  // 1. Everything already on the China board, for dedupe.
  const existing = [];
  let cursor = null;
  for (let p = 0; p < 10; p++) {
    const q = cursor
      ? `query { next_items_page(limit:500, cursor:${JSON.stringify(cursor)}) { cursor items { name column_values(ids:["${COL.type}"]) { text } } } }`
      : `query { boards(ids:[${BOARD}]) { items_page(limit:500) { cursor items { name column_values(ids:["${COL.type}"]) { text } } } } }`;
    const d = await monday(q);
    const page = cursor ? (d.data || {}).next_items_page : ((((d.data || {}).boards || [])[0] || {}).items_page);
    if (!page) return res.status(502).json({ error: "Could not read the China board for dedupe; nothing written", detail: d.errors || null });
    for (const it of page.items || []) existing.push({ n: norm(it.name), core: coreName(it.name), label: ((it.column_values || [])[0] || {}).text || "" });
    cursor = page.cursor; if (!cursor) break;
  }

  // 2. Research with Claude + web search.
  const today = new Date(); const iso = d => d.toISOString().slice(0, 10);
  const windows = t.dated === "future"
    ? [[0, 90], [91, 183]].map(([a, b]) => [iso(new Date(today.getTime() + a * DAY)), iso(new Date(today.getTime() + b * DAY))])
    : [[iso(new Date(today.getTime() - 90 * DAY)), iso(today)]];
  const found = [], errors = [];
  for (const w of windows) {
    const prompt = [
      "You research opportunities for Digital Fox Talent, a creator management agency whose China representative, Han Yi, pitches English-language YouTube creators (gaming, tech, film and pop culture) to Chinese companies.",
      ...t.ask(w),
      "Use web search and check every fact against official or reliable sources. Never invent a company, a title or a date. If only a month or season is announced, give the 15th of that month and set date_confidence to \"approximate\".",
      "Give each company's English name, its Chinese name in Chinese characters where you can confirm it, and its main website domain.",
      "Reply with ONLY a JSON array, no prose, at most 20 items, each: " + FIELDS
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
    if (Array.isArray(arr)) for (const x of arr) found.push(x);
  }

  // 3. Validate, dedupe, cap, write.
  const added = [], skipped = [];
  for (const x of found) {
    const row = toRow(x, type, today);
    if (row.skip) { skipped.push(row.skip); continue; }
    if (isDupe(row.name, t.label, existing)) { skipped.push(row.name + ": already on the board"); continue; }
    if (added.length >= MAX_NEW) { skipped.push(row.name + ": over the per-run cap"); continue; }
    existing.push({ n: norm(row.name), core: coreName(row.name), label: t.label });
    if (dry) { added.push({ name: row.name, date: row.date, company: row.cols[COL.en], approx: row.approx }); continue; }
    const d = await monday("mutation ($b: ID!, $n: String!, $v: JSON!) { create_item(board_id: $b, group_id: \"topics\", item_name: $n, column_values: $v, create_labels_if_missing: false) { id } }", { b: BOARD, n: row.name, v: JSON.stringify(row.cols) });
    if (d.data && d.data.create_item) added.push({ id: d.data.create_item.id, name: row.name, date: row.date });
    else skipped.push(row.name + ": monday refused (" + JSON.stringify(d.errors || d).slice(0, 160) + ")");
  }
  return res.json({ type, board: BOARD, dry, found: found.length, added, skipped, errors });
}
