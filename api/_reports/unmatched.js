// Unmatched sponsor reads: the link finder's second pass (GET /api/link-finder?pass=unmatched).
//
// The first pass starts from deal rows and looks for their videos. This pass looks the other way:
// every roster channel's uploads from the last 14 days, the sponsor reads in their descriptions, and
// which of those no creator row links. Each one is classified (first clear answer wins):
//   1 Make-good        same brand and creator as a deal, the SAME tracking link and code as that deal's
//                      video, the deal is under its view guarantee, and no invoice of its own
//   2 Deal missing     an invoice on Brand Invoices (18424308590) names this brand and creator for the
//     (invoiced)       video's month: the invoice customer decides the client
//   3 Separate buy     the brand has deals with this creator, but a new link or code, or no guarantee left
//   4 Other agency     no deal with this creator, but the brand's usual client is known from other deals
//   5 Unknown          nothing matches
// A brand counts only from a LINK in the description (the brand's own domain, or a redirect whose path
// names it) or a promo CODE on a line that names it, never from a bare word ("Cheesecake Factory" is not
// Factor). A link on most of a channel's uploads is a standing link (merch, a long-running affiliate),
// not a read. A read that an open creator row will pick up in the normal pass is left alone.
//
// Client tag check (same pass): for each invoice on Brand Invoices with a QB customer, the deal's CLIENT
// mirror (from CONTACTS) and QB Customer (auto) should name the same company. Mismatches are listed.
//
// Writes: only make-goods touch deals (append to LIVE VIDEO URLS + an update with the evidence), and only
// when MAKEGOOD_WRITES is on. Everything else goes to the review board "Unmatched sponsor reads"
// (18433205666), one row per video and brand (or per invoice), never twice. Contacts and deals are
// never created or changed by this pass.

import { monday } from "./monday.js";
import { yt, loadGtr } from "./backfill.js";
import { windowOf, monthHint } from "./flight-match.js";

export const REVIEW_BOARD = 18433205666;
const SUB_BOARD = 6162879732, AR_BOARD = 18424308590;
export const NOTIFY_USERS = [100099218, 54957240]; // Margot Grant, Alex Mackenzie
const D = 864e5, REPORT_DAYS = 14, STANDING_DAYS = 45;

const sq = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
const day = s => new Date(String(s).slice(0, 10) + "T00:00:00Z").getTime();
const iso = t => new Date(t).toISOString().slice(0, 10);
const cvMap = cvs => { const o = {}; for (const c of cvs || []) o[c.id] = c; return o; };
const txt = c => !c ? "" : (c.display_value != null && c.display_value !== "") ? c.display_value : (c.text || "");
const ID_RE = /(?:v=|youtu\.be\/|shorts\/|live\/|embed\/)([A-Za-z0-9_-]{11})/g;
const vidIds = t => [...String(t || "").matchAll(ID_RE)].map(m => m[1]);

// ---------- monday loading ----------

const ROW_FIELDS = "cursor items { id name parent_item { id name group { title } column_values(ids:[\"status_1\",\"dropdown_mm1a3tqp\",\"lookup_mkz6pygk\",\"lookup_mm5zp13v\",\"board_relation_mm5x8h0y\",\"date__1\"]) { id text ... on BoardRelationValue { display_value linked_item_ids } ... on MirrorValue { display_value } } } column_values(ids:[\"connect_boards__1\",\"text_mm6aq9qp\",\"numeric_mm3yxqes\",\"numeric_mm4bn6yq\",\"date_mm1mb38m\",\"timerange_mm1m50vx\",\"color_mm7jh1xw\"]) { id text ... on BoardRelationValue { display_value } } }";
export const ROWS_QUERY = "query { boards(ids:[" + SUB_BOARD + "]) { items_page(limit:500) { " + ROW_FIELDS + " } } }";
const AR_FIELDS = "cursor items { id name group { title } column_values(ids:[\"text_mm5qdm4f\",\"text_mm60e5d9\",\"text_mm5qvwsw\",\"text_mm5qq5q\",\"board_relation_mm5xasjj\",\"date_mm5qwsdn\"]) { id text ... on BoardRelationValue { display_value linked_item_ids } } }";
export const AR_QUERY = "query { boards(ids:[" + AR_BOARD + "]) { items_page(limit:500) { " + AR_FIELDS + " } } }";
export const REVIEW_QUERY = "query { boards(ids:[" + REVIEW_BOARD + "]) { items_page(limit:500) { cursor items { id column_values(ids:[\"key\"]) { text } } } } }";

async function allPages(token, query, fields) {
  let d = await monday(token, query);
  let page = d.boards[0].items_page, items = page.items.slice(), guard = 0;
  while (page.cursor && guard++ < 20) {
    d = await monday(token, "query { next_items_page(limit:500, cursor:\"" + page.cursor + "\") { " + fields + " } }");
    page = d.next_items_page; items = items.concat(page.items);
  }
  return items;
}

// Creator rows with their deal. One row = one creator's part of one deal.
export function parseRows(items) {
  const out = [];
  for (const it of items) {
    const p = it.parent_item; if (!p) continue;
    const c = cvMap(it.column_values), pc = cvMap(p.column_values);
    const brands = String(txt(pc.dropdown_mm1a3tqp) || String(p.name).split(/[_]/)[0]).split(",").map(s => s.trim()).filter(Boolean);
    out.push({
      id: it.id, row: it.name, deal: p.name, dealId: p.id, group: (p.group && p.group.title) || "", status: txt(pc.status_1),
      brands, brand: brands[0] || "", h: txt(c.connect_boards__1),
      links: txt(c.text_mm6aq9qp), vids: vidIds(txt(c.text_mm6aq9qp)),
      req: Number(txt(c.numeric_mm3yxqes)) || 0, views: Number(txt(c.numeric_mm4bn6yq)) || 0,
      pub: txt(c.date_mm1mb38m), live: String(txt(c.timerange_mm1m50vx)).slice(0, 10), closed: txt(pc.date__1), label: txt(c.color_mm7jh1xw),
      client: txt(pc.lookup_mkz6pygk), qbAuto: txt(pc.lookup_mm5zp13v),
      arIds: ((pc.board_relation_mm5x8h0y && pc.board_relation_mm5x8h0y.linked_item_ids) || []).map(String),
    });
  }
  return out;
}

