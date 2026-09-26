// Nightly link finder. Runs on Vercel (cron in vercel.json), not on anyone's computer.
//
// For US Campaigns creator rows (subitems board 6162879732) with an empty LIVE VIDEO URLS and no
// LINK BACKFILL label, it looks through that creator's YouTube uploads around the live date and
// links a video ONLY when the evidence is strong. Everything else is labelled for a person or left
// for another night. Every write gets an update on the row with the evidence.
//
// STRICT RULES
//   Linked          the video's description has a sponsor link naming the brand, it was published
//                   14 days before to 70 days after the row's date, it is not a Short, no other row
//                   already uses it, and it is the only such video for that row.
//   Needs a person  more than one strong video, a standing link (3+ videos carry the brand link),
//                   two or more rows for the same creator on one deal, weak matches only, or the
//                   channel could not be found. The update lists what was seen.
//   No video found  nothing at all mentions the brand and the row's date is over 45 days old.
//   (left alone)    the row's date is under 45 days old and nothing strong yet: tried again tomorrow.
//
// SAFETY: never overwrites a non-empty LIVE VIDEO URLS (re-checked just before each write).
// Caps per night: 25 Linked, 60 writes in all, about 1,500 YouTube units, 45 seconds.
// The view sync (09:00 UTC) then fills LATEST VIEWS and CPM for the new links.
//
// Runs at 07:20 UTC (1:20am Mountain), just after the YouTube allowance resets at 07:00 UTC,
// so it never competes with the view sync or the report for the day's allowance.
//
//   GET /api/link-finder?dry=1   (team cookie or CRON_SECRET) shows the plan, writes nothing.

import { monday, mondayToken } from "./_reports/monday.js";
import { cookieOk } from "./_reports/access.js";
import { missingRows, loadGtr, scanCreator } from "./_reports/backfill.js";

export const config = { maxDuration: 60 };

const SUB_BOARD = 6162879732;
const MAX_LINKED = 25, MAX_WRITES = 60, UNIT_BUDGET = 1500, TIME_MS = 45000, OLD_DAYS = 45;
const ID_RE = /(?:v=|youtu\.be\/|shorts\/|live\/|embed\/)([A-Za-z0-9_-]{11})/g;
const esc = s => String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const fmt = n => Number(n || 0).toLocaleString("en-US");

async function mondayVars(token, query, variables) {
  const r = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" },
    body: JSON.stringify({ query, variables }),
  });
  const d = await r.json();
  if (!r.ok || (d && d.errors)) throw new Error("monday: " + JSON.stringify((d && d.errors) || r.status).slice(0, 300));
  return d.data;
}

// Every video already linked on any creator row, so one video is never linked twice.
async function linkedVideoIds(token) {
  const fields = "cursor items { column_values(ids:[\"text_mm6aq9qp\"]) { text } }";
  let d = await monday(token, "query { boards(ids:[" + SUB_BOARD + "]) { items_page(limit:500, query_params:{rules:[{column_id:\"text_mm6aq9qp\", compare_value:[], operator:is_not_empty}]}) { " + fields + " } } }");
  let page = d.boards[0].items_page, items = page.items.slice(), guard = 0;
  while (page.cursor && guard++ < 10) {
    d = await monday(token, "query { next_items_page(limit:500, cursor:\"" + page.cursor + "\") { " + fields + " } }");
    page = d.next_items_page; items = items.concat(page.items);
  }
  const ids = new Set();
  for (const it of items) for (const m of String(it.column_values[0].text || "").matchAll(ID_RE)) ids.add(m[1]);
  return ids;
}

const ageDays = a => a ? (Date.now() - new Date(a).getTime()) / 864e5 : 0;
const strong = c => c.sponsorLink && !c.short && c.days >= -14 && c.days <= 70;
const candLine = c => "<li>" + esc(c.title) + " (" + c.at + ", " + (c.days >= 0 ? "+" : "") + c.days + " days, " + fmt(c.views) + " views" + (c.sponsorLink ? ", brand link" : "") + (c.sponsorWords ? ", sponsor wording" : "") + (c.short ? ", Short" : "") + ") youtube.com/watch?v=" + c.v + "</li>";

