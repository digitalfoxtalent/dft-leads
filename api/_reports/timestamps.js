// Ad read timestamps: where in each campaign video the sponsor read sits. READ ONLY (probe stage).
//
// Source 1: SponsorBlock (sponsor.ajay.app), a free public database where viewers mark sponsor
// segments on YouTube videos. Only segments with a non-negative vote score count, locked ones first.
// Source 2 (to come): the video's captions, first mention of the brand, for videos with no segment.

const SB = "https://sponsor.ajay.app/api/skipSegments";

async function one(id) {
  const r = await fetch(SB + "?videoID=" + encodeURIComponent(id) + "&categories=" + encodeURIComponent('["sponsor"]'), { headers: { "User-Agent": "DFT campaign reporting (reports.digitalfoxtalent.com)" } });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error("SponsorBlock " + r.status);
  const j = await r.json();
  return (Array.isArray(j) ? j : []).filter(x => (x.votes || 0) >= 0).map(x => ({ s: Math.round(x.segment[0]), e: Math.round(x.segment[1]), v: x.votes || 0, l: x.locked ? 1 : 0, d: Math.round(x.videoDuration || 0) }))
    .sort((a, b) => b.l - a.l || b.v - a.v || a.s - b.s);
}

export async function sponsorSegments(ids) {
  const out = {}, err = {}; let next = 0;
  const list = [...new Set(ids)].filter(x => /^[A-Za-z0-9_-]{11}$/.test(x));
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < list.length) { const id = list[next++]; try { out[id] = await one(id); } catch (e) { err[id] = String(e && e.message || e).slice(0, 80); } }
  }));
  return { segs: out, errors: err };
}

const mmss = t => (t >= 3600 ? Math.floor(t / 3600) + ":" + String(Math.floor(t % 3600 / 60)).padStart(2, "0") : Math.floor(t / 60)) + ":" + String(t % 60).padStart(2, "0");

// Probe: how many of a partner's campaign videos already have a sponsor segment marked.
export async function timestampProbe(payload, match) {
  const vids = [];
  for (const c of payload.c) if (match.test(c.cl || "")) for (const r of c.r) for (const v of r.v) vids.push({ v, b: c.b, cr: r.h, p: r.p });
  const { segs, errors } = await sponsorSegments(vids.map(x => x.v));
  const withSeg = vids.filter(x => (segs[x.v] || []).length);
  return { videos: vids.length, distinct: Object.keys(segs).length + Object.keys(errors).length, marked: new Set(withSeg.map(x => x.v)).size, errors: Object.keys(errors).length,
    sample: withSeg.slice(0, 12).map(x => [x.v, x.b, x.cr, segs[x.v].map(s => mmss(s.s) + "-" + mmss(s.e) + (s.l ? " locked" : " v" + s.v)).join(" | ")]),
    unmarked: vids.filter(x => !(segs[x.v] || []).length && !errors[x.v]).slice(0, 8).map(x => [x.v, x.b, x.cr]) };
}

