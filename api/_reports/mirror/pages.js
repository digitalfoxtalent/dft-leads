// Pages for the monday mirror on ecosystem.digitalfoxtalent.com. Read only.
//
//   /<department>/boards              every board in that department the viewer may see, by folder
//   /boards/<board id>                one board, laid out like monday: groups, then items with their columns
//   /boards/<board id>/items/<id>     one item: every field, its subitems and its updates
//   /data/mirror                      how the copy is doing: runs, and boards whose counts differ
//
// SECURITY: every value is escaped before it reaches the page; only http(s) links are ever linked; the
// pages carry no script at all and a strict Content-Security-Policy (see securityHeaders); a board the
// viewer may not see looks exactly like a board that does not exist; every view is logged.

import { read, write } from "./db.js";

// Active, non-guest monday users (refreshed by every sync). Someone who leaves monday loses access here too.
async function teamSet() { return new Set((await read(`SELECT email FROM mirror.team`)).map(r => r.email)); }
import { canSee } from "./policy.js";

export const DEPT_NAMES = {
  partnerships: "Brand Partnerships", platforms: "Platform Monetization", shows: "Show Development", talent: "Talent",
  reporting: "Reporting", content: "Content Production", finance: "Finance and Operations", data: "Data Engine",
  marketing: "Marketing and Website",
};
const PAGE_SIZE = 200;
// One width per column type, so the same column lines up in every group, as on monday.
const WIDTH = { status: 150, color: 150, people: 150, multiple_person: 150, date: 120, timeline: 190, numbers: 120, formula: 140,
  link: 160, long_text: 320, text: 220, email: 200, phone: 150, dropdown: 180, tags: 160, file: 180, board_relation: 200,
  mirror: 200, checkbox: 90, rating: 110, creation_log: 160, last_updated: 160 };
const colgroup = cols => `<colgroup><col style="width:380px">${cols.map(c => `<col style="width:${WIDTH[c.type] || 180}px">`).join("")}</colgroup>`;

