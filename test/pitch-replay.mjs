// Offline regression replay for the pitch pipeline (POST /api/roster {op:"pitch"}) in api/roster.js.
// Run: node test/pitch-replay.mjs            (PITCH_SEED=<n> varies the draft wording; PITCH_VERBOSE=1 prints failures in full)
//
// Nothing touches the network: globalThis.fetch is replaced by a router that answers monday GraphQL from an in-memory
// board (test/fixtures/pitch/roster.json) and Anthropic messages from a per-test function, and rejects anything else.
// Each scenario imports roster.js fresh (?t=<n>) so its module-level board cache never leaks between scenarios.
// Board ids, column ids and list storage columns are read from roster.js's own source, so the harness follows renames.
// Some scenarios are expected to FAIL against the current code; the harness prints PASS/FAIL per scenario and exits 1
// if any fail.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROSTER = path.join(HERE, "..", "api", "roster.js");
const SRC = fs.readFileSync(ROSTER, "utf8");
const FIX = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "pitch", "roster.json"), "utf8"));
const VERBOSE = !!process.env.PITCH_VERBOSE;

// ------------------------------------------------------------------ constants, read from roster.js
const srcNum = (name, fb) => { const m = SRC.match(new RegExp("const " + name + "\\s*=\\s*(\\d+)\\s*;")); return m ? Number(m[1]) : fb; };
const srcStr = (name, fb) => { const m = SRC.match(new RegExp("const " + name + "\\s*=\\s*\"([^\"]+)\"")); return m ? m[1] : fb; };
const srcObj = (name, fb) => { const m = SRC.match(new RegExp("const " + name + " = \\{([\\s\\S]*?)\\n?\\};")); if (!m) return fb; const o = {}; let x; const re = /(\w+):\s*"([^"]+)"/g; while ((x = re.exec(m[1]))) o[x[1]] = x[2]; return Object.keys(o).length ? o : fb; };
const BOARD = srcNum("BOARD", 18417663127);
const SUB_BOARD = srcNum("SUB_BOARD", 18417669961);
const LISTS_BOARD = srcNum("LISTS_BOARD", 18434088297);
const CREATOR_BOARD = srcNum("CREATOR_BOARD", 6160485039);
const PITCH_BOARD = srcNum("PITCH_BOARD", 18435316650);
const FACTS_ITEM = srcNum("FACTS_ITEM", 13283766377);
const LESSONS_ITEM = srcNum("PITCH_LESSONS_ITEM", 13327548036);
const PLAYBOOK_ITEM = srcNum("PLAYBOOK_ITEM", 13313762403);
const RECRUIT_LESSONS_ITEM = srcNum("RECRUIT_LESSONS_ITEM", 13320786518);
const HOST = srcStr("HOST", "roster-viewguarantee.digitalfoxtalent.com");
const AI_LIST = srcStr("AI_LIST", "ai-campaigns-tj-50001f");
const PB = srcObj("PB", { by: "text_mm83t28h", contact: "text_mm83nbr6", result: "text_mm83dzmw", list: "link_mm832b9j", draft: "long_text_mm89wehb", check: "text_mm897m47" });
const L = srcObj("L", { slug: "text_mm7vgrr5", items: "long_text_mm7vtnkw", by: "text_mm7v2v06", link: "link_mm7vwxw0", updated: "text_mm7vj42p", opened: "date_mm867kmd" });
const C = srcObj("C", {});
const ITEM_COLS = (() => {
  const m = SRC.match(/const ITEM_COLS = \[([\s\S]*?)\];/);
  if (!m) return [L.items];
  return m[1].split(",").map(s => s.trim()).filter(Boolean).map(s => s === "L.items" ? L.items : s.replace(/^"|"$/g, ""));
})();
const NOTE_COL = "long_text_mm83jwpf"; // Pitch Requests "note" column (pointers, facts, lessons)
const FIT_COL = "long_text_mm84rm3j"; // Rates board brand fit note
const PITCH_MODELS = (() => { const m = SRC.match(/const PITCH_MODELS = \[([^\]]+)\]/); return m ? m[1].split(",").map(s => s.trim().replace(/^"|"$/g, "")) : ["claude-opus-5-5"]; })();
for (const k of ["subs", "bvg", "brate", "bcpm", "bbasis", "bq", "bnote", "handle", "category", "location", "about", "url", "vis", "us", "uk", "male"]) assert.ok(C[k], "roster.js column C." + k + " not found; the harness needs updating");

// ------------------------------------------------------------------ small helpers
const DFT = /@digitalfoxtalent\.com$/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const jres = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
const textOf = v => v == null ? "" : typeof v === "string" ? v : typeof v === "number" ? String(v) : typeof v === "object" ? (v.text != null ? String(v.text) : v.label != null ? String(v.label) : v.url != null ? String(v.url) : v.date != null ? String(v.date) : JSON.stringify(v)) : String(v);
const ROWS = FIX.rows;
const rowById = Object.fromEntries(ROWS.map(r => [r.id, r]));
const baseName = n => String(n || "").replace(/\s*-\s*(Shorts|Instagram|TikTok|Snapchat|Dedicated).*$/i, "");
const idsOf = (...names) => ROWS.filter(r => names.includes(baseName(r.name))).map(r => r.id);

// ------------------------------------------------------------------ the in-memory monday account
function rateCv(r) {
  const long = r.group === "topics";
  const cv = {
    [C.subs]: String(r.subs || ""), [C.handle]: r.handle, [C.category]: r.category, [C.location]: r.location, [C.about]: r.about || "",
    [C.url]: "https://www.youtube.com/" + r.handle, [C.vis]: r.vis || "Auto", [C.us]: r.us || "", [C.uk]: r.uk || "", [C.male]: r.male || "",
    [C.bq]: "Q4 2026", [C.bnote]: "", [C.bvg]: String(r.vg), [C.bcpm]: "25",
  };
  if (long) { cv[C.brate] = String(Math.round(r.vg * 25 / 1000)); cv[C.bbasis] = String(Math.round(r.vg / 1.5)); if (C.avg) cv[C.avg] = String(Math.round(r.vg / 1.5)); }
  else { cv[C.bbasis] = String(r.vg); if (C.avg) cv[C.avg] = String(r.vg); }
  if (r.fit) cv[FIT_COL] = r.fit;
  return cv;
}
function listCv(body) { // a list's JSON split over the Items columns the way bodyValues does
  const s = JSON.stringify(body), cv = {}; let pos = 0;
  ITEM_COLS.forEach(c => { cv[c] = s.slice(pos, pos + 1900); pos += 1900; });
  return cv;
}
function listBodyOf(it) { const s = ITEM_COLS.map(c => it.cv[c] || "").join(""); try { return s ? JSON.parse(s) : {}; } catch (e) { return { __bad: s.slice(0, 120) }; } }

