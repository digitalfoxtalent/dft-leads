// SUBPLOT monthly revenue statement.
//
// Pulls last month's AdSense earnings broken down by URL channel, maps each channel to the
// creator whose articles sit under that URL prefix, applies the 60/40 split, and writes one
// row per creator onto Platform Revenue - Money In (all platforms), the same board MSN and
// Meta already report into.
//
// Design rules, because this decides what creators get paid:
//   - Google is the system of record. We snapshot its numbers; we never recompute a closed
//     month. Re-running is a no-op once rows exist.
//   - Every write carries the raw figures it came from, so a statement can be audited without
//     re-querying Google.
//   - Attributed earnings must reconcile against the site total. Anything that does not
//     belong to a creator (home, sections, threads, join) is reported as house revenue on its
//     own row rather than quietly absorbed or spread across creators.
//   - An approved creator with no URL channel is an ALARM, not a zero. Their earnings were
//     never attributed and Google cannot backfill them.
//   - THE RATE CARD IS THE SOURCE OF TRUTH FOR THE SPLIT, not this file. Rates are read live
//     from the Platform Rate Card board so there is one place a rate can be changed. If the
//     rate card cannot be read, or a creator who earned money has no rate on it, we ARCHIVE
//     the month and write NO payout rows. Guessing a split is how someone gets paid wrongly.
//
// Env: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, ADSENSE_REFRESH_TOKEN, MONDAY_API_KEY.
// Manual run: /api/adsense-monthly?month=2026-08&dry=1  (dry returns the statement, writes nothing)

import { CREATORS } from "./_subplot/data.js";
import { archiveMonth } from "./_subplot/archive.js";

const BOARD = 18427528293;
const RATE_CARD = 18427503050;                  // Platform Rate Card — Creator x Platform
const PLATFORM = "SUBPLOT";
const HOUSE_ROW = "House (non-article pages)";

// The rate card's columns. Platform Brand ID holds the SUBPLOT slug — it is the join key,
// pinned to match CREATORS[].slug in _subplot/data.js and the AdSense URL channel.
const RC = {
  platform: "color_mm6d5f1f", slug: "text_mm6dv6p5", pct: "numeric_mm6d3mjj",
  fee: "numeric_mm6dsmpa", status: "color_mm6dg8xv",
};

const COL = {
  creator: "text_mm6dvz37", platform: "color_mm6dh8fr", period: "date_mm6dk5y1",
  total: "numeric_mm6d5zmn", creatorPct: "numeric_mm6dr6mk", payout: "numeric_mm6dq16x",
  dftNet: "numeric_mm6d7xgs", source: "text_mm6d426t", bill: "color_mm6dcq7d",
};

const money = n => Math.round((Number(n) || 0) * 100) / 100;

// ---- Google

async function accessToken() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
      refresh_token: process.env.ADSENSE_REFRESH_TOKEN || "",
      grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error("oauth: " + (j.error_description || j.error || r.status));
  return j.access_token;
}

const api = async (tok, path) => {
  const r = await fetch("https://adsense.googleapis.com/v2/" + path, { headers: { Authorization: "Bearer " + tok } });
  const j = await r.json();
  if (!r.ok) throw new Error("adsense " + path.split("?")[0] + ": " + (j.error?.message || r.status));
  return j;
};

// AdSense returns rows as arrays of cells; name them.
function rows(report) {
  const heads = (report.headers || []).map(h => h.name);
  return (report.rows || []).map(r => {
    const o = {};
    (r.cells || []).forEach((c, i) => { o[heads[i]] = c.value; });
    return o;
  });
}

function reportPath(account, from, to, dims) {
  const q = new URLSearchParams();
  q.set("dateRange", "CUSTOM");
  q.set("startDate.year", from.y); q.set("startDate.month", from.m); q.set("startDate.day", 1);
  q.set("endDate.year", to.y); q.set("endDate.month", to.m); q.set("endDate.day", to.d);
  q.set("currencyCode", "USD");
  for (const d of dims) q.append("dimensions", d);
  for (const m of ["ESTIMATED_EARNINGS", "PAGE_VIEWS", "IMPRESSIONS", "CLICKS"]) q.append("metrics", m);
  return `${account}/reports:generate?${q}`;
}

// ---- monday

async function monday(query, variables) {
  const r = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: process.env.MONDAY_API_KEY || "", "API-Version": "2024-10" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error("monday: " + JSON.stringify(j.errors));
  return j.data;
}

