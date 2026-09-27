// Daily view-count updater for board 6162879732 ("Subitems of US Campaigns").
// Writes VIEW COUNT (numeric_mm3vrpfr), LATEST VIEWS (numeric_mm4bn6yq) and CPM
// (numeric_mm1m53kk). It is the SOLE writer of all three. See "SINGLE WRITER" below.
//
// ── HISTORY — read before changing the source column ───────────────────────────
// Until 27 Aug 2026 this read video URLs from link_mm5dgdx9 ("LIVE LINKS NEW"), a
// LINK column that had since been DELETED, falling back to file_mm1zd4v9, the legacy
// file column the Brand Partnerships annexe says must not be read programmatically.
// A link column holds exactly ONE url and 115+ rows here hold two or more, so it
// summed a subset of a deal's videos and wrote that over a correct total. Its sibling
// in tommack99/renewal-sync had the identical defect against LATEST VIEWS and
// understated 37 campaigns by ~779,000 views — the worst by 69.6% — before it was
// caught and disabled.
//
// It now reads text_mm6aq9qp (LIVE VIDEO URLS), the documented single source of
// truth: a PLAIN TEXT column holding a comma-separated list of one or more urls.
// Do not repoint it at a link column again. A link column cannot represent a
// multi-video deal, and every silent undercount here has come from assuming it can.
//
// ── SINGLE WRITER — why this job writes LATEST VIEWS too, as of 27 Aug 2026 ─────────
// LATEST VIEWS used to be written by the Campaign View Sync workflow in
// tommack99/renewal-sync. That job had this same partial-sum defect and was disabled on
// 27 Aug 2026, which left numeric_mm4bn6yq with NO writer at all while this job kept
// advancing VIEW COUNT — so the two would have silently drifted apart.
//
// That drift matters beyond tidiness: the documented way to check this job is behaving is
// to count rows where VIEW COUNT differs from LATEST VIEWS and expect zero. Two writers,
// or one writer and one frozen column, both destroy that check.
//
// So this job now writes all three columns from one computed total, in one mutation, which
// is what numeric_mm3vrpfr's own column description has always said happens: "the daily
// view-count updater writes both to the same value every run". One writer, one source of
// truth, one number. Do not reintroduce a second writer for any of the three.
//
// ⚠️ OPEN QUESTION, deliberately not decided in code: LATEST VIEWS is titled "30 days
// after Live maximum", which suggests it should stop at a 30-day ceiling rather than track
// live forever, and VIEW COUNT's description flags itself as a redundant duplicate that is
// "safe to retire once confirmed". Neither behaviour is implemented here, because neither
// was ever implemented by the job this replaces — it wrote running totals. If the 30-day
// rule is real, it needs a Live date on the row to measure from, and that is a design
// change to agree with Tom, not something to infer from a column title.
//
// ── SAFETY RULES — these are what make a wrong total impossible, not merely unlikely ─
// 1. ALL-OR-NOTHING. If any video id on a row fails to come back from the YouTube
//    API (private, deleted, region-blocked, typo), the row is SKIPPED entirely and
//    reported under `unresolved`. Summing the ids that did resolve is precisely the
//    bug above: a partial sum is indistinguishable from a real one once written.
// 2. NO LARGE REGRESSIONS. A new total below DROP_GUARD × the stored value is
//    skipped and reported under `regressions`. Views drift down by small amounts
//    when YouTube discounts traffic; they do not halve. A big drop means the input
//    changed meaning, not that the audience left.
// 3. DRY RUN. GET ?dryRun=1 computes and diffs everything and writes NOTHING.
//    Use it after any change here, and compare before letting the cron write again.
//
// Do NOT add a second writer to any of these three columns. The whole incident was two
// jobs writing one column with different ideas of which videos belong to a row. For a
// one-off backfill, Make scenario 6073306 already exists and is deliberately left
// INACTIVE as a manual tool, not a schedule.

export const config = { maxDuration: 300 };

const BOARD = "6162879732";
const COL_URLS  = "text_mm6aq9qp";     // LIVE VIDEO URLS - single source of truth (text, comma-separated)
const COL_VIEWS  = "numeric_mm3vrpfr"; // VIEW COUNT
const COL_LATEST = "numeric_mm4bn6yq"; // LATEST VIEWS - same value, same mutation, one writer
const COL_CPM   = "numeric_mm1m53kk";  // CPM
const COL_RATE  = "numeric_mm3vg42g";  // GROSS RATE
const DROP_GUARD = 0.9;

