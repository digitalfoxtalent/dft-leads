// Weekly media kit refresh for Channel Connect creators.
//
// GOAL (Tom, 6-8 Oct 2026): a current media kit and audience stats on every Global Talent
// Roster row, refreshed automatically for creators connected through Channel Connect, and an
// Audience stats link on the roster site that draws from those media kits.
//
// WHAT IT DOES, every day (vercel.json cron), for every row on Creator YouTube Access
// (monday 18432126799):
//   1. Works out the channel id. If the row has none, it takes the UC id from the Rates board
//      row linked to the same Global Talent Roster row, and writes it back onto the access row.
//   2. Opens the creator's brand audience page on Channel Connect as data
//      (connect.digitalfoxtalent.com/api/kit?format=json). That page answers 200 when the
//      channel is connected, 404 when it never was, 410 when the creator removed access.
//   3. Connected: puts the audience page link and today's date on the GTR row ("Media kit",
//      "Media kit updated"), writes age, gender, US and UK onto the channel's Rates board rows
//      (YouTube and YouTube Shorts groups only, matched by channel id), and marks the access
//      row Granted / Healthy / Live (Channel Connect) with today as Last verified.
//   4. Access removed: marks the access row Revoked and takes the Channel Connect link off the
//      GTR row, so the roster site stops showing a dead link. Manual media kit links (anything
//      not on connect.digitalfoxtalent.com) are never touched.
//
// THE LINK IS SIGNED. Channel Connect signs every link with STATS_SECRET. This job reads that
// secret at run time from the API Keys board (item 13197661446), the same way the Megaphone
// and decline tokens are read, so there is one copy of it and nothing to set in Vercel. It is
// never logged or returned. The "kit" signature opens the brand audience page only: it cannot
// open the internal stats page or the remove-access link.
//
// WHY DAILY. Daily from 8 Oct 2026 while the shared-link outreach runs, so a creator who
// connects shows as Live the next day. Audience mix moves slowly, so once most of the roster
// has connected this can go back to weekly ("15 12 * * 1") to save API calls.
//
// Runs: Vercel cron (daily 12:15 UTC), or a signed-in DFT team member opening
// https://roster-viewguarantee.digitalfoxtalent.com/api/kit-sync
//   ?dry=1          work it all out and report, write nothing
//   ?only=UC...     one channel
import crypto from "node:crypto";
import { isCron } from "./_reports/cron.js";
import { teamEmail } from "./_reports/access.js";
import { monday, mondayToken } from "./_reports/monday.js";

export const config = { maxDuration: 300 };

const CONNECT = "https://connect.digitalfoxtalent.com";
const KEY_ITEM = 13197661446; // API Keys: "Channel Connect STATS_SECRET (dft-connect Vercel)"
const KEY_COL = "text_mm5bcxe7";
const CHANNEL_RE = /^UC[A-Za-z0-9_-]{22}$/;

const ACCESS_BOARD = 18432126799;
const A = { chan: "text_mm7df591", status: "color_mm7dpp3w", health: "color_mm7d6evf", verified: "date_mm7dvyy5", roster: "link_mm7wf7qv", kit: "color_mm7wzqqz" };
const GTR_BOARD = 6160485039;
const G = { kit: "link_mm7y59q3", kitDate: "date_mm7yb1h5" };
const RATES_BOARD = 18417663127;
const RATES_GROUPS = ["topics", "group_mm4av3kr"]; // YouTube channels, YouTube Shorts
const R = {
  src: "text_mm49b3x7", handle: "text_mm49w81b", rel: "board_relation_mm49w1a4",
  male: "text_mm5nkdfn", female: "text_mm5nb2t7",
  "age13-17": "text_mm5n6m90", "age18-24": "text_mm5n69hv", "age25-34": "text_mm5nbatb",
  "age35-44": "text_mm5n7syq", "age45-54": "text_mm5n5cc8", "age55-64": "text_mm5nzj3n",
  us: "text_mm5nsagz", uk: "text_mm5n7ybc",
};
const AGE_KEYS = ["age13-17", "age18-24", "age25-34", "age35-44", "age45-54", "age55-64"];

