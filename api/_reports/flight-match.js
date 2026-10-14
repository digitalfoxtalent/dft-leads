// Matches a creator's open rows to their uploads, flight by flight. Pure logic, no network.
// Used by the nightly link finder; the same rules were used by hand for the Sept 2026 backfill.
//
// WINDOW per row: DATE PUBLISHED -3/+10 days, else LIVE DATE -5/+35, else a month named in the
// deal or row name (3 days before to 7 after that month), else the deal's close date -5/+100.
// Apart from a publish date, never more than 7 days before the deal closed.
// EVIDENCE, strongest first:
//   link   the description carries a link naming the brand (huel.com/rejects, rula.com/REJECTS)
//   title  the title names the brand (film and game promos often have no link)
// A brand link on 40%+ of uploads over 90+ days is a standing link (not proof), so only titles count.
// FLIGHTS: matching videos with no gap over 9 days are one flight. Several open rows for the same
// brand each take one flight, oldest row first. A lone row with a live, publish or month date takes
// every match in its window. Over 15 matches is left for a person.
// EARLY FILL (Tom, 9 Oct 2026): a flight that started in the last 8 days used to wait until it ended,
// so a live campaign showed nothing on its report for a week. Now, from its live (or publish) date, the
// row is filled as soon as there is a video with a description link naming the brand, but only when it
// is the creator's one open row for that brand (no title-only matches, no spot 1 / spot 2 guessing).
// Later videos of the same flight are added by the unmatched-reads pass's In-flight rule (same link or
// code, inside the row's flight). Anything less certain still waits for the flight to end.

const D = 864e5;
const sq = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const day = s => new Date(s + "T00:00:00Z").getTime();
const iso = t => new Date(t).toISOString().slice(0, 10);
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

export function monthHint(r) {
  const s = (r.deal + " " + r.row).toLowerCase();
  const m = s.match(/(^|[^a-z])(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)(?=[^a-z]|$)/);
  if (!m) return null;
  const mon = MON[m[2].slice(0, 3)];
  const y = s.match(/20(2[4-7])/);
  let year;
  if (y) year = 2000 + Number(y[1]);
  else { const c = new Date(day(r.closed || r.live || r.pub || "2026-01-01") - 30 * D); year = c.getUTCFullYear(); if (mon < c.getUTCMonth()) year++; }
  return { mon, year };
}
export const skipRow = r => /expense|\bexp\b|extra fee|tax fee|cancellation|^fedex$|^amazon$|expense\?/i.test(r.row);
export function windowOf(r) {
  if (r.pub) return { a: day(r.pub) - 3 * D, b: day(r.pub) + 10 * D, why: "published " + r.pub };
  if (r.live) return { a: day(r.live) - 5 * D, b: day(r.live) + 35 * D, why: "live date " + r.live };
  const h = monthHint(r);
  if (h) { const a = Date.UTC(h.year, h.mon, 1), b = Date.UTC(h.year, h.mon + 1, 0); return { a: a - 3 * D, b: b + 7 * D, why: "month in the deal name (" + iso(a).slice(0, 7) + ")" }; }
  if (r.closed) return { a: day(r.closed) - 5 * D, b: day(r.closed) + 100 * D, why: "deal closed " + r.closed };
  return null;
}
export const sinceFor = rows => { const ws = rows.map(windowOf).filter(Boolean).map(w => w.a); return ws.length ? iso(Math.min(...ws) - 7 * D) : null; };
const cluster = (vs, gap) => { const out = []; let cur = []; for (const v of vs) { if (cur.length && day(v.at) - day(cur[cur.length - 1].at) > gap * D) { out.push(cur); cur = []; } cur.push(v); } if (cur.length) out.push(cur); return out; };