// Decide what happens to each row of one creator.
function decide(scan, used) {
  const out = [];
  if (scan.notFound) {
    for (const r of scan.rows) if (ageDays(r.anchor) > OLD_DAYS) out.push({ r, action: "Needs a person", why: "The creator's YouTube channel could not be found from the roster handle (" + esc(scan.ytHandle) + ")." });
    return out;
  }
  // Two or more open rows for this creator on one deal: which video is which spot is a judgement call.
  const perDeal = {};
  for (const r of scan.rows) perDeal[r.dealId] = (perDeal[r.dealId] || 0) + 1;
  // A brand link that sits on 3+ videos is a standing link, not proof of one integration.
  const linkVids = {};
  for (const r of scan.rows) for (const c of r.candidates) if (c.sponsorLink) { const b = r.brand.toLowerCase(); (linkVids[b] = linkVids[b] || new Set()).add(c.v); }
  const rows = scan.rows.slice().sort((a, b) => String(a.anchor).localeCompare(String(b.anchor)));
  for (const r of rows) {
    const old = ageDays(r.anchor) > OLD_DAYS;
    const top = r.candidates.slice(0, 3).map(candLine).join("");
    if (!r.anchor) { out.push({ r, action: "Needs a person", why: "The row has no live, publish or close date to search around." }); continue; }
    if (perDeal[r.dealId] > 1) { if (old || r.candidates.some(strong)) out.push({ r, action: "Needs a person", why: "This creator has " + perDeal[r.dealId] + " open rows on this deal, so matching videos to spots needs a person." + (top ? "<ul>" + top + "</ul>" : "") }); continue; }
    if ((linkVids[r.brand.toLowerCase()] || new Set()).size >= 3) { out.push({ r, action: "Needs a person", why: "The brand link appears on " + linkVids[r.brand.toLowerCase()].size + " of this creator's videos (a standing link), so it does not prove which one was the integration.<ul>" + top + "</ul>" }); continue; }
    const s = r.candidates.filter(c => strong(c) && !used.has(c.v));
    if (s.length === 1) { used.add(s[0].v); out.push({ r, action: "Linked", video: s[0] }); continue; }
    if (s.length > 1) { out.push({ r, action: "Needs a person", why: s.length + " videos carry a brand link in the window.<ul>" + s.slice(0, 3).map(candLine).join("") + "</ul>" }); continue; }
    if (!old) continue; // recent: try again tomorrow
    if (!r.candidates.length) out.push({ r, action: "No video found", why: "No upload from " + WIN_TXT + " mentions " + esc(r.brand) + " in its title, description or links." });
    else out.push({ r, action: "Needs a person", why: "Only weak matches (brand named, but no brand link):<ul>" + top + "</ul>" });
  }
  return out;
}
const WIN_TXT = "14 days before to 75 days after the row's date";

