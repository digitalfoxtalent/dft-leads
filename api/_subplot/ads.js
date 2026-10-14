// SUBPLOT advertising. Nothing here is live until the AdSense publisher id is set in the
// Vercel env; until then every placement renders as the grey placeholder it does today.
//
//   ADSENSE_CLIENT             ca-pub-0000000000000000   turns ads on, serves ads.txt
//   ADSENSE_SLOT_<NAME>        1234567890                the ad unit id for one placement
//   ADSENSE_LAYOUT_IN_FEED     -fb+5w+4e-db+86           in-feed native layout key
//
// Placement names passed to adSlot(): leaderboard, in-article-N, article-rail,
// front-rail, in-feed, mobile-anchor. A placement with no slot id keeps its placeholder,
// so units can be switched on one at a time.
//
// In-article positions repeat down a long piece (in-article-1, -2, -3). They all share one
// ad unit: Google allows the same unit many times on a page, and one unit means one row in
// reporting instead of a row per article length.

// Per brand. Wordie gets its OWN AdSense publisher (Tom, 4 Sep 2026: a policy problem on one
// site must not take the other's money down), so it reads WORDIE_-prefixed vars and NEVER falls
// back to SUBPLOT's. Unset means Wordie shows no ads and serves no ads.txt, which is correct:
// serving SUBPLOT's publisher id on wordie.media would put an unapproved domain on that account.
import { brand } from "./brand.js";
const P = () => (brand().key === "wordie" ? "WORDIE_" : "");
export const client = () => (process.env[P() + "ADSENSE_CLIENT"] || "").trim();
export const on = () => /^ca-pub-\d+$/.test(client());

// in-article-3 -> IN_ARTICLE. Trailing position numbers never get their own unit.
const envKey = name => name.replace(/-\d+$/, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_");
const slotEnv = name => `${P()}ADSENSE_SLOT_${envKey(name)}`;
export const slotId = name => (process.env[slotEnv(name)] || "").trim();

// <head> tag. Loading the library also enables Auto ads if they are turned on in AdSense.
export const headTag = () => on()
  ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client()}" crossorigin="anonymous"></script>`
  : "";

// Native formats read better than a boxed display ad in the places they belong:
// in-article sits in the body copy, in-feed sits between wire rows and takes the list's shape.
function insAttrs(name) {
  const base = name.replace(/-\d+$/, "");
  if (base === "in-article") {
    return `style="display:block;text-align:center" data-ad-layout="in-article" data-ad-format="fluid"`;
  }
  if (base === "in-feed") {
    const key = (process.env[P() + "ADSENSE_LAYOUT_IN_FEED"] || "").trim();
    // Without the layout key the in-feed unit renders nothing, so fall back to a display box.
    if (key) return `style="display:block" data-ad-format="fluid" data-ad-layout-key="${key}"`;
  }
  return `style="display:block" data-ad-format="auto" data-full-width-responsive="true"`;
}

// One ad unit, responsive within whatever box the placement gives it.
export function unit(name, extraClass = "") {
  const id = slotId(name);
  if (!on() || !id) return null;
  return `<div class="ad live ${extraClass}" data-slot="${name}">
    <ins class="adsbygoogle" ${insAttrs(name)} data-ad-client="${client()}" data-ad-slot="${id}"></ins>
    <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
  </div>`;
}

// Required by Google so other sellers cannot pass off inventory as ours.
export const adsTxt = () => on()
  ? `google.com, ${client().replace(/^ca-/, "")}, DIRECT, f08c47fec0942fa0\n`
  : "";
