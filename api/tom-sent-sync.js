import crypto from "crypto";
export const config = { maxDuration: 120 };
// TOM SENT-MAIL SYNC (Tom, 17 Oct 2026: "set up mine the same as George's"). George's daily list picks up the studio
// emails he sends from george@ and logs them on his board. This does the same for Tom's Games, TV & Tech release board
// (18435939296): it reads tom@'s sent mail, matches each external email to a release row, and writes
//   Tom Last Emailed (date_mm88ncxq) and Tom Email (link_mm88t2fs), and sets Outreach Status to Contacted when it was
//   still Not started, so the title drops off Tom's 4pm alerts and his morning list.
// A match needs the release's title in the subject or body AND a recipient who is one of the row's contacts or at the
// row's company domain; or a recipient who is a named contact on that row only. Domain alone never matches, because one
// studio (Netflix, Sony) sits on many rows. Daily at 13:20 UTC, before the 7:45am Denver list. ?days=30 to backfill,
// ?dry=1 to preview. Calls need the Vercel cron user agent or CRON_SECRET.
// 20 Oct 2026: also reads the Game, Series and Tech rows still on George's Studio board (18415007170) - Tom's
// categories since the 17 Oct split - so an email Tom sends about one of them (Zelda to Golin, MacBook Pro and iMac to
// Apple) stops its alert. Film rows stay George's alone.
// 20 Oct 2026, creators: also marks Target Creators rows (18415381478) Tom has emailed, the same way the alert's "I've
// emailed them" button does - Outreach Status Done plus Outreach Sent (the date it went, Denver) - so the 1:30pm creator
// alert skips them and the board's own automation moves them to Creators Approached. Matched on the row's exact email
// address only, and only rows with Outreach Status still blank. Volrusk was emailed at 11:35am and alerted at 4pm, so
// this also runs at 1:10pm Denver on weekdays (?run=midday), 20 minutes before the creator alerts. That board has no Tom Last Emailed columns, so
// there it flips Not started to Contacted and posts a note on the row with the email link (once, since the flip
// removes it from the next run).

const BOARD = "18435939296", STUDIO_BOARD = "18415007170", TOM = "tom@digitalfoxtalent.com";
const TOM_TYPES = new Set(["Game", "Series", "Tech"]);
const CREATOR_BOARD = "18415381478", CCOL = { email: "email_mm3t61sv", status: "color_mm3tzck8", sent: "date_mm7g7kp9" };
const denverDate = ms => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Denver" });

// Creator rows Tom has emailed: rows is [{id, name, email}] with Outreach Status blank; sentTo maps each external
// address Tom wrote to {at, thread} for his latest email to it. Exact address match only.
export function matchCreators(rows, sentTo) {
  const out = [];
  for (const r of rows) {
    const e = String(r.email || "").trim().toLowerCase();
    if (e && sentTo[e]) out.push({ id: r.id, name: r.name, email: e, at: sentTo[e].at, thread: sentTo[e].thread });
  }
  return out;
}
const COL = { status: "color_mm5bmek5", domain: "text_mm5baenw", email: "email_mm5bfw35", alt: "long_text_mm5dn2fx", verified: "long_text_mm7v8xhz", backup: "long_text_mm7vjxdy", last: "date_mm88ncxq", link: "link_mm88t2fs", type: "color_mm5bqrxh" };
const FREE = /^(gmail|googlemail|icloud|me|mac|yahoo|ymail|hotmail|outlook|live|msn|aol|proton|protonmail|pm|gmx|mail|zoho|yandex|hey|fastmail)\./i;
const EMAIL_RE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const norm = s => " " + String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim() + " ";
const baseDomain = d => String(d || "").toLowerCase().replace(/^www\./, "").split(".").slice(-2).join(".");

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