function makeDb({ board, lists, fromEmail, item, itemAgeMs, itemBy, pointers }) {
  const items = new Map();
  const add = it => { items.set(String(it.id), Object.assign({ state: "active", created_at: new Date(Date.now() - 864e5).toISOString(), group: "", raw: {} }, it, { id: String(it.id) })); };
  (board || ROWS).forEach(r => add({ id: r.id, board: BOARD, group: r.group, name: r.name, cv: rateCv(r) }));
  const today = new Date().toISOString().slice(0, 10);
  add({ id: 8800001, board: LISTS_BOARD, name: "AI campaigns", cv: Object.assign({ [L.slug]: AI_LIST, [L.by]: "tom@digitalfoxtalent.com " + today, [L.updated]: "" }, listCv({ ids: FIX.aiList })) });
  (lists || []).forEach((l, i) => add({ id: l.id || 8800100 + i, board: LISTS_BOARD, name: l.name, cv: Object.assign({ [L.slug]: l.slug, [L.by]: l.by || "tom@digitalfoxtalent.com (pitch) " + today, [L.updated]: l.updated || "", [L.link]: "Open list - https://" + HOST + "/r/" + l.slug }, listCv(l.body)) }));
  add({ id: FACTS_ITEM, board: PITCH_BOARD, name: "Standing facts for pitch replies", cv: { [NOTE_COL]: "- Availability and posting dates are confirmed with each creator as soon as they approve.\n- Rates on the list include 12 months of digital usage for short form." } });
  add({ id: LESSONS_ITEM, board: PITCH_BOARD, name: "Standing lessons for pitch replies", cv: { [NOTE_COL]: "- Keep the thank-you to one short sentence.\n- Do not add a stock availability line." } });
  (pointers || ["Family Fun Lab is not a fit for horror games", "Keep lists to YouTube unless the brand asks for socials"]).forEach((p, i) => add({ id: 5540001 + i, board: PITCH_BOARD, name: "Earlier pitch " + (i + 1), cv: { [NOTE_COL]: p, [PB.result]: "Ready: 10 placements" } }));
  if (item !== null) add({ id: item, board: PITCH_BOARD, name: "Pitch request", created_at: new Date(Date.now() - (itemAgeMs == null ? 60e3 : itemAgeMs)).toISOString(), cv: { [PB.by]: itemBy || fromEmail, [PB.result]: "" } });
  const stamps = {};
  return { items, stamps, nextId: 7700001, touch: b => { stamps[String(b)] = new Date(Date.now() + Object.keys(stamps).length).toISOString() + "#" + Math.random(); } };
}

function itemOut(it) {
  return { id: it.id, name: it.name, created_at: it.created_at, state: it.state, board: { id: String(it.board) }, group: { id: it.group, title: it.group },
    column_values: Object.entries(it.cv).map(([id, text]) => ({ id, text: String(text), value: it.raw[id] != null ? it.raw[id] : null })), subitems: [] };
}
function applyValues(db, it, values) {
  Object.entries(values || {}).forEach(([k, v]) => { if (k === "name") it.name = String(v); else it.cv[k] = textOf(v); });
  db.touch(it.board);
}
function requestedCols(q) { const m = q.match(/column_values\(ids:(\[[^\]]*\])\)\{id text\}\}\}\s*$/) || q.match(/change_multiple_column_values\([^)]*\)\{id name column_values\(ids:(\[[^\]]*\])\)/); try { return m ? JSON.parse(m[1]) : null; } catch (e) { return null; } }

