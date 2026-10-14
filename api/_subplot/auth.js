// Wordie creator signup - proving the person signing up owns the channel they are claiming.
//
// WHY THIS EXISTS. Everything the article pipeline consumes is public, so a YouTube URL is
// enough to MAKE an article. Ownership proof is not about production: it is about who we
// publish under and who we pay. Without it anyone can submit anyone's channel, and Wordie
// would run articles under a creator's byline, with their name and channel link, while
// splitting the money with an impostor. The person harmed never opted in, which is the
// complaint that becomes a legal letter rather than a support ticket.
//
// WHERE IT LIVES. Two routes, both rewritten onto api/subplot.js in vercel.json rather than
// added as files. api/ sits on exactly twelve serverless functions and Vercel Hobby fails
// the WHOLE build at thirteen, so a new endpoint file would take the site down. Files under
// api/_subplot/ are not deployed as functions, which is why this one is safe here.
//   /api/auth/google           -> start()
//   /api/auth/google/callback  -> callback()
//
// WHAT IT KEEPS. The channel id, the channel title, the handle, the email the creator typed,
// and the moment they agreed. The Google access token is used ONCE, inside callback(), to ask
// which channels the account owns, and is then dropped. The privacy policy says exactly that,
// and a reviewer will check, so do not start storing it.
//
// CONSENT IS CAPTURED BEFORE THE HANDSHAKE, not after. The creator ticks the licence on /join,
// and that tick travels through the signed state parameter. If the tick is missing the flow
// never starts, so there is no path that produces a verified channel without a recorded yes.

import crypto from "crypto";
import { usesGoogleAuth, legalUpdated, brand, mail, siteUrl } from "./brand.js";

const domain = () => brand().domain;
const brandName = () => brand().name;

const RIGHTS_BOARD = 18429671241;              // Wordie - Article Rights (per creator)
const RCOL = {
  wordie: "color_mm6wj5w0",                    // Wordie Articles status
  channelId: "text_mm6xabqj",                  // the proved UC... id, the machine key for this row
  consentSource: "text_mm6fkdtk",
  notes: "text_mm6ffja1",
  handle: "text_mm84amzt",                     // @handle; the site and the robot read approvals by it
  subs: "numeric_mm84jgve",                    // public subscriber count at signup
  longForm: "numeric_mm84z5s2",                // uploads over 3 minutes among the latest 50
  check: "text_mm84f66a",                      // what the automatic check decided, and why
};

// AUTOMATIC CHANNEL APPROVAL (Tom, 14 Oct 2026). Wordie has no per-article review: a channel
// that passes these checks at signup is Approved there and then, and its new articles publish
// without a human. 25,000 subscribers is Tom's floor. 10 long-form uploads (over 3 minutes)
// among the latest 50 is the floor for there being anything to write from: Shorts produce too
// few words. The checks read PUBLIC data with Wordie's API key, never the creator's token.
const MIN_SUBS = 25000;
const MIN_LONG = 10;
const LONG_SECS = 180;

const SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true";

const clientId = () => process.env.WORDIE_GOOGLE_CLIENT_ID || "";
const clientSecret = () => process.env.WORDIE_GOOGLE_CLIENT_SECRET || "";
const redirectUri = () => siteUrl() + "/api/auth/google/callback";

// The state parameter is signed, not encrypted - it carries nothing secret, and the point is
// only that a third party cannot mint one. Key is derived from the client secret so there is
// no extra env var to forget to set. A stray secret would break signing loudly, not silently.
const stateKey = () => crypto.createHash("sha256").update("wordie-state|" + clientSecret()).digest();
const b64u = b => Buffer.from(b).toString("base64url");
const unb64u = s => Buffer.from(String(s), "base64url").toString("utf8");

function signState(payload) {
  const body = b64u(JSON.stringify(payload));
  const mac = crypto.createHmac("sha256", stateKey()).update(body).digest("base64url");
  return body + "." + mac;
}

function readState(raw) {
  const s = String(raw || "");
  const dot = s.lastIndexOf(".");
  if (dot < 1) return null;
  const body = s.slice(0, dot);
  const mac = crypto.createHmac("sha256", stateKey()).update(body).digest("base64url");
  // timingSafeEqual throws on length mismatch, so compare lengths first.
  const got = Buffer.from(s.slice(dot + 1));
  const want = Buffer.from(mac);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try { return JSON.parse(unb64u(body)); } catch { return null; }
}

const cookieValue = (req, name) => {
  const m = new RegExp("(?:^|;\\s*)" + name + "=([^;]*)").exec(req.headers.cookie || "");
  return m ? decodeURIComponent(m[1]) : "";
};

