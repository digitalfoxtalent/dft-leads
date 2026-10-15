// Alert for sign-up checks under the bar.
//
// WHY (Tom, 15 Oct 2026): "Can we just be pinged a notification at the time who applied but
// was rejected?" dft-connect's /api/signup-check answers "not yet" to channels under the bar
// and revokes our access. Before it answers, it posts the channel id and its average here;
// we look up the public channel name and handle and email Tom (creator alerts are Tom only,
// 6 Oct 2026) from theteam@. Nothing is written anywhere else, and the sent copy in
// theteam@ is trashed straight away. The not-yet page still says "We haven't kept any of
// your details": Tom deletes each alert on receipt (15 Oct 2026), so nothing is kept.
//
// AUTH. dft-connect has no monday token, so the call is signed with Channel Connect's
// STATS_SECRET (purpose "underbar"), the same secret kit-sync reads from the API Keys
// board. Only dft-connect can produce a valid signature, so nobody else can trigger an alert.
import crypto from "node:crypto";
import { monday, mondayToken } from "./_reports/monday.js";

const ALERT_FROM = "theteam@digitalfoxtalent.com";
const ALERT_TO = "tom@digitalfoxtalent.com";

// Same delegated Gmail service account roster.js uses for its internal alerts.
async function gmailToken(subject) {
  const raw = process.env.GMAIL_DELEGATE_KEY;
  if (!raw) throw new Error("GMAIL_DELEGATE_KEY not set");
  const key = JSON.parse(raw), now = Math.floor(Date.now() / 1000);
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = b64u({ alg: "RS256", typ: "JWT" }) + "." + b64u({ iss: key.client_email, scope: "https://www.googleapis.com/auth/gmail.modify", aud: "https://oauth2.googleapis.com/token", sub: subject, iat: now, exp: now + 3000 });
  const sig = crypto.createSign("RSA-SHA256").update(unsigned).sign(key.private_key).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + unsigned + "." + sig });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error("Gmail token: " + (d.error_description || d.error || r.status));
  return d.access_token;
}

async function sendAlert(subject, html) {
  const tok = await gmailToken(ALERT_FROM);
  const enc = (x) => "=?UTF-8?B?" + Buffer.from(x).toString("base64") + "?=";
  const mime = ["From: Digital Fox Talent <" + ALERT_FROM + ">", "To: " + ALERT_TO, "Subject: " + enc(subject), "MIME-Version: 1.0", "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", Buffer.from(html).toString("base64")].join("\r\n");
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify({ raw: Buffer.from(mime).toString("base64url") }) });
  if (!r.ok) throw new Error("Gmail send " + r.status);
  // Don't leave a copy in theteam@'s Sent folder.
  const sent = await r.json().catch(() => ({}));
  if (sent.id) await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${sent.id}/trash`, { method: "POST", headers: { Authorization: "Bearer " + tok } }).catch(() => {});
}

const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export const config = { maxDuration: 30 };

const KEY_ITEM = 13197661446; // API Keys: "Channel Connect STATS_SECRET (dft-connect Vercel)"
const KEY_COL = "text_mm5bcxe7";
const CHANNEL_RE = /^UC[A-Za-z0-9_-]{22}$/;

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch (e) { return {}; }
}

async function channelInfo(channel) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return {};
  const r = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channel}&key=${key}`);
  if (!r.ok) return {};
  const d = await r.json();
  const it = d.items && d.items[0];
  if (!it) return {};
  return { title: it.snippet.title, handle: it.snippet.customUrl || "", subs: it.statistics.hiddenSubscriberCount ? null : +it.statistics.subscriberCount };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const tok = mondayToken(); // only to read the shared secret off the API Keys board
  if (!tok) return res.status(500).json({ error: "MONDAY_API_KEY not set" });

  const body = readBody(req);
  const channel = String(body.channel || "");
  const t = String(body.t || "");
  if (!CHANNEL_RE.test(channel)) return res.status(400).json({ error: "bad channel" });

  try {
    const d = await monday(tok, `query { items(ids:[${KEY_ITEM}]) { column_values(ids:["${KEY_COL}"]) { text } } }`);
    const secret = String((d.items[0] && d.items[0].column_values[0].text) || "").trim();
    if (secret.length < 20) return res.status(500).json({ error: "secret missing" });
    const expected = crypto.createHmac("sha256", secret).update("underbar:" + channel).digest("base64url").slice(0, 32);
    const a = Buffer.from(expected), b = Buffer.from(t);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(403).json({ error: "bad signature" });

    // dft-connect sends the public title, handle and subscribers it already read; the
    // YouTube lookup here is only a fallback.
    const sent = { title: String(body.title || "").slice(0, 120), handle: String(body.handle || "").slice(0, 60), subs: Number.isFinite(+body.subscribers) && body.subscribers !== null && body.subscribers !== "" ? +body.subscribers : null };
    const info = sent.title ? sent : { ...sent, ...(await channelInfo(channel)) };
    const avg = body.average == null || body.average === "" || !Number.isFinite(+body.average) ? null : Math.round(+body.average);
    const n = (x) => (x == null ? "n/a" : Math.round(x).toLocaleString("en-US"));
    const name = info.title || info.handle || channel;
    const url = /^@[A-Za-z0-9._-]+$/.test(info.handle) ? `https://www.youtube.com/${info.handle}` : `https://www.youtube.com/channel/${channel}`;
    const subject = `Sign-up check under the bar: ${name} (${n(avg)} avg views)`;
    const html = `<p><a href="${esc(url)}">${esc(name)}</a>${info.handle ? " (" + esc(info.handle) + ")" : ""} checked their channel on the sign-up page and was under the bar.</p>
<p>Average views per long-form video: ${n(avg)}<br>Subscribers: ${n(info.subs)}</p>
<p>We removed their YouTube access, as the page promises. No contact details are captured at this step. Please delete this email once read: the page tells them we keep nothing.</p>`;
    await sendAlert(subject, html);
    return res.status(200).json({ ok: true, sent: true });
  } catch (e) {
    return res.status(502).json({ error: "could not send" });
  }
}
