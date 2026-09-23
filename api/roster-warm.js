// Keeps the roster feeds warm in the edge cache.
//
// Vercel keys its cache per deployment, and this project deploys several times a day
// (Subplot, Wordie, leads work), so every deploy left /api/roster cold and the next
// brand to open roster-viewguarantee.digitalfoxtalent.com waited for monday. This
// cron requests both feeds through the public hostname every ten minutes, so the
// visitor gets the cached copy and the monday call happens here instead.
//
// It only reads. Refused unless it comes from Vercel's scheduler or carries CRON_SECRET.
const HOST = "https://roster-viewguarantee.digitalfoxtalent.com";
const PATHS = ["/api/roster", "/api/brand-roster"];

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const fromCron = req.headers["x-vercel-cron"] || (secret && req.headers.authorization === "Bearer " + secret);
  if (!fromCron) return res.status(404).json({ error: "Not found" });
  res.setHeader("Cache-Control", "no-store");
  const results = await Promise.all(PATHS.map(async p => {
    const t = Date.now();
    try {
      const r = await fetch(HOST + p, { headers: { accept: "application/json" } });
      await r.arrayBuffer();
      return { path: p, status: r.status, cache: r.headers.get("x-vercel-cache"), ms: Date.now() - t };
    } catch (e) {
      return { path: p, error: String(e && e.message || e), ms: Date.now() - t };
    }
  }));
  return res.status(200).json({ ok: true, results });
}