// Title phrases that count as "mentions this release": the full name, and the main title before a subtitle
// ("Metro 2039: X" -> "metro 2039"), each at least 6 characters so short words never match on their own.
export function titlePhrases(name) {
  const full = norm(name).trim();
  const main = norm(String(name).split(/\s+[-–—:]\s+|:|\(/)[0]).trim();
  const noSeason = main.replace(/ (season|series|part|vol|volume) \d+$/, "").trim(); // "percy jackson and the olympians"
  return [...new Set([full, main, noSeason])].filter(p => p.length >= 6);
}
export function matchRows(msg, rows) {
  const text = norm(msg.subject + " " + msg.body);
  const out = [];
  for (const r of rows) {
    const named = msg.to.filter(a => r.emails.has(a));
    const atCompany = msg.to.filter(a => r.domains.has(baseDomain(a.split("@")[1])));
    const mentions = r.phrases.some(p => text.includes(" " + p + " "));
    if (mentions && (named.length || atCompany.length)) out.push(r);
    else if (named.length && named.some(a => (rows.contactCount[a] || 0) === 1)) out.push(r);
  }
  return out;
}

export function rowFrom(it, c, board, rows) {
  const found = [c[COL.email], c[COL.alt], c[COL.verified], c[COL.backup]].join(" ").match(EMAIL_RE) || [];
  const em = new Set(found.map(e => e.toLowerCase().replace(/[.,]+$/, "")));
  const domains = new Set();
  if (c[COL.domain]) domains.add(baseDomain(c[COL.domain].replace(/^https?:\/\//, "").split("/")[0]));
  for (const e of em) { const dm = e.split("@")[1]; if (dm && !FREE.test(dm)) domains.add(baseDomain(dm)); }
  for (const e of em) rows.contactCount[e] = (rows.contactCount[e] || 0) + 1;
  return { id: it.id, board, name: it.name, status: c[COL.status], last: c[COL.last], emails: em, domains, phrases: titlePhrases(it.name) };
}

export default async function handler(req, res) {
  const MK = process.env.MONDAY_API_KEY;
  if (!MK) return res.status(500).json({ error: "Missing env vars" });
  const secret = process.env.CRON_SECRET;
  const ok = /vercel-cron/i.test(String(req.headers["user-agent"] || "")) || (secret && (String(req.headers.authorization || "") === "Bearer " + secret || req.query.key === secret));
  if (!ok) return res.status(401).json({ error: "Not allowed" });
  const dry = req.query.dry === "1";
  const days = Math.min(60, Math.max(1, +req.query.days || 3));
  const monday = async (query, variables) => (await fetch("https://api.monday.com/v2", { method: "POST", headers: { "Content-Type": "application/json", Authorization: MK }, body: JSON.stringify({ query, variables: variables || {} }) })).json();

  // 1. Release rows and everything that identifies who works on each one: Tom's board, plus Game/Series/Tech rows on George's.
  const rows = []; rows.contactCount = {};
  for (const board of [BOARD, STUDIO_BOARD]) {
    const d = await monday(`query { boards(ids:[${board}]) { groups(ids:["topics"]) { items_page(limit:500) { items { id name column_values(ids:${JSON.stringify(Object.values(COL))}) { id text } } } } } }`);
    const items = (((((d.data || {}).boards || [])[0] || {}).groups || [])[0] || {}).items_page;
    if (!items) return res.status(502).json({ error: "Could not read board " + board, detail: d.errors || null });
    for (const it of items.items || []) {
      const c = {}; for (const v of it.column_values || []) c[v.id] = v.text || "";
      if (board === STUDIO_BOARD && !TOM_TYPES.has(c[COL.type])) continue;
      rows.push(rowFrom(it, c, board, rows));
    }
  }

  // 2. tom@'s sent mail to anyone outside DFT.
  const tok = await gmailToken(TOM);
  const G = path => fetch("https://gmail.googleapis.com/gmail/v1/users/me" + path, { headers: { Authorization: "Bearer " + tok } }).then(r => r.ok ? r.json() : {}).catch(() => ({}));
  let ids = [], pt = "";
  do { const r = await G("/messages?maxResults=100&q=" + encodeURIComponent("in:sent newer_than:" + days + "d") + (pt ? "&pageToken=" + pt : "")); ids = ids.concat(r.messages || []); pt = r.nextPageToken || ""; } while (pt && ids.length < 600);
  const hd = (m, n) => (((m.payload || {}).headers || []).find(h => h.name.toLowerCase() === n) || {}).value || "";
  const bodyText = pl => { let out = ""; const walk = x => { if (!x || out.length > 20000) return; if (x.body && x.body.data && /text\/plain/.test(x.mimeType || "")) out += Buffer.from(x.body.data, "base64url").toString("utf8"); (x.parts || []).forEach(walk); }; walk(pl); return out.split(/\nOn .{10,80} wrote:/)[0]; };
  const hits = {}, sentTo = {}; let scanned = 0;
  for (let i = 0; i < ids.length; i += 10) {
    const full = await Promise.all(ids.slice(i, i + 10).map(m => G("/messages/" + m.id + "?format=full")));
    for (const m of full) {
      if (!m || !m.payload) continue;
      const to = [...new Set(((hd(m, "to") + "," + hd(m, "cc")).match(EMAIL_RE) || []).map(a => a.toLowerCase()))].filter(a => !/@digitalfoxtalent\.com$/.test(a));
      if (!to.length) continue;
      scanned++;
      const msg = { to, subject: hd(m, "subject"), body: bodyText(m.payload) || m.snippet || "" };
      const at = new Date(+m.internalDate || 0).toISOString().slice(0, 10);
      const local = denverDate(+m.internalDate || 0);
      for (const a of to) if (!sentTo[a] || sentTo[a].at < local) sentTo[a] = { at: local, thread: m.threadId };
      for (const r of matchRows(msg, rows)) {
        if (!hits[r.id] || hits[r.id].at < at) hits[r.id] = { at, thread: m.threadId, subject: msg.subject.slice(0, 120), to: to.join(", ") };
      }
    }
  }

  // 3. Write newer dates; flip Not started to Contacted. On George's board (no Tom columns) only the flip, plus a note.
  const written = [];
  for (const r of rows) {
    const h = hits[r.id]; if (!h) continue;
    const url = "https://mail.google.com/mail/u/" + TOM + "/#all/" + h.thread;
    if (r.board === STUDIO_BOARD) {
      if (r.status && r.status !== "Not started") continue;
      written.push({ title: r.name, board: "studio", date: h.at, to: h.to, subject: h.subject, contacted: true });
      if (dry) continue;
      await monday("mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id: $b, item_id: $i, column_values: $v) { id } }", { b: STUDIO_BOARD, i: r.id, v: JSON.stringify({ [COL.status]: { label: "Contacted" } }) });
      const esc = x => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;");
      await monday("mutation ($i: ID!, $t: String!) { create_update(item_id: $i, body: $t) { id } }", { i: r.id, t: "<p>Tom emailed " + esc(h.to) + " about this title on " + h.at + ", so it is marked Contacted. <a href=\"" + url + "\">" + esc(h.subject || "Tom's email") + "</a></p>" });
      continue;
    }
    if (r.last && r.last >= h.at) continue;
    const cols = {};
    cols[COL.last] = { date: h.at };
    cols[COL.link] = { url, text: h.subject || "Tom's email" };
    if (!r.status || r.status === "Not started") cols[COL.status] = { label: "Contacted" };
    written.push({ title: r.name, date: h.at, to: h.to, subject: h.subject, contacted: !!cols[COL.status] });
    if (!dry) await monday("mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id: $b, item_id: $i, column_values: $v) { id } }", { b: BOARD, i: r.id, v: JSON.stringify(cols) });
  }
  // 4. Target Creators rows Tom has emailed, still with a blank Outreach Status.
  const cd = await monday(`query { boards(ids:[${CREATOR_BOARD}]) { items_page(limit:500, query_params:{rules:[{column_id:"${CCOL.status}", compare_value:[], operator:is_empty}]}) { items { id name column_values(ids:["${CCOL.email}"]) { text } } } } }`);
  const cItems = ((((cd.data || {}).boards || [])[0] || {}).items_page || {}).items;
  const creators = [];
  if (cItems) {
    const cRows = cItems.map(it => ({ id: it.id, name: it.name, email: ((it.column_values || [])[0] || {}).text || "" }));
    for (const c of matchCreators(cRows, sentTo)) {
      creators.push({ name: c.name, email: c.email, date: c.at });
      if (!dry) await monday("mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id: $b, item_id: $i, column_values: $v) { id } }", { b: CREATOR_BOARD, i: c.id, v: JSON.stringify({ [CCOL.status]: { label: "Done" }, [CCOL.sent]: { date: c.at } }) });
    }
  }
  return res.json({ dry, days, rows: rows.length, sentScanned: scanned, written, creators, creatorBoardRead: !!cItems });
}
