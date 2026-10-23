import crypto from "crypto";
export const config = { maxDuration: 60 };
// ENQUIRY ROUTER, delivery step (Tom, 22 Oct 2026: "upon clicking reply we would need this to go through to the email
// thread and it feel natural, like our other systems ... being taken to a dedicated gmail screen isn't a good user journey").
// Make scenario 6743738 "Enquiry router" reads each new message in tom@ (which also receives theteam@ and every creator
// address), decides who owns it (Margot, George, Han Yi or Alex), then calls this endpoint. This copies the brand's
// ORIGINAL email, byte for byte, into the owner's own Gmail inbox through the domain-wide delegation already used for
// pitch drafts (service account pitch-drafts@dft-pitch-drafts.iam.gserviceaccount.com, scope gmail.modify,
// key in GMAIL_DELEGATE_KEY). It arrives from the brand, unread, in their inbox, so Reply and Reply all behave exactly
// as if the brand had written to them: the reply threads under the brand's message on both sides.
// mode "shadow": the copy goes to Tom instead, subject prefixed "[Test: <owner>]", with a fresh Message-ID and the
// router's "Routed to" label so the router does not pick it up again.
// Nothing is ever sent. Only tom@ is read, only the four owners can receive, and the same message is never copied twice.
// Calls need the router key (sha256 below; the key itself is on monday API Keys (Private) 18422548864).
const KEY_SHA256 = "9d04be2ab1874c36d9ad6f05e3f0c27a2476d944b29dc39bc9f7768a6ed1148a";
const SOURCE = "tom@digitalfoxtalent.com";
const OWNERS = {
  "margot@digitalfoxtalent.com": { name: "Margot", label: "Label_32" },
  "george@digitalfoxtalent.com": { name: "George", label: "Label_33" },
  "hani@digitalfoxtalent.com": { name: "Han Yi", label: "Label_34" },
  "alex@digitalfoxtalent.com": { name: "Alex", label: "Label_35" }
};

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
async function gmail(tok, path, opt = {}) {
  const r = await fetch("https://gmail.googleapis.com" + path, { ...opt, headers: { Authorization: "Bearer " + tok, ...(opt.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Gmail " + r.status + " " + ((j.error || {}).message || ""));
  return j;
}

// Split the raw message into its header block and body, keeping every byte (latin1 maps bytes 1:1).
function splitRaw(buf) {
  const s = buf.toString("latin1");
  let i = s.indexOf("\r\n\r\n"), sep = "\r\n";
  if (i < 0) { i = s.indexOf("\n\n"); sep = "\n"; }
  if (i < 0) return { head: s, body: "", sep };
  return { head: s.slice(0, i), body: s.slice(i), sep };
}
const headerLines = head => head.split(/\r?\n(?=[^ \t])/);
const getHeader = (lines, name) => { const l = lines.find(x => x.toLowerCase().startsWith(name.toLowerCase() + ":")); return l ? l.slice(name.length + 1).replace(/\r?\n[ \t]+/g, " ").trim() : ""; };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  let b = req.body || {};
  if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  const given = crypto.createHash("sha256").update(String(b.key || "")).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(given), Buffer.from(KEY_SHA256))) return res.status(401).json({ error: "Not allowed" });
  const owner = String(b.owner || "").toLowerCase().trim();
  const mode = b.mode === "live" ? "live" : "shadow";
  const id = String(b.messageId || "").replace(/[^a-zA-Z0-9]/g, "");
  if (!OWNERS[owner]) return res.status(400).json({ error: "owner must be one of " + Object.keys(OWNERS).join(", ") });
  if (!id) return res.status(400).json({ error: "messageId missing" });
  try {
    const src = await gmailToken(SOURCE);
    const m = await gmail(src, "/gmail/v1/users/me/messages/" + id + "?format=raw");
    const buf = Buffer.from(String(m.raw || ""), "base64url");
    if (!buf.length) throw new Error("message has no content");
    const { head, body, sep } = splitRaw(buf);
    let lines = headerLines(head);
    const from = getHeader(lines, "From");
    if (/@digitalfoxtalent\.com>?\s*$/i.test(from) && !/^brief$/i.test(getHeader(lines, "Subject"))) throw new Error("refusing to route mail sent by DFT");
    const msgId = getHeader(lines, "Message-ID");
    const target = mode === "live" ? owner : SOURCE;
    const tok = target === SOURCE ? src : await gmailToken(target);
    let labelIds = ["INBOX", "UNREAD"];
    if (mode === "live") {
      if (msgId) {
        const q = await gmail(tok, "/gmail/v1/users/me/messages?maxResults=1&q=" + encodeURIComponent("rfc822msgid:" + msgId.replace(/[<>]/g, "")));
        if ((q.messages || []).length) return res.status(200).json({ ok: true, already: true, target, owner: OWNERS[owner].name });
      }
      lines = ["X-DFT-Routed: enquiry router, " + OWNERS[owner].name].concat(lines);
    } else {
      const fresh = "<router-test-" + crypto.randomBytes(8).toString("hex") + "@digitalfoxtalent.com>";
      const subj = getHeader(lines, "Subject");
      lines = lines.filter(l => !/^(subject|message-id|in-reply-to|references):/i.test(l));
      lines = ["X-DFT-Routed: enquiry router test, " + OWNERS[owner].name, "Message-ID: " + fresh, "Subject: [Test: " + OWNERS[owner].name + "] " + subj].concat(lines);
      labelIds.push(OWNERS[owner].label);
    }
    const msg = Buffer.from(lines.join(sep) + body, "latin1");
    const boundary = "dftrouter" + crypto.randomBytes(8).toString("hex");
    const multipart = Buffer.concat([
      Buffer.from("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify({ labelIds }) + "\r\n--" + boundary + "\r\nContent-Type: message/rfc822\r\n\r\n", "utf8"),
      msg,
      Buffer.from("\r\n--" + boundary + "--", "utf8")
    ]);
    const out = await gmail(tok, "/upload/gmail/v1/users/me/messages/import?uploadType=multipart&internalDateSource=dateHeader&neverMarkSpam=true", {
      method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + boundary }, body: multipart
    });
    return res.status(200).json({ ok: true, mode, target, owner: OWNERS[owner].name, importedId: out.id, threadId: out.threadId });
  } catch (e) {
    return res.status(502).json({ error: String(e && e.message || e) });
  }
}
