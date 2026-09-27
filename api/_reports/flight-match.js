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
    const w = windowOf(r);
    if (!w) { res.push({ r, act: "review", why: "no date" }); continue; }
    if (w.a > today - 2 * D) { res.push({ r, act: "future", why: w.why }); continue; }
    // A flight that started in the last 8 days may still be running: wait, so no video is missed.
    if ((r.live || r.pub) && day(r.live || r.pub) > today - 8 * D) { res.push({ r, act: "recent", why: w.why + " (flight may still be running)" }); continue; }
    // Nothing goes live more than a week before the deal closed.
    if (!r.pub && r.closed) w.a = Math.max(w.a, day(r.closed) - 7 * D);
    (byBrand[sq(r.brand)] = byBrand[sq(r.brand)] || []).push({ r, w });
  }
  for (const bk of Object.keys(byBrand)) {
    const brs = byBrand[bk].sort((x, y) => x.w.a - y.w.a);
    const strongV = bk.length >= 3 ? vids.filter(v => (v.u || []).some(u => sq(u).includes(bk))) : [];
    const titleV = vids.filter(v => (v.mt || []).some(b => sq(b) === bk));
    const nameV = vids.filter(v => (v.m || []).some(b => sq(b) === bk));
    let standing = false;
    if (strongV.length >= 8) {
      const a = day(strongV[0].at), b = day(strongV[strongV.length - 1].at);
      const inSpan = vids.filter(v => day(v.at) >= a && day(v.at) <= b).length;
      if (b - a > 90 * D && strongV.length / Math.max(1, inSpan) > 0.4) standing = true;
    }
    const tiers = standing ? [["title", titleV]] : [["link", strongV], ["title", titleV]];
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
        const take = (brs.length === 1 && (r.pub || r.live || monthHint(r))) ? inW : flights[0];
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
  return res;
}
