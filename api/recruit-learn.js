import crypto from "crypto";
export const config = { maxDuration: 120 };
// RECRUIT EMAIL LEARNER (Tom, 18 Oct 2026: "Please learn from adjustments I make each time when sending the emails").
// The creator alert's Draft button (api/roster.js recruitDraft) saves the email it wrote on the Target Creators row:
//   Draft as written (long_text_mm88pfn1) and Draft thread (text_mm886vha, "sender|threadId|YYYY-MM-DD").
// Each night this opens that Gmail thread in the sender's mailbox. Once the email has gone out, it compares what was
// sent with what was written and, when the sender changed it, has Claude turn the edits into short standing lessons.
// The lessons live on the Pitch Requests item "Standing lessons for creator recruitment emails" (13320786518), which
// recruitDraft reads into every new email, so each edit carries forward. The team can edit or delete lessons there.
// Draft thread becomes "done:..." once checked, or "unsent:..." if nothing went out within 21 days.
// Daily 13:50 UTC. ?dry=1 shows what it would learn without writing. Calls need the Vercel cron user agent or CRON_SECRET.

const BOARD = "18415381478", LESSONS_ITEM = "13320786518", LESSONS_BOARD = "18435316650", LESSONS_COL = "long_text_mm83jwpf";
const COL = { text: "long_text_mm88pfn1", thread: "text_mm886vha" };
const MODELS = ["claude-opus-5-5", "claude-sonnet-4-5"];
const MAX_LESSONS = 20;
const DAY = 86400000;

async function gmailToken(subject) {
  const raw = process.env.GMAIL_DELEGATE_KEY;
  if (!raw) throw new Error("GMAIL_DELEGATE_KEY not set");
  const key = JSON.parse(raw), now = Math.floor(Date.now() / 1000);
  const b64u = o => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = b64u({ alg: "RS256", typ: "JWT" }) + "." + b64u({ iss: key.client_email, scope: "https://www.googleapis.com/auth/gmail.modify", aud: "https://oauth2.googleapis.com/token", sub: subject, iat: now, exp: now + 3000 });
  const sig = crypto.createSign("RSA-SHA256").update(unsigned).sign(key.private_key).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + unsigned + "." + sig });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error("Gmail token: " + (d.error_description || d.error || r.status));
  return d.access_token;
}

// The body the person wrote: plain text, above any quoted reply, without the sign-off and signature.
export function mainText(s) {
  let t = String(s || "").replace(/\r/g, "");
  t = t.split(/\n(?:On .{6,120} wrote:|-{2,} ?Forwarded message|>)/)[0];
  t = t.split(/\n\s*(?:warm regards|kind regards|best regards|best|cheers|thanks|many thanks|all the best)\s*,?\s*\n/i)[0];
  // Link targets are not wording: Gmail shows a link as "here <https://...>", the draft as "here (https://...)".
  t = t.replace(/\s*[<(]https?:\/\/[^\s>)]+[>)]/g, "");
  return t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
const same = (a, b) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