// vids: /scan output for one creator (sorted by date); rows: that creator's open rows.
// Returns [{ r, act: link|title|weak|none|review|future|skip, why, vids }]
export function matchRows(vids, rows, now) {
  const res = [], today = now || Date.now(), byBrand = {};
  for (const r of rows) {
    if (skipRow(r)) { res.push({ r, act: "skip", why: "not a content row" }); continue; }
    // A deal with no brand set falls back to the first word of its name, which is sometimes the
    // creator ("Cosmic Wonder_SonyMarvelWolverine_Sept2026"): that would match the creator's own links.
    const me = sq(r.h).replace(/^the/, ""), bq = sq(r.brand).replace(/^the/, "");
    if (me.length >= 4 && bq && (bq.includes(me) || me.includes(bq))) { res.push({ r, act: "review", why: "no brand set on the deal" }); continue; }
    const w = windowOf(r);
    if (!w) { res.push({ r, act: "review", why: "no date" }); continue; }
    if (w.a > today - 2 * D) { res.push({ r, act: "future", why: w.why }); continue; }
    // A flight that started in the last 8 days may still be running. One that has not started yet waits;
    // one that has started is matched now, but only a sure match is kept (EARLY FILL above).
    let early = false;
    if ((r.live || r.pub) && day(r.live || r.pub) > today - 8 * D) {
      if (day(r.live || r.pub) > today) { res.push({ r, act: "recent", why: w.why + " (not live yet)" }); continue; }
      early = true;
    }
    // Nothing goes live more than a week before the deal closed.
    if (!r.pub && r.closed) w.a = Math.max(w.a, day(r.closed) - 7 * D);
    (byBrand[sq(r.brand)] = byBrand[sq(r.brand)] || []).push({ r, w, early });
  }
  const start = res.length;
  for (const bk of Object.keys(byBrand)) {
    const brs = byBrand[bk].sort((x, y) => x.w.a - y.w.a);
    // Several open rows for this brand and one of them still running: which video is which spot is
    // clearer once the flight is over, so the running ones wait.
    if (brs.length > 1 && brs.some(b => b.early)) {
      for (const b of brs.filter(x => x.early)) res.push({ r: b.r, act: "recent", why: b.w.why + " (flight may still be running; " + brs.length + " open rows for this brand)" });
      for (let i = brs.length - 1; i >= 0; i--) if (brs[i].early) brs.splice(i, 1);
      if (!brs.length) continue;
    }
    const strongV = bk.length >= 3 ? vids.filter(v => (v.u || []).some(u => sq(u).includes(bk))) : [];
    const titleV = vids.filter(v => (v.mt || []).some(b => sq(b) === bk));
    const nameV = vids.filter(v => (v.m || []).some(b => sq(b) === bk));
    let standing = false;
    if (strongV.length >= 8) {
      const a = day(strongV[0].at), b = day(strongV[strongV.length - 1].at);
      const inSpan = vids.filter(v => day(v.at) >= a && day(v.at) <= b).length;
      if (b - a > 90 * D && strongV.length / Math.max(1, inSpan) > 0.4) standing = true;
    }
    // A brand link on nearly every upload across these rows' windows (80%+, 6+ videos) says nothing
    // about which upload carried the read: leave those rows to a person.
    const spanA = Math.min(...brs.map(b => b.w.a)), spanB = Math.max(...brs.map(b => b.w.b));
    const upl = vids.filter(v => day(v.at) >= spanA && day(v.at) <= spanB && !(v.s < 70));
    const lk = upl.filter(v => strongV.includes(v));
    if (!standing && lk.length >= 6 && lk.length / Math.max(1, upl.length) >= 0.8) {
      for (const { r, w } of brs) res.push({ r, act: "review", why: w.why + "; the brand link is on " + lk.length + " of " + upl.length + " uploads in the window, so which one carried the read is unclear", vids: lk.slice(0, 5) });
      continue;
    }
    // Two or more open rows on the SAME deal for this creator (spot 1, spot 2 of one booking): which
    // upload was which spot is a judgement call, so those rows go to a person.
    const perDeal = {}; for (const b of brs) perDeal[b.r.dealId || b.r.deal] = (perDeal[b.r.dealId || b.r.deal] || 0) + 1;
    const sameDeal = brs.filter(b => perDeal[b.r.dealId || b.r.deal] > 1);
    for (const b of sameDeal) res.push({ r: b.r, act: "review", why: b.w.why + "; " + perDeal[b.r.dealId || b.r.deal] + " open rows for this creator on one deal", vids: strongV.filter(v => day(v.at) >= b.w.a && day(v.at) <= b.w.b).slice(0, 6) });
    if (sameDeal.length) { for (const b of sameDeal) brs.splice(brs.indexOf(b), 1); if (!brs.length) continue; }
    const tiers = standing ? [["title", titleV]] : (brs.length === 1 && brs[0].early) ? [["link", strongV]] : [["link", strongV], ["title", titleV]];
    const claimed = new Set();
    for (const { r, w } of brs) {
      let done = false;
      for (const [tier, pool] of tiers) {
        const inW = pool.filter(v => !claimed.has(v.v) && day(v.at) >= w.a && day(v.at) <= w.b);
        if (!inW.length) continue;
        // Several open rows for this brand: one flight each. A flight is one evidence link (two deals
        // for the same brand in one month used different links) with no gap over 9 days.
        const key = v => tier === "link" ? String((v.u || []).find(u => sq(u).includes(bk)) || "").toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "") : "t";
        const groups = {}; for (const v of inW) (groups[key(v)] = groups[key(v)] || []).push(v);
        const flights = Object.values(groups).flatMap(g => cluster(g, 9)).sort((x, y) => day(x[0].at) - day(y[0].at));
        // With several rows, a row with a live date takes its own week first (TRR runs spots two weeks apart).
        const wk = r.live ? inW.filter(v => day(v.at) >= day(r.live) - 3 * D && day(v.at) <= day(r.live) + 10 * D) : [];
        const take = (brs.length === 1 && (r.pub || r.live || monthHint(r))) ? inW : (wk.length ? wk : flights[0]);
        if (take.length > 15) { res.push({ r, act: "review", why: take.length + " " + tier + " matches in the window", vids: take.slice(0, 5) }); done = true; break; }
        for (const v of take) claimed.add(v.v);
        res.push({ r, act: tier, sole: brs.length === 1, why: w.why + (standing ? "; the brand link is a standing link, so titles only" : ""), vids: take.map(v => ({ ...v, ev: tier === "link" ? (v.u || []).find(u => sq(u).includes(bk)) : "title names " + r.brand })) });
        done = true; break;
      }
      if (!done) {
        const weak = nameV.filter(v => day(v.at) >= w.a && day(v.at) <= w.b);
        res.push({ r, act: weak.length ? "weak" : "none", why: w.why, vids: weak.slice(0, 4) });
      }
    }
    // Second pass: a matched row with a tight window (publish, live or month date) also takes the
    // leftover matches in its window that fall in no other open row's window for this brand.
    if (brs.length > 1) for (const x of res) {
      if (x.act !== "link" || sq(x.r.brand) !== bk || !(x.r.pub || x.r.live || monthHint(x.r))) continue;
      const me = brs.find(b => b.r === x.r); if (!me) continue;
      const extra = strongV.filter(v => !claimed.has(v.v) && day(v.at) >= me.w.a && day(v.at) <= me.w.b && !brs.some(b => b !== me && day(v.at) >= b.w.a && day(v.at) <= b.w.b));
      for (const v of extra) { claimed.add(v.v); x.vids.push({ ...v, ev: (v.u || []).find(u => sq(u).includes(bk)) }); }
      x.vids.sort((p, q) => day(p.at) - day(q.at));
    }
  }
  // A running flight keeps only a sure match: anything else waits for the flight to end, as before.
  for (let i = start; i < res.length; i++) {
    const x = res[i], b = Object.values(byBrand).flat().find(y => y.r === x.r);
    if (!b || !b.early) continue;
    if (x.act === "link" && writable(x)) { x.early = true; x.why += " (flight still running: filled early)"; continue; }
    res[i] = { r: x.r, act: "recent", why: (b.w.why || "") + " (flight may still be running)", vids: x.vids };
  }
  return res;
}

