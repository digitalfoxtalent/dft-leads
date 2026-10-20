// IndexNow, 20 Oct 2026 (Tom: "Please enable them, and anything else we should enable").
//
// IndexNow is the open ping that Bing, Yandex, Seznam and Naver share: the site tells them which URLs are new and
// they fetch those within hours instead of waiting to find them in the sitemap. Bing's index is what ChatGPT search,
// Copilot and DuckDuckGo answer from, so this is the fastest route for a new SUBPLOT article into those as well.
//
// The key is NOT a secret: by design it is published at https://subplot.tv/<key>.txt so the engines can confirm the
// pings come from the site's owner. No account or login is involved.
//
// Once a day the existing health cron (/api/subplot?path=__health) sends the long-form articles published in the last
// 26 hours (two hours of overlap so a slow run never leaves a gap). Snippets are left out: they are noindex. A failed
// ping is logged and never blocks the health check.
import { artPath } from "./render.js";

export const INDEXNOW_KEY = "1de8520b202b01d3dd2c03257499f286";
export const INDEXNOW_HOST = "subplot.tv";
const ENDPOINT = "https://api.indexnow.org/indexnow";
const WINDOW_MS = 26 * 3600 * 1000;
const MAX_URLS = 10000; // the protocol's limit per request

export function recentUrls(data, now = Date.now(), windowMs = WINDOW_MS) {
  return (data.arts || [])
    .filter(a => { const t = +new Date(a.p); return t && now - t <= windowMs && t <= now + 3600 * 1000; })
    .slice(0, MAX_URLS)
    .map(a => `https://${INDEXNOW_HOST}${artPath(a)}`);
}

export async function pingIndexNow(urls) {
  if (!urls.length) return { sent: 0, status: "nothing new" };
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: INDEXNOW_HOST, key: INDEXNOW_KEY, keyLocation: `https://${INDEXNOW_HOST}/${INDEXNOW_KEY}.txt`, urlList: urls }),
  });
  return { sent: urls.length, status: r.status };
}