export function parseInvoices(items) {
  return items.map(it => {
    const c = cvMap(it.column_values);
    return { id: String(it.id), name: it.name, group: (it.group && it.group.title) || "", num: txt(c.text_mm5qdm4f), customer: txt(c.text_mm60e5d9),
      brandText: txt(c.text_mm5qvwsw), campaign: txt(c.text_mm5qq5q), sent: txt(c.date_mm5qwsdn),
      dealIds: ((c.board_relation_mm5xasjj && c.board_relation_mm5xasjj.linked_item_ids) || []).map(String) };
  });
}

// Loaded in flat pieces and joined here: asking for the deal's mirror columns from every creator row
// took over 40 seconds on 29 Sep 2026. Rows, deals and the deals' contacts are three cheap reads.
const SUB_FIELDS = "cursor items { id name parent_item { id } column_values(ids:[\"connect_boards__1\",\"text_mm6aq9qp\",\"numeric_mm3yxqes\",\"numeric_mm4bn6yq\",\"date_mm1mb38m\",\"timerange_mm1m50vx\",\"color_mm7jh1xw\"]) { id text ... on BoardRelationValue { display_value } } }";
const DEAL_FIELDS = "cursor items { id name group { title } column_values(ids:[\"status_1\",\"dropdown_mm1a3tqp\",\"date__1\",\"board_relation_mm5x8h0y\",\"deal_contact\"]) { id text ... on BoardRelationValue { linked_item_ids } } }";
export async function loadData(token) {
  const [subItems, dealItems, arItems, revItems, gtr] = await Promise.all([
    allPages(token, "query { boards(ids:[" + SUB_BOARD + "]) { items_page(limit:500) { " + SUB_FIELDS + " } } }", SUB_FIELDS),
    allPages(token, "query { boards(ids:[6162879609]) { items_page(limit:500) { " + DEAL_FIELDS + " } } }", DEAL_FIELDS),
    allPages(token, AR_QUERY, AR_FIELDS),
    allPages(token, REVIEW_QUERY, "cursor items { id column_values(ids:[\"key\"]) { text } }"), loadGtr(token)]);
  // The deals' contacts: which client each contact belongs to, and its QuickBooks name.
  const contactOf = {}, ids = new Set();
  for (const d of dealItems) { const c = cvMap(d.column_values).deal_contact; const l = (c && c.linked_item_ids) || []; contactOf[d.id] = l.map(String); l.forEach(x => ids.add(String(x))); }
  const contacts = {}, list = [...ids];
  for (let i = 0; i < list.length; i += 100) {
    const r = await monday(token, "query { items(ids:[" + list.slice(i, i + 100).join(",") + "], limit:100) { id column_values(ids:[\"contact_account\",\"text3\"]) { id text ... on BoardRelationValue { display_value } } } }");
    for (const it of r.items) { const c = cvMap(it.column_values); contacts[it.id] = { client: txt(c.contact_account), qb: txt(c.text3) }; }
  }
  const deals = {};
  for (const d of dealItems) {
    const c = cvMap(d.column_values), cs = contactOf[d.id].map(x => contacts[x]).filter(Boolean);
    const join = k => [...new Set(cs.map(x => x[k]).filter(Boolean))].join(", ");
    deals[d.id] = { id: d.id, name: d.name, group: d.group, column_values: [c.status_1, c.dropdown_mm1a3tqp, c.date__1, c.board_relation_mm5x8h0y, { id: "lookup_mkz6pygk", text: join("client") }, { id: "lookup_mm5zp13v", text: join("qb") }].filter(Boolean) };
  }
  const rowItems = subItems.map(it => ({ ...it, parent_item: it.parent_item && deals[it.parent_item.id] })).filter(it => it.parent_item);
  return { rows: parseRows(rowItems), invoices: parseInvoices(arItems), reviewKeys: new Set(revItems.flatMap(i => String((i.column_values[0] || {}).text || "").split(/\s+/)).filter(Boolean)), gtr };
}

// ---------- brands and description parsing ----------