// Source 2: captions. One transcript per video through Apify (supreme_coder/youtube-transcript-scraper,
// about $0.0007 a video), then every caption line that names the brand.
const atok = () => process.env.APIFY_TOKEN || "";
const flat = s => String(s || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
export async function transcripts(ids) {
  if (!atok()) throw new Error("APIFY_TOKEN missing");
  const A = "https://api.apify.com/v2";
  let r = await fetch(A + "/acts/supreme_coder~youtube-transcript-scraper/runs?waitForFinish=60&maxTotalChargeUsd=1&token=" + atok(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ urls: ids.map(id => ({ url: "https://www.youtube.com/watch?v=" + id })), outputFormat: "json" }) });
  if (!r.ok) throw new Error("Apify transcripts " + r.status + " " + (await r.text()).slice(0, 160));
  let run = (await r.json()).data; const t0 = Date.now();
  while (!/SUCCEEDED|FAILED|ABORTED|TIMED-OUT/.test(run.status) && Date.now() - t0 < 200000) {
    r = await fetch(A + "/actor-runs/" + run.id + "?waitForFinish=60&token=" + atok()); run = (await r.json()).data;
  }
  if (!/SUCCEEDED/.test(run.status)) throw new Error("Apify transcripts run " + run.status);
  r = await fetch(A + "/datasets/" + run.defaultDatasetId + "/items?clean=1&token=" + atok());
  const out = {};
  for (const it of await r.json()) { const m = String(it.videoUrl || it.inputUrl || "").match(/v=([A-Za-z0-9_-]{11})/); if (m && Array.isArray(it.transcript)) out[m[1]] = it.transcript; }
  return out;
}
// Auto captions mishear brand names ("Huel's" comes out as "Hules"), so a caption word also counts
// when, after dropping a plural or possessive s, it is one swap of neighbouring letters away from a
// brand word, or one letter away for brand words of 6 letters or more.
function near(w, k) {
  if (w === k) return true;
  if (Math.abs(w.length - k.length) > 1) return false;
  if (w.length === k.length) { const d = []; for (let i = 0; i < w.length; i++) if (w[i] !== k[i]) d.push(i);
    if (d.length === 2 && d[1] === d[0] + 1 && w[d[0]] === k[d[1]] && w[d[1]] === k[d[0]]) return true;
    return k.length >= 6 && d.length === 1; }
  if (k.length < 6) return false;
  const [a, b] = w.length < k.length ? [w, k] : [k, w]; let i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(i) === b.slice(i + 1);
}
export function brandHits(tr, brand) {
  const keys = [flat(brand)].concat(String(brand || "").split(/\s+/).map(flat).filter(w => w.length >= 5)).filter(Boolean);
  const words = String(brand || "").split(/\s+/).map(flat).filter(w => w.length >= 4);
  const hits = [];
  for (let i = 0; i < tr.length; i++) {
    const text = (tr[i].text || "") + " " + ((tr[i + 1] || {}).text || "");
    const win = flat(text); // a name split across two caption lines
    const toks = String(text).toLowerCase().replace(/&#39;|'/g, "").split(/[^a-z0-9]+/).filter(Boolean).map(t => t.length > 4 ? t.replace(/s$/, "") : t);
    if (keys.some(k => win.includes(k)) || toks.some(t => words.some(k => near(t, k)))) { const t = Math.round(tr[i].start || 0); if (!hits.length || t - hits[hits.length - 1] > 20) hits.push(t); }
  }
  return hits;
}
export async function timestampCheck(id, brand, at) {
  const [{ segs }, tr] = await Promise.all([sponsorSegments([id]), transcripts([id])]);
  const t = tr[id] || [];
  const main = at != null && at !== "" ? { s: Number(at) } : (segs[id] || []).filter(x => x.e - x.s >= 15)[0];
  const around = main ? t.filter(x => x.start >= main.s - 5 && x.start <= main.s + 60).map(x => x.text).join(" ").slice(0, 700) : "";
  return { id, brand, sponsorBlock: (segs[id] || []).map(s => mmss(s.s) + "-" + mmss(s.e) + (s.l ? " locked" : " v" + s.v)), captions: t.length, brandMentions: brandHits(t, brand).map(mmss), around, line: lineFor(id, segs[id] || [], t, brand) };
}

// ── Write step: AD READ TIMES (long_text_mm7kw197) on each creator row, one line per video ────────
//   <videoId> read 52:47-54:07 | mention 0:00 | sponsorblock+captions
// read: a SponsorBlock sponsor segment that the captions confirm names this brand (±15s), else the
//   first caption line naming the brand after the first minute. Unconfirmed SponsorBlock segments are
//   written as "check" (a multi-sponsor video can carry another brand's segment; seen on TRR 27 Sep),
//   and only confirmed reads are shown to partners. mention: brand named in the first minute (the "brought to you by" line).
// Rows are only filled for videos not already listed, so a run can be repeated safely.
const COL = "long_text_mm7kw197";
const HEAD = "Ad read times (into the video; the podcast copy has the read at the same point, after any pre-roll)";
const PHRASES = ["sponsoredby", "sponsorofthis", "todayssponsor", "thisvideosponsor", "broughttoyouby", "partneredwith", "usecode", "promocode", "withcode", "linkinthedescription", "linkdownbelow", "linkbelow"];
function phraseHits(tr) {
  const hits = [];
  for (let i = 0; i < tr.length; i++) {
    const win = flat((tr[i].text || "") + " " + ((tr[i + 1] || {}).text || ""));
    if (PHRASES.some(k => win.includes(k))) { const t = Math.round(tr[i].start || 0); if (!hits.length || t - hits[hits.length - 1] > 60) hits.push(t); }
  }
  return hits;
}
function lineFor(id, segs, tr, brand) {
  const hasTr = !!(tr && tr.length);
  const hits = hasTr ? brandHits(tr, brand) : [];
  const intro = hits.filter(h => h < 60), body = hits.filter(h => h >= 60);
  const main = segs.filter(x => x.e - x.s >= 15);
  const span = x => mmss(x.s) + "-" + mmss(x.e);
  let read = null, src = "";
  const ok = hasTr ? main.filter(x => hits.some(h => h >= x.s - 15 && h <= x.e + 15)) : [];
  if (ok.length) { read = ok.map(span).join(", "); src = "sponsorblock+captions"; }
  else if (body.length) { read = "~" + mmss(body[0]); src = "captions"; }
  else if (main.length) { read = "check " + main.map(span).join(", "); src = hasTr ? "sponsorblock, not confirmed by captions" : "sponsorblock, no captions to confirm"; }
  else if (hasTr) {
    const ph = phraseHits(tr).filter(h => h >= 60);
    if (ph.length === 1) { read = "~" + mmss(ph[0]); src = "captions (sponsor wording, brand name not heard)"; }
    else if (ph.length > 1) { read = "check ~" + ph.slice(0, 3).map(mmss).join(", ~"); src = "captions (sponsor wording at several points)"; }
  }
  const parts = [id, read ? "read " + read : "read not found"];
  if (intro.length) parts.push("mention " + mmss(intro[0]));
  parts.push(src || (hasTr ? "captions" : "no captions"));
  return parts[0] + " " + parts.slice(1).join(" | ") + " | v3";
}
export async function timestampApply(token, payload, match, opts) {
  const { monday } = await import("./monday.js");
  const dry = !!opts.dry; const max = Math.min(60, Math.max(5, parseInt(opts.max, 10) || 30));
  // The report payload is cached; read this column fresh so a repeated run moves on.
  const cand = []; for (const c of payload.c) if (!match || match.test(c.cl || "")) for (const r of c.r) if (r.v.length) cand.push({ c, r });
  const fresh = {};
  for (let i = 0; i < cand.length; i += 100) {
    const d = await monday(token, "query { items(ids:[" + cand.slice(i, i + 100).map(x => x.r.id).join(",") + "], limit:100) { id column_values(ids:[\"" + COL + "\"]) { text } } }");
    for (const it of d.items) fresh[it.id] = (it.column_values[0] && it.column_values[0].text) || "";
  }
  const rows = [];
  for (const { c, r: r0 } of cand) {
    const r = Object.assign({}, r0, { at: fresh[r0.id] != null ? fresh[r0.id] : r0.at });
    // Kept: confirmed lines, and anything from the current version. Everything else is worked out again once.
    const keep = l => /^[A-Za-z0-9_-]{11}\s/.test(l.trim()) && (/\| v3$/.test(l.trim()) || (/\| (sponsorblock\+captions|captions)$/.test(l.trim()) && !/read not found/.test(l)));
    const have = new Set(String(r.at || "").split("\n").filter(keep).map(l => l.trim().slice(0, 11)));
    const todo = r.v.filter(v => !have.has(v));
    if (todo.length) rows.push({ id: r.id, b: c.b, at: r.at || "", todo });
  }
  const pick = []; let n = 0;
  for (const r of rows) { if (n && n + r.todo.length > max) break; pick.push(r); n += r.todo.length; }
  const ids = [...new Set(pick.flatMap(r => r.todo))];
  const [{ segs }, tr] = await Promise.all([sponsorSegments(ids), ids.length ? transcripts(ids) : {}]);
  const writes = [];
  for (const r of pick) {
    const old = String(r.at || "").split("\n").filter(l => /^[A-Za-z0-9_-]{11}\s/.test(l.trim()) && !r.todo.includes(l.trim().slice(0, 11)));
    const add = r.todo.map(v => lineFor(v, segs[v] || [], tr[v], r.b));
    writes.push({ id: r.id, b: r.b, lines: add, text: [HEAD].concat(old, add).join("\n") });
  }
  const failed = [];
  if (!dry) for (let i = 0; i < writes.length; i += 10) {
    const b = writes.slice(i, i + 10);
    const q = b.map((w, k) => "m" + k + ":change_multiple_column_values(board_id:6162879732,item_id:" + w.id + ",column_values:" + JSON.stringify(JSON.stringify({ [COL]: { text: w.text } })) + "){id}").join(" ");
    try { await monday(token, "mutation{" + q + "}"); } catch (e) { b.forEach(w => failed.push(w.id)); }
  }
  const all = writes.flatMap(w => w.lines);
  return { dry, rowsLeft: rows.length - pick.length, rows: pick.length, videos: ids.length,
    confirmed: all.filter(l => /sponsorblock\+captions/.test(l)).length, captionsOnly: all.filter(l => / \| captions$/.test(l) && /read ~/.test(l)).length,
    sbOnly: all.filter(l => /sponsorblock$/.test(l)).length, check: all.filter(l => /read check/.test(l)).length, notFound: all.filter(l => /read not found/.test(l)).length,
    sample: writes.slice(0, 6).map(w => w.b + ": " + w.lines.join(" / ")), failed };
}