// watch?v=ID · youtu.be/ID · /shorts/ID · /live/ID · /embed/ID · /v/ID
const ID_PATTERNS = [
  /(?:youtube\.com|youtube-nocookie\.com)\/watch\?(?:[^#\s]*&)?v=([A-Za-z0-9_-]{11})/g,
  /youtu\.be\/([A-Za-z0-9_-]{11})/g,
  /(?:youtube\.com|youtube-nocookie\.com)\/(?:shorts|live|embed|v)\/([A-Za-z0-9_-]{11})/g,
];

// Split the cell on commas, then pull an id out of each entry. Returns the distinct
// ids and a count of entries that looked like a url but yielded no id, so a
// malformed cell is visible in the response rather than silently shrinking the sum.
export function parseVideoIds(text) {
  const ids = [];
  let unparsed = 0;
  for (const rawEntry of String(text || "").split(",")) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    let found = null;
    for (const re of ID_PATTERNS) {
      re.lastIndex = 0;
      const m = re.exec(entry);
      if (m) { found = m[1]; break; }
    }
    if (found) { if (!ids.includes(found)) ids.push(found); }
    else unparsed++;
  }
  return { ids, unparsed };
}

async function mondayQuery(token, query) {
  const r = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ query }),
  });
  const d = await r.json();
  if (d && d.errors) throw new Error("monday: " + JSON.stringify(d.errors));
  return d;
}