// Words that are also brands: these count only when the link's own domain is the brand.
const COMMON = new Set(["factor", "fox", "beam", "meta", "opera", "hulu", "disney", "hbo", "fx", "naruto", "webtoon", "warhammer", "human", "degen", "daybreak", "obscura", "gaia", "exit8"]);
const ALIASES = { raidshadowlegends: ["raid", "plarium"], hellofresh: ["hellofresh"], liquidiv: ["liquidiv", "liquid-iv"], magicthegathering: ["mtg", "magic"], rocketmoney: ["rocketmoney"], ubereats: ["ubereats"] };
const DOMAIN_PREFIX = /^(try|get|go|use|join|shop|drink|eat|my|the|buy|play)/;
const DOMAIN_SUFFIX = /^(\d{0,3}|app|hq|meals|usa|us|official|inc|co|games?|vpn)$/;
const SHORT_HOSTS = /^(bit\.ly|geni\.us|tinyurl\.com|rebrand\.ly|shorturl\.at|t\.co|ow\.ly|bl\.ink|linkin\.bio|lnk\.to|smarturl\.it|fanlink\.to|onelink\.me|[a-z0-9-]+\.onelink\.me|go\.[a-z0-9-]+\.[a-z]+|click\.[a-z0-9-]+\.[a-z]+|trk\.[a-z0-9-]+\.[a-z]+|app\.adjust\.com|[a-z0-9-]+\.sjv\.io|[a-z0-9-]+\.pxf\.io|[a-z0-9-]+\.go2cloud\.org|impact\.com)$/i;
const SOCIAL = /(^|\.)(youtube\.com|youtu\.be|instagram\.com|twitter\.com|x\.com|tiktok\.com|facebook\.com|fb\.com|fb\.me|discord\.(gg|com)|twitch\.tv|patreon\.com|threads\.net|linktr\.ee|bsky\.app|reddit\.com|spotify\.com|apple\.com|google\.com|goo\.gl|amzn\.to|amazon\.com|a\.co|podcasts\.apple\.com|snapchat\.com|kick\.com|ko-fi\.com|buymeacoffee\.com|teespring\.com|spreadshirt\.com|fourthwall\.com|streamelements\.com|imdb\.com|wikipedia\.org|letterboxd\.com|gofundme\.com|substack\.com|megaphone\.fm|libsyn\.com|anchor\.fm|pod\.link|podcasts\.google\.com|digitalfoxtalent\.com|subplot\.tv|wordie\.media|gmail\.com|bsky\.social|threads\.com|mailchi\.mp)$/i;
const SPONSOR_WORDS = /sponsor|partner(ed)?|thanks? to|brought to you|promo ?code|use (my |our )?code|coupon|discount|% ?off|free trial|sign up|download/i;
const CODE_RE = /\b(?:code|coupon|promo)\b\s*(?:is\s*)?[:\-"'“‘(]?\s*([A-Za-z0-9][A-Za-z0-9_-]{2,24})/i;
const CODE_STOP = /^(at|for|and|the|to|below|here|in|on|link|now|today|and|is|off|you|your|get|with|from|when|this|that|which)$/i;

export function brandIndex(rows, invoices) {
  const seen = new Map();
  const add = (name) => {
    const k = sq(name).replace(/^the/, ""); if (k.length < 3 || seen.has(k)) return;
    seen.set(k, { brand: String(name).trim(), k, keys: [k, ...(ALIASES[k] || [])].map(sq), common: COMMON.has(k) });
  };
  for (const r of rows) for (const b of r.brands) add(b);
  for (const i of invoices) { if (i.brandText) add(i.brandText); }
  return [...seen.values()];
}

function hostParts(url) {
  const m = String(url).match(/^(?:https?:\/\/)?([^\/?#\s]+)([^?#\s]*)/i); if (!m) return null;
  const host = m[1].toLowerCase().replace(/^www\./, "").replace(/:\d+$/, "");
  const labels = host.split(".");
  const reg = labels.length >= 3 && /^(co|com|org|net)$/.test(labels[labels.length - 2]) ? labels[labels.length - 3] : labels[Math.max(0, labels.length - 2)];
  return { host, reg: reg || host, path: m[2] || "" };
}
const domainIs = (reg, key) => { const r = sq(reg), r2 = r.replace(DOMAIN_PREFIX, ""); for (const x of [r, r2]) { if (x === key) return true; if (x.startsWith(key) && DOMAIN_SUFFIX.test(x.slice(key.length))) return true; } return false; };

// Which known brand a link belongs to. Domain first; a redirect's path counts only for distinctive names.
export function brandOfLink(url, brands) {
  const hp = hostParts(url); if (!hp) return null;
  for (const b of brands) if (b.keys.some(k => domainIs(hp.reg, k))) return { b, how: "domain" };
  const redirect = SHORT_HOSTS.test(hp.host) || hp.path.length > 1;
  if (!redirect) return null;
  const segs = hp.path.split("/").map(sq).filter(Boolean);
  for (const b of brands) {
    if (b.common || b.k.length < 5) continue;
    if (b.keys.some(k => k.length >= 5 && segs.some(s => s === k || (SHORT_HOSTS.test(hp.host) && s.startsWith(k))))) return { b, how: "link path" };
  }
  return null;
}
export const normLink = u => String(u).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "").replace(/[\/.,!)]+$/, "");

// Sponsor reads in one description: [{ key, brand, known, link, code, how, line }]
export function readsIn(desc, brands, ownKeys) {
  const out = new Map();
  const lines = String(desc || "").split(/\n+/);
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const urls = (line.match(/https?:\/\/[^\s)\]>"']+|\b[a-z0-9-]+\.(?:com|co|io|me|ly|us|net|org|app|gg|tv|deals|link|shop|store)\/[^\s)\]>"']*/gi) || []).map(u => u.replace(/[.,!]+$/, ""));
    const cm = line.match(CODE_RE); const code = cm && !CODE_STOP.test(cm[1]) ? cm[1] : "";
    // A code with its link on the next line ("Use code X at" / "https://...") belongs to that link.
    const nextUrls = !urls.length && code && lines[li + 1] ? (lines[li + 1].match(/https?:\/\/[^\s)\]>"']+/gi) || []) : [];
    for (const u of urls.concat(nextUrls)) {
      const hp = hostParts(u); if (!hp || SOCIAL.test(hp.host)) continue;
      if (ownKeys.some(k => sq(hp.reg).includes(k))) continue; // the creator's own site or shop (a brand link often ends in the creator's name)
      const hit = brandOfLink(u, brands);
      const key = hit ? hit.b.k : "?" + sq(hp.reg);
      const cur = out.get(key) || { key, brand: hit ? hit.b.brand : hp.host, known: !!hit, link: normLink(u), code: "", how: hit ? hit.how : "link", line: line.trim().slice(0, 160), sponsorish: false };
      if (code && !cur.code) cur.code = code;
      cur.sponsorish = cur.sponsorish || !!code || SPONSOR_WORDS.test(line) || (li > 0 && SPONSOR_WORDS.test(lines[li - 1]));
      out.set(key, cur);
    }
    // A code with no link on the line counts only when the line names a known brand.
    if (code && !urls.length && !nextUrls.length) {
      for (const b of brands) {
        if (b.common) continue;
        const re = new RegExp("\\b" + b.brand.replace(/[.*+?^${}()|[\]\\]/g, "").replace(/\s+/g, "[\\s-]*") + "\\b", "i");
        if (re.test(line) && !out.has(b.k)) out.set(b.k, { key: b.k, brand: b.brand, known: true, link: "", code, how: "code", line: line.trim().slice(0, 160), sponsorish: true });
      }
    }
  }
  // Unknown domains need sponsor wording or a code to count; known brands count from the link alone.
  return [...out.values()].filter(r => r.known || r.sponsorish);
}

// ---------- YouTube ----------

async function channelUploads(handle, gtr, key, sinceMs) {
  let units = 0;
  const k = String(handle).toLowerCase();
  const ytHandle = gtr.handle[k] || handle;
  const url = gtr.url && gtr.url[k];
  let uploads = null, title = "";
  const um = url && String(url).match(/channel\/(UC[\w-]{22})/);
  if (um) uploads = "UU" + um[1].slice(2);
  else {
    const tries = [ytHandle.startsWith("@") ? "forHandle=" + encodeURIComponent(ytHandle) : "forHandle=" + encodeURIComponent("@" + ytHandle.replace(/^@/, ""))];
    const m = url && String(url).match(/youtube\.com\/(?:(@[\w.\-]+)|(?:user|c)\/([\w.\-]+))/i);
    if (m) tries.push(m[1] ? "forHandle=" + encodeURIComponent(m[1]) : "forUsername=" + encodeURIComponent(m[2]));
    for (const q of tries) { units++; const ch = await yt("channels?part=contentDetails,snippet&" + q, key); const c0 = ch.items && ch.items[0]; if (c0) { uploads = c0.contentDetails.relatedPlaylists.uploads; title = c0.snippet.title; break; } }
  }
  if (!uploads) return { notFound: true, units, vids: [] };
  const ids = [];
  const readList = async id => { let pageToken = "", pages = 0; while (pages++ < 3) { units++; const pl = await yt("playlistItems?part=contentDetails&maxResults=50&playlistId=" + id + (pageToken ? "&pageToken=" + pageToken : ""), key); let old = false; for (const x of pl.items || []) { if (new Date(x.contentDetails.videoPublishedAt || 0).getTime() >= sinceMs) ids.push(x.contentDetails.videoId); else old = true; } if (old || !pl.nextPageToken) break; pageToken = pl.nextPageToken; } };
  try { await readList(uploads); }
  catch (e) { if (!/404/.test(String(e.message))) throw e; for (const pre of ["UULF", "UUSH"]) { try { await readList(pre + uploads.slice(2)); } catch (e2) { if (!/404/.test(String(e2.message))) throw e2; } } }
  const vids = await videoDetails([...new Set(ids)], key);
  return { title, units: units + Math.ceil(ids.length / 50), vids };
}

export async function videoDetails(ids, key) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const vd = await yt("videos?part=snippet,statistics&id=" + ids.slice(i, i + 50).join(","), key);
    for (const x of vd.items || []) out.push({ v: x.id, at: String(x.snippet.publishedAt || "").slice(0, 10), t: String(x.snippet.title || "").slice(0, 90), d: x.snippet.description || "", n: Number(x.statistics && x.statistics.viewCount || 0), ch: x.snippet.channelTitle });
  }
  return out;
}

async function pool(list, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const j = i++; out[j] = await fn(list[j], j); } })); return out; }

