// Writes a checked list of video links to creator rows (team only, POST /apply-links).
//
// Used for backfills Claude has matched by hand-built rules, e.g. Rhapsody's TRR flights: each
// video was published inside the row's flight window and its description carries a link to the
// row's brand. The server does the safety checks itself, whatever the list says:
//   - the row must exist on the creator board and still have an EMPTY LIVE VIDEO URLS and no LINK BACKFILL label
//   - a video already linked on another row FOR THE SAME BRAND is dropped (one read, one row). A video
//     can sit on rows of different brands: one TRR video often carries two sponsors' reads.
//   - rows left with no videos are skipped
// Then it writes LIVE VIDEO URLS, sets LINK BACKFILL to Linked and posts an update with the evidence.
// Replacing links (row.replace = true) is allowed only for rows this backfill already linked
// (LINK BACKFILL = Linked), or rows named in body.overwrite. The update then records the old links,
// so any change can be put back by hand.
// ?dry=1 reports what it would do and writes nothing.

import { monday } from "./monday.js";

const SUB_BOARD = 6162879732;
const ID = /^[A-Za-z0-9_-]{11}$/;
const ID_RE = /(?:v=|youtu\.be\/|shorts\/|live\/|embed\/)([A-Za-z0-9_-]{11})/g;
const esc = s => String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

async function mondayVars(token, query, variables) {
  const r = await fetch("https://api.monday.com/v2", { method: "POST", headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" }, body: JSON.stringify({ query, variables }) });
  const d = await r.json();
  if (!r.ok || (d && d.errors)) throw new Error("monday: " + JSON.stringify((d && d.errors) || r.status).slice(0, 300));
  return d.data;
}
const brandKey = (adv, deal) => String(adv || String(deal || "").split(/[_\s]/)[0]).toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^liquidiv$/, "liquid").replace(/^prizepicks$/, "prize").replace(/^hellofresh$/, "hello");
// video id -> set of brand keys it is already linked under
async function linkedVideoBrands(token) {
  const fields = "cursor items { id parent_item { name column_values(ids:[\"dropdown_mm1a3tqp\"]) { text } } column_values(ids:[\"text_mm6aq9qp\"]) { text } }";
  let d = await monday(token, "query { boards(ids:[" + SUB_BOARD + "]) { items_page(limit:500, query_params:{rules:[{column_id:\"text_mm6aq9qp\", compare_value:[], operator:is_not_empty}]}) { " + fields + " } } }");
  let page = d.boards[0].items_page, items = page.items.slice(), guard = 0;
  while (page.cursor && guard++ < 10) { d = await monday(token, "query { next_items_page(limit:500, cursor:\"" + page.cursor + "\") { " + fields + " } }"); page = d.next_items_page; items = items.concat(page.items); }
  const map = new Map();
  for (const it of items) {
    const p = it.parent_item || {}; const b = brandKey(p.column_values && p.column_values[0] && p.column_values[0].text, p.name);
    for (const m of String(it.column_values[0].text || "").matchAll(ID_RE)) { if (!map.has(m[1])) map.set(m[1], new Set()); map.get(m[1]).add(b); }
  }
  return map;
}

export async function applyLinks(token, body, dry) {
  const rows = Array.isArray(body && body.rows) ? body.rows.slice(0, 80) : [];
  const brandNote = String(body && body.rule || "").slice(0, 400);
  const used = await linkedVideoBrands(token);
  const ids = rows.map(r => String(r.id)).filter(x => /^\d{6,}$/.test(x));
  const cur = {};
  for (let i = 0; i < ids.length; i += 50) {
    const d = await monday(token, "query { items(ids:[" + ids.slice(i, i + 50).join(",") + "], limit:50) { id name board { id } parent_item { name column_values(ids:[\"dropdown_mm1a3tqp\"]) { text } } column_values(ids:[\"text_mm6aq9qp\",\"color_mm7jh1xw\"]) { id text } } }");
    for (const it of d.items) { const cv = {}; for (const c of it.column_values) cv[c.id] = c.text || ""; const p = it.parent_item || {}; cur[it.id] = { board: it.board && it.board.id, deal: p.name, brand: brandKey(p.column_values && p.column_values[0] && p.column_values[0].text, p.name), links: cv.text_mm6aq9qp, label: cv.color_mm7jh1xw }; }
  }
  const out = [];
  for (const r of rows) {
    const id = String(r.id), c = cur[id];
    if (!c || String(c.board) !== String(SUB_BOARD)) { out.push({ id, result: "skipped: not a creator row" }); continue; }
    const overwrite = new Set((body && body.overwrite || []).map(String));
    const canReplace = r.replace && (c.label === "Linked" || overwrite.has(id));
    if ((c.links || c.label) && !canReplace) { out.push({ id, deal: c.deal, result: "skipped: row already has links or a label" }); continue; }
    const own = new Set(canReplace ? [...String(c.links || "").matchAll(ID_RE)].map(m => m[1]) : []);
    const vids = (Array.isArray(r.v) ? r.v : []).filter(v => ID.test(String(v[0]))).filter(v => own.has(v[0]) || !(used.get(v[0]) || new Set()).has(c.brand));
    const dropped = (r.v || []).length - vids.length;
    if (!vids.length) { out.push({ id, deal: c.deal, result: "skipped: every video is already on another row for this brand", dropped }); continue; }
    if (!dry) {
      const urls = vids.map(v => "https://www.youtube.com/watch?v=" + v[0]).join(", ");
      await mondayVars(token, "mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id:$b, item_id:$i, column_values:$v) { id } }",
        { b: String(SUB_BOARD), i: id, v: JSON.stringify({ text_mm6aq9qp: urls, color_mm7jh1xw: { label: "Linked" } }) });
      const body2 = (canReplace && c.links ? "<p><b>Links corrected by the backfill.</b> Previous LIVE VIDEO URLS: " + esc(c.links) + "</p>" : "") + "<p><b>Backfill: linked " + vids.length + (vids.length === 1 ? " video" : " videos") + "</b></p><p>" + esc(brandNote || r.why || "") + "</p><ul>" +
        vids.map(v => "<li>" + esc(v[1] || "") + " youtube.com/watch?v=" + esc(v[0]) + (v[2] ? " - " + esc(v[2]) : "") + "</li>").join("") + "</ul>" +
        (dropped ? "<p>" + dropped + " more matching " + (dropped === 1 ? "video was" : "videos were") + " left off because already on another row for this brand.</p>" : "") +
        "<p>If any is wrong, edit LIVE VIDEO URLS; the view sync picks up the change the next morning.</p>";
      await mondayVars(token, "mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t) { id } }", { i: id, t: body2 });
    }
    if (canReplace) for (const x of own) { const set = used.get(x); if (set && !vids.some(v => v[0] === x)) set.delete(c.brand); } // freed videos can go to another row
    for (const v of vids) { if (!used.has(v[0])) used.set(v[0], new Set()); used.get(v[0]).add(c.brand); }
    out.push({ id, deal: c.deal, brand: c.brand, result: dry ? (canReplace ? "would replace" : "would link") : (canReplace ? "replaced" : "linked"), videos: vids.length, dropped });
  }
  return { dry, rows: out.length, linked: out.filter(o => /link|replace/.test(o.result) && !/skipped/.test(o.result)).length, videos: out.reduce((a, o) => a + (o.videos || 0), 0), out };
}