export default async function handler(req, res) {
  const MK = process.env.MONDAY_API_KEY, ANT = process.env.ANTHROPIC_API_KEY;
  if (!MK || !ANT) return res.status(500).json({ error: "Missing env vars" });
  const secret = process.env.CRON_SECRET;
  const ok = /vercel-cron/i.test(String(req.headers["user-agent"] || "")) || (secret && (String(req.headers.authorization || "") === "Bearer " + secret || req.query.key === secret));
  if (!ok) return res.status(401).json({ error: "Not allowed" });
  const dry = req.query.dry === "1";
  const monday = async (query, variables) => (await fetch("https://api.monday.com/v2", { method: "POST", headers: { "Content-Type": "application/json", Authorization: MK }, body: JSON.stringify({ query, variables: variables || {} }) })).json();
  const setRow = (id, v) => dry ? null : monday("mutation($b:ID!,$i:ID!,$v:JSON!){change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id}}", { b: BOARD, i: String(id), v: JSON.stringify(v) });

  // 1. Rows whose draft has not been checked yet.
  const d = await monday(`query{boards(ids:[${BOARD}]){items_page(limit:500,query_params:{rules:[{column_id:"${COL.thread}",compare_value:[],operator:is_not_empty}]}){items{id name column_values(ids:${JSON.stringify(Object.values(COL))}){id text}}}}}`);
  const items = ((((d.data || {}).boards || [])[0] || {}).items_page || {}).items;
  if (!items) return res.status(502).json({ error: "Could not read Target Creators", detail: d.errors || null });
  const open = [];
  for (const it of items) {
    const c = {}; for (const v of it.column_values || []) c[v.id] = v.text || "";
    const [sender, thread, date] = String(c[COL.thread]).split("|");
    if (!thread || /^(done|unsent):/.test(sender)) continue;
    open.push({ id: it.id, name: it.name, sender, thread, date, written: c[COL.text] || "" });
  }

  // 2. What actually went out.
  const tokens = {}, pairs = [], checked = [];
  for (const r of open) {
    try {
      tokens[r.sender] = tokens[r.sender] || await gmailToken(r.sender);
      const t = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/threads/" + r.thread + "?format=full", { headers: { Authorization: "Bearer " + tokens[r.sender] } }).then(x => x.ok ? x.json() : null).catch(() => null);
      const sent = ((t || {}).messages || []).find(m => (m.labelIds || []).includes("SENT") && !(m.labelIds || []).includes("DRAFT"));
      if (!sent) {
        const old = r.date && Date.now() - Date.parse(r.date + "T12:00:00Z") > 21 * DAY;
        if (!t || old) { checked.push({ name: r.name, result: "not sent" }); await setRow(r.id, { [COL.thread]: "unsent:" + [r.sender, r.thread, r.date].join("|") }); }
        continue;
      }
      let body = "";
      const walk = x => { if (!x || body) return; if (x.body && x.body.data && /text\/plain/.test(x.mimeType || "")) body = Buffer.from(x.body.data, "base64url").toString("utf8"); (x.parts || []).forEach(walk); };
      walk(sent.payload);
      const before = mainText(r.written), after = mainText(body || sent.snippet || "");
      const changed = !!after && !same(before, after);
      if (changed) pairs.push({ name: r.name, before, after });
      checked.push({ name: r.name, result: changed ? "edited" : "sent as written" });
      await setRow(r.id, { [COL.thread]: "done:" + [r.sender, r.thread, r.date].join("|") });
    } catch (e) { checked.push({ name: r.name, result: "error: " + String(e.message || e).slice(0, 120) }); }
  }
  if (!pairs.length) return res.json({ dry, open: open.length, checked, learned: [] });

  // 3. Turn the edits into standing lessons, merged with the ones already kept.
  const lq = await monday(`query{items(ids:[${LESSONS_ITEM}]){column_values(ids:["${LESSONS_COL}"]){text}}}`);
  const current = String((((((lq.data || {}).items || [])[0] || {}).column_values || [])[0] || {}).text || "").split("\n").map(x => x.replace(/^[-\s]+/, "").trim()).filter(Boolean);
  const prompt = [
    "Digital Fox Talent's Draft button writes first-contact emails recruiting YouTube creators to the agency. Below are emails as the button wrote them (BEFORE) and as the DFT team member actually sent them (AFTER), plus the standing lessons already kept.",
    "Work out what the sender consistently wants different and return the updated list of standing lessons for future emails.",
    "Rules:",
    "- A lesson is one short plain instruction a writer can follow for any creator, e.g. \"Keep the email to three short paragraphs.\" or \"Say 'we would love to chat' rather than asking for a call this week.\"",
    "- Learn only from real changes in wording, structure, length, tone, claims or what is left out. Ignore changes that only swap in this creator's own details (their name, channel, numbers).",
    "- Where the sender rewrote a sentence, prefer a lesson that gives their exact preferred wording.",
    "- Keep every existing lesson unless an AFTER email clearly contradicts it; then replace it. Merge duplicates. Never invent facts about DFT.",
    "- No em dashes. At most " + MAX_LESSONS + " lessons, most important first.",
    'Reply with ONLY JSON: {"lessons":["..."],"new":["the lessons that are new or changed this time"]}',
    "",
    "EXISTING LESSONS:\n" + (current.length ? "- " + current.join("\n- ") : "(none)"),
    "",
    ...pairs.slice(0, 10).map((p, i) => "EMAIL " + (i + 1) + " (" + p.name + ")\nBEFORE:\n" + p.before + "\nAFTER:\n" + p.after + "\n")
  ].join("\n");
  let out = null; const errors = [];
  for (const model of MODELS) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": ANT, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model, max_tokens: 2000, messages: [{ role: "user", content: prompt }] }) });
      const j = await r.json();
      if (!r.ok || !j.content) { errors.push(model + ": " + ((j.error || {}).message || r.status)); continue; }
      const txt = j.content.filter(x => x.type === "text").map(x => x.text).join("\n");
      const m = txt.match(/\{[\s\S]*\}/); out = m ? JSON.parse(m[0]) : null;
      if (out && Array.isArray(out.lessons) && out.lessons.length) break;
      out = null;
    } catch (e) { errors.push(model + ": " + e.message); }
  }
  if (!out) return res.status(502).json({ dry, checked, error: "Could not work out lessons", errors });
  const lessons = out.lessons.map(x => String(x).replace(/[—–]/g, ",").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, MAX_LESSONS);
  if (!dry) await monday("mutation($b:ID!,$i:ID!,$v:JSON!){change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id}}", { b: LESSONS_BOARD, i: LESSONS_ITEM, v: JSON.stringify({ [LESSONS_COL]: { text: lessons.map(x => "- " + x).join("\n") } }) });
  return res.json({ dry, open: open.length, checked, learned: out.new || [], lessons });
}
