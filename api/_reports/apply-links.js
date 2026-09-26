// Writes a checked list of video links to creator rows (team only, POST /apply-links).
//
// Used for backfills Claude has matched by hand-built rules, e.g. Rhapsody's TRR flights: each
// video was published inside the row's flight window and its description carries a link to the
// row's brand. The server does the safety checks itself, whatever the list says:
//   - the row must exist on the creator board and still have an EMPTY LIVE VIDEO URLS and no LINK BACKFILL label
//   - any video already linked on another row is dropped (one video, one row)
//   - rows left with no videos are skipped
// Then it writes LIVE VIDEO URLS, sets LINK BACKFILL to Linked and posts an update with the evidence.
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
async function linkedVideoIds(token) {
  const fields = "cursor items { id column_values(ids:[\"text_mm6aq9qp\"]) { text } }";
  let d = await monday(token, "query { boards(ids:[" + SUB_BOARD + "]) { items_page(limit:500, query_params:{rules:[{column_id:\"text_mm6aq9qp\", compare_value:[], operator:is_not_empty}]}) { " + fields + " } } }");
  let page = d.boards[0].items_page, items = page.items.slice(), guard = 0;
  while (page.cursor && guard++ < 10) { d = await monday(token, "query { next_items_page(limit:500, cursor:\"" + page.cursor + "\") { " + fields + " } }"); page = d.next_items_page; items = items.concat(page.items); }
  const ids = new Set();
  for (const it of items) for (const m of String(it.column_values[0].text || "").matchAll(ID_RE)) ids.add(m[1]);
  return ids;
}

export async function applyLinks(token, body, dry) {
  const rows = Array.isArray(body && body.rows) ? body.rows.slice(0, 80) : [];
  const brandNote = String(body && body.rule || "").slice(0, 400);
  const used = await linkedVideoIds(token);
  const ids = rows.map(r => String(r.id)).filter(x => /^\d{6,}$/.test(x));
  const cur = {};
  for (let i = 0; i < ids.length; i += 50) {
    const d = await monday(token, "query { items(ids:[" + ids.slice(i, i + 50).join(",") + "], limit:50) { id name board { id } parent_item { name } column_values(ids:[\"text_mm6aq9qp\",\"color_mm7jh1xw\"]) { id text } } }");
    for (const it of d.items) { const cv = {}; for (const c of it.column_values) cv[c.id] = c.text || ""; cur[it.id] = { board: it.board && it.board.id, deal: it.parent_item && it.parent_item.name, links: cv.text_mm6aq9qp, label: cv.color_mm7jh1xw }; }
  }
  const out = [];
  for (const r of rows) {
    const id = String(r.id), c = cur[id];
    if (!c || String(c.board) !== String(SUB_BOARD)) { out.push({ id, result: "skipped: not a creator row" }); continue; }
    if (c.links || c.label) { out.push({ id, deal: c.deal, result: "skipped: row already has links or a label" }); continue; }
    const vids = (Array.isArray(r.v) ? r.v : []).filter(v => ID.test(String(v[0]))).filter(v => !used.has(v[0]));
    const dropped = (r.v || []).length - vids.length;
    if (!vids.length) { out.push({ id, deal: c.deal, result: "skipped: no videos left after removing ones already on other rows", dropped }); continue; }
    if (!dry) {
      const urls = vids.map(v => "https://www.youtube.com/watch?v=" + v[0]).join(", ");
      await mondayVars(token, "mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id:$b, item_id:$i, column_values:$v) { id } }",
        { b: String(SUB_BOARD), i: id, v: JSON.stringify({ text_mm6aq9qp: urls, color_mm7jh1xw: { label: "Linked" } }) });
      const body2 = "<p><b>Backfill: linked " + vids.length + (vids.length === 1 ? " video" : " videos") + "</b></p><p>" + esc(brandNote || r.why || "") + "</p><ul>" +
        vids.map(v => "<li>" + esc(v[1] || "") + " youtube.com/watch?v=" + esc(v[0]) + (v[2] ? " - " + esc(v[2]) : "") + "</li>").join("") + "</ul>" +
        (dropped ? "<p>" + dropped + " more matching " + (dropped === 1 ? "video was" : "videos were") + " left off because already on another row.</p>" : "") +
        "<p>If any is wrong, edit LIVE VIDEO URLS; the view sync picks up the change the next morning.</p>";
      await mondayVars(token, "mutation ($i: ID!, $t: String!) { create_update(item_id:$i, body:$t) { id } }", { i: id, t: body2 });
    }
    for (const v of vids) used.add(v[0]);
    out.push({ id, deal: c.deal, result: dry ? "would link" : "linked", videos: vids.length, dropped });
  }
  return { dry, rows: out.length, linked: out.filter(o => o.result === "linked" || o.result === "would link").length, videos: out.reduce((a, o) => a + (o.videos || 0), 0), out };
}
