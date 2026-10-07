// Creator distribution: every Megaphone creator against every platform, with rejection rates,
// back-catalogue progress and the next openings. READ ONLY.
//
// SOURCES
//   Megaphone   shows, Spotify / Apple / iHeart links and SPAN status, read live with the token
//               from the monday "API Keys (Private)" board (see ../megaphone.js).
//   Register    https://dftvideo.b-cdn.net/megaphone-backfill/status/coverage.json, DFT's platform
//               register for what Megaphone does not track (Amazon, Pandora, TuneIn), per-show
//               overrides, submission and rejection counts, and the openings list. Claude keeps it;
//               the back-catalogue agent on Tom's Mac uploads it to Bunny every run.
//   Agent       agent.json and <slug>.json in the same folder, written by the back-catalogue agent.
//   MSN         the Video distribution record (../distribution/load.js), reused for the MSN card.
//
// RULES (as every report): it always renders; a source that fails shows its last good figures and
// says so; a short or empty read is a fault, never the truth.

import { megaphoneToken } from "../megaphone.js";
import { mget, NET } from "../distribution/breaks.js";
import { distributionData } from "../distribution/load.js";
import { TEMPLATE } from "./page.js";

const CDN = "https://dftvideo.b-cdn.net/megaphone-backfill/status/";
const CACHE_MS = 10 * 60 * 1000;
let cache = null;
const last = { megaphone: null, registry: null, agent: null, statuses: null };

async function cdnJson(name) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(CDN + name + "?t=" + Math.floor(Date.now() / 60000), { signal: ctl.signal, headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(name + " answered " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function readMegaphone(mondayTok) {
  const tok = await megaphoneToken(mondayTok);
  if (tok.length < 10) throw new Error("Megaphone key missing on monday");
  const pods = await mget(tok, "/networks/" + NET + "/podcasts?per_page=100");
  if (!Array.isArray(pods) || pods.length < 10) throw new Error("short read: " + (pods && pods.length) + " shows");
  return {
    at: new Date().toISOString(),
    shows: pods.map(p => ({
      title: p.title, episodes: p.episodesCount || 0,
      spotify: !!p.spotifyIdentifier, apple: !!p.itunesIdentifier, iheart: !!p.iheartIdentifier,
      span: p.spanOptIn || null,
    })),
  };
}

async function readRegistry() {
  const d = await cdnJson("coverage.json");
  if (!d || !d.updated || !d.status) throw new Error("register is incomplete");
  return d;
}

async function readAgent() {
  const a = await cdnJson("agent.json");
  if (!a || !a.last_run) throw new Error("agent status is incomplete");
  const slugs = (a.creators || []).map(c => c.slug).filter(Boolean);
  const statuses = (await Promise.all(slugs.map(s => cdnJson(s + ".json").catch(() => null)))).filter(Boolean);
  return { agent: a, statuses };
}

export async function coverageData(mondayTok) {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const errors = [];
  const [mp, reg, ag, msn] = await Promise.allSettled([readMegaphone(mondayTok), readRegistry(), readAgent(), distributionData(mondayTok)]);
  const out = { fetchedAt: new Date().toISOString(), errors };

  if (mp.status === "fulfilled") { last.megaphone = mp.value; out.megaphone = mp.value; }
  else { errors.push("Megaphone (" + String(mp.reason && mp.reason.message || mp.reason).slice(0, 80) + ")"); out.megaphone = last.megaphone ? Object.assign({}, last.megaphone, { stale: true }) : { shows: [], stale: true }; }

  if (reg.status === "fulfilled") { last.registry = reg.value; out.registry = reg.value; }
  else { errors.push("platform register"); out.registry = last.registry || {}; out.registryStale = true; }

  if (ag.status === "fulfilled") { last.agent = ag.value.agent; last.statuses = ag.value.statuses; out.agent = ag.value.agent; out.statuses = ag.value.statuses; }
  else { errors.push("back-catalogue agent"); out.agent = last.agent; out.statuses = last.statuses || []; out.agentStale = true; }

  if (msn.status === "fulfilled" && msn.value && msn.value.summary) {
    const S = msn.value.summary;
    out.msn = { updated: S.updated, stale: !!msn.value.stale, rejected90: S.rejected90, reasons90: S.reasons90 || [], sinceJul: S.sinceJul || {} };
  } else { out.msn = { stale: true }; }

  cache = { at: Date.now(), data: out };
  return out;
}

export async function renderCoverage(mondayTok) {
  const payload = await coverageData(mondayTok);
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  return TEMPLATE.replace("__DATA__", () => json);
}
