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
import { canEdit, editForm, historyHtml, editableColumns, currentText, fp, boardToken } from "./edit.js";

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
const tableWidth = cols => 380 + cols.reduce((n, c) => n + (WIDTH[c.type] || 180), 0); // exact, so every group lines up like monday

const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeUrl = u => { try { const x = new URL(String(u)); return /^https?:$/.test(x.protocol) ? x.href : null; } catch (e) { return null; } };
const isId = v => /^\d{1,19}$/.test(String(v || ""));
const iso = v => (v instanceof Date ? v.toISOString() : v == null ? "" : String(v));
const ago = t => { if (!t) return "never"; const m = Math.round((Date.now() - Date.parse(iso(t))) / 60000);
  return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago"; };
const hexOk = c => (/^#[0-9a-f]{3,8}$/i.test(String(c || "")) ? c : null);

export function securityHeaders(res) {
  res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin"); // no-referrer makes browsers post Origin: null, which the edit check refuses
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
:root{--bg:#f6f7fb;--surface:#fff;--side:#fff;--line:#d0d4e4;--line2:#e6e9ef;--fg:#323338;--muted:#676879;--faint:#9699a6;--primary:#0073ea;--sel:#cce5ff;--hover:#f5f6f8;--fox:#f58220}
@media (prefers-color-scheme: dark){:root{--bg:#181b34;--surface:#30324e;--side:#292f4c;--line:#4b4e69;--line2:#3d405b;--fg:#d5d8df;--muted:#9699a6;--faint:#797e93;--primary:#579bfc;--sel:#1f3a63;--hover:#383b59}}
*{box-sizing:border-box} html,body{margin:0;height:100%;background:var(--bg);color:var(--fg)}
body{font:400 14px/1.45 Figtree,Poppins,system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:inherit}
.top{position:sticky;top:0;z-index:20;height:48px;display:flex;align-items:center;gap:14px;padding:0 16px;background:var(--side);border-bottom:1px solid var(--line2)}
.top .brand{font-weight:700;font-size:15px;text-decoration:none;display:flex;align-items:center;gap:8px}.top .brand i{width:10px;height:10px;border-radius:3px;background:var(--fox)}
.top .crumb{color:var(--muted);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.top .crumb a{text-decoration:none}.top .crumb a:hover{color:var(--fg)}
.top .me{margin-left:auto;color:var(--muted);font-size:12.5px}
.shell{display:grid;grid-template-columns:264px minmax(0,1fr);min-height:calc(100vh - 48px)}
.side{background:var(--side);border-right:1px solid var(--line2);padding:14px 10px 40px;position:sticky;top:48px;height:calc(100vh - 48px);overflow:auto}
.side form{margin:0 4px 12px}.side input{width:100%;height:32px;padding:0 10px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--fg);font:inherit;font-size:13px}
.side h3{font-size:12px;font-weight:600;color:var(--muted);margin:14px 8px 6px;text-transform:none}
.side details{margin:0}.side summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;font-size:13.5px;font-weight:500}
.side summary::-webkit-details-marker{display:none}.side summary:hover{background:var(--hover)}
.side summary:before{content:"";width:6px;height:6px;border-right:1.5px solid var(--muted);border-bottom:1.5px solid var(--muted);transform:rotate(-45deg);transition:transform .15s;flex:none;margin-right:2px}
.side details[open]>summary:before{transform:rotate(45deg)}
.side .ws{width:20px;height:20px;border-radius:5px;display:inline-grid;place-items:center;font-size:11px;font-weight:700;color:#fff;flex:none}
.side .fold{padding-left:14px}.side .fold summary{font-weight:400;font-size:13px;color:var(--muted)}
.side a.bd{display:flex;align-items:center;gap:8px;padding:5px 8px 5px 24px;border-radius:6px;font-size:13px;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.side a.bd:before{content:"";width:12px;height:10px;border:1.5px solid var(--faint);border-radius:2px;flex:none}
.side a.bd:hover{background:var(--hover)}.side a.bd.on{background:var(--sel);font-weight:500}
.main{padding:22px 32px 80px;min-width:0}
h1{margin:0 0 4px;font-size:26px;font-weight:600;letter-spacing:-.01em;line-height:1.2}
.desc{color:var(--muted);font-size:13.5px;margin:0 0 6px;max-width:900px}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--line2);margin:14px 0 16px}.tabs span,.tabs a{padding:8px 12px;font-size:13.5px;text-decoration:none;color:var(--muted);border-bottom:2px solid transparent;margin-bottom:-1px}.tabs .on{color:var(--fg);border-bottom-color:var(--primary);font-weight:500}
.sub{color:var(--muted);font-size:13px;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center}
.badge{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;border:1px solid var(--line);font-size:12px;color:var(--muted)}
.badge.lock{border-color:#fdab3d;color:#c47f00}.badge.edit{border-color:var(--primary);color:var(--primary)}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 6px}
.bar input{width:240px;max-width:100%;height:32px;padding:0 10px;border-radius:6px;border:1px solid var(--line);background:var(--surface);color:var(--fg);font:inherit;font-size:13px}
.bar button,.btn{height:32px;padding:0 12px;border-radius:6px;border:1px solid var(--line);background:var(--surface);color:var(--fg);font:inherit;font-size:13px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
.btn.primary,.btn.fox{background:var(--primary);border-color:var(--primary);color:#fff;font-weight:500}
.bar .count{color:var(--muted);font-size:13px;margin-left:4px}.bar .grow{flex:1}
details.group{margin-top:26px}
details.group>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;font-weight:600;font-size:16px;color:var(--gc,#579bfc);margin:0 0 8px}
details.group>summary::-webkit-details-marker{display:none}
details.group>summary:before{content:"";width:7px;height:7px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(-45deg);transition:transform .15s;margin-right:4px}
details.group[open]>summary:before{transform:rotate(45deg)}
details.group>summary span{color:var(--faint);font-weight:400;font-size:13px}
.tw{overflow-x:auto;background:var(--surface);border-radius:8px 0 0 8px;border-left:6px solid var(--gc,#579bfc);box-shadow:0 0 0 1px var(--line2)}
table{border-collapse:collapse;table-layout:fixed;width:max-content}
th,td{height:36px;padding:0 10px;border-bottom:1px solid var(--line2);border-right:1px solid var(--line2);text-align:center;vertical-align:middle;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
th{background:var(--surface);font-weight:400;color:var(--muted);font-size:13px;position:sticky;top:0}
td.nm,th.nm{text-align:left;position:sticky;left:0;background:var(--surface);z-index:1;box-shadow:1px 0 0 var(--line2)}
th.nm{z-index:2}
tbody tr:hover td{background:var(--hover)}
td.nm a{text-decoration:none}td.nm a:hover{color:var(--primary)}
td.txt{text-align:left}td.num{text-align:right;font-variant-numeric:tabular-nums}
td.st{padding:0}td.st .pill{display:flex;align-items:center;justify-content:center;height:36px;width:100%;border-radius:0;min-width:0}
.pill{display:inline-block;padding:3px 10px;border-radius:4px;color:#fff;font-size:13px;text-align:center;background:#c4c4c4}
.subs{display:inline-block;margin-left:6px;padding:0 6px;border-radius:9px;background:var(--hover);color:var(--muted);font-size:11.5px}
.clip{display:block;overflow:hidden;text-overflow:ellipsis}
.muted{color:var(--faint)} .sm{font-size:12px}
td[data-c]{cursor:pointer}td[data-c]:hover{box-shadow:inset 0 0 0 1px var(--primary)}
td.saving{opacity:.5}
td.nm .ren{visibility:hidden;margin-left:6px;border:0;background:none;color:var(--muted);cursor:pointer;font-size:12px;padding:2px 4px}
tr:hover td.nm .ren{visibility:visible}
.pop{position:absolute;z-index:50;background:var(--surface);border:1px solid var(--line);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:8px}
.pop .opts{display:grid;gap:6px;min-width:180px}.pop .opt{border:0;border-radius:4px;color:#fff;height:32px;font:inherit;font-size:13px;cursor:pointer}
.pop .opt.clear{background:var(--hover);color:var(--muted)}
.pop input,.pop textarea{font:inherit;font-size:13px;padding:6px 8px;border:1px solid var(--primary);border-radius:4px;background:var(--surface);color:var(--fg);width:100%}
.pop textarea{min-width:340px;min-height:140px;resize:vertical}.pop .acts{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}
#eco-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(20px);opacity:0;transition:all .2s;background:#323338;color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;z-index:60;max-width:90vw}
#eco-toast.show{opacity:1;transform:translateX(-50%)}#eco-toast.bad{background:#d83a52}
.lists{display:grid;gap:22px;margin-top:20px}
.foldh{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin:0 0 10px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
.card{display:block;padding:14px 16px;border-radius:8px;border:1px solid var(--line2);background:var(--surface);text-decoration:none}
.card:hover{border-color:var(--primary)} .card b{display:block;font-weight:500;font-size:14px}
.card span{display:block;margin-top:4px;font-size:12px;color:var(--faint)}
dl{display:grid;grid-template-columns:minmax(140px,220px) 1fr;gap:0;margin:18px 0 0;border:1px solid var(--line2);border-radius:8px;overflow:hidden;background:var(--surface)}
dt,dd{margin:0;padding:10px 14px;border-bottom:1px solid var(--line2)} dt{color:var(--muted);font-size:12.5px}
dd{white-space:pre-wrap;overflow-wrap:anywhere;min-width:0}
h2.sec{font-size:16px;font-weight:600;margin:30px 0 10px}
.upd{padding:12px 14px;border:1px solid var(--line2);border-radius:8px;background:var(--surface);margin-bottom:10px;white-space:pre-wrap;overflow-wrap:anywhere}
.upd b{display:block;font-size:12px;color:var(--muted);font-weight:500;margin-bottom:6px}
.pager{display:flex;gap:10px;align-items:center;margin-top:20px;color:var(--muted)}
.empty{padding:40px 0;color:var(--faint)}
.ok{color:#00854d} .bad{color:#d83a52}
.note{margin:14px 0 0;padding:10px 14px;border-radius:8px;border:1px solid var(--line2);background:var(--surface)}
form.edit{border:1px solid var(--line2);border-radius:8px;background:var(--surface);padding:18px 20px}
form.edit .fields{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px 18px}
form.edit label{display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--muted)}
form.edit input,form.edit select,form.edit textarea{min-height:34px;padding:6px 10px;border-radius:6px;border:1px solid var(--line);background:var(--surface);color:var(--fg);font:inherit;font-size:13.5px;width:100%}
form.edit textarea{resize:vertical}
form.edit .acts{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:18px}
.btn.sm{height:26px;padding:0 8px;font-size:12px}
.tw.plain{border-left:0;border-radius:8px}.tw.plain td,.tw.plain th{text-align:left;white-space:normal}
@media (max-width:900px){.shell{grid-template-columns:1fr}.side{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line2)}.main{padding:18px 16px 60px}}
@media (max-width:640px){dl{grid-template-columns:1fr} dt{border-bottom:0}}
`;

const WS_COLOURS = { partnerships: "#e2445c", platforms: "#00c875", shows: "#a25ddc", talent: "#fdab3d", reporting: "#579bfc", content: "#ff642e", finance: "#037f4c", data: "#66ccff", marketing: "#ff158a" };

// The left sidebar, like monday's: each department is a workspace, with its folders and boards. Only boards the
// viewer may see are listed (same rule as everywhere else), so a private board's name never shows to others.
export async function sidebar(email, current) {
  const rows = await read(`SELECT id::text AS id, name, department, folder_path, workspace_name, access, allowed_emails, gone
    FROM mirror.boards WHERE board_type = 'board' AND NOT gone ORDER BY name`);
  const team = await teamSet();
  const mine = rows.filter(b => canSee(b, email, team));
  const cur = mine.find(b => b.id === String(current || "")) || null;
  const curDept = cur ? cur.department : (DEPT_NAMES[current] ? current : null);
  const out = Object.keys(DEPT_NAMES).map(d => {
    const list = mine.filter(b => (DEPT_NAMES[b.department] ? b.department : "data") === d);
    if (!list.length) return "";
    const folders = new Map();
    for (const b of list) { const f = b.workspace_name === "@digitalfoxtalent" ? (b.folder_path || "") : (b.workspace_name || ""); if (!folders.has(f)) folders.set(f, []); folders.get(f).push(b); }
    const link = b => `<a class="bd${cur && cur.id === b.id ? " on" : ""}" href="/boards/${esc(b.id)}" title="${esc(b.name)}">${esc(b.name)}</a>`;
    const inner = [...folders.entries()].sort((x, y) => (x[0] === "") - (y[0] === "") || x[0].localeCompare(y[0])).map(([f, bs]) => f
      ? `<details class="fold"${cur && bs.some(b => b.id === cur.id) ? " open" : ""}><summary>${esc(f.split(" / ").pop())}</summary>${bs.map(link).join("")}</details>`
      : bs.map(link).join("")).join("");
    return `<details${curDept === d ? " open" : ""}><summary><span class="ws" style="background:${WS_COLOURS[d]}">${esc(DEPT_NAMES[d][0])}</span>${esc(DEPT_NAMES[d])}</summary>${inner}<a class="bd" href="/${esc(d)}/boards">All ${esc(DEPT_NAMES[d])} boards</a></details>`;
  }).join("");
  return `<aside class="side"><form method="get" action="/${esc(curDept || "marketing")}/boards"><input name="q" placeholder="Search boards" aria-label="Search boards"></form><h3>Workspaces</h3>${out}</aside>`;
}

function frame(title, crumbs, body, nav, extraHead) {
  const c = crumbs.map(([t, h]) => (h ? `<a href="${esc(h)}">${esc(t)}</a>` : esc(t))).join(" / ");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap"><style>${CSS}</style>${extraHead || ""}</head>
<body><header class="top"><a class="brand" href="/"><i></i>Ecosystem</a><nav class="crumb" aria-label="Breadcrumb">${c}</nav></header>
<div class="shell">${nav || `<aside class="side"></aside>`}<main class="main">${body}</main></div></body></html>`;
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
  const body = `<h1>${esc(DEPT_NAMES[dept])}</h1>
<p class="desc">${mine.length} board${mine.length === 1 ? "" : "s"} you can see. Copied from monday every 30 minutes${EDIT_NOTE[dept] || ""}. <a href="/data/mirror">How the copy is doing</a></p>
<form class="bar" method="get"><input name="q" value="${esc(q || "")}" placeholder="Search boards" aria-label="Search boards"><button type="submit">Search</button></form>
${mine.length ? `<div class="lists">${[...byFolder.entries()].map(([f, list]) => `<section><h2 class="foldh">${esc(f)}</h2><div class="cards">${list.map(b =>
  `<a class="card" href="/boards/${esc(b.id)}"><b>${esc(b.name)}</b><span>${b.mirror_items == null ? "Copying soon" : esc(b.mirror_items) + (Number(b.mirror_items) === 1 ? " item" : " items")} · ${b.access === "team" ? "Whole team" : "Listed people only"}</span></a>`).join("")}</div></section>`).join("")}</div>`
  : `<p class="empty">No boards here${q ? " match that search" : ""}.</p>`}`;
  return { status: 200, html: frame(DEPT_NAMES[dept], [[DEPT_NAMES[dept], "/" + dept], ["Boards", null]], body, await sidebar(email, dept)) };
}
const EDIT_NOTE = { marketing: ", and editable here: changes save straight to monday" };

// The text-like column types, left-aligned as on monday; everything else is centred.
const LEFT = new Set(["text", "long_text", "link", "email", "people", "multiple_person", "dropdown", "board_relation", "mirror", "tags", "file", "phone", "location"]);
const nameInner = (b, it, subs, editable) => `<a href="/boards/${esc(b.id)}/items/${esc(it.id)}">${esc(it.name)}</a>${subs ? `<span class="subs">${esc(subs)} subitem${subs === 1 ? "" : "s"}</span>` : ""}${editable ? `<button class="ren" type="button" aria-label="Rename">Rename</button>` : ""}`;
const LONG_MAX = 4000; // longer texts are edited on the item page, so a board never ships megabytes of text

// One cell's inner HTML, used by the board and by the inline editor's reply.
export function cellHtml(b, col, it, editable) {
  if (col.id === "name") return nameInner(b, it, 0, editable);
  return cell(col, it.vals && it.vals[col.id]);
}

export async function renderBoard(email, id, q, page, opts = {}) {
  const b = await board(id);
  const team = await teamSet();
  if (!b || b.board_type !== "board" || !canSee(b, email, team)) { await logAccess(email, "/boards/" + id, id, false); return notFound(); }
  await logAccess(email, "/boards/" + id, id, true);
  const p = Math.max(1, Math.min(10000, parseInt(page, 10) || 1));
  const where = `board_id = $1::bigint AND NOT deleted AND parent_id IS NULL` + (q ? ` AND (name ILIKE $2 OR vals::text ILIKE $2)` : ``);
  const params = q ? [b.id, "%" + String(q).slice(0, 100).replace(/[%_\\]/g, m => "\\" + m) + "%"] : [b.id];
  const total = (await read(`SELECT count(*)::int AS n FROM mirror.items WHERE ${where}`, params))[0].n;
  const items = await read(`SELECT id::text AS id, name, group_id, vals FROM mirror.items WHERE ${where}
    ORDER BY pos NULLS LAST, created_at LIMIT ${PAGE_SIZE} OFFSET ${(p - 1) * PAGE_SIZE}`, params);
  const subCounts = items.length ? Object.fromEntries((await read(`SELECT parent_id::text AS id, count(*)::int AS n FROM mirror.items
    WHERE parent_id = ANY($1::bigint[]) AND NOT deleted GROUP BY parent_id`, [items.map(i => i.id)])).map(r => [r.id, r.n])) : {};
  const editable = !!opts.secret && canEdit(b, email, team);
  const ecols = editable ? new Map(editableColumns(b).map(c => [c.id, c])) : new Map();
  const cols = (b.columns || []).filter(c => c.type !== "name" && c.type !== "subtasks");
  const groups = (b.groups || []);
  const known = new Set(groups.map(g => g.id));
  const byGroup = new Map(groups.map(g => [g.id, []]));
  for (const it of items) { const g = known.has(it.group_id) ? it.group_id : "_"; if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(it); }
  const gInfo = Object.fromEntries(groups.map(g => [g.id, g]));
  const edAttrs = (c, it) => {
    const ed = ecols.get(c.id); if (!ed) return "";
    const v = currentText(ed, it);
    if (ed.type === "long_text" && v.length > LONG_MAX) return ` data-c="${esc(c.id)}" data-t="long" data-href="/boards/${esc(b.id)}/items/${esc(it.id)}"`;
    return ` data-c="${esc(c.id)}" data-t="${esc(ed.type)}" data-f="${esc(fp(v))}" data-v="${esc(v)}"`;
  };
  const td = (c, it) => {
    const cls = c.type === "status" ? "st" : c.type === "numbers" ? "num" : LEFT.has(c.type) ? "txt" : "";
    return `<td${cls ? ` class="${cls}"` : ""}${edAttrs(c, it)}>${cell(c, it.vals && it.vals[c.id])}</td>`;
  };
  const nameCol = { id: "name", type: "name", title: "Name" };
  const table = list => `<div class="tw"><table style="width:${tableWidth(cols)}px">${colgroup(cols)}<thead><tr><th class="nm">Item</th>${cols.map(c => `<th title="${esc(c.title)}">${esc(c.title)}</th>`).join("")}</tr></thead><tbody>${list.map(it =>
    `<tr data-i="${esc(it.id)}"><td class="nm"${editable ? edAttrs(nameCol, it).replace(/data-t="name"/, 'data-t="name"') : ""}>${nameInner(b, it, subCounts[it.id] || 0, editable)}</td>${cols.map(c => td(c, it)).join("")}</tr>`).join("")}</tbody></table></div>`;
  const sections = [...byGroup.entries()].filter(([, l]) => l.length).map(([g, l]) => {
    const gi = gInfo[g] || { title: "Other" }; const col = hexOk(gi.color);
    return `<details class="group" open${col ? ` style="--gc:${col}"` : ""}><summary>${esc(gi.title)} <span>${l.length} item${l.length === 1 ? "" : "s"}</span></summary>${table(l)}</details>`;
  }).join("");
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = n => `?${q ? "q=" + encodeURIComponent(q) + "&" : ""}page=${n}`;
  const dept = DEPT_NAMES[b.department] ? b.department : "data";
  const colsJson = editable ? JSON.stringify(Object.fromEntries([...ecols.values()].map(c => [c.id, { t: c.type, n: c.title, l: c.type === "status" ? Object.values(c.labels || {}).filter(x => x && x[0]).map(x => [x[0], hexOk(x[1]) || "#c4c4c4"]) : undefined }]))).replace(/</g, "\\u003c") : "";
  const body = `<div${editable ? ` data-eco-board data-b="${esc(b.id)}" data-k="${esc(boardToken(opts.secret, email, b.id))}"` : ""}>
<h1>${esc(b.name)}</h1>${b.description ? `<p class="desc">${esc(b.description)}</p>` : ""}
<div class="tabs"><span class="on">Main table</span></div>
<form class="bar" method="get"><input name="q" value="${esc(q || "")}" placeholder="Search" aria-label="Search this board"><button type="submit">Search</button>${q ? `<a class="btn" href="/boards/${esc(b.id)}">Clear</a>` : ""}
<span class="count">${esc(total)} ${Number(total) === 1 ? (q ? "item matches" : "item") : (q ? "items match" : "items")}</span><span class="grow"></span>
<span class="badge${editable ? " edit" : ""}">${editable ? "Click any cell to edit · saves to monday" : "Read-only copy of monday · copied " + esc(ago(b.synced_at))}</span>${b.access === "team" ? "" : `<span class="badge lock">Listed people only</span>`}
<a class="btn" href="https://digitalfoxtalent.monday.com/boards/${esc(b.id)}" target="_blank" rel="noopener noreferrer">Open in monday</a></form>
${sections || `<p class="empty">${b.synced_at ? "No items" + (q ? " match that search." : " on this board.") : "This board has not been copied yet. It fills in within the next few runs."}</p>`}
${pages > 1 ? `<div class="pager">${p > 1 ? `<a class="btn" href="${qs(p - 1)}">Previous</a>` : ""}<span>Page ${p} of ${pages}</span>${p < pages ? `<a class="btn" href="${qs(p + 1)}">Next</a>` : ""}</div>` : ""}
</div>${editable ? `<script type="application/json" id="eco-cols">${colsJson}</script>` : ""}`;
  return { status: 200, html: frame(b.name, [[DEPT_NAMES[dept], "/" + dept + "/boards"], [b.name, null]], body, await sidebar(email, b.id),
    editable ? `<script src="/assets/eco-board.js" defer></script>` : "") };
}

export async function renderItem(email, boardId, itemId, opts = {}) {
  const b = await board(boardId);
  const team = await teamSet();
  if (!b || b.board_type !== "board" || !isId(itemId) || !canSee(b, email, team)) { await logAccess(email, "/boards/" + boardId + "/items/" + itemId, boardId, false); return notFound(); }
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
  const editable = !!opts.secret && canEdit(b, email, team);
  const note = opts.note ? `<p class="note ${opts.note.ok ? "ok" : "bad"}">${esc(opts.note.message)}</p>` : "";
  const body = `<h1>${esc(it.name)}</h1>
<div class="sub"><span class="badge${editable ? " edit" : ""}">${editable ? "Editable here · saves to monday" : "Read-only copy of monday"}</span>${group ? `<span>Group: ${esc(group.title)}</span>` : ""}<span>Created ${esc(iso(it.created_at).slice(0, 10))}${it.creator ? " by " + esc(it.creator) : ""}</span>
<a class="btn" href="https://digitalfoxtalent.monday.com/boards/${esc(b.id)}/pulses/${esc(it.id)}" target="_blank" rel="noopener noreferrer">Open in monday</a></div>
${note}${editable ? `<h2 class="sec">Edit</h2>${editForm(b, it, email, opts.secret)}<h2 class="sec">All fields</h2>` : ""}
<dl>${cols.map(c => `<dt>${esc(c.title)}</dt><dd>${c.type === "long_text" ? esc((it.vals && it.vals[c.id] && it.vals[c.id][0]) || "") : cell(c, it.vals && it.vals[c.id])}</dd>`).join("")}</dl>
${subs.length ? `<h2 class="sec">Subitems</h2><div class="tw"><table>${colgroup(scols)}<thead><tr><th>Subitem</th>${scols.map(c => `<th>${esc(c.title)}</th>`).join("")}</tr></thead><tbody>${subs.map(s =>
  `<tr><td class="nm">${esc(s.name)}</td>${scols.map(c => `<td${c.type === "numbers" ? ' class="num"' : ""}>${cell(c, s.vals && s.vals[c.id])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : ""}
${editable ? `<h2 class="sec">Changes made in the Ecosystem</h2>${await historyHtml(b, it, email, opts.secret)}` : ""}
<h2 class="sec">Updates</h2>${upd.length ? upd.map(u => `<div class="upd"><b>${esc(u.creator || "Someone")} · ${esc(iso(u.created_at).slice(0, 16).replace("T", " "))}</b>${esc(u.body)}</div>`).join("") : `<p class="muted">No updates.</p>`}`;
  return { status: 200, html: frame(it.name, [[DEPT_NAMES[dept], "/" + dept + "/boards"], [b.name, "/boards/" + b.id], [it.name, null]], body, await sidebar(email, b.id)) };
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
<h2 class="sec">Recent runs</h2><div class="tw plain"><table><thead><tr><th>Started</th><th>Result</th><th>Boards</th><th>Items written</th><th>monday calls</th><th>Note</th></tr></thead><tbody>${runs.map(r =>
  `<tr><td>${esc(ago(r.started_at))}</td><td class="${r.ok ? "ok" : r.ok === false ? "bad" : ""}">${r.ok ? "OK" : r.ok === false ? "Failed" : "Running"}</td><td class="num">${esc(r.boards_synced)}</td><td class="num">${esc(r.items_written)}</td><td class="num">${esc(r.api_calls)}</td><td>${esc(r.note || "")}</td></tr>`).join("")}</tbody></table></div>
<h2 class="sec">Boards whose counts differ</h2>${off.length ? `<div class="tw plain"><table><thead><tr><th>Board</th><th>monday</th><th>Copy</th><th>Copied</th></tr></thead><tbody>${off.map(b =>
  `<tr><td class="nm"><a href="/boards/${esc(b.id)}">${esc(b.name)}</a></td><td class="num">${esc(b.monday_items)}</td><td class="num">${esc(b.mirror_items)}</td><td>${esc(ago(b.synced_at))}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">None. Every copied board you can see matches monday.</p>`}
${errs.length ? `<h2 class="sec">Errors</h2><div class="tw"><table><tbody>${errs.map(b => `<tr><td class="nm">${esc(b.name)}</td><td>${esc(b.sync_error)}</td></tr>`).join("")}</tbody></table></div>` : ""}`;
  return { status: 200, html: frame("Monday copy", [["Data Engine", "/data"], ["Monday copy", null]], body, await sidebar(email, "data")) };
}
