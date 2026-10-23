import crypto from "crypto";
export const config = { maxDuration: 300 };
// ENQUIRY ROUTER, reply drafts (Tom, 22 Oct 2026: "warm leads in their laps"). Vercel cron, every 2 minutes.
// When api/route-enquiry.js delivers a brand's email into a salesperson's inbox it marks the Brand Enquiries row
// (18430423439) "Reply draft: pending". This picks up ONE pending row per run and asks the pitch system
// (api/roster.js op "pitch", the same one behind forwarding to pitch@) to build a creator shortlist and save a reply
// draft IN THE BRAND'S THREAD in that salesperson's own Gmail (search: rfc822msgid of the brand's email, so the draft
// joins the routed copy). Nothing is sent: the salesperson reviews the draft and presses Send.
// Pitches take up to about 4 minutes, hence a separate function with a 300 second limit.
// GET with the Vercel cron user agent or CRON_SECRET. ?dry=1 shows the next pending row without doing anything.

const BOARD = "18430423439";
const PITCH_BOARD = "18435316650";
const C = { owner: "multiple_person_mm712vbw", ids: "text_mm8d131d", draft: "text_mm8d6pzp", decision: "color_mm8d23ft", message: "long_text_mm71nh8r", email: "email_mm71btg0", routedAt: "date_mm8d4cqy" };
const OWNERS = { 100099218: ["margot@digitalfoxtalent.com", "Margot Grant"], 104886769: ["george@digitalfoxtalent.com", "George Roush"], 119590675: ["hani@digitalfoxtalent.com", "Han Yi"], 54957240: ["alex@digitalfoxtalent.com", "Alex Mackenzie"] };

async function monday(query, variables) {
  const r = await fetch("https://api.monday.com/v2", { method: "POST", headers: { "Content-Type": "application/json", Authorization: process.env.MONDAY_API_KEY, "API-Version": "2024-10" }, body: JSON.stringify({ query, variables: variables || {} }) });
  const j = await r.json().catch(() => ({}));
  if (j.errors && j.errors.length) throw new Error("monday: " + JSON.stringify(j.errors).slice(0, 300));
  return j.data || {};
}
async function gmailToken(subject) {
  const key = JSON.parse(process.env.GMAIL_DELEGATE_KEY), now = Math.floor(Date.now() / 1000);
  const b64u = o => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = b64u({ alg: "RS256", typ: "JWT" }) + "." + b64u({ iss: key.client_email, scope: "https://www.googleapis.com/auth/gmail.modify", aud: "https://oauth2.googleapis.com/token", sub: subject, iat: now, exp: now + 3000 });
  const sig = crypto.createSign("RSA-SHA256").update(unsigned).sign(key.private_key).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + unsigned + "." + sig });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error("Gmail token: " + (d.error_description || d.error || r.status));
  return d.access_token;
}
// DEMO (Tom, 23 Oct 2026: "run one more test right now so I can see what the sales lead will receive"). Put
// "[demo: <Brand Enquiries row id>]" in the name of the mode item (13365313505). The next run removes the tag first (so it
// runs once), then puts that row's brand email into TOM's inbox exactly as a salesperson gets it (byte for byte, unread,
// from the brand) under a fresh Message-ID so it does not merge with his original, and builds the reply draft in it.
const MODE_ITEM = "13365313505";
async function rawMessage(tok, id) {
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/" + id + "?format=raw", { headers: { Authorization: "Bearer " + tok } });
  const m = await r.json(); if (!r.ok) throw new Error("Gmail " + r.status);
  const s = Buffer.from(String(m.raw || ""), "base64url").toString("latin1");
  let i = s.indexOf("\r\n\r\n"), sep = "\r\n"; if (i < 0) { i = s.indexOf("\n\n"); sep = "\n"; }
  return { lines: (i < 0 ? s : s.slice(0, i)).split(/\r?\n(?=[^ \t])/), body: i < 0 ? "" : s.slice(i), sep };
}
async function demo(rowId) {
  const d = await monday(`query { items(ids:[${Number(rowId)}]) { column_values(ids:["${C.ids}"]) { text } } }`);
  const tomMsg = String((((((d.items || [])[0] || {}).column_values) || [])[0] || {}).text || "").split("|")[0];
  if (!tomMsg) throw new Error("demo: row has no Gmail id");
  const tom = "tom@digitalfoxtalent.com", tok = await gmailToken(tom);
  const { lines, body, sep } = await rawMessage(tok, tomMsg);
  const mid = "dft-demo-" + crypto.randomBytes(6).toString("hex") + "@digitalfoxtalent.com";
  const head = ["X-DFT-Routed: enquiry router demo for Tom"].concat(lines.filter(l => !/^(message-id|references|in-reply-to):/i.test(l)), ["Message-ID: <" + mid + ">"]);
  const boundary = "dftdemo" + crypto.randomBytes(8).toString("hex");
  const multipart = Buffer.concat([
    Buffer.from("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify({ labelIds: ["INBOX", "UNREAD"] }) + "\r\n--" + boundary + "\r\nContent-Type: message/rfc822\r\n\r\n", "utf8"),
    Buffer.from(head.join(sep) + body, "latin1"), Buffer.from("\r\n--" + boundary + "--", "utf8")]);
  const ir = await fetch("https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/import?uploadType=multipart&internalDateSource=receivedTime&neverMarkSpam=true", { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "multipart/related; boundary=" + boundary }, body: multipart });
  const out = await ir.json().catch(() => ({}));
  if (!ir.ok || !out.id) throw new Error("demo import " + ir.status);
  return { owner: [tom, "Tom James"], mid, hit: { id: out.id, threadId: out.threadId } };
}

