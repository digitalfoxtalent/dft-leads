// Alert for sign-up checks under the bar.
//
// WHY (Tom, 15 Oct 2026): "Can we just be pinged a notification at the time who applied but
// was rejected?" dft-connect's /api/signup-check answers "not yet" to channels under the bar.
// Before it answers, it posts the channel id, its average and its signed stats link here;
// we look up the public channel name and handle and email Tom and Alex (Tom asked for Alex
// to get these too, 17 Oct 2026) from theteam@.
//
// KEPT, NOT DELETED (Tom, 18 Oct 2026: "I'd like not to delete the data if they are
// rejected"). dft-connect keeps our read-only access, the alert carries the stats link, and
// the sent copy stays in theteam@ as the record. The not-yet page says we kept the access.
//
// AUTH. dft-connect has no monday token, so the call is signed with Channel Connect's
// STATS_SECRET (purpose "underbar"), the same secret kit-sync reads from the API Keys
// board. Only dft-connect can produce a valid signature, so nobody else can trigger an alert.
import crypto from "node:crypto";
import { monday, mondayToken } from "./_reports/monday.js";
import { yt } from "./_ytkey.js";

const ALERT_FROM = "theteam@digitalfoxtalent.com";
const ALERT_TO = ["tom@digitalfoxtalent.com", "alex@digitalfoxtalent.com"];

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
  const mime = ["From: Digital Fox Talent <" + ALERT_FROM + ">", "To: " + ALERT_TO.join(", "), "Subject: " + enc(subject), "MIME-Version: 1.0", "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", Buffer.from(html).toString("base64")].join("\r\n");
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify({ raw: Buffer.from(mime).toString("base64url") }) });
  if (!r.ok) throw new Error("Gmail send " + r.status);
  // The sent copy stays in theteam@ as the record (Tom, 18 Oct 2026).
}

const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export const config = { maxDuration: 30 };

const KEY_ITEM = 13197661446; // API Keys: "Channel Connect STATS_SECRET (dft-connect Vercel)"
const KEY_COL = "text_mm5bcxe7";
const CHANNEL_RE = /^UC[A-Za-z0-9_-]{22}$/;
const STATS_PREFIX = "https://connect.digitalfoxtalent.com/api/stats?";

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

// WHY THEY WERE UNDER THE BAR (Tom, 19 Oct 2026, after the honestilana alert read "0 avg
// views" with no explanation: "Can you include this information in the rejection email
// please?"). We re-read their last 50 uploads with the public API and say, in plain words,
// which rule they missed, how their long-form and Shorts actually do, and what they make.
// The rules mirror dft-connect api/signup-check.js (keep them in step if the bar moves):
// 50,000 average over the last 10 long-form uploads (100,000 needs no back catalogue,
// 50,000-100,000 needs 10+ long-form videos), and 3+ long-form uploads in the last 90 days.
// Long-form = over 3 minutes, as in dft-connect _youtube.js. Everything here is best
// effort: any failure just leaves the extra lines out.
const LONGFORM_MIN_SECONDS = 180;
const BAR = 50000, STANDOUT = 100000, MIN_LONGFORM_VIDEOS = 10, ACTIVE_90D = 3;

function isoSeconds(d) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(d || ""));
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

async function channelBreakdown(channel) {
  const get = async (u) => { const r = await yt(u); if (!r.ok) throw new Error("yt " + r.status); return r.json; };
  const c = await get(`https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&id=${channel}`);
  const it = c.items && c.items[0];
  if (!it) return null;
  const pl = await get(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${it.contentDetails.relatedPlaylists.uploads}`);
  const ids = (pl.items || []).map((x) => x.contentDetails.videoId);
  if (!ids.length) return { description: it.snippet.description || "", scanned: 0, longform: [], shorts: [], titles: [] };
  const v = await get(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics,liveStreamingDetails&id=${ids.join(",")}`);
  const vids = (v.items || []).map((x) => ({
    title: x.snippet.title, at: Date.parse(x.snippet.publishedAt), seconds: isoSeconds(x.contentDetails.duration),
    views: +((x.statistics || {}).viewCount || 0), live: !!x.liveStreamingDetails,
  })).sort((a, b) => b.at - a.at);
  return {
    description: it.snippet.description || "",
    scanned: vids.length,
    longform: vids.filter((x) => x.seconds > LONGFORM_MIN_SECONDS && !x.live),
    shorts: vids.filter((x) => x.seconds <= LONGFORM_MIN_SECONDS && !x.live),
    titles: vids.slice(0, 15).map((x) => x.title),
  };
}