// ---------- classification ----------

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const NOISE = /^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sept?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?|20\d\d|\d+|spot\d*|flight\d*|week\d*|wk\d*|q[1-4]|renewal|bonus|makegood|integration|dedicated|shorts?|video|podcast|x|and|the|of|ep\d*|pt\d*|part\d*|v\d)$/;
const tokens = s => String(s || "").replace(/([a-z])([A-Z])/g, "$1 $2").split(/[_\s\-:|,&/.]+/).map(sq).filter(Boolean);

// Names a creator goes by in deal and invoice names (HeavySpoilers, TRR, Vetted), learnt from their rows.
export function creatorAliases(rows, brands) {
  const brandKeys = new Set(brands.flatMap(b => b.keys));
  const al = {};
  for (const r of rows) {
    const h = sq(r.h).replace(/^the/, ""); if (!h) continue;
    const set = al[r.h.toLowerCase()] = al[r.h.toLowerCase()] || new Set([sq(r.h), h]);
    const bk = new Set(r.brands.map(b => sq(b).replace(/^the/, "")));
    for (const t of tokens(r.deal)) if (t.length >= 3 && !NOISE.test(t) && !bk.has(t) && !brandKeys.has(t) && ![...bk].some(b => b && (t.startsWith(b) || b.startsWith(t)))) set.add(t);
  }
  // A token used by several creators ("usa", an agency name) says nothing about which creator.
  const count = {}; for (const s of Object.values(al)) for (const t of s) count[t] = (count[t] || 0) + 1;
  for (const [h, s] of Object.entries(al)) al[h] = new Set([...s].filter(t => count[t] === 1 || t === sq(h) || t === sq(h).replace(/^the/, "")));
  return al;
}

function invoiceMonth(inv) {
  const h = monthHint({ deal: inv.name + " " + inv.campaign, row: "", closed: inv.sent });
  if (h) return h.year * 12 + h.mon;
  if (inv.sent) { const d = new Date(inv.sent); return d.getUTCFullYear() * 12 + d.getUTCMonth(); }
  return null;
}
function monthFits(invM, at) {
  if (invM == null) return false;
  const d = new Date(at), m = d.getUTCFullYear() * 12 + d.getUTCMonth(), dd = d.getUTCDate();
  return invM === m || (invM === m + 1 && dd >= 25) || (invM === m - 1 && dd <= 7);
}
const invoiceNames = (inv, brandKey, aliases) => {
  const tk = tokens(inv.name + " " + inv.campaign);
  return tk.some(t => t === brandKey || t.startsWith(brandKey)) && tk.some(t => aliases.has(t));
};