// Which creators already have a row for this period? Re-running must never double-pay.
async function existing(period) {
  const q = `query($b:ID!){boards(ids:[$b]){items_page(limit:500,query_params:{rules:[
    {column_id:"${COL.platform}",compare_value:["${PLATFORM}"]},
    {column_id:"${COL.period}",compare_value:["${period}"]}]}){items{name column_values(ids:["${COL.creator}"]){text}}}}}`;
  const d = await monday(q, { b: String(BOARD) });
  const items = d.boards?.[0]?.items_page?.items || [];
  return new Set(items.map(i => (i.column_values?.[0]?.text || "").trim()));
}

const createItem = (name, vals) => monday(
  `mutation($b:ID!,$n:String!,$v:JSON!){create_item(board_id:$b,item_name:$n,column_values:$v){id}}`,
  { b: String(BOARD), n: name, v: JSON.stringify(vals) });

// Read the SUBPLOT rates off the rate card. Returns slug -> { pct, fee, status, row }.
// SUBPLOT is 60% less a $50 monthly publishing fee (Creator Agreement v3, 28 Sep 2026). The fee
// is read off the rate card, never assumed, so if a row's fee changes this job follows it
// without a deploy.
async function rateCard() {
  const q = `query($b:ID!){boards(ids:[$b]){items_page(limit:500,query_params:{rules:[
    {column_id:"${RC.platform}",compare_value:["${PLATFORM}"]}]}){items{id name column_values(
    ids:["${RC.slug}","${RC.pct}","${RC.fee}","${RC.status}"]){id text}}}}}`;
  const d = await monday(q, { b: String(RATE_CARD) });
  const items = d.boards?.[0]?.items_page?.items || [];
  const card = new Map();
  for (const it of items) {
    const v = Object.fromEntries((it.column_values || []).map(c => [c.id, (c.text || "").trim()]));
    const slug = v[RC.slug];
    if (!slug) continue;                                    // no join key, cannot be trusted
    card.set(slug, {
      row: it.id, name: it.name,
      pct: Number(v[RC.pct]),
      fee: Number(v[RC.fee] || 0),
      status: v[RC.status] || "",
    });
  }
  return card;
}

// The rate card's own formula, verbatim: payout = max(0, round(gross x pct, 2) - fee).
// It floors at zero — a creator never owes DFT.
function payoutFor(gross, rate) {
  if (!rate || rate.status === "Internal — no share") return { pct: 0, fee: 0, payout: 0 };
  const pct = Number.isFinite(rate.pct) ? rate.pct : NaN;
  return { pct, fee: rate.fee, payout: Math.max(0, money(gross * (pct / 100)) - rate.fee) };
}