// These two pages are the only ones on the site that do not go through render.js: they are
// reached mid-redirect, before any data is loaded, and must render even when the article feed
// is down. So the styling is inline and deliberately plain, with room to breathe.
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(title)}</title><style>
:root{color-scheme:light dark;--ink:#12121c;--bg:#fbfaf8;--soft:#5b5b66;--line:#e6e3dd;--teal:#0f7b6c}
@media (prefers-color-scheme:dark){:root{--ink:#f2f1ee;--bg:#14141a;--soft:#a3a2ad;--line:#2c2c36}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Helvetica,Arial,sans-serif}
main{max-width:40rem;margin:0 auto;padding:5rem 1.75rem 6rem}
h1{font-size:1.9rem;line-height:1.2;letter-spacing:-.02em;margin:0 0 1.5rem;text-wrap:balance}
h2{font-size:1.1rem;letter-spacing:.04em;text-transform:uppercase;color:var(--soft);margin:3rem 0 1rem}
p{margin:0 0 1.25rem;max-width:34rem}
a{color:var(--teal)}
.note{border-top:1px solid var(--line);margin-top:3rem;padding-top:1.5rem;color:var(--soft);font-size:.94rem}
</style></head><body><main>${body}</main></body></html>`;

const problem = (res, title, detail) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(400).send(page(title, `<h1>${title}</h1><p>${detail}</p>
    <p><a href="/join">Start again</a>, or email <a href="mailto:${mail("hello")}">${mail("hello")}</a> and a person will sort it out.</p>`));
};

// ---------- start ----------

export async function start(req, res) {
  if (!usesGoogleAuth()) return res.status(404).send("Not found");
  if (!clientId() || !clientSecret()) return problem(res, "Sign-in is not set up yet", "The Google credentials for this site are missing, which is our fault and not yours.");

  const q = req.query || {};
  // No tick, no handshake. This is the only door into the flow, so a verified channel can
  // never exist without a recorded agreement.
  if (String(q.consent) !== "yes") return problem(res, "The agreement needs a tick", "We can only publish your videos as articles if you have agreed to the terms on the form.");
  const email = String(q.email || "").trim().slice(0, 200);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return problem(res, "We need an email that works", "It is the only way we can tell you when your articles go up, or when something needs you.");

  const nonce = crypto.randomBytes(16).toString("base64url");
  const state = signState({
    n: nonce,
    email,
    terms: legalUpdated(),
    src: String(q.source || "direct").replace(/[^\w-]/g, "").slice(0, 40) || "direct",
    ts: Date.now(),
  });

  // Double submit: the nonce is in the signed state AND in a cookie the browser sends back.
  // An attacker who can make the victim's browser follow a link cannot also set this cookie.
  res.setHeader("Set-Cookie", `wordie_oauth=${nonce}; Path=/; Max-Age=900; HttpOnly; Secure; SameSite=Lax`);
  res.setHeader("Cache-Control", "no-store");

  const url = AUTH_URL + "?" + new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    // We want no refresh token: there is nothing we do later that needs one, and not having
    // one is easier to justify at review and impossible to leak.
    access_type: "online",
    include_granted_scopes: "true",
    prompt: "consent select_account",
    state,
  }).toString();
  res.writeHead(302, { Location: url });
  return res.end();
}

// ---------- callback ----------

export async function callback(req, res) {
  if (!usesGoogleAuth()) return res.status(404).send("Not found");
  res.setHeader("Cache-Control", "no-store");
  const q = req.query || {};

  if (q.error) {
    const why = String(q.error) === "access_denied"
      ? "You closed the Google window, or chose not to give permission. Nothing was saved."
      : "Google returned: " + String(q.error).slice(0, 120);
    return problem(res, "We could not check the channel", why);
  }

  const st = readState(q.state);
  if (!st) return problem(res, "That link has expired", "Sign-in links only work once, and only for a few minutes.");
  if (!st.n || st.n !== cookieValue(req, "wordie_oauth")) return problem(res, "That did not come from us", "The sign-in did not start in this browser, so we have stopped it.");
  if (!(Date.now() - Number(st.ts || 0) < 15 * 60 * 1000)) return problem(res, "That link has expired", "Please start again - it only takes a moment.");

  const code = String(q.code || "");
  if (!code) return problem(res, "Google sent us back empty-handed", "No authorisation code came back, so there is nothing to check.");

  // Clear the nonce cookie whatever happens next.
  res.setHeader("Set-Cookie", "wordie_oauth=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");

  let channel;
  try {
    const tr = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: clientId(), client_secret: clientSecret(),
        redirect_uri: redirectUri(), grant_type: "authorization_code",
      }).toString(),
    });
    const tok = await tr.json();
    if (!tr.ok || !tok.access_token) throw new Error(tok.error_description || tok.error || ("token exchange returned " + tr.status));

    const cr = await fetch(CHANNELS_URL, { headers: { Authorization: "Bearer " + tok.access_token } });
    const cj = await cr.json();
    if (!cr.ok) throw new Error((cj.error && cj.error.message) || ("channels.list returned " + cr.status));
    channel = (cj.items || [])[0];
    // The token has done its one job. Nothing below this line may use it, and nothing stores it.
  } catch (e) {
    return problem(res, "We could not check the channel", "Google said: " + String(e.message || e).slice(0, 200));
  }

  if (!channel) {
    return problem(res, "That Google account has no YouTube channel",
      "Many people have two: a personal one and a Brand Account that owns the channel. Start again and pick the account that owns the channel you want on " + brandName() + ".");
  }

  const sn = channel.snippet || {};
  const verdict = await checkChannel(String(channel.id || ""));
  const rec = {
    channelId: String(channel.id || ""),
    title: String(sn.title || "").slice(0, 120),
    handle: String(sn.customUrl || "").replace(/^@?/, "@").slice(0, 80),
    email: st.email,
    terms: st.terms,
    src: st.src,
    at: new Date().toISOString(),
    verdict,
  };

  let saved = { ok: false, error: "" };
  try { saved = await recordConsent(rec); }
  catch (e) { saved = { ok: false, error: String(e.message || e) }; }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const chan = rec.title || rec.handle || rec.channelId;
  const tail = saved.ok
    ? `<p>We have your agreement on file, dated today, against that channel and no other.</p>`
    : `<p><b>One thing:</b> we verified the channel but could not file the paperwork just then. Nothing is lost - email <a href="mailto:${mail("hello")}">${mail("hello")}</a> and we will finish it by hand.</p>`;
  return res.status(200).send(page(brandName() + " - channel verified", `
    <h1 style="margin:0 0 1.25rem">That is your channel. Thank you.</h1>
    <p style="font-size:1.1rem">Google confirmed that <b>${escapeHtml(chan)}</b> belongs to the account you signed in with. That is the only thing we asked it, and we did not keep the key.</p>
    ${tail}
    <h2 style="margin:2.5rem 0 .75rem">What happens now</h2>
    ${whatNext(saved.ok ? saved.status : "Pending - asked", verdict)}
    <p style="margin-top:2.5rem"><a href="/">Have a look at the site</a>.</p>`));
}

function whatNext(status, v) {
  if (status === "Approved") return `<p><b>You're in.</b> Your channel passed our checks, so there is nothing more to do. Your next long-form uploads become articles under your name, usually within a day of going live on YouTube.</p>
    <p>You can leave at any time and every article comes down. Just email <a href="mailto:${mail("hello")}">${mail("hello")}</a>.</p>`;
  if (status === "Not approved" && v.reason) return `<p>${escapeHtml(v.reason)}</p>
    <p>Your agreement stays on file, so if that changes you only need to sign in again and we will re-check straight away.</p>`;
  return `<p>We could not finish the automatic check just now, so a person will look at your channel instead. We will email you either way, and nothing appears under your name until then.</p>`;
}

// Public stats only, with the site's API key. Returns { status, subs, long, reason, note }.
// "Pending - asked" means the check could not run and a person decides; it never blocks a
// creator for our own outage.
async function checkChannel(id) {
  const key = process.env.YOUTUBE_API_KEY;
  const today = new Date().toISOString().slice(0, 10);
  const look = why => ({ status: "Pending - asked", subs: null, long: null, reason: "", note: `NEEDS A LOOK ${today}: ${why}` });
  if (!key || !id) return look("the automatic check had no API key or channel id");
  try {
    const g = async u => { const r = await fetch(u + "&key=" + key); const j = await r.json(); if (!r.ok) throw new Error((j.error && j.error.message) || r.status); return j; };
    const ch = ((await g(`https://www.googleapis.com/youtube/v3/channels?part=statistics,contentDetails&id=${encodeURIComponent(id)}`)).items || [])[0];
    if (!ch) return look("YouTube returned no public data for the channel");
    const st = ch.statistics || {};
    if (st.hiddenSubscriberCount) return look("subscriber count is hidden");
    const subs = Number(st.subscriberCount || 0);
    const uploads = ch.contentDetails && ch.contentDetails.relatedPlaylists && ch.contentDetails.relatedPlaylists.uploads;
    let long = 0;
    if (uploads) {
      const pl = await g(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}`);
      const ids = (pl.items || []).map(i => i.contentDetails && i.contentDetails.videoId).filter(Boolean);
      if (ids.length) {
        const vs = await g(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids.join(",")}`);
        long = (vs.items || []).filter(v => secs(v.contentDetails && v.contentDetails.duration) > LONG_SECS).length;
      }
    }
    if (subs < MIN_SUBS) return { status: "Not approved", subs, long, reason: `Wordie currently takes channels with ${MIN_SUBS.toLocaleString("en-US")} subscribers or more, and yours has ${subs.toLocaleString("en-US")}.`, note: `AUTO-DECLINED ${today}: ${subs} subscribers, under ${MIN_SUBS}` };
    if (long < MIN_LONG) return { status: "Not approved", subs, long, reason: `Wordie writes from long-form videos, and only ${long} of your latest 50 uploads run over three minutes. We need ${MIN_LONG}.`, note: `AUTO-DECLINED ${today}: ${long} long-form uploads in the latest 50, under ${MIN_LONG}` };
    return { status: "Approved", subs, long, reason: "", note: `AUTO-APPROVED ${today}: ${subs} subscribers, ${long} long-form uploads in the latest 50 (floors ${MIN_SUBS} and ${MIN_LONG})` };
  } catch (e) {
    return look("YouTube check failed: " + String(e.message || e).slice(0, 120));
  }
}
const secs = d => { const m = String(d || "").match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : 0; };