// Client names match when one contains the other or they share a 6+ letter start (InfluenceLogic / Influencer Logic LLC).
const clientKey = s => sq(String(s || "").replace(/\b(llc|inc|ltd|limited|corp(oration)?|co|company|media|group|agency|the|us|usa)\b\.?/gi, ""));
const lev = (a, b) => { const m = a.length, n = b.length; let p = Array.from({ length: n + 1 }, (_, j) => j); for (let i = 1; i <= m; i++) { const c = [i]; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; } return p[n]; };
export function sameClient(a, b) {
  const x = clientKey(a), y = clientKey(b); if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  let i = 0; while (i < x.length && i < y.length && x[i] === y[i]) i++;
  if (i >= 6) return true;
  return Math.min(x.length, y.length) >= 6 && lev(x, y) / Math.max(x.length, y.length) <= 0.2; // FlexSpot / FlexiSpot, GameInfluencer / Gamefluencer
}

const openDeal = r => !/lost/i.test(r.status) && !/complete - creators paid/i.test(r.group);

// The usual client for a brand: most common CLIENT on this creator's deals for it, else across all creators.
function usualClient(rows, bk, hk) {
  const tally = list => { const c = {}; for (const r of list) if (r.client) c[r.client] = (c[r.client] || 0) + 1; const best = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; return best ? { client: best[0], n: best[1], of: list.length } : null; };
  const deals = new Map(); for (const r of rows) if (r.brands.some(b => sq(b).replace(/^the/, "") === bk)) deals.set(r.dealId + "|" + r.h.toLowerCase(), r);
  const mine = [...deals.values()].filter(r => r.h.toLowerCase() === hk);
  return (mine.length && tally(mine)) || tally([...deals.values()]);
}

// data: { rows, invoices, gtr }; scans: [{ h, vids, title }]; refs: videoId -> details (the deals' own videos)
export function classify(data, scans, refs, now) {
  const today = now || Date.now();
  const brands = brandIndex(data.rows, data.invoices);
  const aliases = creatorAliases(data.rows, brands);
  const linked = new Map(); // video id -> set of brand keys it is linked under
  for (const r of data.rows) for (const v of r.vids) { if (!linked.has(v)) linked.set(v, new Set()); for (const b of r.brands) linked.get(v).add(sq(b).replace(/^the/, "")); }
  const invById = new Map(data.invoices.map(i => [i.id, i]));
  const found = [], skipped = { linked: 0, openRow: 0, standing: 0, old: 0 };
  for (const s of scans) {
    const hk = s.h.toLowerCase();
    const al = aliases[hk] || new Set([sq(s.h)]);
    const ownKeys = [sq(s.h).replace(/^the/, ""), sq(s.title).replace(/^the/, ""), sq(data.gtr.handle[hk] || "").replace(/^the/, "")].filter(x => x.length >= 4);
    const reads = s.vids.map(v => ({ v, reads: readsIn(v.d, brands, ownKeys) }));
    // Standing links: on 60%+ of the channel's long-form uploads over the scan window (6+ videos).
    const counts = {}; for (const x of reads) for (const r of x.reads) counts[r.key] = (counts[r.key] || 0) + 1;
    const n = s.vids.length;
    const myRows = data.rows.filter(r => r.h.toLowerCase() === hk);
    for (const { v, reads: rs } of reads) {
      if (day(v.at) < today - REPORT_DAYS * D) { if (rs.length) skipped.old++; continue; }
      for (const rd of rs) {
        if (counts[rd.key] >= 6 && counts[rd.key] / Math.max(1, n) >= 0.6) { skipped.standing++; continue; }
        if (rd.known && (linked.get(v.v) || new Set()).has(rd.key)) { skipped.linked++; continue; }
        if (!rd.known && linked.has(v.v)) { skipped.linked++; continue; } // an unknown domain on a video we already track
        const bRows = rd.known ? myRows.filter(r => r.brands.some(b => sq(b).replace(/^the/, "") === rd.key)) : [];
        // An open row (no links yet) whose window covers this video: the first pass will link it.
        const pending = bRows.find(r => !r.vids.length && !r.label && (() => { const w = windowOf(r); return w && day(v.at) >= w.a && day(v.at) <= w.b; })());
        if (pending) { skipped.openRow++; continue; }
        found.push(decide(v, rd, s, hk, al, bRows, data, refs, invById, brands));
      }
    }
  }
  return { found, skipped, tags: tagCheck(data, aliases) };
}