const setCols = (id, vals) => monday("mutation($b:ID!,$i:ID!,$v:JSON!){change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id}}", { b: BOARD, i: String(id), v: JSON.stringify(vals) });

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const ok = /vercel-cron/i.test(String(req.headers["user-agent"] || "")) || (secret && (String(req.headers.authorization || "") === "Bearer " + secret || req.query.key === secret));
  if (!ok) return res.status(401).json({ error: "Not allowed" });
  const dry = req.query.dry === "1";
  let rowId = "";
  try {
    const mi = await monday(`query { items(ids:[${MODE_ITEM}]) { name } }`);
    const modeName = String((((mi.items) || [])[0] || {}).name || ""), dm = modeName.match(/\s*\[demo:\s*(\d+)\]/i);
    let demoRun = null;
    if (dm && !dry) {
      await monday("mutation($b:ID!,$i:ID!,$v:String!){change_simple_column_value(board_id:$b,item_id:$i,column_id:\"name\",value:$v){id}}", { b: "18422548864", i: MODE_ITEM, v: modeName.replace(dm[0], "") });
      demoRun = await demo(dm[1]);
    }
    const d = await monday(`query { boards(ids:[${BOARD}]) { items_page(limit:100, query_params:{rules:[{column_id:"${C.draft}", compare_value:["pending","working"], operator:contains_text}]}) { items { id name column_values(ids:${JSON.stringify(Object.values(C))}) { id text value } } } } }`);
    const items = ((((d.boards || [])[0] || {}).items_page || {}).items) || [];
    // A claim older than 10 minutes was cut off (time limit or error) and is tried again.
    const state = it => (it.column_values.find(c => c.id === C.draft) || {}).text || "";
    const row = demoRun ? { id: "demo", name: "demo", column_values: [] } : items.find(it => state(it) === "pending" || (/^working /.test(state(it)) && Date.now() - Date.parse(state(it).slice(8)) > 600000));
    if (!row) return res.status(200).json({ ok: true, pending: 0 });
    const cv = {}; let ownerId = "";
    for (const c of row.column_values) { cv[c.id] = c.text || ""; if (c.id === C.owner) { try { ownerId = String(((JSON.parse(c.value || "{}").personsAndTeams) || [])[0].id); } catch (e) {} } }
    const owner = demoRun ? demoRun.owner : OWNERS[ownerId];
    const mid = demoRun ? demoRun.mid : String(cv[C.ids] || "").split("|")[1];
    if (dry) return res.status(200).json({ ok: true, next: row.id, name: row.name, owner, mid });
    const save = async vals => { if (!demoRun) await setCols(row.id, vals); };
    if (!demoRun) {
      if (!owner || !mid || cv[C.decision] !== "Routed") { await save({ [C.draft]: "failed: no owner or no message id" }); return res.status(200).json({ ok: false, row: row.id }); }
      await save({ [C.draft]: "working " + new Date().toISOString() }); // claimed, so an overlapping run skips it
      rowId = row.id;
    }
    // The brand's email as the salesperson has it, laid out like a forward so the pitch system can read it.
    const tok = await gmailToken(owner[0]);
    const G = p => fetch("https://gmail.googleapis.com/gmail/v1/users/me" + p, { headers: { Authorization: "Bearer " + tok } }).then(r => r.json());
    const hit = demoRun ? demoRun.hit : ((await G("/messages?maxResults=1&q=" + encodeURIComponent("rfc822msgid:" + mid))).messages || [])[0];
    if (!hit) { await save({ [C.draft]: "failed: the brand's email is not in " + owner[1].split(" ")[0] + "'s inbox" }); return res.status(200).json({ ok: false }); }
    // Never touch a thread the salesperson is already working on: the pitch system replaces drafts in the thread.
    const th = await G("/threads/" + hit.threadId + "?format=minimal");
    if ((th.messages || []).some(x => (x.labelIds || []).some(l => l === "SENT" || l === "DRAFT"))) { await save({ [C.draft]: "skipped: " + owner[1].split(" ")[0] + " is already replying" }); return res.status(200).json({ ok: true, skipped: row.id }); }
    const m = await G("/messages/" + hit.id + "?format=full");
    const h = n => (((m.payload || {}).headers || []).find(x => x.name.toLowerCase() === n) || {}).value || "";
    const part = (p, type) => { if (!p) return ""; if (p.mimeType === type && p.body && p.body.data) return Buffer.from(p.body.data, "base64url").toString("utf8"); for (const c of p.parts || []) { const r = part(c, type); if (r) return r; } return ""; };
    let text = part(m.payload, "text/plain");
    if (!text) text = part(m.payload, "text/html").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
    const from = cv[C.email] && !/@digitalfoxtalent\.com$/i.test(cv[C.email]) ? (h("from").replace(/<[^>]*>/, "").replace(/"/g, "").replace(/\s+via\s+.*$/i, "").trim() + " <" + cv[C.email] + ">") : h("from");
    const fwd = "---------- Forwarded message ---------\nFrom: " + from + "\nDate: " + h("date") + "\nSubject: " + h("subject") + "\nTo: " + h("to") + (h("cc") ? "\nCc: " + h("cc") : "") + "\n\n" + text;
    // The pitch system checks a Pitch Requests row made in the last 15 minutes by the same person.
    const pr = await monday("mutation($b:ID!,$n:String!,$v:JSON!){create_item(board_id:$b,item_name:$n,column_values:$v){id}}", { b: PITCH_BOARD, n: "Routed " + new Date().toISOString().slice(5, 16).replace("T", " "), v: JSON.stringify({ text_mm83t28h: owner[0] }) });
    const item = ((pr || {}).create_item || {}).id;
    const r = await fetch("https://roster-viewguarantee.digitalfoxtalent.com/api/roster", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "pitch", item, fromEmail: owner[0], fromName: owner[1], subject: h("subject"), text: fwd, html: "", sentTo: h("to"), thread: "", search: "rfc822msgid:" + mid }) });
    const out = await r.json().catch(() => ({}));
    const verdict = !r.ok ? "failed: " + String(out.error || r.status).slice(0, 200)
      : out.draftMade === true ? "ready: " + (out.listUrl || "")
      : out.listsOnly ? "lists only: " + (out.listUrl || "")
      : "list made, no draft (" + String(out.draftMade || "not made").slice(0, 120) + "): " + (out.listUrl || "");
    await save({ [C.draft]: verdict.slice(0, 250) });
    return res.status(200).json({ ok: r.ok, row: row.id, verdict });
  } catch (e) {
    if (rowId) await setCols(rowId, { [C.draft]: ("failed: " + String(e && e.message || e)).slice(0, 250) }).catch(() => null);
    return res.status(502).json({ error: String(e && e.message || e) });
  }
}
