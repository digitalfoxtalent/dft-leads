import crypto from "crypto";
export const config = { maxDuration: 120 };
// PITCH REPLY LEARNER (Tom, 19 Oct 2026: "Can you also review the emails I have sent, and try to learn from them please?").
// Each pitch@ draft is saved on its Pitch Requests row by api/roster.js pitchFromEmail:
//   Draft as written (long_text_mm89wehb) and Draft check (text_mm897m47, "sender|brand contact|ISO time").
// Each night this looks in the sender's Sent mail for the first email to that brand contact after the draft was made,
// compares it with what was written and, when the sender changed it, has Claude turn the edits into short standing
// lessons. The lessons live on the Pitch Requests item "Standing lessons for pitch replies" (13327548036), which
// polishPitch in api/roster.js applies to every new draft. The team can edit or delete lessons there.
// Draft check becomes "done:..." once checked, or "unsent:..." if nothing went out within 21 days.
// Daily 13:40 UTC. ?dry=1 shows what it would learn without writing. Calls need the Vercel cron user agent or CRON_SECRET.

const BOARD = "18435316650", LESSONS_ITEM = "13327548036", LESSONS_COL = "long_text_mm83jwpf";
const COL = { text: "long_text_mm89wehb", check: "text_mm897m47" };
const MODELS = ["claude-opus-5-5", "claude-sonnet-4-5"];
const MAX_LESSONS = 20;
const DAY = 86400000;
const DFT = /@digitalfoxtalent\.com$/i;

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

// The body the person wrote: plain text, above any quoted reply, without the greeting line's links, sign-off or signature.
function mainText(s) {
  let t = String(s || "").replace(/\r/g, "");
  t = t.split(/\n(?:On .{6,160} wrote:|-{2,} ?Forwarded message|>)/)[0];
  t = t.split(/\n\s*(?:warm regards|kind regards|best regards|best|cheers|thanks|many thanks|all the best)\s*,?\s*\n/i)[0];
  t = t.replace(/\s*<https?:\/\/[^>\s]+>/g, "").replace(/https?:\/\/\S+/g, "");
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

  // 1. Pitch drafts not checked yet.
  const d = await monday(`query{boards(ids:[${BOARD}]){items_page(limit:500,query_params:{rules:[{column_id:"${COL.check}",compare_value:[],operator:is_not_empty}]}){items{id name column_values(ids:${JSON.stringify(Object.values(COL))}){id text}}}}}`);
  const items = ((((d.data || {}).boards || [])[0] || {}).items_page || {}).items;
  if (!items) return res.status(502).json({ error: "Could not read Pitch Requests", detail: d.errors || null });
  const open = [];
  for (const it of items) {
    const c = {}; for (const v of it.column_values || []) c[v.id] = v.text || "";
    const [sender, contact, when] = String(c[COL.check]).split("|");
    if (!contact || !when || /^(done|unsent):/.test(sender)) continue;
    open.push({ id: it.id, name: it.name, sender, contact, when, written: c[COL.text] || "" });
  }

  // 2. What actually went out: the sender's first email to that contact after the draft was made.
  const tokens = {}, pairs = [], checked = [];
  for (const r of open) {
    const mark = p => setRow(r.id, { [COL.check]: p + [r.sender, r.contact, r.when].join("|") });
    try {
      const box = DFT.test(r.sender) ? r.sender.toLowerCase() : "tom@digitalfoxtalent.com";
      tokens[box] = tokens[box] || await gmailToken(box);
      const G = p => fetch("https://gmail.googleapis.com/gmail/v1/users/me" + p, { headers: { Authorization: "Bearer " + tokens[box] } }).then(x => x.ok ? x.json() : null).catch(() => null);
      const after = Math.floor((Date.parse(r.when) || 0) / 1000) - 60;
      const list = await G("/messages?maxResults=20&q=" + encodeURIComponent("in:sent to:" + r.contact + " after:" + after));
      const ids = ((list || {}).messages || []).map(m => m.id);
      if (!ids.length) {
        if (Date.now() - (Date.parse(r.when) || 0) > 21 * DAY) { checked.push({ name: r.name, result: "not sent" }); await mark("unsent:"); }
        continue;
      }
      const sent = await G("/messages/" + ids[ids.length - 1] + "?format=full"); // the list is newest first
      if (!sent) continue;
      let body = "";
      const walk = x => { if (!x || body) return; if (x.body && x.body.data && /text\/plain/.test(x.mimeType || "")) body = Buffer.from(x.body.data, "base64url").toString("utf8"); (x.parts || []).forEach(walk); };
      walk(sent.payload);
      const before = mainText(r.written), afterText = mainText(body || sent.snippet || "");
      const changed = !!afterText && !same(before, afterText);
      if (changed) pairs.push({ name: r.name, before, after: afterText });
      checked.push({ name: r.name, result: changed ? "edited" : "sent as written" });
      await mark("done:");
    } catch (e) { checked.push({ name: r.name, result: "error: " + String(e.message || e).slice(0, 120) }); }
  }
  if (!pairs.length) return res.json({ dry, open: open.length, checked, learned: [] });

  // 3. Turn the edits into standing lessons, merged with the ones already kept.
  const lq = await monday(`query{items(ids:[${LESSONS_ITEM}]){column_values(ids:["${LESSONS_COL}"]){text}}}`);
  const current = String((((((lq.data || {}).items || [])[0] || {}).column_values || [])[0] || {}).text || "").split("\n").map(x => x.replace(/^[-\s]+/, "").trim()).filter(Boolean);
  const prompt = [
    "Digital Fox Talent's pitch system drafts replies to brands that enquire about booking creators: a short email with a link to a creator list, sometimes rates and answers to the brand's questions. Below are replies as the system wrote them (BEFORE) and as the DFT team member actually sent them (AFTER), plus the standing lessons already kept.",
    "Work out what the sender consistently wants different and return the updated list of standing lessons for future replies.",
    "Rules:",
    "- A lesson is one short plain instruction a writer can follow for any brand, e.g. \"Keep the reply to three short paragraphs.\" or \"Close with 'Is that something you would like to explore?' when the brand wrote to us directly.\"",
    "- Learn only from real changes in wording, structure, length, tone, claims or what is left out. Ignore changes that only swap in this brand's or creator's own details (names, prices, numbers, links).",
    "- Where the sender rewrote a sentence, prefer a lesson that gives their exact preferred wording.",
    "- If an AFTER email is a completely different message (for example a decline or a quick question), learn nothing from it.",
    "- Keep every existing lesson unless an AFTER email clearly contradicts it; then replace it. Merge duplicates. Never invent facts, prices or promises about DFT.",
    "- No em dashes. At most " + MAX_LESSONS + " lessons, most important first.",
    'Reply with ONLY JSON: {"lessons":["..."],"new":["the lessons that are new or changed this time"]}',
    "",
    "EXISTING LESSONS:\n" + (current.length ? "- " + current.join("\n- ") : "(none)"),
    "",
    ...pairs.slice(0, 10).map((p, i) => "EMAIL " + (i + 1) + " (" + p.name + ")\nBEFORE:\n" + p.before.slice(0, 3000) + "\nAFTER:\n" + p.after.slice(0, 3000) + "\n")
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
  if (!dry) await monday("mutation($b:ID!,$i:ID!,$v:JSON!){change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id}}", { b: BOARD, i: LESSONS_ITEM, v: JSON.stringify({ [LESSONS_COL]: { text: lessons.map(x => "- " + x).join("\n") } }) });
  return res.json({ dry, open: open.length, checked, learned: out.new || [], lessons });
}
