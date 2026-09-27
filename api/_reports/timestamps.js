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

const mmss = t => Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0");

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
  const u = "https://api.apify.com/v2/acts/supreme_coder~youtube-transcript-scraper/run-sync-get-dataset-items?timeout=240&clean=1&maxTotalChargeUsd=1&token=" + atok();
  const r = await fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ urls: ids.map(id => ({ url: "https://www.youtube.com/watch?v=" + id })), outputFormat: "json" }) });
  if (!r.ok) throw new Error("Apify transcripts " + r.status);
  const out = {};
  for (const it of await r.json()) { const m = String(it.videoUrl || it.inputUrl || "").match(/v=([A-Za-z0-9_-]{11})/); if (m && Array.isArray(it.transcript)) out[m[1]] = it.transcript; }
  return out;
}
export function brandHits(tr, brand) {
  const keys = [flat(brand)].concat(String(brand || "").split(/\s+/).map(flat).filter(w => w.length >= 5)).filter(Boolean);
  const hits = [];
  for (let i = 0; i < tr.length; i++) {
    const win = flat((tr[i].text || "") + " " + ((tr[i + 1] || {}).text || "")); // a name split across two caption lines
    if (keys.some(k => win.includes(k))) { const t = Math.round(tr[i].start || 0); if (!hits.length || t - hits[hits.length - 1] > 20) hits.push(t); }
  }
  return hits;
}
export async function timestampCheck(id, brand) {
  const [{ segs }, tr] = await Promise.all([sponsorSegments([id]), transcripts([id])]);
  const t = tr[id] || [];
  return { id, brand, sponsorBlock: (segs[id] || []).map(s => mmss(s.s) + "-" + mmss(s.e) + (s.l ? " locked" : " v" + s.v)), captions: t.length, brandMentions: brandHits(t, brand).map(mmss) };
}
