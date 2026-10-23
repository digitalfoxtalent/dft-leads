// Contract alert email (Tom, 23 Oct 2026). Replaces the monday notification that scenario 6681595
// used to send to the uploader, the sales lead, Alex and Tom.
//
// Tom, 23 Oct 2026: "We can add this to the routing system too please so it only goes to the sales
// lead", and then "Can this run through the routing system too?". So it does: the owner map, the
// sender and the send helper all come from api/route-enquiry.js, which means a salesperson joining
// or leaving is one edit in that file and this follows. The alert goes to the deal's SALES LEAD
// only. Tom is the fallback when a deal has no lead, so an unassigned deal is never silent.
//
// Make 6681595 fires this on a status change: POST {item:"<monday item id>"}.
// No shared secret: the endpoint only ever emails a real US Campaigns row that is sitting at
// Review or Red Flag, and it refuses to send twice for the same review (the ALERT SENT stamp), so
// the worst a stray call can do is nothing at all.
import { OWNERS, BY_MONDAY_ID, BY_MONDAY_NAME, sendInternal } from "./route-enquiry.js";

export const config = { maxDuration: 30 };

const BOARD = "6162879609";
const C = { review: "long_text_mm15j0h2", owner: "deal_owner", status: "color_mm1atc11", tracker: "text_mm5vpm0b" };
const HOST = "roster-viewguarantee.digitalfoxtalent.com";

const monday = async (query, variables) => {
  const r = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: process.env.MONDAY_API_KEY || process.env.MONDAY_API_TOKEN, "API-Version": "2024-10" },
    body: JSON.stringify({ query, variables })
  });
  const j = await r.json();
  if (j.errors) throw new Error(j.errors[0].message);
  return j.data;
};

// Each flag in a CLAUDE REVIEW is "<issue> Ask: <client wording>" under a Red/Orange/Yellow heading.
export function parseFlags(review) {
  const out = []; let level = "";
  for (let line of String(review || "").replace(/\r/g, "").split("\n")) {
    line = line.trim();
    const h = /^(Red|Orange|Yellow)\s+Flags?\b/i.exec(line);
    if (h) { level = h[1].toLowerCase(); continue; }
    if (!level || !/^[*\-•]\s*/.test(line)) continue;
    const body = line.replace(/^[*\-•]\s*/, "");
    const i = body.search(/\bAsk:\s/);
    out.push({ level, issue: (i < 0 ? body : body.slice(0, i)).trim(), ask: i < 0 ? "" : body.slice(i).replace(/^Ask:\s*/, "").trim() });
  }
  return out;
}

