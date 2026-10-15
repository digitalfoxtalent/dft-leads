// Handle log for sign-up checks under the bar.
//
// WHY (Tom, 15 Oct 2026): "Let's keep a record? Not of the data, but just the YT handle."
// dft-connect's /api/signup-check answers "not yet" to channels under the bar and revokes
// our access. Before it answers, it posts the channel id here; we look up the public
// handle and add it to the Creator Applications board, group "Checked, under the bar
// (handle only)". One row per channel, named by its handle. Nothing else is stored:
// no average, no analytics, no email. The not-yet page says exactly this.
//
// AUTH. dft-connect has no monday token, so the call is signed with Channel Connect's
// STATS_SECRET (purpose "underbar"), the same secret kit-sync reads from the API Keys
// board. Only dft-connect can produce a valid signature, so nobody can write rows here.
import crypto from "node:crypto";
import { monday, mondayToken } from "./_reports/monday.js";

export const config = { maxDuration: 30 };

const BOARD = 18429940671; // Creator Applications (Website)
const GROUP = "group_mm85z0xm"; // Checked, under the bar (handle only)
const KEY_ITEM = 13197661446; // API Keys: "Channel Connect STATS_SECRET (dft-connect Vercel)"
const KEY_COL = "text_mm5bcxe7";
const CHANNEL_RE = /^UC[A-Za-z0-9_-]{22}$/;

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch (e) { return {}; }
}

async function handleFor(channel) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return null;
  const r = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${channel}&key=${key}`);
  if (!r.ok) return null;
  const d = await r.json();
  const s = d.items && d.items[0] && d.items[0].snippet;
  return s ? s.customUrl || s.title || null : null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const tok = mondayToken();
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

    const handle = (await handleFor(channel)) || channel;
    const name = JSON.stringify(handle.slice(0, 120));

    // One row per channel: skip if this handle is already in the group.
    const found = await monday(tok, `query { boards(ids:[${BOARD}]) { groups(ids:["${GROUP}"]) { items_page(limit: 1, query_params: { rules: [{ column_id: "name", compare_value: [${name}], operator: any_of }] }) { items { id } } } } }`);
    const g = found.boards[0] && found.boards[0].groups[0];
    if (g && g.items_page.items.length) return res.status(200).json({ ok: true, existing: true });

    const made = await monday(tok, `mutation { create_item(board_id: ${BOARD}, group_id: "${GROUP}", item_name: ${name}) { id } }`);
    return res.status(200).json({ ok: true, itemId: made.create_item.id });
  } catch (e) {
    return res.status(502).json({ error: "could not record" });
  }
}
