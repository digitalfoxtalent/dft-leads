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
