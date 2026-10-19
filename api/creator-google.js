// Creator approved -> their DFT email address and Google Chat space.
//
// WHY (Tom, 19 Oct 2026: "Are you able to set this up? And can we make it as part of your recruitment
// process?"). Until now each new creator's @digitalfoxtalent.com address (a Google Group) and their
// "@handle x DFT" Chat space were made by hand. Make scenario 6695139 (built on every live Approve) posts
// here after the monday workspace step, so both are made on approval.
//
// HOW. The same delegated service account roster.js uses for Gmail
// (pitch-drafts@dft-pitch-drafts.iam.gserviceaccount.com, key in GMAIL_DELEGATE_KEY), acting as tom@, with
// three more domain-wide delegation scopes: admin.directory.group, apps.groups.settings and
// chat.spaces.create (Admin console > Security > API controls > Domain-wide delegation).
//
// WHAT IT MAKES, matching the standard recipe (Master Handover Step 2 and the 8 Sep 2026 recipe):
//  - Group <name>@digitalfoxtalent.com, named after the channel, description "Brand enquiries for <channel>
//    (@handle)". External senders can post and contact owners, join is invite only, no external members.
//    Members tom@ (owner) and alex@ (member).
//  - Chat space "@handle x DFT", external members allowed, with Alex and the creator (Tom is the creator of
//    the space). If the creator's email is not a Google account the space is still made with Alex and the
//    alert says the creator needs inviting by hand.
//  - Global Talent Roster row: DFT Custom Email, Bespoke Email Action "Using Bespoke DFT", Auto Forwarding NO,
//    Google Chat Yes, plus an update.
// WHAT IT CAN'T DO: add the address to Gmail routing rule e4566 (Google has no API for routing rules). The
// email to Tom and Alex says so and names the word to add.
//
// SAFE TO RE-RUN. Skips the address if the roster row already has one or the address exists; skips the space
// if Google Chat is already Yes. mode "dry" reports what it would do and changes nothing.
import crypto from "node:crypto";
import { monday, mondayToken } from "./_reports/monday.js";
import { yt } from "./_ytkey.js";

export const config = { maxDuration: 60 };

const DOMAIN = "digitalfoxtalent.com";
const TOM = "tom@" + DOMAIN, ALEX = "alex@" + DOMAIN, TEAM = "theteam@" + DOMAIN;
const GTR = 6160485039;
const KEY_ITEM = 13330549704; // API Keys (Private): "Make webhook key: creator Google setup (dft-leads)"
const KEY_COL = "text_mm5bcxe7";
const S = "https://www.googleapis.com/auth/";

async function googleToken(subject, scopes) {
  const raw = process.env.GMAIL_DELEGATE_KEY;
  if (!raw) throw new Error("GMAIL_DELEGATE_KEY not set");
  const key = JSON.parse(raw), now = Math.floor(Date.now() / 1000);
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = b64u({ alg: "RS256", typ: "JWT" }) + "." + b64u({ iss: key.client_email, scope: scopes.map((s) => S + s).join(" "), aud: "https://oauth2.googleapis.com/token", sub: subject, iat: now, exp: now + 3000 });
  const sig = crypto.createSign("RSA-SHA256").update(unsigned).sign(key.private_key).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + unsigned + "." + sig });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error("Google token (" + scopes.join(",") + "): " + (d.error_description || d.error || r.status));
  return d.access_token;
}

async function g(tok, method, url, body) {
  const r = await fetch(url, { method, headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = {}; try { json = JSON.parse(text); } catch (e) {}
  return { ok: r.ok, status: r.status, json, text: text.slice(0, 300) };
}

async function sendInternal(subject, html) {
  const tok = await googleToken(TEAM, ["gmail.modify"]);
  const enc = (x) => "=?UTF-8?B?" + Buffer.from(x).toString("base64") + "?=";
  const mime = ["From: Digital Fox Talent <" + TEAM + ">", "To: " + [TOM, ALEX].join(", "), "Subject: " + enc(subject), "MIME-Version: 1.0", "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", Buffer.from(html).toString("base64")].join("\r\n");
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify({ raw: Buffer.from(mime).toString("base64url") }) });
  if (!r.ok) throw new Error("Gmail send " + r.status);
}