const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeUrl = u => { try { const x = new URL(String(u)); return /^https?:$/.test(x.protocol) ? x.href : null; } catch (e) { return null; } };
const isId = v => /^\d{1,19}$/.test(String(v || ""));
const iso = v => (v instanceof Date ? v.toISOString() : v == null ? "" : String(v));
const ago = t => { if (!t) return "never"; const m = Math.round((Date.now() - Date.parse(iso(t))) / 60000);
  return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago"; };
const hexOk = c => (/^#[0-9a-f]{3,8}$/i.test(String(c || "")) ? c : null);

export function securityHeaders(res) {
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
}

export async function logAccess(email, path, boardId, allowed) {
  try { await write(`INSERT INTO mirror.access_log (email, path, board_id, allowed) VALUES ($1, $2, $3, $4)`,
    [String(email || "").slice(0, 200), String(path || "").slice(0, 300), isId(boardId) ? String(boardId) : null, !!allowed]); }
  catch (e) { /* logging never blocks a page */ }
}

// ---------- the page frame ----------

const CSS = `
:root{--bg:#0b0a09;--panel:#161311;--panel2:#1f1b18;--line:rgba(249,248,247,.10);--fg:#f9f8f7;--muted:#b3aca5;--faint:#8f8881;--fox:#f58220;--gold:#dba44f}
@media (prefers-color-scheme: light){:root{--bg:#f6f4f1;--panel:#fff;--panel2:#f1eee9;--line:rgba(20,18,16,.12);--fg:#191512;--muted:#5d5650;--faint:#8a837c;--fox:#d96a0c;--gold:#9a6a12}}
*{box-sizing:border-box} html,body{margin:0;background:var(--bg);color:var(--fg)}
body{font:400 14px/1.5 Poppins,system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:inherit}
.wrap{max-width:1500px;margin:0 auto;padding-left:max(24px,env(safe-area-inset-left,0px));padding-right:max(24px,env(safe-area-inset-right,0px));padding-block:28px 72px}
.crumb{font-size:13px;color:var(--faint)} .crumb a{color:var(--muted);text-decoration:none} .crumb a:hover{color:var(--fg)}
h1{margin:18px 0 6px;font-size:clamp(24px,3vw,34px);font-weight:600;line-height:1.15;letter-spacing:-.01em}
.sub{color:var(--muted);font-size:13.5px;display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center}
.badge{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;border:1px solid var(--line);font-size:12px;color:var(--muted)}
.badge.lock{border-color:rgba(219,164,79,.5);color:var(--gold)}
.bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:22px 0 8px}
.bar input{flex:1 1 280px;min-width:0;min-height:42px;padding:0 14px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--fg);font:inherit}
.bar button,.btn{min-height:42px;padding:0 16px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--fg);font:inherit;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}
.btn.fox{background:var(--fox);border-color:var(--fox);color:#000;font-weight:600}
.group{margin-top:26px}
.gh{display:flex;align-items:center;gap:10px;font-weight:600;font-size:15px;margin:0 0 8px}
.gh i{width:4px;height:18px;border-radius:2px;background:var(--gc,#579bfc)}
.gh span{color:var(--faint);font-weight:400;font-size:12.5px}
.tw{overflow-x:auto;border:1px solid var(--line);border-left:3px solid var(--gc,#579bfc);border-radius:10px;background:var(--panel)}
table{border-collapse:collapse;table-layout:fixed;width:max-content}
th,td{padding:9px 12px;border-bottom:1px solid var(--line);border-right:1px solid var(--line);text-align:left;vertical-align:top;max-width:320px;font-size:13px}
th{position:sticky;top:0;background:var(--panel2);font-weight:500;color:var(--muted);white-space:nowrap;font-size:12px}
td.nm{font-weight:500}
th,td{overflow-wrap:anywhere}
td.nm a{text-decoration:none} td.nm a:hover{color:var(--fox)}
td.num{text-align:right;font-variant-numeric:tabular-nums}
.pill{display:inline-block;min-width:96px;padding:3px 10px;border-radius:4px;color:#fff;font-size:12px;text-align:center;background:#797e93}
.clip{display:block;max-height:3.1em;overflow:hidden}
.muted{color:var(--faint)} .sm{font-size:12px}
.lists{display:grid;gap:22px;margin-top:26px}
.fold h2{font-size:13px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:var(--gold);margin:0 0 10px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
.card{display:block;padding:14px 16px;border-radius:12px;border:1px solid var(--line);background:var(--panel);text-decoration:none}
.card:hover{border-color:var(--fox)} .card b{display:block;font-weight:500;font-size:14px}
.card span{display:block;margin-top:4px;font-size:12px;color:var(--faint)}
dl{display:grid;grid-template-columns:minmax(140px,220px) 1fr;gap:0;margin:22px 0 0;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--panel)}
dt,dd{margin:0;padding:10px 14px;border-bottom:1px solid var(--line)} dt{color:var(--muted);background:var(--panel2);font-size:12.5px}
dd{white-space:pre-wrap;overflow-wrap:anywhere;min-width:0}
h2.sec{font-size:16px;font-weight:600;margin:34px 0 10px}
.upd{padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:var(--panel);margin-bottom:10px;white-space:pre-wrap;overflow-wrap:anywhere}
.upd b{display:block;font-size:12px;color:var(--muted);font-weight:500;margin-bottom:6px}
.pager{display:flex;gap:10px;align-items:center;margin-top:20px;color:var(--muted)}
.empty{padding:40px 0;color:var(--faint)}
.ok{color:#3ecf8e} .bad{color:#ff7a59}
@media (max-width:640px){dl{grid-template-columns:1fr} dt{border-bottom:0}}
`;

function frame(title, crumbs, body) {
  const c = crumbs.map(([t, h]) => (h ? `<a href="${esc(h)}">${esc(t)}</a>` : esc(t))).join(" / ");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap"><style>${CSS}</style></head>
<body><div class="wrap"><nav class="crumb" aria-label="Breadcrumb">${c}</nav>${body}</div></body></html>`;
}

const notFound = () => ({ status: 404, html: frame("Not found", [["Ecosystem", "/"]],
  `<h1>Not found</h1><p class="muted">This board does not exist, or you do not have access to it in monday.</p>`) });

// ---------- values ----------

function parse(v) { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } }

export function cell(col, pair) {
  if (!pair) return "";
  const [text, raw] = pair;
  const t = text == null ? "" : String(text);
  switch (col.type) {
    case "status": {
      const v = parse(raw); const lab = col.labels && v && v.index != null ? col.labels[String(v.index)] : null;
      const label = t || (lab && lab[0]) || "";
      if (!label) return "";
      const bg = hexOk(lab && lab[1]);
      return `<span class="pill"${bg ? ` style="background:${bg}"` : ""}>${esc(label)}</span>`;
    }
    case "link": {
      const v = parse(raw); const url = safeUrl(v && v.url);
      const label = (v && v.text) || t || (v && v.url) || "";
      return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : esc(label);
    }
    case "checkbox": { const v = parse(raw); return v && String(v.checked) === "true" ? "Yes" : ""; }
    case "long_text": return `<span class="clip" title="${esc(t.slice(0, 600))}">${esc(t)}</span>`;
    case "file": return esc(t.split(/,\s*/).map(u => { try { return decodeURIComponent(new URL(u).pathname.split("/").pop()); } catch (e) { return u; } }).join(", "));
    default: return esc(t);
  }
}

// ---------- data ----------

async function board(id) {
  if (!isId(id)) return null;
  return (await read(`SELECT id::text AS id, name, description, board_type, board_kind, workspace_name, folder_path, department,
    access, allowed_emails, columns, groups, parent_board_id::text AS parent_board_id, monday_items, mirror_items, synced_at, gone
    FROM mirror.boards WHERE id = $1::bigint`, [id]))[0] || null;
}

// ---------- pages ----------

export async function renderDepartment(email, dept, q) {
  if (!DEPT_NAMES[dept]) return notFound();
  const rows = await read(`SELECT id::text AS id, name, folder_path, workspace_name, access, allowed_emails, gone, mirror_items, synced_at
    FROM mirror.boards WHERE department = $1 AND board_type = 'board' AND NOT gone ORDER BY folder_path, name`, [dept]);
  const team = await teamSet();
  const mine = rows.filter(b => canSee(b, email, team)).filter(b => !q || (b.name + " " + b.folder_path + " " + b.workspace_name).toLowerCase().includes(q.toLowerCase()));
  await logAccess(email, "/" + dept + "/boards", null, true);
  const byFolder = new Map();
  for (const b of mine) {
    const key = b.workspace_name === "@digitalfoxtalent" ? (b.folder_path || "Not in a folder") : (b.workspace_name || "Other");
    if (!byFolder.has(key)) byFolder.set(key, []);
    byFolder.get(key).push(b);
  }
  const body = `<h1>${esc(DEPT_NAMES[dept])} boards</h1>
<div class="sub"><span class="badge">Read-only copy of monday, refreshed every 30 minutes</span><span>${mine.length} board${mine.length === 1 ? "" : "s"} you can see</span><a href="/data/mirror">How the copy is doing</a></div>
<form class="bar" method="get"><input name="q" value="${esc(q || "")}" placeholder="Find a board" aria-label="Find a board"><button type="submit">Search</button></form>
${mine.length ? `<div class="lists">${[...byFolder.entries()].map(([f, list]) => `<section class="fold"><h2>${esc(f)}</h2><div class="cards">${list.map(b =>
  `<a class="card" href="/boards/${esc(b.id)}"><b>${esc(b.name)}</b><span>${b.mirror_items == null ? "Copying soon" : esc(b.mirror_items) + (Number(b.mirror_items) === 1 ? " item" : " items")} · ${b.access === "team" ? "Whole team" : "Listed people only"}</span></a>`).join("")}</div></section>`).join("")}</div>`
  : `<p class="empty">No boards here yet${q ? " match that search" : ""}. The first full copy fills in over the first few hours.</p>`}`;
  return { status: 200, html: frame(DEPT_NAMES[dept] + " boards", [["Ecosystem", "/"], [DEPT_NAMES[dept], "/" + dept], ["Boards", null]], body) };
}

export async function renderBoard(email, id, q, page) {
  const b = await board(id);
  if (!b || b.board_type !== "board" || !canSee(b, email, await teamSet())) { await logAccess(email, "/boards/" + id, id, false); return notFound(); }
  await logAccess(email, "/boards/" + id, id, true);
  const p = Math.max(1, Math.min(10000, parseInt(page, 10) || 1));
  const where = `board_id = $1::bigint AND NOT deleted AND parent_id IS NULL` + (q ? ` AND (name ILIKE $2 OR vals::text ILIKE $2)` : ``);
  const params = q ? [b.id, "%" + String(q).slice(0, 100).replace(/[%_\\]/g, m => "\\" + m) + "%"] : [b.id];
  const total = (await read(`SELECT count(*)::int AS n FROM mirror.items WHERE ${where}`, params))[0].n;
  const items = await read(`SELECT id::text AS id, name, group_id, vals FROM mirror.items WHERE ${where}
    ORDER BY pos NULLS LAST, created_at LIMIT ${PAGE_SIZE} OFFSET ${(p - 1) * PAGE_SIZE}`, params);
  const subCounts = items.length ? Object.fromEntries((await read(`SELECT parent_id::text AS id, count(*)::int AS n FROM mirror.items
    WHERE parent_id = ANY($1::bigint[]) AND NOT deleted GROUP BY parent_id`, [items.map(i => i.id)])).map(r => [r.id, r.n])) : {};
  const cols = (b.columns || []).filter(c => c.type !== "name" && c.type !== "subtasks");
  const groups = (b.groups || []);
  const known = new Set(groups.map(g => g.id));
  const byGroup = new Map(groups.map(g => [g.id, []]));
  for (const it of items) { const g = known.has(it.group_id) ? it.group_id : "_"; if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(it); }
  const gInfo = Object.fromEntries(groups.map(g => [g.id, g]));
  const table = list => `<div class="tw"><table>${colgroup(cols)}<thead><tr><th>Item</th>${cols.map(c => `<th>${esc(c.title)}</th>`).join("")}</tr></thead><tbody>${list.map(it =>
    `<tr><td class="nm"><a href="/boards/${esc(b.id)}/items/${esc(it.id)}">${esc(it.name)}</a>${subCounts[it.id] ? ` <span class="muted sm">(${subCounts[it.id]} subitems)</span>` : ""}</td>${cols.map(c =>
      `<td${c.type === "numbers" ? ' class="num"' : ""}>${cell(c, it.vals && it.vals[c.id])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  const sections = [...byGroup.entries()].filter(([, l]) => l.length).map(([g, l]) => {
    const gi = gInfo[g] || { title: "Other" }; const col = hexOk(gi.color);
    return `<section class="group"${col ? ` style="--gc:${col}"` : ""}><h2 class="gh"><i></i>${esc(gi.title)} <span>${l.length}</span></h2>${table(l)}</section>`;
  }).join("");
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = n => `?${q ? "q=" + encodeURIComponent(q) + "&" : ""}page=${n}`;
  const dept = DEPT_NAMES[b.department] ? b.department : "data";
  const body = `<h1>${esc(b.name)}</h1>
<div class="sub"><span class="badge">Read-only copy of monday · copied ${esc(ago(b.synced_at))}</span>${b.access === "team" ? "" : `<span class="badge lock">Listed people only</span>`}
<span>${esc(total)} ${Number(total) === 1 ? (q ? "item matches" : "item") : (q ? "items match" : "items")}</span><a class="btn" href="https://digitalfoxtalent.monday.com/boards/${esc(b.id)}" target="_blank" rel="noopener noreferrer">Open in monday</a></div>
<form class="bar" method="get"><input name="q" value="${esc(q || "")}" placeholder="Search this board" aria-label="Search this board"><button type="submit">Search</button>${q ? `<a class="btn" href="/boards/${esc(b.id)}">Clear</a>` : ""}</form>
${sections || `<p class="empty">${b.synced_at ? "No items" + (q ? " match that search." : " on this board.") : "This board has not been copied yet. It fills in within the next few runs."}</p>`}
${pages > 1 ? `<div class="pager">${p > 1 ? `<a class="btn" href="${qs(p - 1)}">Previous</a>` : ""}<span>Page ${p} of ${pages}</span>${p < pages ? `<a class="btn" href="${qs(p + 1)}">Next</a>` : ""}</div>` : ""}`;
  return { status: 200, html: frame(b.name, [["Ecosystem", "/"], [DEPT_NAMES[dept], "/" + dept], ["Boards", "/" + dept + "/boards"], [b.name, null]], body) };
}

export async function renderItem(email, boardId, itemId) {
  const b = await board(boardId);
  if (!b || b.board_type !== "board" || !isId(itemId) || !canSee(b, email, await teamSet())) { await logAccess(email, "/boards/" + boardId + "/items/" + itemId, boardId, false); return notFound(); }
  const it = (await read(`SELECT id::text AS id, name, group_id, vals, created_at, updated_at, creator FROM mirror.items
    WHERE id = $1::bigint AND board_id = $2::bigint AND NOT deleted`, [itemId, b.id]))[0];
  if (!it) { await logAccess(email, "/boards/" + b.id + "/items/" + itemId, b.id, false); return notFound(); }
  await logAccess(email, "/boards/" + b.id + "/items/" + it.id, b.id, true);
  const subs = await read(`SELECT i.id::text AS id, i.name, i.vals, i.board_id::text AS board_id FROM mirror.items i
    WHERE i.parent_id = $1::bigint AND NOT i.deleted ORDER BY i.pos NULLS LAST, i.created_at`, [it.id]);
  const subBoard = subs.length ? await board(subs[0].board_id) : null;
  const upd = await read(`SELECT body, creator, created_at FROM mirror.updates WHERE item_id = $1::bigint ORDER BY created_at DESC LIMIT 50`, [it.id]);
  const cols = (b.columns || []).filter(c => c.type !== "name" && c.type !== "subtasks");
  const group = (b.groups || []).find(g => g.id === it.group_id);
  const scols = subBoard ? (subBoard.columns || []).filter(c => c.type !== "name") : [];
  const dept = DEPT_NAMES[b.department] ? b.department : "data";
  const body = `<h1>${esc(it.name)}</h1>
<div class="sub"><span class="badge">Read-only copy of monday</span>${group ? `<span>Group: ${esc(group.title)}</span>` : ""}<span>Created ${esc(iso(it.created_at).slice(0, 10))}${it.creator ? " by " + esc(it.creator) : ""}</span>
<a class="btn" href="https://digitalfoxtalent.monday.com/boards/${esc(b.id)}/pulses/${esc(it.id)}" target="_blank" rel="noopener noreferrer">Open in monday</a></div>
<dl>${cols.map(c => `<dt>${esc(c.title)}</dt><dd>${c.type === "long_text" ? esc((it.vals && it.vals[c.id] && it.vals[c.id][0]) || "") : cell(c, it.vals && it.vals[c.id])}</dd>`).join("")}</dl>
${subs.length ? `<h2 class="sec">Subitems</h2><div class="tw"><table>${colgroup(scols)}<thead><tr><th>Subitem</th>${scols.map(c => `<th>${esc(c.title)}</th>`).join("")}</tr></thead><tbody>${subs.map(s =>
  `<tr><td class="nm">${esc(s.name)}</td>${scols.map(c => `<td${c.type === "numbers" ? ' class="num"' : ""}>${cell(c, s.vals && s.vals[c.id])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : ""}
<h2 class="sec">Updates</h2>${upd.length ? upd.map(u => `<div class="upd"><b>${esc(u.creator || "Someone")} · ${esc(iso(u.created_at).slice(0, 16).replace("T", " "))}</b>${esc(u.body)}</div>`).join("") : `<p class="muted">No updates.</p>`}`;
  return { status: 200, html: frame(it.name, [["Ecosystem", "/"], [DEPT_NAMES[dept], "/" + dept], ["Boards", "/" + dept + "/boards"], [b.name, "/boards/" + b.id], [it.name, null]], body) };
}

export async function renderStatus(email) {
  await logAccess(email, "/data/mirror", null, true);
  const runs = await read(`SELECT started_at, finished_at, boards_synced, items_written, api_calls, ok, note FROM mirror.sync_runs ORDER BY id DESC LIMIT 15`);
  const all = await read(`SELECT id::text AS id, name, department, access, allowed_emails, gone, monday_items, mirror_items, synced_at, sync_error
    FROM mirror.boards WHERE board_type = 'board' AND NOT gone ORDER BY name`);
  const team = await teamSet();
  const mine = all.filter(b => canSee(b, email, team));
  const copied = mine.filter(b => b.synced_at).length;
  const off = mine.filter(b => b.synced_at && b.mirror_items !== b.monday_items);
  const errs = mine.filter(b => b.sync_error);
  const body = `<h1>How the monday copy is doing</h1>
<div class="sub"><span class="badge">${copied} of ${mine.length} boards you can see are copied</span><span>${off.length} with a different item count</span><span>${errs.length} with an error</span></div>
<h2 class="sec">Recent runs</h2><div class="tw"><table><thead><tr><th>Started</th><th>Result</th><th>Boards</th><th>Items written</th><th>monday calls</th><th>Note</th></tr></thead><tbody>${runs.map(r =>
  `<tr><td>${esc(ago(r.started_at))}</td><td class="${r.ok ? "ok" : r.ok === false ? "bad" : ""}">${r.ok ? "OK" : r.ok === false ? "Failed" : "Running"}</td><td class="num">${esc(r.boards_synced)}</td><td class="num">${esc(r.items_written)}</td><td class="num">${esc(r.api_calls)}</td><td>${esc(r.note || "")}</td></tr>`).join("")}</tbody></table></div>
<h2 class="sec">Boards whose counts differ</h2>${off.length ? `<div class="tw"><table><thead><tr><th>Board</th><th>monday</th><th>Copy</th><th>Copied</th></tr></thead><tbody>${off.map(b =>
  `<tr><td class="nm"><a href="/boards/${esc(b.id)}">${esc(b.name)}</a></td><td class="num">${esc(b.monday_items)}</td><td class="num">${esc(b.mirror_items)}</td><td>${esc(ago(b.synced_at))}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">None. Every copied board you can see matches monday.</p>`}
${errs.length ? `<h2 class="sec">Errors</h2><div class="tw"><table><tbody>${errs.map(b => `<tr><td class="nm">${esc(b.name)}</td><td>${esc(b.sync_error)}</td></tr>`).join("")}</tbody></table></div>` : ""}`;
  return { status: 200, html: frame("Monday copy", [["Ecosystem", "/"], ["Data Engine", "/data"], ["Monday copy", null]], body) };
}
