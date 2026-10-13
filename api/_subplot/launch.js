// SUBPLOT launch switch (Tom, 10 Oct 2026: AdSense cut-off Friday 17 Oct, then open to search either way).
//
// false: private preview. Every response carries noindex (header and meta), robots.txt lets only Google's
//        crawlers fetch pages (so an AdSense review can read the site), and the DFT <-> SUBPLOT links are off.
// true:  launched. No noindex anywhere, robots.txt open to every crawler (Bing matters: it feeds MSN and Copilot),
//        and the cross-links go live (crosslinks.js reads this). The canonical tag (withCanonical) still points
//        every copy, including the /subplot preview path on the roster host, at subplot.tv.
//
// The article publisher watches for this: once subplot.tv stops sending noindex it holds each new article back
// from the MSN feeds for 3 hours, so SUBPLOT publishes first (publisher build 73).
export const LAUNCHED = true;