const today = () => new Date().toISOString().slice(0, 10);
const hkey = h => String(h || "").toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_.-]/g, "");
const pctText = n => (n == null || isNaN(n) ? null : Math.round(n) + "%");
const isOurs = url => String(url || "").startsWith(CONNECT + "/");

function kitLink(secret, channel) {
  const t = crypto.createHmac("sha256", secret).update("kit:" + channel).digest("base64url").slice(0, 32);
  return `${CONNECT}/api/kit?k=${encodeURIComponent(channel)}&t=${t}`;
}

async function readSecret(tok) {
  const d = await monday(tok, `query { items(ids:[${KEY_ITEM}]) { column_values(ids:["${KEY_COL}"]) { text } } }`);
  return String((d.items[0] && d.items[0].column_values[0].text) || "").trim();
}

const colMap = cvs => Object.fromEntries((cvs || []).map(c => [c.id, c]));

async function accessRows(tok) {
  const ids = JSON.stringify(Object.values(A));
  const d = await monday(tok, `query { boards(ids:[${ACCESS_BOARD}]) { items_page(limit:500) { items { id name column_values(ids:${ids}) { id text value } } } } }`);
  return d.boards[0].items_page.items.map(it => {
    const c = colMap(it.column_values);
    let roster = null;
    try { roster = JSON.parse(c[A.roster].value || "null"); } catch (e) { roster = null; }
    const gtr = /\/pulses\/(\d+)/.exec((roster && roster.url) || "");
    return { id: it.id, name: it.name, channel: (c[A.chan].text || "").trim(), status: c[A.status].text, gtrId: gtr ? gtr[1] : null };
  });
}

async function ratesRows(tok) {
  const ids = JSON.stringify([R.src, R.handle, R.rel]);
  const d = await monday(tok, `query { boards(ids:[${RATES_BOARD}]) { groups(ids:${JSON.stringify(RATES_GROUPS)}) { id items_page(limit:500) { items { id name
    column_values(ids:${ids}) { id text ... on BoardRelationValue { linked_item_ids } } } } } } }`);
  const out = [];
  d.boards[0].groups.forEach(g => g.items_page.items.forEach(it => {
    const c = colMap(it.column_values);
    out.push({ id: it.id, name: it.name, group: g.id, src: (c[R.src].text || "").trim(), handle: c[R.handle].text || "", gtrIds: (c[R.rel].linked_item_ids || []).map(String) });
  }));
  return out;
}

async function gtrKitLinks(tok, gtrIds) {
  if (!gtrIds.length) return {};
  const d = await monday(tok, `query { items(ids:[${gtrIds.join(",")}], limit:100) { id column_values(ids:["${G.kit}"]) { value } } }`);
  const out = {};
  d.items.forEach(it => {
    let v = null;
    try { v = JSON.parse(it.column_values[0].value || "null"); } catch (e) { v = null; }
    out[it.id] = (v && v.url) || "";
  });
  return out;
}

// The channel id for an access row with none: the UC id on the YouTube-group Rates row linked
// to the same roster row. When a roster row has several channels, the handle decides.
function channelFor(row, rates) {
  if (!row.gtrId) return null;
  const linked = rates.filter(r => r.group === "topics" && r.gtrIds.includes(row.gtrId) && CHANNEL_RE.test(r.src));
  const ids = [...new Set(linked.map(r => r.src))];
  if (ids.length === 1) return ids[0];
  const byHandle = linked.find(r => hkey(r.handle) === hkey(row.name));
  return byHandle ? byHandle.src : null;
}

async function probe(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(url + "&format=json", { signal: ctrl.signal });
    if (r.status === 200) return { state: "connected", data: await r.json() };
    if (r.status === 404) return { state: "not-connected" };
    if (r.status === 410) return { state: "revoked" };
    return { state: "error", code: r.status };
  } catch (e) {
    return { state: "error", code: e.name === "AbortError" ? "timeout" : "fetch" };
  } finally {
    clearTimeout(timer);
  }
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

async function write(tok, board, item, values) {
  const v = JSON.stringify(JSON.stringify(values));
  await monday(tok, `mutation { change_multiple_column_values(board_id:${board}, item_id:${item}, column_values:${v}, create_labels_if_missing:false) { id } }`);
}