export default async function handler(req, res) {
  const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
  const MONDAY_API_KEY = process.env.MONDAY_API_KEY;
  if (!YOUTUBE_API_KEY || !MONDAY_API_KEY) {
    return res.status(500).json({ error: "Missing env vars (YOUTUBE_API_KEY / MONDAY_API_KEY)" });
  }
  const dryRun = String((req.query && req.query.dryRun) || "") === "1";

  try {
    // 1. Page the board.
    const cols = [COL_URLS, COL_VIEWS, COL_CPM, COL_RATE].map(c => '"' + c + '"').join(",");
    let items = [], cursor = null;
    do {
      const page = cursor
        ? 'items_page(limit:100,cursor:"' + cursor + '")'
        : 'items_page(limit:100)';
      const d = await mondayQuery(MONDAY_API_KEY,
        "{boards(ids:[" + BOARD + "]){" + page + "{cursor items{id name column_values(ids:[" + cols + "]){id text}}}}}");
      const p = d && d.data && d.data.boards && d.data.boards[0] && d.data.boards[0].items_page;
      if (!p) break;
      items = items.concat(p.items || []);
      cursor = p.cursor || null;
    } while (cursor);

    // 2. Parse each row's LIVE VIDEO URLS.
    const rows = [], malformed = [];
    for (const it of items) {
      const cv = id => {
        const c = (it.column_values || []).find(x => x.id === id);
        return (c && c.text) || "";
      };
      const { ids, unparsed } = parseVideoIds(cv(COL_URLS));
      if (unparsed) malformed.push({ itemId: it.id, name: it.name, unparsedEntries: unparsed, cell: cv(COL_URLS) });
      if (!ids.length) continue;
      rows.push({
        itemId: it.id,
        name: it.name,
        videoIds: ids,
        rate: parseFloat(cv(COL_RATE)) || 0,
        currentViews: parseFloat(cv(COL_VIEWS)) || 0,
      });
    }
    if (!rows.length) {
      return res.json({ mode: dryRun ? "dryRun" : "write", scanned: items.length, found: 0, updated: 0, malformed });
    }

    // 3. Resolve every distinct id, 50 at a time.
    const allIds = [...new Set(rows.flatMap(r => r.videoIds))];
    const stats = {};
    for (let i = 0; i < allIds.length; i += 50) {
      const batch = allIds.slice(i, i + 50);
      const yr = await fetch("https://www.googleapis.com/youtube/v3/videos?part=statistics&id=" + batch.join(",") + "&key=" + YOUTUBE_API_KEY);
      const yd = await yr.json();
      if (yd && yd.error) throw new Error("youtube: " + JSON.stringify(yd.error));
      for (const v of (yd.items || [])) stats[v.id] = parseInt((v.statistics && v.statistics.viewCount) || 0, 10);
    }

    // 4. Decide each row. Rules 1 and 2 above are enforced here.
    const toWrite = [], unresolved = [], regressions = [], unchanged = [];
    for (const r of rows) {
      const missing = r.videoIds.filter(id => !(id in stats));
      if (missing.length) {
        unresolved.push({ itemId: r.itemId, name: r.name, missing, videoIds: r.videoIds });
        continue;
      }
      const total = r.videoIds.reduce((s, id) => s + stats[id], 0);
      if (total === 0) { unresolved.push({ itemId: r.itemId, name: r.name, reason: "all videos report 0 views", videoIds: r.videoIds }); continue; }
      if (r.currentViews > 0 && total < r.currentViews * DROP_GUARD) {
        regressions.push({ itemId: r.itemId, name: r.name, stored: r.currentViews, computed: total,
          dropPct: +(100 * (1 - total / r.currentViews)).toFixed(1), videoIds: r.videoIds });
        continue;
      }
      if (total === r.currentViews) { unchanged.push(r.itemId); continue; }
      toWrite.push({ itemId: r.itemId, name: r.name, videoCount: r.videoIds.length,
        stored: r.currentViews, views: total,
        cpm: r.rate > 0 ? parseFloat(((r.rate / total) * 1000).toFixed(2)) : null });
    }

    const summary = {
      mode: dryRun ? "dryRun" : "write",
      scanned: items.length,
      rowsWithUrls: rows.length,
      distinctVideos: allIds.length,
      resolvedVideos: Object.keys(stats).length,
      wouldWrite: toWrite.length,
      unchanged: unchanged.length,
      skippedUnresolved: unresolved.length,
      skippedRegression: regressions.length,
      malformedCells: malformed.length,
    };

    if (dryRun) {
      return res.json({ ...summary, updated: 0, changes: toWrite, unresolved, regressions, malformed });
    }

    // 5. Write, 20 rows per request (aliased mutations). One request per row with a pause took
    // about 0.7 s a row, so once ~450 rows changed in a day the run hit the 300 s limit and the
    // rows near the end of the board were never updated (seen 27 Sep 2026). Batched, it is ~25 requests.
    let updated = 0; const failures = [];
    for (let i = 0; i < toWrite.length; i += 20) {
      const batch = toWrite.slice(i, i + 20);
      const body = batch.map((w, k) => {
        const vals = { [COL_VIEWS]: w.views, [COL_LATEST]: w.views };
        if (w.cpm !== null) vals[COL_CPM] = w.cpm;
        return "m" + k + ":change_multiple_column_values(board_id:" + BOARD + ",item_id:" + w.itemId + ",column_values:" + JSON.stringify(JSON.stringify(vals)) + "){id}";
      }).join(" ");
      try {
        const d = await mondayQuery(MONDAY_API_KEY, "mutation{" + body + "}");
        batch.forEach((w, k) => { if (d && d.data && d.data["m" + k]) updated++; else failures.push({ itemId: w.itemId, name: w.name, error: "no confirmation returned" }); });
      } catch (e) {
        // One bad row fails the whole request: retry that batch row by row so the others still land.
        for (const w of batch) {
          const vals = { [COL_VIEWS]: w.views, [COL_LATEST]: w.views };
          if (w.cpm !== null) vals[COL_CPM] = w.cpm;
          try {
            const d = await mondayQuery(MONDAY_API_KEY, "mutation{change_multiple_column_values(board_id:" + BOARD + ",item_id:" + w.itemId + ",column_values:" + JSON.stringify(JSON.stringify(vals)) + "){id}}");
            if (d && d.data && d.data.change_multiple_column_values) updated++;
            else failures.push({ itemId: w.itemId, name: w.name, error: "no confirmation returned" });
          } catch (e2) { failures.push({ itemId: w.itemId, name: w.name, error: String((e2 && e2.message) || e2) }); }
        }
      }
    }

    return res.json({ ...summary, updated, failures, changes: toWrite, unresolved, regressions, malformed });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