function mondayAnswer(db, rec, query, variables) {
  const q = String(query || ""), v = variables || {};
  if (/^\s*mutation/.test(q)) {
    if (/create_item\(/.test(q)) {
      const id = String(db.nextId++), vals = JSON.parse(v.v || "{}");
      const it = { id, board: Number(v.b), name: String(v.n), state: "active", created_at: new Date().toISOString(), group: "", raw: {}, cv: {} };
      db.items.set(id, it); applyValues(db, it, vals);
      rec.push({ op: "create_item", board: Number(v.b), item: id, name: String(v.n), values: vals });
      return { create_item: { id } };
    }
    if (/change_multiple_column_values\(/.test(q)) {
      let board, itemId, vals;
      if (v.i != null) { board = Number(v.b); itemId = String(v.i); vals = JSON.parse(v.v || "{}"); }
      else { const m = q.match(/change_multiple_column_values\(board_id:(\d+),item_id:(\d+),column_values:("(?:[^"\\]|\\.)*")\)/); if (!m) throw new Error("stub cannot parse inline mutation: " + q.slice(0, 200)); board = Number(m[1]); itemId = m[2]; vals = JSON.parse(JSON.parse(m[3])); }
      const it = db.items.get(itemId);
      rec.push({ op: "change_multiple_column_values", board, item: itemId, values: vals, missing: !it });
      if (!it) throw Object.assign(new Error("monday: item not found"), { mondayErrors: [{ message: "Item not found" }] });
      applyValues(db, it, vals);
      const cols = requestedCols(q);
      return { change_multiple_column_values: { id: it.id, name: it.name, column_values: (cols || []).map(id => ({ id, text: String(it.cv[id] || "") })) } };
    }
    rec.push({ op: "other-mutation", query: q.slice(0, 200), variables: v });
    return {};
  }
  if (/boards\(ids:\[[\d,]+\]\)\{id updated_at\}/.test(q)) {
    const ids = q.match(/boards\(ids:\[([\d,]+)\]/)[1].split(",");
    return { boards: ids.map(id => ({ id, updated_at: db.stamps[id] || "2026-10-19T09:00:00Z" })) };
  }
  if (/next_items_page/.test(q)) return { next_items_page: { cursor: null, items: [] } };
  let m = q.match(/boards\(ids:\[(\d+)\]\)\{groups\(ids:\["([^"]+)"\]\)/);
  if (m) {
    const items = [...db.items.values()].filter(it => String(it.board) === m[1] && it.group === m[2] && it.state === "active").map(itemOut);
    return { boards: [{ groups: [{ id: m[2], items_page: { items } }] }] };
  }
  m = q.match(/boards\(ids:\[(\d+)\]\)\{items_page/);
  if (m) {
    const items = [...db.items.values()].filter(it => String(it.board) === m[1] && it.state === "active").map(itemOut);
    return { boards: [{ items_page: { cursor: null, items } }] };
  }
  if (/items\(ids:/.test(q)) {
    const ids = v.i ? [].concat(v.i).map(String) : ((q.match(/items\(ids:\[([^\]]*)\]/) || [])[1] || "").split(",").map(s => s.trim().replace(/"/g, "")).filter(Boolean);
    return { items: ids.map(id => db.items.get(id)).filter(Boolean).map(itemOut) };
  }
  rec.push({ op: "unknown-query", query: q.slice(0, 300) });
  return {};
}

// ------------------------------------------------------------------ the Anthropic stub
function kindOf(prompt) {
  const p = String(prompt || "");
  if (p.startsWith("You help Digital Fox Talent")) return "pitch";
  if (p.startsWith("You are Tom James, founder")) return "review";
  if (p.startsWith("Research the brand")) return "research";
  if (p.startsWith("A DFT teammate forwarded")) return "split";
  if (p.startsWith("You are Tom James at Digital Fox Talent")) return "polish";
  return "other";
}
// The catalogue lines in a pitch prompt: "id | format | name | handle | category | ...".
function rosterLines(prompt) {
  return String(prompt).split("\n").filter(l => /^d?\d+ \| /.test(l)).map(l => { const p = l.split(" | "); return { id: p[0], format: p[1], name: p[2], handle: p[3], category: p[4], line: l }; });
}
const pointerOf = prompt => (String(prompt).split("\n").find(l => /^POINTER FROM /.test(l)) || "").replace(/^POINTER FROM [^:]*\):\s*/, "");
const YT = f => f === "YouTube integration" || f === "YouTube Shorts";
// What a sensible model would pick: gaming, reaction, entertainment and tech channels as integrations and Shorts,
// plus every creator the forwarder's note asks to include (named). Tests override this where they need to.
function defaultPicks(prompt) {
  const lines = rosterLines(prompt), note = pointerOf(prompt);
  const picks = lines.filter(l => YT(l.format) && /gaming|reaction|entertainment|tech|anime/i.test(l.category)).map(l => ({ id: l.id, named: false, fit: 4, why: "fits the audience" }));
  lines.filter(l => YT(l.format) && note && new RegExp("\\b(include|add)\\b[^.?!]*" + baseName(l.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(note))
    .forEach(l => { const x = picks.find(p => p.id === l.id); if (x) x.named = true; else picks.push({ id: l.id, named: true, fit: 5, why: "asked for in the note" }); });
  return picks;
}
function pitchReply(prompt, extra) {
  const sub = (String(prompt).match(/This pitch is for the (.+?) campaign alone/) || [])[1] || "";
  const product = sub || (extra && extra.product) || "Campaign Alpha";
  return Object.assign({ brand: "Northpeak", ai_product: false, product, opener: "Thanks for getting in touch about " + product + ".", title: product, contact_first_name: "Jordan",
    angles: ["gaming", "reaction"], mix: "gaming, reaction and personality channels", answer: "", stage: "new", closing: false, formats: [], questions: [],
    picks: defaultPicks(prompt), no_pitch_reason: "", needs_details: "" }, extra || {});
}
function defaultClaude(call) {
  if (call.kind === "pitch") return pitchReply(call.prompt);
  if (call.kind === "review") return { remove: [] };
  if (call.kind === "research") return { brand: "Northpeak", website: "https://northpeak.example", product: "a mobile game", audience: "gamers 18 to 34, US and UK", tone: "playful", past_creators: [], notes: "" };
  if (call.kind === "split") return { campaigns: [] };
  if (call.kind === "polish") { // hand the draft back unchanged, which passes every check in polishPitch
    const p = String(call.prompt), a = p.indexOf("THE DRAFT (one paragraph per item):\n"), z = p.indexOf("\n\nReply with ONLY JSON");
    try { return { paragraphs: JSON.parse(p.slice(a + 36, z)) }; } catch (e) { return { paragraphs: [] }; }
  }
  return {};
}
async function anthropicAnswer(state, init) {
  const body = JSON.parse(init.body || "{}"), prompt = String(((body.messages || [])[0] || {}).content || ""), kind = kindOf(prompt);
  const n = state.counts[kind] = (state.counts[kind] || 0); state.counts[kind]++;
  const call = { kind, prompt, model: body.model, n, tools: body.tools || null };
  let reply = state.claude ? await state.claude(call, defaultClaude) : undefined;
  if (reply === undefined) reply = defaultClaude(call);
  const entry = { kind, model: body.model, n, prompt, reply };
  state.prompts.push(entry);
  if (reply && reply.networkError) { entry.networkError = true; throw new TypeError("fetch failed"); }
  if (reply && reply.httpStatus) return jres({ type: "error", error: { type: "api_error", message: reply.message || "stub error" } }, reply.httpStatus);
  const text = typeof reply === "string" ? reply : JSON.stringify(reply);
  return jres({ id: "msg_stub", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text }], stop_reason: "end_turn" });
}

// ------------------------------------------------------------------ the forward and the run
const DEFAULT_BODY = [
  "Hi DFT team,",
  "",
  "I'm Jordan from Northpeak Media. We're running a creator campaign for Campaign Alpha, a new mobile strategy game launching in November, and we'd love to work with some of your YouTube creators on integrations.",
  "",
  "Could you send over a few options with rates?",
  "",
  "Best,",
  "Jordan Lee",
  "Partnerships Manager, Northpeak Media",
].join("\n");
function buildForward({ note, fromName, from, to, date, subject, body }) {
  const head = "---------- Forwarded message ---------\nFrom: " + from + "\nDate: " + date + "\nSubject: " + subject + "\nTo: " + to + "\n\n";
  const sig = "\n\nWarm regards\n" + fromName + "\nDigital Fox Talent\n\u{1F98A}\n\n";
  const text = (note ? note + sig : "") + head + body;
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = "<div dir=\"ltr\">" + (note ? esc(note).replace(/\n/g, "<br>") + "<br><br>Warm regards<br>" + esc(fromName) + "<br>Digital Fox Talent<br>\u{1F98A}<br><br>" : "") +
    "<div class=\"gmail_quote\"><div dir=\"ltr\" class=\"gmail_attr\">---------- Forwarded message ---------<br>From: " + esc(from) + "<br>Date: " + esc(date) + "<br>Subject: " + esc(subject) + "<br>To: " + esc(to) + "<br></div><br><br>" +
    esc(body).replace(/\n/g, "<br>") + "</div></div>";
  return { text, html };
}

let RUN = 0;
async function runPitch(opt = {}) {
  const fromEmail = opt.fromEmail || "tom@digitalfoxtalent.com";
  const fromName = opt.fromName || (/^tom@/.test(fromEmail) ? "Tom James" : /^margot@/.test(fromEmail) ? "Margot Grant" : "Alex Mackenzie");
  const item = opt.item === undefined ? 5550001 : opt.item;
  const subjectLine = opt.subject || "Creator partnership for Campaign Alpha";
  const fwd = buildForward({ note: opt.note || "", fromName, from: opt.from || "Jordan Lee <jordan@northpeakmedia.com>", to: opt.to || "<theteam@digitalfoxtalent.com>", date: opt.date || "Mon, Oct 19, 2026 at 9:12 AM", subject: subjectLine, body: opt.text || DEFAULT_BODY });
  const db = makeDb({ board: opt.board, lists: opt.lists, fromEmail, item: opt.dbItem === undefined ? item : opt.dbItem, itemAgeMs: opt.itemAgeMs, itemBy: opt.itemBy, pointers: opt.pointers });
  const mutations = [], state = { claude: opt.model || opt.claude || null, prompts: [], counts: {} }, unexpected = [];
  const saved = { fetch: globalThis.fetch, random: Math.random, env: Object.assign({}, process.env) };
  process.env.MONDAY_API_KEY = "test-monday-key";
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  delete process.env.MONDAY_API_TOKEN; delete process.env.GMAIL_DELEGATE_KEY;
  Math.random = mulberry32((Number(process.env.PITCH_SEED) || 7) * 1000 + (++RUN));
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url && url.url ? url.url : url);
    if (u === "https://api.monday.com/v2") {
      const { query, variables } = JSON.parse(init.body || "{}");
      try { return jres({ data: mondayAnswer(db, mutations, query, variables) }); }
      catch (e) { return jres({ errors: e.mondayErrors || [{ message: String(e.message || e) }] }); }
    }
    if (u === "https://api.anthropic.com/v1/messages") return anthropicAnswer(state, init);
    unexpected.push(u);
    throw new TypeError("offline harness: unexpected fetch to " + u);
  };
  const body = opt.rawBody || { op: "pitch", item: item == null ? undefined : String(item), fromEmail, fromName, text: fwd.text, html: fwd.html, subject: "Fwd: " + subjectLine, sentTo: opt.sentTo || "pitch@digitalfoxtalent.com" };
  const req = { method: "POST", url: "/api/roster", headers: { host: HOST }, query: {}, body };
  const res = { statusCode: 200, headers: {}, body: undefined, setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; }, status(n) { this.statusCode = n; return this; }, json(o) { this.body = o; return this; }, send(s) { this.body = s; return this; }, end() { return this; } };
  let crashed = null;
  try {
    const mod = await import(pathToFileURL(ROSTER).href + "?t=" + RUN);
    await Promise.race([mod.default(req, res), sleep(opt.timeoutMs || 30000).then(() => { throw new Error("handler did not finish in time"); })]);
  } catch (e) { crashed = e; }
  finally { globalThis.fetch = saved.fetch; Math.random = saved.random; for (const k of Object.keys(process.env)) if (!(k in saved.env)) delete process.env[k]; Object.assign(process.env, saved.env); }
  const row = db.items.get(String(item));
  const createdLists = mutations.filter(m => m.op === "create_item" && m.board === LISTS_BOARD).map(m => db.items.get(m.item));
  const listWrites = mutations.filter(m => m.op === "change_multiple_column_values" && m.board === LISTS_BOARD && Object.keys(m.values).some(k => ITEM_COLS.includes(k)))
    .map(m => { const s = ITEM_COLS.map(c => textOf(m.values[c])).join(""); let b = null; try { b = JSON.parse(s); } catch (e) {} return { item: m.item, name: m.values.name, body: b }; });
  return { status: res.statusCode, json: res.body, crashed, mutations, prompts: state.prompts, db, row, rowResult: row ? String(row.cv[PB.result] || "") : "", createdLists, listWrites, unexpected, fromName, fromEmail,
    listOf: url => { const slug = String(url || "").split("/r/")[1]; const it = [...db.items.values()].find(x => x.board === LISTS_BOARD && x.cv[L.slug] === slug); return it ? Object.assign({ item: it }, listBodyOf(it)) : null; } };
}

// ------------------------------------------------------------------ checks shared by scenarios
const above = t => { const s = String(t || ""), i = s.indexOf("\u{1F98A}"); return i >= 0 ? s.slice(0, i + 2) : s.split(/\n\nOn [^\n]*wrote:/)[0]; };
const urlsIn = s => [...new Set(String(s || "").match(/https:\/\/[a-z0-9.-]+\/r\/[a-z0-9-]+/g) || [])];
function expectOk(r) {
  if (r.crashed) throw new Error("handler threw: " + (r.crashed.stack || r.crashed));
  if (r.status !== 200) throw new Error("status " + r.status + ": " + JSON.stringify(r.json && r.json.error || r.json).slice(0, 300));
  if (r.unexpected.length) throw new Error("unexpected network calls: " + r.unexpected.join(", "));
}
function savedIds(r) { const l = r.listOf(r.json && r.json.listUrl); if (!l) throw new Error("saved list " + (r.json && r.json.listUrl) + " not found on the lists board"); return (l.ids || []).map(String); }
const SUCCESSES = [];
const keep = (name, r) => {
  if (r.status === 200 && r.json && r.json.text) SUCCESSES.push({ name, r });
  if (process.env.PITCH_DUMP) console.log("---- " + name + " status " + r.status + " | model calls: " + r.prompts.map(p => p.kind + "@" + p.model + (p.networkError ? "(net error)" : "")).join(", ") + "\n" + (r.json && r.json.text ? above(r.json.text) : JSON.stringify(r.json)) + "\n---- row: " + r.rowResult + "\n");
  return r;
};

// ------------------------------------------------------------------ scenarios
const BRAND = "jordan@northpeakmedia.com";
const TWO_CAMPAIGNS = [
  "Hi team,",
  "",
  "We have two campaigns coming up and would love creator recommendations for both:",
  "",
  "1. Campaign Alpha: a mobile strategy game launching in November. We're after YouTube integrations with gaming audiences in the US and UK.",
  "2. Campaign Beta: an AI writing assistant app. Looking for tech and productivity creators for YouTube integrations and Shorts.",
  "",
  "When could videos go live? Rates would be great too.",
  "",
  "Best,",
  "Jordan Lee",
  "Northpeak Media",
].join("\n");
const ALPHA_IDS = idsOf("Pixel Pioneers", "Speedrun Sam", "Retro Arcade Hour", "Northern Lights Gaming", "Anime Avenue").filter(id => ["topics", "group_mm4av3kr"].includes(rowById[id].group));
const BETA_IDS = FIX.aiList.slice();
const AVAIL_Q = { q: "When could videos go live", answer: "Availability and posting dates are confirmed with each creator as soon as they approve, and we can move quickly." };
function twoCampaignModel(call) {
  if (call.kind === "split") return { campaigns: [{ name: "Campaign Alpha", brief: "A mobile strategy game launching in November; YouTube integrations with gaming audiences in the US and UK." }, { name: "Campaign Beta", brief: "An AI writing assistant app; tech and productivity creators for YouTube integrations and Shorts." }] };
  if (call.kind === "pitch") {
    if (/This pitch is for the Campaign Beta campaign alone/.test(call.prompt)) return pitchReply(call.prompt, { ai_product: true, product: "Campaign Beta", title: "Campaign Beta", mix: "tech and reaction channels", formats: ["integration", "shorts"], questions: [AVAIL_Q], picks: BETA_IDS.map(id => ({ id, named: false, fit: 4, why: "tech audience" })) });
    if (/This pitch is for the Campaign Alpha campaign alone/.test(call.prompt)) return pitchReply(call.prompt, { product: "Campaign Alpha", title: "Campaign Alpha", mix: "gaming channels", questions: [AVAIL_Q], picks: ALPHA_IDS.map(id => ({ id, named: false, fit: 4, why: "gaming audience" })) });
  }
  return undefined;
}
function checkTwoLists(r) {
  expectOk(r);
  const urls = (r.json.lists || []).map(l => l.url);
  if (urls.length !== 2) throw new Error("expected 2 lists in the result, got " + urls.length + (r.json.notMade && r.json.notMade.length ? " (not made: " + r.json.notMade.join("; ") + ")" : "") + "; row: " + r.rowResult.slice(0, 200));
  const slugs = urls.map(u => u.split("/r/")[1]);
  if (slugs[0] === slugs[1]) throw new Error("both campaigns share one list slug " + slugs[0]);
  const top = above(r.json.text);
  for (const u of urls) { if (!top.includes(u)) throw new Error("draft text is missing list URL " + u); if (!String(r.json.html).includes(u)) throw new Error("draft html is missing list URL " + u); }
  if (urlsIn(top).length !== 2) throw new Error("draft carries " + urlsIn(top).length + " distinct list URLs, expected 2");
  const avail = top.split(/(?<=[.!?])\s+/).filter(s => /availab|posting dates/i.test(s)).length;
  if (avail > 1) throw new Error("availability sentence appears " + avail + " times");
  if (r.json.to !== BRAND) throw new Error("draft addressed to " + r.json.to);
  return urls;
}

const S = [];
const scenario = (id, title, fn) => S.push({ id, title, fn });

scenario("1", "Normal single forward", async () => {
  const r = keep("1", await runPitch({ note: "Please pitch this one, thanks!" }));
  expectOk(r);
  if (r.json.to !== BRAND) throw new Error("json.to is " + r.json.to);
  if (!r.json.listUrl || !String(r.json.html).includes(r.json.listUrl)) throw new Error("html does not contain the list URL " + r.json.listUrl);
  if (!/^Ready/.test(r.rowResult)) throw new Error("row result is '" + r.rowResult.slice(0, 160) + "'");
  const ids = savedIds(r); if (!ids.length) throw new Error("saved list is empty");
  return "to " + r.json.to + ", " + ids.length + " placements, row '" + r.rowResult.slice(0, 50) + "'";
});

scenario("2", "Pick call returns two JSON objects back to back", async () => {
  const first = idsOf("Pixel Pioneers", "Speedrun Sam", "Retro Arcade Hour").filter(id => rowById[id].group === "topics");
  const second = idsOf("Cinema Circuit", "Family Fun Lab").filter(id => rowById[id].group === "topics");
  const r = keep("2", await runPitch({ model: call => call.kind === "pitch" && call.n === 0 ? JSON.stringify(pitchReply(call.prompt, { picks: first.map(id => ({ id, named: false, fit: 4, why: "x" })) })) + "\n" + JSON.stringify(pitchReply(call.prompt, { title: "Second Object", picks: second.map(id => ({ id, named: false, fit: 5, why: "y" })) })) : undefined }));
  expectOk(r);
  const ids = savedIds(r);
  const leak = ids.filter(id => second.includes(id)); if (leak.length) throw new Error("list holds picks from the second object: " + leak.join(","));
  if (!first.every(id => ids.includes(id))) throw new Error("list is missing picks from the first object: " + ids.join(","));
  if (r.json.title === "Second Object") throw new Error("title came from the second object");
  return "used the first object (" + ids.length + " placements)";
});

const EMPTY = extra => call => call.kind === "pitch" ? pitchReply(call.prompt, Object.assign({ picks: [] }, extra || {})) : undefined;
scenario("3a", "Empty picks, no reason, retry picks", async () => {
  const r = keep("3a", await runPitch({ model: call => call.kind === "pitch" && call.n === 0 ? pitchReply(call.prompt, { picks: [] }) : undefined }));
  if (/No list made/.test(JSON.stringify(r.json)) || /No list made/.test(r.rowResult)) throw new Error("said 'No list made': " + r.rowResult.slice(0, 200));
  expectOk(r); savedIds(r);
  return "retry made a list (" + r.prompts.filter(p => p.kind === "pitch").length + " pick calls)";
});
scenario("3b", "Empty picks, no reason, on every pick call", async () => {
  const r = keep("3b", await runPitch({ model: EMPTY() }));
  if (/No list made/.test(JSON.stringify(r.json)) || /No list made/.test(r.rowResult)) throw new Error("said 'No list made' (" + r.status + "): " + String(r.json && r.json.error || r.rowResult).slice(0, 200));
  expectOk(r); savedIds(r);
  return "a fallback list was made";
});

const MASS = "It reads like mass outreach";
scenario("4a", "Empty picks with no_pitch_reason, retry picks", async () => {
  const r = keep("4a", await runPitch({ model: call => call.kind === "pitch" && call.n === 0 ? pitchReply(call.prompt, { picks: [], no_pitch_reason: MASS }) : undefined }));
  expectOk(r); savedIds(r);
  if (!/heads-up/i.test(r.rowResult)) throw new Error("list made but the row has no heads-up: '" + r.rowResult.slice(0, 200) + "'");
  return "list made, row: '" + r.rowResult.slice(0, 120) + "'";
});
scenario("4b", "Empty picks with no_pitch_reason on every pick call", async () => {
  const r = keep("4b", await runPitch({ model: EMPTY({ no_pitch_reason: MASS }) }));
  if (r.status !== 200) throw new Error("no list (" + r.status + "): " + String(r.json && r.json.error).slice(0, 200));
  expectOk(r); savedIds(r);
  if (!/heads-up/i.test(r.rowResult)) throw new Error("row has no heads-up: '" + r.rowResult.slice(0, 200) + "'");
  return "list made with heads-up";
});

scenario("5", "Two campaigns, two lists, one draft", async () => {
  const r = keep("5", await runPitch({ note: "Can you prepare 2 pitches? One for each of these please?", subject: "Creator campaigns: Campaign Alpha and Campaign Beta", text: TWO_CAMPAIGNS, model: twoCampaignModel }));
  const urls = checkTwoLists(r);
  if (r.createdLists.length !== 2) throw new Error(r.createdLists.length + " lists created, expected 2");
  return "2 lists (" + urls.map(u => u.split("/r/")[1]).join(", ") + "), availability said at most once";
});

scenario("6", "Two campaigns, an earlier Campaign Alpha list exists for the company", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const pre = { id: 8800200, name: "Campaign Alpha", slug: "campaign-alpha-tj-a1b2c3", by: "tom@digitalfoxtalent.com (pitch) " + today, body: { ids: idsOf("Pixel Pioneers").filter(id => rowById[id].group === "topics"), for: ["northpeakmedia.com"] } };
  const r = keep("6", await runPitch({ note: "Can you prepare 2 pitches? One for each of these please?", subject: "Creator campaigns: Campaign Alpha and Campaign Beta", text: TWO_CAMPAIGNS, model: twoCampaignModel, lists: [pre] }));
  checkTwoLists(r);
  const alpha = r.db.items.get(String(pre.id)), alphaBody = listBodyOf(alpha);
  const betaOnly = BETA_IDS.filter(id => !ALPHA_IDS.includes(id) && !pre.body.ids.includes(id));
  const bad = r.listWrites.filter(w => w.item === String(pre.id) && ((w.body && (w.body.ids || []).some(id => betaOnly.includes(String(id)))) || /beta/i.test(String(w.name || ""))));
  if (bad.length) throw new Error("Beta's picks were written onto the Campaign Alpha list item (" + bad.length + " writes)");
  if (/beta/i.test(alpha.name)) throw new Error("the Alpha list item was renamed to " + alpha.name);
  if ((alphaBody.ids || []).some(id => betaOnly.includes(String(id)))) throw new Error("the Alpha list now holds Beta creators");
  const betaUrl = (r.json.lists || []).find(l => /beta/i.test(l.title));
  if (betaUrl && betaUrl.url.endsWith(pre.slug)) throw new Error("the Beta list URL is the Alpha list's URL");
  return "Alpha list updated in place, Beta got its own list";
});

const FOOTER_BODY = footer => [
  "Hello,",
  "",
  "We're reaching out on behalf of Campaign Delta, a puzzle game for iOS and Android launching worldwide next month. We'd like YouTube integrations with gaming and entertainment creators.",
  "",
  "Could you share some options and rates?",
  "",
  "Thanks,",
  "Sam Rivera",
  "Northpeak Media",
].concat(footer).join("\n");
const notCanadaOnly = r => {
  expectOk(r);
  const ids = savedIds(r), locs = ids.map(id => (rowById[id.replace(/^d/, "")] || {}).location || "?");
  if (!locs.some(l => !/Canada/.test(l))) throw new Error("list holds only Canadian creators: " + ids.join(","));
  if (/canada only/i.test(r.rowResult)) throw new Error("row says it read the email as Canada only: " + r.rowResult.slice(0, 200));
  return ids.length + " placements, " + locs.filter(l => !/Canada/.test(l)).length + " outside Canada";
};
scenario("7", "Agency footer with 'only' and a Vancouver, Canada address", async () => {
  const r = keep("7", await runPitch({ from: "Sam Rivera <sam@northpeakmedia.com>", subject: "Campaign Delta creator integrations", text: FOOTER_BODY(["1055 West Georgia Street, Suite 400, Vancouver, Canada V6E 3P3", "This email is intended for the recipient specified in message only. If you have received it in error, please delete it."]),
    model: call => call.kind === "pitch" ? pitchReply(call.prompt, { product: "Campaign Delta", title: "Campaign Delta", contact_first_name: "Sam" }) : undefined }));
  return notCanadaOnly(r);
});
scenario("7b", "(extra) Footer 'recipient only' on the same line as the Canada address", async () => {
  const r = keep("7b", await runPitch({ from: "Sam Rivera <sam@northpeakmedia.com>", subject: "Campaign Delta creator integrations", text: FOOTER_BODY(["Confidential: for the named recipient only, Northpeak Media, Vancouver, Canada"]),
    model: call => call.kind === "pitch" ? pitchReply(call.prompt, { product: "Campaign Delta", title: "Campaign Delta", contact_first_name: "Sam" }) : undefined }));
  return notCanadaOnly(r);
});

scenario("8", "Note 'No rush, but please include <creator>'", async () => {
  const want = "Cinema Circuit";
  const r = keep("8", await runPitch({ note: "No rush, but please include " + want + "." }));
  expectOk(r);
  const pitch = r.prompts.find(p => p.kind === "pitch"), namedByModel = ((pitch && pitch.reply.picks) || []).filter(p => p.named).map(p => p.id);
  if (!namedByModel.length) throw new Error("harness: the stub model did not pick " + want + " from the note");
  const ids = savedIds(r), mine = idsOf(want);
  if (!ids.some(id => mine.includes(id))) throw new Error(want + " was picked (named) by the model but is not on the saved list");
  return want + " is on the list";
});

scenario("9a", "Security: sub + unknown item, text '...'", async () => {
  const r = await runPitch({ item: 999999, dbItem: null, fromEmail: "margot@digitalfoxtalent.com", rawBody: { op: "pitch", sub: { name: "x" }, item: "999999", fromEmail: "margot@digitalfoxtalent.com", text: "..." } });
  return securityCheck(r);
});
scenario("9b", "Security: sub + unknown item, with a real forward", async () => {
  const fwd = buildForward({ note: "", fromName: "Margot Grant", from: "Jordan Lee <" + BRAND + ">", to: "<theteam@digitalfoxtalent.com>", date: "Mon, Oct 19, 2026 at 9:12 AM", subject: "Creator partnership for Campaign Alpha", body: DEFAULT_BODY });
  const r = await runPitch({ item: 999999, dbItem: null, fromEmail: "margot@digitalfoxtalent.com", rawBody: { op: "pitch", sub: { name: "x" }, item: "999999", fromEmail: "margot@digitalfoxtalent.com", fromName: "Margot Grant", text: fwd.text, html: fwd.html, subject: "Fwd: Creator partnership for Campaign Alpha" } });
  return securityCheck(r);
});
scenario("9c", "Security: no sub, unknown item, real forward", async () => {
  const r = await runPitch({ item: 999999, dbItem: null, fromEmail: "margot@digitalfoxtalent.com" });
  return securityCheck(r);
});
scenario("9d", "Security: no sub, stale item (30 min old)", async () => {
  const r = await runPitch({ fromEmail: "margot@digitalfoxtalent.com", itemAgeMs: 30 * 60e3 });
  return securityCheck(r);
});
scenario("9e", "Security: no sub, item made by someone else", async () => {
  const r = await runPitch({ fromEmail: "margot@digitalfoxtalent.com", itemBy: "alex@digitalfoxtalent.com" });
  return securityCheck(r);
});
function securityCheck(r) {
  if (r.crashed) throw new Error("handler threw: " + r.crashed);
  const calls = r.prompts.length, lists = r.mutations.filter(m => m.op === "create_item" || (m.board === LISTS_BOARD && m.op === "change_multiple_column_values")).length;
  const problems = [];
  if (r.status === 200) problems.push("accepted with status 200");
  if (calls) problems.push(calls + " Anthropic calls (" + [...new Set(r.prompts.map(p => p.kind))].join(", ") + ")");
  if (lists) problems.push(lists + " list writes");
  if (problems.length) throw new Error(problems.join("; "));
  return "rejected " + r.status + ": " + String(r.json && r.json.error).slice(0, 70);
}

scenario("10", "First model network error on the pick call", async () => {
  const r = keep("10", await runPitch({ model: call => call.kind === "pitch" && call.model === PITCH_MODELS[0] ? { networkError: true } : undefined }));
  expectOk(r); savedIds(r);
  if (r.json.model === PITCH_MODELS[0]) throw new Error("result claims the failing model " + r.json.model);
  return "fell through to " + r.json.model;
});

scenario("11", "Forward with only @digitalfoxtalent.com addresses", async () => {
  const r = await runPitch({ from: "Margot Grant <margot@digitalfoxtalent.com>", to: "Tom James <tom@digitalfoxtalent.com>", subject: "Brand call about Campaign Alpha",
    text: "Hi Tom,\n\nThe brand rang this morning about Campaign Alpha, a mobile strategy game, and wants YouTube integrations in November. They did not leave an email address.\n\nMargot" });
  if (r.crashed) throw new Error("handler threw: " + r.crashed);
  if (r.status === 200) throw new Error("made a draft to " + (r.json && r.json.to));
  if (r.json && r.json.to && DFT.test(r.json.to)) throw new Error("draft addressed to a DFT address " + r.json.to);
  const err = String(r.json && r.json.error || "");
  if (!/brand email|no brand|forward the brand/i.test(err)) throw new Error("error is not clear: '" + err.slice(0, 200) + "'");
  if (r.createdLists.length) throw new Error("a list was still created");
  return "rejected " + r.status + ": " + err.slice(0, 70);
});

scenario("13", "'a better gaming experience' vs the creator Better Gaming", async () => {
  const body = "Hi there,\n\nWe make the Gripline Pro, a mobile controller that gives players a better gaming experience on phones and tablets. We'd love YouTube integrations with gaming creators this December.\n\nWhat would rates look like?\n\nCheers,\nJordan Lee\nNorthpeak Media";
  const notBG = call => call.kind === "pitch" ? pitchReply(call.prompt, { product: "Gripline Pro", title: "Gripline Pro", picks: defaultPicks(call.prompt).filter(p => !/^Better Gaming/.test((rosterLines(call.prompt).find(l => l.id === p.id) || {}).name || "")) }) : undefined;
  const r = keep("13", await runPitch({ subject: "Gripline Pro creator campaign", text: body, model: notBG }));
  expectOk(r);
  const pitch = r.prompts.find(p => p.kind === "pitch");
  const namedLine = (String(pitch && pitch.prompt).split("\n").find(l => /Named in this enquiry and on the roster:/.test(l)) || "");
  const top = above(r.json.text);
  const issues = [];
  if (/Better Gaming/.test(namedLine)) issues.push("the pitch prompt tells the model Better Gaming was named");
  if (/(reaching out to|in touch with|thinking of|interested in) Better Gaming|Better Gaming's rates|Better Gaming (is|are) on the list|find Better Gaming/i.test(top)) issues.push("the draft treats Better Gaming as named: '" + (top.match(/[^\n]*Better Gaming[^\n]*/) || [""])[0].slice(0, 120) + "'");
  if (savedIds(r).some(id => idsOf("Better Gaming").includes(id))) issues.push("Better Gaming was forced onto the list though the model did not pick it");
  if (issues.length) throw new Error(issues.join("; "));
  return "Better Gaming not treated as named";
});

scenario("14", "A run claims its request row before doing anything else", async () => {
  const r = keep("14", await runPitch({ note: "Please pitch this one." }));
  expectOk(r);
  const rowWrites = r.mutations.filter(m => m.op === "change_multiple_column_values" && m.board === PITCH_BOARD && String(m.item) === "5550001" && PB.result in m.values);
  const firstVal = rowWrites.length ? textOf(rowWrites[0].values[PB.result]) : "";
  if (!/^Working/.test(firstVal)) throw new Error("first write to the row's result was '" + firstVal.slice(0, 80) + "', not a Working claim");
  return "row claimed with '" + firstVal + "', then '" + r.rowResult.slice(0, 40) + "'";
});

scenario("15", "Note 'leave out <creator>' still removes them", async () => {
  const want = "Cinema Circuit", mine = idsOf(want).filter(id => rowById[id].group === "topics");
  const m = call => call.kind === "pitch" ? pitchReply(call.prompt, { picks: defaultPicks(call.prompt).concat(mine.map(id => ({ id, named: false, fit: 4, why: "film" }))) }) : undefined;
  const r = keep("15", await runPitch({ note: "Pitch this but leave out " + want + " please.", model: m }));
  expectOk(r);
  if (savedIds(r).some(id => idsOf(want).includes(id))) throw new Error(want + " is on the list despite 'leave out'");
  return want + " left out";
});

scenario("16", "Ordinary notes do not split into several pitches or turn into press", async () => {
  const notes = ["Need 10+ creators on the list please", "Launch is Nov 15, please pitch", "No press on this one, paid only please"];
  const out = [];
  for (const note of notes) {
    const r = keep("16 " + note.slice(0, 12), await runPitch({ note }));
    expectOk(r);
    if (r.prompts.some(p => p.kind === "split")) throw new Error("'" + note + "' triggered a campaign split");
    if (r.json.press) throw new Error("'" + note + "' made a press package");
    out.push("ok");
  }
  return notes.length + " notes stayed single, paid pitches";
});

scenario("17", "Two campaigns: a creator named for one campaign is not forced onto the other", async () => {
  const want = "Cinema Circuit";
  const body = TWO_CAMPAIGNS.replace("1. Campaign Alpha: a mobile strategy game launching in November.", "1. Campaign Alpha: a mobile strategy game launching in November. We'd love Cinema Circuit on this one.");
  const m = call => {
    if (call.kind === "split") return { campaigns: [{ name: "Campaign Alpha", brief: "A mobile strategy game launching in November; they would love Cinema Circuit; YouTube integrations." }, { name: "Campaign Beta", brief: "An AI writing assistant app; tech and productivity creators for YouTube integrations and Shorts." }] };
    return twoCampaignModel(call);
  };
  const r = keep("17", await runPitch({ note: "Can you prepare 2 pitches? One for each of these please?", text: body, model: m }));
  const urls = checkTwoLists(r);
  const betaUrl = (r.json.lists || []).find(l => /Beta/i.test(l.title));
  if (!betaUrl) throw new Error("no Beta list in the result");
  const beta = r.listOf(betaUrl.url);
  if ((beta.ids || []).map(String).some(id => idsOf(want).includes(id))) throw new Error(want + " was forced onto the Campaign Beta list");
  return want + " stayed off the Beta list";
});

scenario("12", "Draft safety on every successful scenario", async () => {
  if (!SUCCESSES.length) throw new Error("no successful scenario to check");
  const bad = [];
  for (const { name, r } of SUCCESSES) {
    const t = String(r.json.text || ""), h = String(r.json.html || ""), top = above(t), errs = [];
    if (/[\[\]]/.test(top)) errs.push("square bracket: '" + (top.match(/[^\n]*[\[\]][^\n]*/) || [""])[0].slice(0, 80) + "'");
    if (/\u2014/.test(top)) errs.push("em dash");
    if (/google\.com\/url/i.test(t + h)) errs.push("google.com/url link");
    const g = (top.match(/^Hi ([^\n]*),/) || [])[1];
    if (g == null) errs.push("no 'Hi <name>,' greeting");
    else if (!g.trim() || /^the$/i.test(g.trim())) errs.push("greeting 'Hi " + g + ",'");
    if (!top.includes("Warm regards\n" + r.fromName + "\nDigital Fox Talent")) errs.push("sign-off lines missing");
    if (r.json.to && DFT.test(r.json.to)) errs.push("addressed to " + r.json.to);
    if (errs.length) bad.push(name + ": " + errs.join(", "));
  }
  if (bad.length) throw new Error(bad.join(" | "));
  return SUCCESSES.length + " drafts checked (" + SUCCESSES.map(s => s.name).join(", ") + ")";
});

// ------------------------------------------------------------------ run
const results = [];
for (const s of S) {
  let ok = false, why = "";
  try { why = await s.fn(); ok = true; } catch (e) { why = String(e && e.message || e); if (VERBOSE) console.error(e); }
  results.push({ id: s.id, title: s.title, ok, why });
  console.log((ok ? "PASS" : "FAIL") + "  " + s.id.padEnd(3) + " " + s.title + "\n        " + (VERBOSE ? why : why.slice(0, 300)));
}
const failed = results.filter(r => !r.ok);
console.log("\n" + (results.length - failed.length) + "/" + results.length + " passed" + (failed.length ? "; failing: " + failed.map(r => r.id).join(", ") : ""));
process.exit(failed.length ? 1 : 0);