// Which matches are safe to write without a person. Shared by the nightly finder and the Sept 2026 backfill.
//   link   a description link naming the brand, 1-15 videos; a brand that is a common word must be in the link's domain
//   title  only when this is the creator's one open row for the brand, the name is distinctive (6+ letters,
//          not a common word) and the window is tight (publish, live or month date), or the name is long (9+)
export const COMMON = /^(factor|fox|beam|outcome|meta|opera|recall|worthy|backseat|webtoon|warhammer|naruto|pretty woman|addicted|like a prayer|open up|in my room|hairdresser|pomegranate|lemonade|human)$/i;
export const writable = d => {
  if (!d.vids || !d.vids.length || d.vids.length > 15) return false;
  if (d.act === "link") return !COMMON.test(String(d.r.brand || "").trim()) || d.vids.every(v => String(v.ev || "").split("/")[0].toLowerCase().replace(/[^a-z0-9]/g, "").includes(String(d.r.brand).toLowerCase().replace(/[^a-z0-9]/g, ""))); // a common word must be in the link's domain
  if (d.act !== "title" || !d.sole) return false; // title matches only when this is the creator's one open row for the brand
  const b = String(d.r.brand || "").trim();
  const n = b.replace(/[^a-z0-9]/gi, "").length;
  if (COMMON.test(b) || n < 6) return false;
  return !!(d.r.pub || d.r.live || monthHint(d.r)) || n >= 9; // a long, distinctive name (a film title) holds even on a close-date window
};