const escapeHtml = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- the rights record ----------
//
// The status set here comes from checkChannel (14 Oct 2026, replacing the human yes/no gate at
// Tom's instruction): Approved when the public checks pass, Not approved with the reason when
// they fail, Pending - asked when they could not run. A row Tom has set to Not approved BY HAND
// (its check column does not start AUTO-) is a veto: a repeat signup never lifts it.
async function recordConsent(rec) {
  const token = process.env.MONDAY_API_KEY || process.env.MONDAY_API_TOKEN;
  if (!token) return { ok: false, error: "MONDAY_API_KEY not set" };

  const gql = async (query, variables) => {
    const r = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" },
      body: JSON.stringify({ query, variables }),
    });
    const j = await r.json();
    if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300));
    return j.data;
  };

  const note = `Signed up at ${brandName()} ${rec.at.slice(0, 10)}. Channel ownership proved by the creator's own Google sign-in (youtube.readonly, used once, token discarded). Email ${rec.email}. Source ${rec.src}.`;

  // Every other row on this board states plainly what its status does NOT mean. Match that.
  // A creator agreeing and Wordie accepting them are two different events, and this column is
  // where the next person to read the row finds out which one has happened.
  const v = rec.verdict;
  const source = `CREATOR CONSENT GIVEN at signup ${rec.at.slice(0, 10)}: the creator ticked the licence on /join and proved they own this channel by their own Google sign-in, on the terms of ${rec.terms}. Acceptance is the separate Wordie Articles status, set by the automatic channel check (see Channel check).`;
  const values = {
    [RCOL.wordie]: { label: v.status },
    [RCOL.handle]: rec.handle,
    [RCOL.check]: v.note.slice(0, 500),
    ...(v.subs != null ? { [RCOL.subs]: String(v.subs) } : {}),
    ...(v.long != null ? { [RCOL.longForm]: String(v.long) } : {}),
    [RCOL.channelId]: rec.channelId,
    [RCOL.consentSource]: source.slice(0, 500),
    [RCOL.notes]: note.slice(0, 500),
  };

  // A repeat signup must not create a second row for the same channel.
  const found = await gql(
    `query($b: ID!, $c: String!, $v: CompareValue!) { items_page_by_column_values(board_id: $b, columns: [{column_id: $c, column_values: [$v]}], limit: 1) { items { id column_values(ids: ["${RCOL.wordie}", "${RCOL.check}"]) { id text } } } }`,
    { b: String(RIGHTS_BOARD), c: RCOL.channelId, v: rec.channelId },
  ).catch(() => null);
  const existing = found && found.items_page_by_column_values && (found.items_page_by_column_values.items || [])[0];

  if (existing && existing.id) {
    const cv = Object.fromEntries((existing.column_values || []).map(c => [c.id, c.text || ""]));
    if (cv[RCOL.wordie] === "Not approved" && !/^AUTO-/.test(cv[RCOL.check])) {
      delete values[RCOL.wordie];                      // a hand-set veto stands
      values[RCOL.check] = ("VETOED BY HAND, re-signup did not change it. Latest check: " + v.note).slice(0, 500);
      rec.verdict = { ...v, status: "Pending - asked", reason: "" };
    }
    await gql(
      `mutation($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id: $b, item_id: $i, column_values: $v) { id } }`,
      { b: String(RIGHTS_BOARD), i: String(existing.id), v: JSON.stringify(values) },
    );
    return { ok: true, id: existing.id, updated: true, status: rec.verdict.status };
  }

  const name = (rec.title || rec.handle || rec.channelId).slice(0, 200);
  const made = await gql(
    `mutation($b: ID!, $n: String!, $v: JSON!) { create_item(board_id: $b, item_name: $n, column_values: $v) { id } }`,
    { b: String(RIGHTS_BOARD), n: name, v: JSON.stringify(values) },
  );
  return { ok: true, id: made.create_item.id, updated: false, status: v.status };
}