const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const slug = (x) => String(x || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

// The address word: the channel name squashed (Matio -> matio, Commentator's Curse -> commentatorscurse),
// falling back to the handle when the name is too short, too long or not Latin letters.
export function addressWord(title, handle) {
  const t = slug(title);
  if (t.length >= 3 && t.length <= 24) return t;
  const h = slug(String(handle || "").replace(/^@/, ""));
  return h.length >= 3 ? h.slice(0, 30) : "";
}

let ytNote = "";
async function channelTitle(handle) {
  if (!handle) return "";
  const r = await yt(`https://www.googleapis.com/youtube/v3/channels?part=snippet&forHandle=${encodeURIComponent(handle.replace(/^@/, ""))}`);
  const d = r.json || {};
  if (!r.ok) { ytNote = "YouTube " + r.status + " " + ((d.error && d.error.message) || "").slice(0, 120); return ""; }
  if (!(d.items && d.items[0])) ytNote = "YouTube found no channel for " + handle;
  return (d.items && d.items[0] && d.items[0].snippet.title) || "";
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch (e) { return {}; }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const mtok = mondayToken();
  if (!mtok) return res.status(500).json({ error: "MONDAY_API_KEY not set" });
  const body = readBody(req);
  const gtrId = String(body.gtrId || "");
  const dry = body.mode !== "live";
  if (!/^[0-9]{6,15}$/.test(gtrId)) return res.status(400).json({ error: "bad gtrId" });

  const log = { gtrId, mode: dry ? "dry" : "live", steps: [] };
  try {
    const k = await monday(mtok, `query { items(ids:[${KEY_ITEM}]) { column_values(ids:["${KEY_COL}"]) { text } } }`);
    const secret = String((k.items[0] && k.items[0].column_values[0].text) || "").trim();
    const given = String(body.key || "");
    if (secret.length < 20 || given.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret))) return res.status(403).json({ error: "bad key" });

    const d = await monday(mtok, `query { items(ids:[${gtrId}]) { id name column_values(ids:["text_mm6nqp7b","email__1","text_mkm0t55g","status3__1","dup__of_state"]) { id text } } }`);
    const it = d.items && d.items[0];
    if (!it) return res.status(404).json({ error: "no roster row" });
    const col = (id) => (((it.column_values || []).find((c) => c.id === id)) || {}).text || "";
    const handle = /^@[A-Za-z0-9._-]{2,60}$/.test(it.name) ? it.name : col("text_mm6nqp7b").trim();
    if (!/^@[A-Za-z0-9._-]{2,60}$/.test(handle)) return res.status(422).json({ error: "no @handle on roster row" });
    const creatorEmail = col("email__1").trim().toLowerCase();
    const title = (await channelTitle(handle)) || handle.replace(/^@/, "");
    log.handle = handle; log.channel = title; if (ytNote) log.youtube = ytNote;

    // ---- the address ----
    let address = col("text_mkm0t55g").trim().toLowerCase(), addressMade = false, addressNote = "";
    const word = addressWord(title, handle);
    if (address) { addressNote = "already on the roster row: " + address; }
    else if (!word) { addressNote = "could not work out an address word from " + title; }
    else {
      const want = word + "@" + DOMAIN;
      const dirTok = await googleToken(TOM, ["admin.directory.group"]);
      const got = await g(dirTok, "GET", `https://admin.googleapis.com/admin/directory/v1/groups/${encodeURIComponent(want)}`);
      if (got.ok && String(got.json.description || "").includes("(" + handle + ")")) {
        // Made by an earlier run of this endpoint that stopped before writing the roster row: adopt it.
        address = want; addressMade = true; addressNote = "created " + want + " (on an earlier run)";
      }
      else if (got.ok) { addressNote = want + " is already taken by the group \"" + (got.json.name || "") + "\", so nothing was made: pick another word by hand"; }
      else if (got.status !== 404) { throw new Error("group lookup " + got.status + " " + got.text); }
      else if (dry) { addressNote = "would create " + want; address = want; }
      else {
        const made = await g(dirTok, "POST", "https://admin.googleapis.com/admin/directory/v1/groups", { email: want, name: title, description: `Brand enquiries for ${title} (${handle})` });
        if (!made.ok) throw new Error("group create " + made.status + " " + made.text);
        const setTok = await googleToken(TOM, ["apps.groups.settings"]);
        // Google can take a few seconds to make a new group visible to the settings API.
        let set = null;
        for (let i = 0; i < 5; i++) {
          set = await g(setTok, "PATCH", `https://www.googleapis.com/groups/v1/groups/${encodeURIComponent(want)}?alt=json`, {
            whoCanPostMessage: "ANYONE_CAN_POST", whoCanContactOwner: "ANYONE_CAN_CONTACT", whoCanJoin: "INVITED_CAN_JOIN",
            allowExternalMembers: "false", whoCanViewGroup: "ALL_IN_DOMAIN_CAN_VIEW", whoCanViewMembership: "ALL_IN_DOMAIN_CAN_VIEW",
          });
          if (set.ok) break;
          await new Promise((r) => setTimeout(r, 3000));
        }
        if (!set.ok) throw new Error("group settings " + set.status + " " + set.text);
        for (const [email, role] of [[TOM, "OWNER"], [ALEX, "MEMBER"]]) {
          const m = await g(dirTok, "POST", `https://admin.googleapis.com/admin/directory/v1/groups/${encodeURIComponent(want)}/members`, { email, role });
          if (!m.ok && m.status !== 409) throw new Error("group member " + email + " " + m.status + " " + m.text);
        }
        address = want; addressMade = true; addressNote = "created " + want;
      }
    }
    log.steps.push("address: " + addressNote);

    // ---- the Chat space ----
    let spaceNote = "", spaceUrl = "", creatorInvited = false;
    if (col("status3__1") === "Yes") spaceNote = "Google Chat already marked Yes on the roster row";
    else if (dry) spaceNote = `would create "${handle} x DFT" with Alex${creatorEmail ? " and " + creatorEmail : ""}`;
    else {
      const chatTok = await googleToken(TOM, ["chat.spaces.create"]);
      const space = { spaceType: "SPACE", displayName: `${handle} x DFT`, externalUserAllowed: true };
      const member = (email) => ({ member: { name: "users/" + email, type: "HUMAN" } });
      let r = creatorEmail ? await g(chatTok, "POST", "https://chat.googleapis.com/v1/spaces:setup", { space, memberships: [member(ALEX), member(creatorEmail)] }) : { ok: false };
      if (r.ok) creatorInvited = true;
      else {
        if (creatorEmail) log.steps.push("chat with creator failed (" + r.status + "), retrying with Alex only");
        r = await g(chatTok, "POST", "https://chat.googleapis.com/v1/spaces:setup", { space, memberships: [member(ALEX)] });
      }
      if (!r.ok) throw new Error("chat space " + r.status + " " + r.text);
      const id = String(r.json.name || "").replace(/^spaces\//, "");
      spaceUrl = "https://chat.google.com/room/" + id;
      spaceNote = `created "${handle} x DFT" with Alex` + (creatorInvited ? " and " + creatorEmail : "; the creator still needs inviting by hand");
    }
    log.steps.push("chat: " + spaceNote);

    if (dry) return res.status(200).json(Object.assign(log, { ok: true, wouldWrite: { address } }));

    // ---- the roster row ----
    const cv = {};
    if (addressMade) Object.assign(cv, { text_mkm0t55g: address, status_mkm0dn4z: { label: "Using Bespoke DFT" }, color_mkv562sg: { label: "NO" } });
    if (spaceUrl) cv.status3__1 = { label: "Yes" };
    const word2 = address ? address.split("@")[0] : "";
    const note = `<p><b>Google set-up on approval</b></p><p>Email: ${esc(addressNote)}</p><p>Chat: ${esc(spaceNote)}${spaceUrl ? ` (${esc(spaceUrl)})` : ""}</p>` + (addressMade ? `<p>Still to do by hand: add <b>${esc(word2)}</b> to Gmail routing rule e4566 so brand mail reaches Tom and Alex with the real sender.</p>` : "");
    await monday(mtok, `mutation { ${Object.keys(cv).length ? `c: change_multiple_column_values(board_id: ${GTR}, item_id: ${gtrId}, column_values: ${JSON.stringify(JSON.stringify(cv))}) { id }` : ""} u: create_update(item_id: ${gtrId}, body: ${JSON.stringify(note)}) { id } }`);

    // ---- tell Tom and Alex, with the one step left ----
    const html = `<p>${esc(handle)} (${esc(title)}) was approved, and their Google set-up is done:</p><ul><li>Email: ${esc(addressNote)}</li><li>Chat: ${esc(spaceNote)}${spaceUrl ? ` - <a href="${esc(spaceUrl)}">open the space</a>` : ""}</li></ul>` +
      (addressMade ? `<p><b>One step left:</b> add <b>${esc(word2)}</b> to the Gmail routing rule "Creator addresses - deliver with original sender" (e4566) so brand mail to ${esc(address)} reaches you both with the real sender showing. Ask Claude and it will open it for you.</p>` : "") +
      (spaceUrl && !creatorInvited ? `<p>The creator wasn't added to the Chat space automatically (their email may not be a Google account). Invite them from the space.</p>` : "");
    await sendInternal(`New creator Google set-up: ${handle}` + (addressMade ? " (routing rule step left)" : ""), html);
    return res.status(200).json(Object.assign(log, { ok: true, address, spaceUrl, creatorInvited }));
  } catch (e) {
    log.error = String(e.message || e).slice(0, 400);
    if (!dry) try { await sendInternal(`New creator Google set-up FAILED: ${log.handle || gtrId}`, `<p>The automatic email and Chat set-up for roster row ${esc(gtrId)} stopped:</p><p>${esc(log.error)}</p><p>Done before it stopped: ${esc(log.steps.join("; ") || "nothing")}</p><p>Ask Claude to finish it by hand.</p>`); } catch (e2) {}
    return res.status(502).json(log);
  }
}