// The rules they missed, in the order the sign-up check applies them.
function reasons(avg, b) {
  const out = [];
  const nf = (x) => Math.round(x).toLocaleString("en-US");
  if (b && b.scanned && !b.longform.length) out.push(`Posts Shorts only: none of their last ${b.scanned} uploads is long-form (over 3 minutes), and Shorts don't count towards the bar.`);
  else if (avg != null && avg < BAR) out.push(`Long-form average of ${nf(avg)} views is under the ${nf(BAR)} bar.`);
  if (b && b.longform.length) {
    const recent = b.longform.filter((x) => x.at > Date.now() - 90 * 864e5).length;
    if (recent < ACTIVE_90D) out.push(`Only ${recent} long-form upload${recent === 1 ? "" : "s"} in the last 90 days (we need ${ACTIVE_90D}).`);
    if (avg != null && avg >= BAR && avg < STANDOUT && b.longform.length < MIN_LONGFORM_VIDEOS && b.scanned < 50) out.push(`Only ${b.longform.length} long-form videos in total (we need ${MIN_LONGFORM_VIDEOS} at this average).`);
  }
  return out;
}

// One plain line on what they make and how it sits with our roster. Claude Haiku, best effort.
async function whatTheyMake(name, b) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !b) return "";
  const prompt = `YouTube channel: ${name}\nChannel description: ${b.description.slice(0, 800)}\nRecent video titles:\n- ${b.titles.join("\n- ")}\n\nIn one short sentence (under 30 words), say what this channel makes and whether it fits a talent agency roster that is mostly film, TV, pop culture and gaming creators. Plain English, no dashes, no preamble.`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-4-5", max_tokens: 120, messages: [{ role: "user", content: prompt }] }),
    });
    if (!r.ok) return "";
    const d = await r.json();
    return String(((d.content || [])[0] || {}).text || "").replace(/\s*[–—]\s*/g, " - ").trim().slice(0, 300);
  } catch (e) { return ""; }
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
    // Only Channel Connect's own signed stats links go in the email.
    const stats = String(body.statsUrl || "");
    const statsLink = stats.startsWith(STATS_PREFIX) && stats.length < 400 ? stats : "";
    let bd = null;
    try { bd = await channelBreakdown(channel); } catch (e) { bd = null; }
    const why = reasons(avg, bd);
    const make = await whatTheyMake(name, bd);
    const avgOf = (xs) => (xs.length ? xs.reduce((s, x) => s + x.views, 0) / xs.length : null);
    const facts = [`Average views per long-form video (last 10): ${n(avg)}`];
    if (bd && bd.scanned) {
      const lf90 = bd.longform.filter((x) => x.at > Date.now() - 90 * 864e5).length;
      facts.push(`Long-form uploads in the last 90 days: ${lf90}${lf90 === bd.scanned && bd.scanned >= 50 ? "+" : ""}`);
      facts.push(`Shorts in their last ${bd.scanned} uploads: ${bd.shorts.length}${bd.shorts.length ? `, averaging ${n(avgOf(bd.shorts.slice(0, 20)))} views` : ""}`);
      const last = Math.max(...bd.longform.concat(bd.shorts).map((x) => x.at));
      if (Number.isFinite(last)) facts.push(`Latest upload: ${new Date(last).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Denver" })}`);
    }
    facts.push(`Subscribers: ${n(info.subs)}`);
    const subject = `Sign-up check under the bar: ${name} (${n(avg)} avg views)`;
    const html = `<p><a href="${esc(url)}">${esc(name)}</a>${info.handle ? " (" + esc(info.handle) + ")" : ""} checked their channel on the sign-up page and was under the bar.</p>
${why.length ? `<p><b>Why they didn't qualify</b></p><ul>${why.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
<p><b>Their numbers</b><br>${facts.map(esc).join("<br>")}</p>
${make ? `<p><b>What they make</b><br>${esc(make)}</p>` : ""}
<p>We've kept their read-only YouTube access${statsLink ? `, so their live stats stay here: <a href="${esc(statsLink)}">Open the stats page</a>` : ""}. No contact details are captured at this step.</p>`;
    await sendAlert(subject, html);
    return res.status(200).json({ ok: true, sent: true });
  } catch (e) {
    return res.status(502).json({ error: "could not send" });
  }
}