async function write(token, d) {
  // Re-check the row is still empty, so a link someone added today is never overwritten.
  const now = await monday(token, "query { items(ids:[" + d.r.id + "]) { column_values(ids:[\"text_mm6aq9qp\",\"color_mm7jh1xw\"]) { id text } } }");
  const cv = {}; for (const c of now.items[0].column_values) cv[c.id] = c.text || "";
  if (cv.text_mm6aq9qp || cv.color_mm7jh1xw) return "skipped (changed since read)";
  const vals = { color_mm7jh1xw: { label: d.action } };
  if (d.action === "Linked") vals.text_mm6aq9qp = "https://www.youtube.com/watch?v=" + d.video.v;
  await mondayVars(token, "mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id:$b, item_id:$i, column_values:$v) { id } }",
    { b: String(SUB_BOARD), i: String(d.r.id), v: JSON.stringify(vals) });
  const body = d.action === "Linked"
    ? "<p><b>Nightly link finder: linked</b> " + esc(d.video.title) + "</p><p>Published " + d.video.at + " (" + (d.video.days >= 0 ? d.video.days + " days after" : -d.video.days + " days before") + " the row's date, " + d.r.anchor + "). The description carries a link naming " + esc(d.r.brand) + (d.video.link ? " (" + esc(d.video.link) + ")" : "") + ". " + fmt(d.video.views) + " views when linked.</p><p>If this is the wrong video: clear LIVE VIDEO URLS and set LINK BACKFILL to Needs a person.</p>"
    : "<p><b>Nightly link finder: " + d.action + "</b></p><p>" + d.why + "</p><p>Searched " + WIN_TXT + " (" + d.r.anchor + "). Paste the right link into LIVE VIDEO URLS when found.</p>";
  await mondayVars(token, "mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t) { id } }", { i: String(d.r.id), t: body });
  return "written";
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const token = mondayToken();
  const secret = process.env.CRON_SECRET;
  const fromCron = req.headers["x-vercel-cron"] || (secret && req.headers.authorization === "Bearer " + secret);
  const dry = String(req.query && req.query.dry || "") === "1";
  if (!fromCron && !(dry && token && cookieOk(req, token))) return res.status(401).json({ error: "Unauthorized" });
  const key = process.env.YOUTUBE_API_KEY;
  if (!token || !key) return res.status(500).json({ error: "Setup: monday or YouTube key missing" });

  const t0 = Date.now();
  const summary = { dry, linked: 0, needsPerson: 0, noVideo: 0, writes: 0, skipped: 0, units: 0, creators: 0, errors: [], plan: [] };
  try {
    const [rows, gtr, used] = await Promise.all([missingRows(token), loadGtr(token), linkedVideoIds(token)]);
    summary.open = rows.length;
    const by = {};
    for (const r of rows) if (r.h && r.h.startsWith("@")) (by[r.h] = by[r.h] || []).push(r);
    const order = Object.keys(by).sort((a, b) => (gtr.signed[b.toLowerCase()] ? 1 : 0) - (gtr.signed[a.toLowerCase()] ? 1 : 0) || by[b].length - by[a].length);
    // Rotate the starting creator by day, so a creator near the end of the list is not always cut off by the caps.
    const shift = order.length ? Math.floor(Date.now() / 864e5) % order.length : 0;
    const signedN = order.filter(h => gtr.signed[h.toLowerCase()]).length;
    const rot = a => a.length ? a.slice(shift % a.length).concat(a.slice(0, shift % a.length)) : a;
    const queue = rot(order.slice(0, signedN)).concat(rot(order.slice(signedN)));
    for (const h of queue) {
      if (Date.now() - t0 > TIME_MS || summary.units > UNIT_BUDGET || summary.writes >= MAX_WRITES || summary.linked >= MAX_LINKED) break;
      let scan;
      try { scan = await scanCreator(h, by[h], key, gtr, 20); }
      catch (e) { summary.errors.push(h + ": " + String(e.message || e).slice(0, 120)); if (/quota|403/i.test(String(e.message))) break; continue; }
      summary.units += scan.units || 0; summary.creators++;
      for (const d of decide(scan, used)) {
        if (Date.now() - t0 > 52000 || summary.writes >= MAX_WRITES || (d.action === "Linked" && summary.linked >= MAX_LINKED)) break;
        summary.plan.push({ creator: h, deal: d.r.deal, row: d.r.row, date: d.r.anchor, action: d.action, video: d.video ? { v: d.video.v, title: d.video.title, at: d.video.at, views: d.video.views } : undefined });
        let result = "planned";
        if (!dry) { try { result = await write(token, d); } catch (e) { result = "error"; summary.errors.push(d.r.id + ": " + String(e.message || e).slice(0, 120)); } }
        if (result === "skipped (changed since read)") { summary.skipped++; continue; }
        if (result === "error") continue;
        summary.writes++;
        if (d.action === "Linked") summary.linked++; else if (d.action === "No video found") summary.noVideo++; else summary.needsPerson++;
      }
    }
  } catch (e) { summary.errors.push(String(e.message || e).slice(0, 200)); }
  summary.ms = Date.now() - t0;
  return res.status(200).json(summary);
}