function decide(v, rd, s, hk, al, bRows, data, refs, invById, brands) {
  const base = { video: v.v, url: "https://www.youtube.com/watch?v=" + v.v, title: v.t, at: v.at, views: v.n, channel: s.title || s.h, h: s.h, brand: rd.brand, code: rd.code, link: rd.link, how: rd.how, key: "read:" + v.v + ":" + rd.key };
  const ev = [rd.how === "code" ? "promo code " + rd.code + " on a line naming " + rd.brand : "description link " + rd.link + (rd.code ? ", code " + rd.code : "")];
  // Invoices that name this brand and creator for the video's month.
  const invs = rd.known ? data.invoices.filter(i => invoiceNames(i, rd.key, al) && monthFits(invoiceMonth(i), v.at)) : [];
  // Rule 1: same link and code as a deal's own video, deal under guarantee, no invoice of its own.
  const deals = new Map(); for (const r of bRows) if (r.vids.length) (deals.get(r.dealId) || deals.set(r.dealId, []).get(r.dealId)).push(r);
  for (const [dealId, rs] of [...deals.entries()].sort((a, b) => Math.max(...b[1].map(r => day(r.pub || r.live || r.closed || "2000-01-01"))) - Math.max(...a[1].map(r => day(r.pub || r.live || r.closed || "2000-01-01"))))) {
    const refVids = rs.flatMap(r => r.vids).map(id => refs[id]).filter(Boolean).filter(x => x.at <= v.at && x.v !== v.v);
    const same = refVids.find(x => readsIn(x.d, brands, []).some(q => q.key === rd.key && (rd.link && q.link === rd.link) && sq(q.code) === sq(rd.code)))
      || refVids.find(x => !rd.link && rd.code && readsIn(x.d, brands, []).some(q => q.key === rd.key && sq(q.code) === sq(rd.code)));
    if (!same) continue;
    const req = rs.reduce((a, r) => a + r.req, 0), views = rs.reduce((a, r) => a + r.views, 0);
    const own = new Set(rs.flatMap(r => r.arIds).concat(data.invoices.filter(i => i.dealIds.includes(dealId) || i.name === rs[0].deal).map(i => i.id)));
    const otherInv = invs.filter(i => !own.has(i.id));
    const ownNums = [...own].map(id => invById.get(id)).filter(Boolean).map(i => i.num || "no number").filter(Boolean);
    const sameEv = "same " + (rd.link ? "link" : "") + (rd.link && rd.code ? " and " : "") + (rd.code ? "code" : "") + " as " + same.v + " (" + same.at + ") on " + rs[0].deal;
    if (otherInv.length) { ev.push(sameEv + ", but invoice " + otherInv.map(i => i.num || i.name).join(", ") + " names this brand and creator for the month"); break; }
    if (!(req > 0)) return { ...base, cls: "Separate buy, deal missing", suggested: rs[0].deal, evidence: ev.concat(sameEv + "; no VIEW REQUIREMENTS on the deal, so whether it is a make-good is for a person").join("; ") };
    if (views >= req) return { ...base, cls: "Separate buy, deal missing", suggested: rs[0].deal, evidence: ev.concat(sameEv + "; but that deal already has " + views.toLocaleString("en-US") + " of " + req.toLocaleString("en-US") + " views, so not a make-good").join("; ") };
    const target = rs.find(r => r.vids.includes(same.v)) || rs[0];
    return { ...base, cls: "Make-good", suggested: rs[0].deal, rowId: target.id, dealId, open: openDeal(target), before: views, req,
      evidence: ev.concat(sameEv, ...(day(v.at) - Math.max(...refVids.map(x => day(x.at))) <= 10 * D ? ["within 10 days of the deal's last video, so probably the same flight running on"] : []), (ownNums.length === 1 ? "one invoice (" : ownNums.length + " invoices (") + (ownNums.join(", ") || "none") + ")", "deal at " + views.toLocaleString("en-US") + " of " + req.toLocaleString("en-US") + " views, this video adds " + v.n.toLocaleString("en-US")).join("; ") };
  }
  // Rule 2: an invoice names this brand and creator for the month, and no deal row holds the video.
  if (invs.length) {
    const i = invs[0];
    return { ...base, cls: "Deal missing (invoiced)", suggested: (i.customer || i.brandText || "?") + " (invoice " + (i.num || i.name) + ")", evidence: ev.concat("invoice " + (i.num || "without a number") + " '" + i.name + "'" + (i.customer ? " to " + i.customer : "") + (i.dealIds.length ? ", linked to a deal" : ", not linked to any deal")).join("; ") };
  }
  // Rule 3: the brand has deals with this creator, but not this link and code (or no guarantee left).
  if (bRows.length) {
    const last = bRows.slice().sort((a, b) => day(b.pub || b.live || b.closed || "2000-01-01") - day(a.pub || a.live || a.closed || "2000-01-01"))[0];
    return { ...base, cls: "Separate buy, deal missing", suggested: (last.client || "no client") + " (last deal " + last.deal + ")", evidence: ev.concat(bRows.length + " earlier " + rd.brand + " row(s) with this creator, none with this link and code in its window").join("; ") };
  }
  // Rule 4: another creator's deals for this brand say who usually buys it.
  const u = rd.known ? usualClient(data.rows, rd.key, hk) : null;
  if (u) return { ...base, cls: "Other agency's deal", suggested: u.client, evidence: ev.concat("no " + rd.brand + " deal with this creator; " + u.n + " of " + u.of + " " + rd.brand + " deals are " + u.client).join("; ") };
  return { ...base, cls: "Unknown", suggested: "", evidence: ev.concat(rd.known ? "no deal or invoice for " + rd.brand + " on monday" : "a sponsor link to a brand with no deals on monday: \"" + rd.line + "\"").join("; ") };
}

