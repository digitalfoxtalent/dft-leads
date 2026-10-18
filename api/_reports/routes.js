// The Ecosystem's address book. One rule for every page: /<department>/<tool>, using the same nine
// departments as the map's top navigation. Anything that used to live somewhere else is redirected here,
// so links already in people's hands (bookmarks, chats, monday rows, emails) keep working.
//
// To add a page: give it a line in PAGES (new address -> internal route in api/reports.js).
// If a page ever moves, add its old address to MOVED instead of deleting it.

export const ECO_ORIGIN = "https://ecosystem.digitalfoxtalent.com";

// Department addresses, in the order the map ranks them. Each opens the map focused on that department.
export const DEPARTMENTS = {
  partnerships: "Brand Partnerships",
  platforms: "Platform Monetization",
  shows: "Show Development",
  talent: "Talent",
  reporting: "Reporting",
  content: "Content Production",
  finance: "Finance and Operations",
  data: "Data Engine",
  marketing: "Marketing and Website",
};

// Tool pages: address -> { route (internal case in api/reports.js), dept, name }.
export const PAGES = {
  "reporting/campaign-reach":        { route: "campaigns",          dept: "reporting", name: "Campaign reach" },
  "reporting/platform-monetization": { route: "platforms",          dept: "reporting", name: "Platform monetization" },
  "reporting/video-distribution":    { route: "distribution",       dept: "reporting", name: "Video distribution" },
  "reporting/creator-distribution":  { route: "coverage",           dept: "reporting", name: "Creator distribution" },
  "reporting/engaged-views":         { route: "engaged",            dept: "reporting", name: "Engaged views" },
  "reporting/refresh":               { route: "refresh",            dept: "reporting", name: "Refresh" },
  "marketing/earnings-calculator":   { route: "marketing/earnings", dept: "marketing", name: "Creator earnings calculator" },
};

// Internal report route -> its Ecosystem address (used for tab bars and for the old reports host).
export const ADDRESS_OF = Object.fromEntries(Object.entries(PAGES).map(([path, p]) => [p.route, "/" + path]));
ADDRESS_OF.home = ADDRESS_OF.campaigns;

// Old Ecosystem addresses (before 17 Oct 2026) -> new ones. Permanent redirects, query string kept.
export const MOVED = {
  "home": "/",
  "sales": "/partnerships",
  "reports": "/reporting/campaign-reach",
  "reports/campaigns": "/reporting/campaign-reach",
  "reports/platforms": "/reporting/platform-monetization",
  "reports/distribution": "/reporting/video-distribution",
  "reports/coverage": "/reporting/creator-distribution",
  "reports/engaged": "/reporting/engaged-views",
  "reports/refresh": "/reporting/refresh",
  "marketing/earnings": "/marketing/earnings-calculator",
};

// Team report pages on reports.digitalfoxtalent.com, now at home in the Ecosystem. Partner pages
// (/campaigns/<partner>), partner key links, sign-in and every data route stay on the reports host.
export const REPORTS_HOST_MOVED = {
  "home": ADDRESS_OF.campaigns,
  "campaigns": ADDRESS_OF.campaigns,
  "platforms": ADDRESS_OF.platforms,
  "distribution": ADDRESS_OF.distribution,
  "coverage": ADDRESS_OF.coverage,
  "engaged": ADDRESS_OF.engaged,
  "refresh": ADDRESS_OF.refresh,
};

// The query string to carry across a redirect (everything except the rewrite's own ?r=).
export function carryQuery(query) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) {
    if (k === "r" || k === "path" || k === "host") continue; // r, plus path and host that Vercel adds from the vercel.json rewrite, never the visitor's own query
    for (const one of [].concat(v)) q.append(k, String(one));
  }
  const s = q.toString();
  return s ? "?" + s : "";
}

// Ecosystem path (no leading or trailing slash) -> what to do with it.
//   { redirect: "/new/address" }    an old address
//   { route: "ecosystem" }          the map, on a department or the home view
//   { route: "<internal>", page }   a tool page
//   { route: "<path>" }             anything else (data routes, sign-in) passes through unchanged
export function resolveEco(rawPath) {
  const p = String(rawPath || "").replace(/^\/+|\/+$/g, "");
  if (MOVED[p] !== undefined) return { redirect: MOVED[p] };
  if (p === "" || DEPARTMENTS[p]) return { route: "ecosystem" };
  if (PAGES[p]) return { route: PAGES[p].route, page: PAGES[p] };
  // Old /reports/<data route> paths, in case a cached page still asks for one.
  if (p.startsWith("reports/")) return { route: p.slice(8) };
  return { route: p };
}