// Rates board audience columns from the kit data, in the board's own "56%" format. A bracket
// YouTube left out is 0% of viewers; US or UK outside the top ten countries is left as it was.
function ratesValues(k) {
  if (!k.hasDemographics) return null;
  const v = {};
  if (k.male != null) v[R.male] = pctText(k.male);
  if (k.female != null) v[R.female] = pctText(k.female);
  AGE_KEYS.forEach(a => { v[R[a]] = pctText((k.ages && k.ages[a]) || 0); });
  if (k.us != null) v[R.us] = pctText(k.us);
  if (k.uk != null) v[R.uk] = pctText(k.uk);
  return v;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const tok = mondayToken();
  if (!tok) return res.status(500).json({ error: "MONDAY_API_KEY not set" });
  if (!isCron(req) && !teamEmail(req, tok)) return res.status(401).json({ error: "unauthorized" });

  const dry = req.query.dry === "1";
  const only = CHANNEL_RE.test(String(req.query.only || "")) ? req.query.only : null;
  const day = today();
  const report = { at: new Date().toISOString(), dry, connected: [], revoked: [], cleared: [], channelIdsFilled: [], noChannel: [], errors: [] };

  try {
    const secret = await readSecret(tok);
    if (secret.length < 20) return res.status(500).json({ error: "STATS_SECRET row on the API Keys board is empty" });

    const [access, rates] = await Promise.all([accessRows(tok), ratesRows(tok)]);
    let rows = access.map(r => {
      const derived = CHANNEL_RE.test(r.channel) ? null : channelFor(r, rates);
      return Object.assign(r, { channel: CHANNEL_RE.test(r.channel) ? r.channel : derived, filled: !!derived });
    });
    if (only) rows = rows.filter(r => r.channel === only);
    rows.filter(r => !r.channel && r.gtrId).forEach(r => report.noChannel.push(r.name));
    rows = rows.filter(r => r.channel);

    const links = await gtrKitLinks(tok, [...new Set(rows.map(r => r.gtrId).filter(Boolean))]);
    const results = await pool(rows, 5, r => probe(kitLink(secret, r.channel)));

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], p = results[i], url = kitLink(secret, r.channel);
      try {
        if (r.filled) {
          report.channelIdsFilled.push(r.name);
          if (!dry) await write(tok, ACCESS_BOARD, r.id, { [A.chan]: r.channel });
        }
        if (p.state === "connected") {
          const rv = ratesValues(p.data);
          const rateRows = rates.filter(x => x.src === r.channel && (!r.gtrId || x.gtrIds.includes(r.gtrId)));
          report.connected.push({ name: r.name, ratesRows: rateRows.length, demographics: !!rv });
          if (dry) continue;
          await write(tok, ACCESS_BOARD, r.id, { [A.status]: { label: "Granted" }, [A.health]: { label: "Healthy" }, [A.kit]: { label: "Live (Channel Connect)" }, [A.verified]: { date: day } });
          if (r.gtrId) await write(tok, GTR_BOARD, r.gtrId, { [G.kit]: { url, text: "Audience stats (live)" }, [G.kitDate]: { date: day } });
          if (rv) for (const x of rateRows) await write(tok, RATES_BOARD, x.id, rv);
        } else if (p.state === "revoked" || p.state === "not-connected") {
          const ours = r.gtrId && isOurs(links[r.gtrId]);
          if (p.state === "revoked") report.revoked.push(r.name);
          if (ours) report.cleared.push(r.name);
          if (dry) continue;
          if (p.state === "revoked") await write(tok, ACCESS_BOARD, r.id, { [A.status]: { label: "Revoked" }, [A.health]: { label: "Revoked" }, [A.verified]: { date: day } });
          if (ours) {
            await write(tok, GTR_BOARD, r.gtrId, { [G.kit]: "", [G.kitDate]: "" });
            await write(tok, ACCESS_BOARD, r.id, { [A.kit]: { label: "Missing" } });
          }
        } else {
          report.errors.push({ name: r.name, code: p.code });
        }
      } catch (e) {
        report.errors.push({ name: r.name, code: String(e.message || e).slice(0, 160) });
      }
    }
    report.checked = rows.length;
    return res.status(200).json(report);
  } catch (e) {
    return res.status(500).json(Object.assign(report, { error: String(e.message || e).slice(0, 300) }));
  }
}