// Invoice customer vs the deal's CLIENT tag. Only invoices that carry a QB customer, sent in the last 200 days.
export function tagCheck(data, aliases, now) {
  const today = now || Date.now();
  const byDeal = new Map(); for (const r of data.rows) if (!byDeal.has(r.dealId)) byDeal.set(r.dealId, r);
  const byName = new Map(); for (const r of byDeal.values()) byName.set(r.deal, r);
  const out = [], seen = new Set(); let noCustomer = 0;
  const pairs = [];
  for (const inv of data.invoices) {
    const ids = new Set(inv.dealIds); for (const r of byDeal.values()) if (r.arIds.includes(inv.id)) ids.add(r.dealId);
    if (!ids.size && byName.has(inv.name)) ids.add(byName.get(inv.name).dealId);
    for (const id of ids) if (byDeal.has(id)) pairs.push([inv, byDeal.get(id)]);
  }
  // A billing entity that never matches any deal's client itself, and always bills for the same client on
  // two or more deals, is that client's paying company (Caucil LLC for TATAM), not a wrong tag.
  const billing = {};
  for (const [inv, d] of pairs) if (inv.customer) { const b = billing[inv.customer] = billing[inv.customer] || { own: false, clients: new Set(), deals: new Set() }; if (sameClient(inv.customer, d.client) || sameClient(inv.customer, d.qbAuto)) b.own = true; else if (d.client) { b.clients.add(clientKey(d.client)); b.deals.add(d.dealId); } }
  const isAlias = (cust, client) => { const b = billing[cust]; return !!(b && !b.own && b.clients.size === 1 && b.deals.size >= 2 && b.clients.has(clientKey(client))); };
  for (const [inv, d] of pairs) {
    if (inv.sent && day(inv.sent) < today - 200 * D) continue;
    if (!inv.customer) { noCustomer++; continue; }
    const k = "tag:" + d.dealId + ":" + (inv.num || inv.id); if (seen.has(k)) continue; seen.add(k);
    if (d.client && (sameClient(inv.customer, d.client) || sameClient(inv.customer, d.qbAuto) || isAlias(inv.customer, d.client))) continue;
    // Is it the invoice that looks wrong? Other deals for this brand on this creator all go to the deal's client.
    const bk = sq(d.brand).replace(/^the/, ""), hk = d.h.toLowerCase();
    const others = new Map(); for (const r of data.rows) if (r.dealId !== d.dealId && r.h.toLowerCase() === hk && r.brands.some(b => sq(b).replace(/^the/, "") === bk)) others.set(r.dealId, r);
    const o = [...others.values()], agree = d.client ? o.filter(r => sameClient(r.client, d.client)).length : 0;
    const note = !d.client ? "the deal has no contact, so no CLIENT tag" :
      (o.length && agree === o.length ? "every other " + d.brand + " deal on " + d.h + " (" + o.length + ") is " + d.client + ": the invoice may be the one that is wrong, a finance flag" : "the deal is tagged " + d.client);
    out.push({ key: k, cls: "Client tag mismatch", deal: d.deal, dealId: d.dealId, brand: d.brand, channel: d.h, invoice: inv.num, customer: inv.customer, client: d.client,
      suggested: "invoice customer " + inv.customer + "; deal CLIENT " + (d.client || "(none)"), evidence: "invoice " + (inv.num || inv.name) + " went to " + inv.customer + "; " + note });
  }
  return { mismatches: out, noCustomer };
}

// ---------- the nightly run ----------

export async function runUnmatched(token, opts) {
  opts = opts || {};
  const { dry, makegoodWrites, notify, timeMs = 38000 } = opts;
  const key = process.env.YOUTUBE_API_KEY; if (!key) throw new Error("YOUTUBE_API_KEY missing");
  const t0 = Date.now(), summary = { pass: "unmatched", dry: !!dry, makegoodWrites: !!makegoodWrites, notify: !!notify, units: 0, channels: 0, errors: [] };
  const data = (opts && opts.data) || await loadData(token);
  summary.loadMs = Date.now() - t0;
  // Dry-run testing only: treat these videos as if no row linked them (re-runs the 28 Sep worked examples).
  const unlink = dry ? String(opts.unlink || "").split(",").filter(Boolean) : [];
  if (unlink.length) for (const r of data.rows) if (r.vids.some(v => unlink.includes(v))) { r.vids = r.vids.filter(v => !unlink.includes(v)); summary.unlinked = (summary.unlinked || []).concat(r.deal); }
  const signed = Object.keys(data.gtr.signed).filter(k => data.gtr.signed[k]);
  const since = Date.now() - STANDING_DAYS * D;
  const scans = (await pool(signed, 8, async h => {
    if (Date.now() - t0 > timeMs) { summary.errors.push(h + ": out of time"); return null; }
    try { const x = await channelUploads(h, data.gtr, key, since); summary.units += x.units; if (x.notFound) { summary.errors.push(h + ": channel not found"); return null; } summary.channels++; return { h, title: x.title || (x.vids[0] && x.vids[0].ch) || h, vids: x.vids }; }
    catch (e) { summary.errors.push(h + ": " + String(e.message || e).slice(0, 120)); return null; }
  })).filter(Boolean);
  // The deals' own videos, for the same-link-and-code test: only brands and creators that turned up.
  const pre = classify(data, scans, {});
  const need = new Set();
  for (const f of pre.found) if (f.cls !== "Unknown") for (const r of data.rows) if (r.h.toLowerCase() === f.h.toLowerCase() && r.brands.some(b => sq(b) === sq(f.brand))) r.vids.slice(0, 20).forEach(x => need.add(x));
  const refs = {}; for (const x of await videoDetails([...need].slice(0, 300), key)) refs[x.v] = x;
  summary.units += Math.ceil(need.size / 50);
  const res = classify(data, scans, refs);
  summary.skipped = res.skipped; summary.tagsWithoutCustomer = res.tags.noCustomer;
  // One review row per channel, brand and class: a weekly flight is one question for a person, not seven.
  // Videos already on the board (by key) are left out; make-goods stay one row per video.
  const ORDER = ["Make-good", "Deal missing (invoiced)", "Separate buy, deal missing", "Other agency's deal", "Client tag mismatch", "Unknown"];
  const groups = new Map();
  for (const f of res.found) {
    if (data.reviewKeys.has(f.key)) continue;
    const g = f.cls === "Make-good" ? f.key : f.cls + "|" + f.h + "|" + f.brand;
    const cur = groups.get(g);
    if (!cur) { groups.set(g, { ...f, keys: [f.key], vids: [f] }); continue; }
    cur.keys.push(f.key); cur.vids.push(f);
  }
  for (const g of groups.values()) if (g.vids.length > 1) {
    g.vids.sort((a, b) => a.at.localeCompare(b.at));
    const first = g.vids[0];
    Object.assign(g, { url: first.url, title: first.title, at: first.at, video: first.video, code: [...new Set(g.vids.map(x => x.code).filter(Boolean))].join(", "),
      evidence: g.vids.length + " videos (" + g.vids.map(x => x.at.slice(5) + " youtu.be/" + x.video).join(", ") + "). " + first.evidence });
  }
  const fresh = [...groups.values()].map(g => ({ ...g, key: g.keys.join(" ") })).concat(res.tags.mismatches.filter(t => !data.reviewKeys.has(t.key)))
    .sort((a, b) => ORDER.indexOf(a.cls) - ORDER.indexOf(b.cls));
  const list = res.found.concat(res.tags.mismatches);
  summary.counts = list.reduce((a, f) => (a[f.cls] = (a[f.cls] || 0) + 1, a), {});
  summary.review = fresh.map(f => ({ cls: f.cls, channel: f.channel, brand: f.brand, suggested: f.suggested, evidence: f.evidence }));
  summary.list = list.map(f => ({ cls: f.cls, channel: f.channel, video: f.url, at: f.at, brand: f.brand, code: f.code, suggested: f.suggested, evidence: f.evidence, new: !data.reviewKeys.has(f.key) }));
  if (dry) { summary.ms = Date.now() - t0; return summary; }
  // Make-goods: append to the deal row, with the same checks as the first pass.
  const made = new Set();
  if (makegoodWrites) for (const f of res.found.filter(x => x.cls === "Make-good" && x.open).slice(0, 5)) {
    try { if (await writeMakegood(token, f)) { made.add(f.key); f.written = true; } } catch (e) { summary.errors.push("make-good " + f.video + ": " + String(e.message || e).slice(0, 120)); }
  }
  summary.makegoods = made.size;
  for (const g of fresh) if (g.cls === "Make-good" && made.has(g.key)) g.written = true;
  // Everything new goes on the review board (make-goods too, as a record, marked Done when written).
  let added = 0;
  for (const f of fresh) {
    if (Date.now() - t0 > (opts.stopMs || 52000)) { summary.errors.push("out of time: " + (fresh.length - added) + " review rows left for tomorrow"); break; }
    added++;
    try { await addReviewItem(token, f, makegoodWrites); } catch (e) { summary.errors.push("review " + f.key + ": " + String(e.message || e).slice(0, 120)); }
  }
  summary.added = added;
  if (notify && fresh.length) {
    const txt2 = "Unmatched sponsor reads: " + fresh.length + " new on the review board (" + Object.entries(fresh.reduce((a, f) => (a[f.cls] = (a[f.cls] || 0) + 1, a), {})).map(([k, n]) => n + " " + k).join(", ") + ").";
    for (const u of NOTIFY_USERS) { try { await mondayVars(token, "mutation ($u: ID!, $t: ID!, $x: String!) { create_notification(user_id:$u, target_id:$t, target_type:Project, text:$x) { text } }", { u: String(u), t: String(REVIEW_BOARD), x: txt2 }); } catch (e) { summary.errors.push("notify " + u + ": " + String(e.message || e).slice(0, 100)); } }
    summary.notified = NOTIFY_USERS.length;
  }
  summary.ms = Date.now() - t0;
  return summary;
}