// ---- handler

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const authed = !secret || req.headers.authorization === "Bearer " + secret || req.headers["x-vercel-cron"];
  if (!authed) return res.status(401).json({ error: "unauthorized" });

  const dry = req.query.dry === "1";
  // Default to the month just gone. AdSense finalises a few days into the new month.
  const now = new Date();
  const [my, mm] = String(req.query.month || "").split("-").map(Number);
  const first = my && mm ? new Date(Date.UTC(my, mm - 1, 1)) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  const period = first.toISOString().slice(0, 10);
  const label = period.slice(0, 7);

  try {
    const tok = await accessToken();
    const accounts = (await api(tok, "accounts")).accounts || [];
    const account = accounts[0]?.name;
    if (!account) throw new Error("no AdSense account on this login");

    const from = { y: first.getUTCFullYear(), m: first.getUTCMonth() + 1 };
    const to = { y: last.getUTCFullYear(), m: last.getUTCMonth() + 1, d: last.getUTCDate() };

    const byChannel = rows(await api(tok, reportPath(account, from, to, ["URL_CHANNEL_NAME"])));
    const siteTotal = rows(await api(tok, reportPath(account, from, to, [])));
    const total = money(siteTotal[0]?.ESTIMATED_EARNINGS);

    // Channel name -> creator. Channels are named for the slug they track.
    const bySlug = new Map(CREATORS.map(c => [c.slug, c]));
    const earned = new Map();
    const unknown = [];
    for (const r of byChannel) {
      const slug = String(r.URL_CHANNEL_NAME || "").trim().replace(/^.*\/a\//, "").replace(/\/$/, "");
      const c = bySlug.get(slug);
      if (!c) { unknown.push({ channel: r.URL_CHANNEL_NAME, earnings: money(r.ESTIMATED_EARNINGS) }); continue; }
      earned.set(c.slug, {
        creator: c, earnings: money(r.ESTIMATED_EARNINGS),
        pageViews: Number(r.PAGE_VIEWS) || 0, impressions: Number(r.IMPRESSIONS) || 0, clicks: Number(r.CLICKS) || 0,
      });
    }

    const attributed = money([...earned.values()].reduce((s, e) => s + e.earnings, 0));
    const house = money(total - attributed);
    // Every approved creator should have a channel. One that does not is unrecoverable money.
    const noChannel = CREATORS.filter(c => !earned.has(c.slug)).map(c => c.slug);

    // Rates come off the rate card, never from a constant in this file.
    const card = await rateCard();
    const noRate = [];                                        // earned money, no usable rate

    const statements = [...earned.values()].map(e => {
      const rate = card.get(e.creator.slug);
      const { pct, fee, payout } = payoutFor(e.earnings, rate);
      if (!rate) noRate.push({ slug: e.creator.slug, why: "no SUBPLOT row on the rate card" });
      else if (rate.status !== "Internal — no share" && !Number.isFinite(rate.pct))
        noRate.push({ slug: e.creator.slug, why: `rate card row ${rate.row} has no Creator %` });
      else if (rate.status !== "Active" && rate.status !== "Internal — no share")
        noRate.push({ slug: e.creator.slug, why: `rate card row ${rate.row} is "${rate.status || "blank"}", not Active` });
      return {
        creator: e.creator.name, slug: e.creator.slug,
        revenue: e.earnings, creatorPct: pct, dftFee: fee,
        payout: money(payout), dftNet: money(e.earnings - payout),
        rateCardRow: rate?.row || null, rateCardStatus: rate?.status || null,
        pageViews: e.pageViews, impressions: e.impressions, clicks: e.clicks,
      };
    }).sort((a, b) => b.revenue - a.revenue);

    const summary = {
      month: label, currency: "USD", siteTotal: total, attributed, house,
      creators: statements.length, statements,
      warnings: {
        creatorsWithNoChannel: noChannel,          // must be empty once every creator is set up
        unrecognisedChannels: unknown,             // a channel we could not map to a creator
        creatorsWithNoRate: noRate,                // BLOCKS the write — see below
        reconciles: money(attributed + house) === total,
      },
    };
    if (dry) return res.status(200).json({ dry: true, ...summary });

    // Archive BEFORE writing any board row. If the archive cannot be written we stop here,
    // leaving nothing half-written, and a retry starts clean. The archive keeps the raw rows
    // Google returned as well as the computed split, so a statement can always be rebuilt.
    const archived = await archiveMonth(label, { ...summary, raw: { byChannel, siteTotal } });

    // The month's data is now safe. Only now do we decide whether it can be PAID from.
    // A missing or unusable rate is not a zero and not a 60% guess — it stops the write.
    // The archive stands, so nothing is lost and a rerun after fixing the board completes it.
    if (noRate.length) {
      return res.status(409).json({
        ...summary, archived, written: [],
        error: "rate card incomplete — no payout rows written",
        fix: `Add or correct the SUBPLOT rows on board ${RATE_CARD}, then re-run this endpoint.`,
      });
    }

    const already = await existing(period);
    const source = `AdSense URL channels, ${label}, pulled ${new Date().toISOString().slice(0, 10)}`;
    const written = [];
    for (const s of statements) {
      if (already.has(s.creator)) continue;                       // closed months are never rewritten
      await createItem(`${s.creator} — ${PLATFORM} — ${label}`, {
        [COL.creator]: s.creator,
        [COL.platform]: { label: PLATFORM },
        [COL.period]: { date: period },
        [COL.total]: s.revenue,
        [COL.creatorPct]: s.creatorPct,
        [COL.payout]: s.payout,
        [COL.dftNet]: s.dftNet,
        [COL.source]: `${source} · rate card row ${s.rateCardRow} (${s.creatorPct}%, fee $${s.dftFee})`,
        [COL.bill]: { label: s.payout > 0 ? "To raise" : "Not required" },
      });
      written.push(s.creator);
    }
    if (house > 0 && !already.has(HOUSE_ROW)) {
      await createItem(`${HOUSE_ROW} — ${PLATFORM} — ${label}`, {
        [COL.creator]: HOUSE_ROW, [COL.platform]: { label: PLATFORM }, [COL.period]: { date: period },
        [COL.total]: house, [COL.creatorPct]: 0, [COL.payout]: 0, [COL.dftNet]: house,
        [COL.source]: source, [COL.bill]: { label: "Not required" },
      });
      written.push(HOUSE_ROW);
    }

    return res.status(200).json({ ...summary, archived, written, skipped: [...already] });
  } catch (e) {
    // Fail loudly. A silent zero month is worse than an error.
    return res.status(500).json({ error: String(e.message || e), month: label });
  }
}