export function alertEmail({ review, label, name, item, lead }) {
  const E = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ORANGE = "#f58220", NAVY = "#0f085e", INK = "#1a1a1a", MUTE = "#6b6b76";
  const CREAM = "#f5f3ef", LINE = "#ece9e4", RED = "#d64545", AMBER = "#e0a000";
  const BTN = "https://" + HOST + "/api/roster?op=contract&item=" + encodeURIComponent(item);
  const ROW = "https://digitalfoxtalent.monday.com/boards/" + BOARD + "/pulses/" + encodeURIComponent(item);
  const who = String(lead || "").trim() || "Not set";

  const shell = (accent, kicker, inner, subject) => ({ subject,
    html: '<div style="margin:0;padding:28px 12px;background:' + CREAM + ';font-family:Poppins,Helvetica,Arial,sans-serif;color:' + INK + '">'
      + '<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid ' + LINE + ';border-radius:18px;overflow:hidden">'
      + '<div style="height:5px;background:' + accent + '"></div>'
      + '<div style="padding:34px 38px 10px">'
      + '<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:' + accent + ';font-weight:700">' + E(kicker) + '</div>'
      + '<h1 style="margin:10px 0 0;font-size:21px;line-height:1.3;font-weight:700">' + E(String(name || "").slice(0, 80)) + '</h1>'
      + '<div style="margin:14px 0 0;font-size:13px;color:' + MUTE + '">Sales lead: <strong style="color:' + INK + '">' + E(who) + '</strong></div>'
      + '</div>' + inner
      + '<div style="padding:22px 38px 34px;border-top:1px solid ' + LINE + ';margin-top:28px">'
      + '<a href="' + ROW + '" style="color:' + NAVY + ';font-size:13px;font-weight:600;text-decoration:none">Open the deal in monday &rarr;</a>'
      + '</div></div></div>' });

  const plain = (title, body) => shell(MUTE, "Not reviewed",
    '<div style="padding:18px 38px 0;font-size:15px;line-height:1.6">' + body + '</div>', title);

  const text = String(review || "");
  if (/did not finish/.test(text)) return plain("Contract not reviewed: " + name,
    '<p style="margin:0 0 14px">The automatic review did not finish, so nothing was checked.</p>'
    + '<p style="margin:0;color:' + MUTE + '">Upload the PDF to the CONTRACT column again to retry it, or review it by hand.</p>');
  if (/NOT REVIEWED|Could not read the attached file automatically/.test(text)) {
    const m = text.match(/is (a \.[A-Za-z0-9?]+ file)/) || text.match(/automatically \((\.[A-Za-z0-9?]+)\)/);
    const what = m ? (m[1].indexOf("a ") === 0 ? m[1] : "a " + m[1] + " file") : "not a PDF";
    return plain("Contract not reviewed: " + name,
      '<p style="margin:0 0 14px">The contract on this deal is ' + E(what) + '. Only PDFs can be read automatically.</p>'
      + '<p style="margin:0;color:' + MUTE + '">Save it as a PDF and upload it to the CONTRACT column. It is reviewed about 5 minutes later.</p>');
  }

  const flags = parseFlags(text);
  const colour = { red: RED, orange: ORANGE, yellow: AMBER };
  const word = { red: "Red flag", orange: "Orange flag", yellow: "Yellow flag" };
  const n = k => flags.filter(f => f.level === k).length;
  const askable = flags.filter(f => f.ask && f.level !== "yellow").length;

  let cards = "";
  for (const k of ["red", "orange", "yellow"]) {
    const group = flags.filter(f => f.level === k);
    if (!group.length) continue;
    cards += '<div style="margin:26px 38px 0;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:' + colour[k] + '">'
      + word[k] + (group.length > 1 ? "s" : "") + " · " + group.length + '</div>';
    for (const f of group) {
      cards += '<div style="margin:12px 38px 0;border:1px solid ' + LINE + ';border-left:4px solid ' + colour[k] + ';border-radius:12px;padding:18px 20px">'
        + '<div style="font-size:15px;line-height:1.6">' + E(f.issue) + '</div>'
        + (f.ask ? '<div style="margin-top:14px;background:' + CREAM + ';border-radius:9px;padding:14px 16px">'
          + '<div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:' + MUTE + ';font-weight:700;margin-bottom:7px">What to ask for</div>'
          + '<div style="font-size:14px;line-height:1.6;color:' + INK + '">' + E(f.ask) + '</div></div>' : "")
        + '</div>';
    }
  }

  const button = askable
    ? '<div style="margin:30px 38px 0;padding:22px 24px;background:' + CREAM + ';border-radius:14px;text-align:center">'
      + '<div style="font-size:14px;color:' + MUTE + ';margin-bottom:14px">We have written the ' + askable + ' amendment' + (askable === 1 ? "" : "s")
      + ' above into an email for you. It goes on the brand&rsquo;s own thread, from your mailbox, copying Tom, Alex and Margot.</div>'
      + '<a href="' + BTN + '" style="display:inline-block;background:' + ORANGE + ';color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:10px">Draft the amendment email</a>'
      + '</div>'
    : "";

  // The verdict line, worded by Tom on 23 Oct 2026. A red flag means do not SIGN, not do not
  // invoice: nothing is signed yet. Below red it is the sales lead's judgement call, so the line
  // says how much care it needs rather than implying a blocker.
  const red = n("red") > 0, orange = n("orange") > 0, yellow = n("yellow") > 0;
  const GREEN = "#1f9d55";
  const accent = red ? RED : orange ? ORANGE : yellow ? AMBER : GREEN;
  const kicker = red ? "Red flag \u00b7 don't sign yet"
    : orange ? "Review yourself, and proceed with caution"
    : yellow ? "Review yourself, but probably safe"
    : "Proceed";
  const tally = ["red", "orange", "yellow"].filter(k => n(k)).map(k => n(k) + " " + k).join(", ");
  const summary = tally
    ? '<div style="margin:16px 38px 0;font-size:13px;color:' + MUTE + '">' + E(tally) + ' to work through.</div>'
    : '<div style="margin:16px 38px 0;font-size:13px;color:' + MUTE + '">Nothing flagged. Read it over and sign when you are happy.</div>';
  return shell(accent, kicker, summary + cards + button,
    (red ? "Contract red flag: " : tally ? "Contract reviewed: " : "Contract clear: ") + name + (tally ? " (" + tally + ")" : ""));
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const body = req.method === "POST" ? (typeof req.body === "object" && req.body ? req.body : JSON.parse(await new Promise(r => { let d = ""; req.on("data", c => d += c); req.on("end", () => r(d || "{}")); }))) : (req.query || {});
    const item = String(body.item || "").replace(/\D/g, "");
    if (!item) return res.status(400).json({ error: "item is required" });
    const dry = String(body.dry || "") === "1";

    const d = await monday(`query{items(ids:[${item}]){ id name board{id}
      review: column_values(ids:["${C.review}"]){ text }
      status: column_values(ids:["${C.status}"]){ text }
      tracker: column_values(ids:["${C.tracker}"]){ text }
      lead: column_values(ids:["${C.owner}"]){ text }
      people: column_values(ids:["${C.owner}"]){ ... on PeopleValue { persons_and_teams { id kind } } } }}`);
    const it = (d.items || [])[0];
    if (!it || String((it.board || {}).id) !== BOARD) return res.status(404).json({ error: "Deal not found on US Campaigns" });

    const label = String((it.status[0] || {}).text || "").trim();
    if (label !== "Review" && label !== "Red Flag") return res.status(200).json({ skipped: "status is " + (label || "empty") });

    const review = String((it.review[0] || {}).text || "");
    const tracker = String((it.tracker[0] || {}).text || "");
    // One alert per review: the stamp carries the review's length, so a fresh review sends again.
    const stamp = "ALERTED:" + label + ":" + review.length;
    if (tracker.includes(stamp)) return res.status(200).json({ skipped: "already alerted" });

    const people = ((it.people[0] || {}).persons_and_teams || []).filter(p => (p.kind || "person") === "person");
    let key = people.map(p => BY_MONDAY_ID[String(p.id)]).find(Boolean)
      || BY_MONDAY_NAME[String((it.lead[0] || {}).text || "").split(",")[0].trim()];
    const to = key ? OWNERS[key].email : "tom@digitalfoxtalent.com";

    const mail = alertEmail({ review, label, name: it.name, item, lead: (it.lead[0] || {}).text });
    if (dry) return res.status(200).json({ to, subject: mail.subject, html: mail.html });

    await sendInternal(to, mail.subject, mail.html);
    await monday(`mutation($b:ID!,$i:ID!,$c:String!,$v:String!){change_simple_column_value(board_id:$b,item_id:$i,column_id:$c,value:$v){id}}`,
      { b: BOARD, i: item, c: C.tracker, v: (stamp + " " + tracker).slice(0, 255) });
    return res.status(200).json({ sent: true, to, lead: key || "fallback: Tom", subject: mail.subject });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