async function mondayVars(token, query, variables) {
  const r = await fetch("https://api.monday.com/v2", { method: "POST", headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" }, body: JSON.stringify({ query, variables }) });
  const d = await r.json();
  if (!r.ok || (d && d.errors)) throw new Error("monday: " + JSON.stringify((d && d.errors) || r.status).slice(0, 300));
  return d.data;
}
const esc = s => String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

async function writeMakegood(token, f) {
  // Fresh read: the row still exists, the video is still not on it, and not on another row for this brand.
  const d = await monday(token, "query { items(ids:[" + f.rowId + "]) { id board { id } column_values(ids:[\"text_mm6aq9qp\"]) { text } } }");
  const it = d.items && d.items[0]; if (!it || String(it.board.id) !== String(SUB_BOARD)) return false;
  const cur = it.column_values[0].text || "";
  if (vidIds(cur).includes(f.video)) return false;
  const q = await monday(token, "query { boards(ids:[" + SUB_BOARD + "]) { items_page(limit:50, query_params:{rules:[{column_id:\"text_mm6aq9qp\", compare_value:[\"" + f.video + "\"], operator:contains_text}]}) { items { id } } } }");
  if (q.boards[0].items_page.items.length) return false;
  const links = (cur ? cur.replace(/[\s,]+$/, "") + ", " : "") + f.url;
  await mondayVars(token, "mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id:$b, item_id:$i, column_values:$v) { id } }", { b: String(SUB_BOARD), i: String(f.rowId), v: JSON.stringify({ text_mm6aq9qp: links }) });
  const body = "<p><b>Make-good linked by the nightly link finder</b></p><p>" + esc(f.at) + " " + esc(f.url.replace(/^https:\/\/(www\.)?/, "")) + " (" + esc(f.title) + ")</p><p>" + esc(f.evidence) + ".</p><p>Views before: " + f.before.toLocaleString("en-US") + " of " + f.req.toLocaleString("en-US") + ". After (with this video's " + f.views.toLocaleString("en-US") + " today): " + (f.before + f.views).toLocaleString("en-US") + ".</p><p>If this is wrong, take the link out of LIVE VIDEO URLS; the view sync corrects the totals the next morning.</p>";
  await mondayVars(token, "mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t) { id } }", { i: String(f.rowId), t: body });
  return true;
}

async function addReviewItem(token, f, writesOn) {
  const name = f.cls === "Client tag mismatch" ? f.deal : (f.brand + " on " + f.channel + " " + f.at);
  const ev = f.cls === "Make-good" ? f.evidence + (f.written ? ". Linked to the deal automatically." : !f.open ? ". Not written: the deal is closed or lost." : !writesOn ? ". Not written: make-good writes are off (dry run)." : ". Not written.") : f.evidence;
  const cols = { channel: f.channel || "", brand: f.brand || "", code: f.code || "", suggested: String(f.suggested || "").slice(0, 250), evidence: { text: String(ev).slice(0, 1900) }, key: f.key, class: { label: f.cls }, review: { label: f.written ? "Done" : "New" } };
  if (f.url) cols.video = { url: f.url, text: f.title ? f.title.slice(0, 60) : f.video };
  if (f.at) cols.published = { date: f.at };
  await mondayVars(token, "mutation ($b: ID!, $n: String!, $v: JSON!) { create_item(board_id:$b, item_name:$n, column_values:$v, create_labels_if_missing:true) { id } }", { b: String(REVIEW_BOARD), n: name.slice(0, 250), v: JSON.stringify(cols) });
}
