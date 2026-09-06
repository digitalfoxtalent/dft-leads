// Brand layer. SUBPLOT and Wordie are the same machine wearing different clothes: one
// codebase, one pipeline, one set of bug fixes. What differs is the name, the voice, the
// palette, the type, and - the real difference - who is allowed to publish.
//
//   subplot  curated. A closed list of approved creators, entertainment only.
//   wordie   open. Any YouTuber can apply, proves the channel by OAuth, then passes
//            automatic checks and a human yes before anything of theirs publishes.
//
// The brand is resolved from the request host. A Node serverless instance handles one
// request at a time, so a module-level "active" brand is safe here; nothing below may hold
// on to it across an await boundary that could span requests.
//
// RULE: nothing outside this file may hardcode a brand name, a member word, an address or a
// domain. Use the helpers below. Everything here is per-brand or it is a bug.

const SUBPLOT_GOOGLE = "family=Montserrat:wght@600;700;800&family=DM+Mono:wght@400;500&family=Mulish:wght@400;600;700";

export const BRANDS = {
  subplot: {
    key: "subplot",
    name: "SUBPLOT",
    domain: "subplot.tv",
    // Google Search Console ownership token. Public by design - it proves control of the
    // domain, it is not a credential. Removing it un-verifies the property, so leave it.
    gsc: "iFwvPvA6WRGimh2Qj8MNDpeAKJ2y4z4FSr3okN9LiJ8",
    tagline: "The story under the story. Breakdowns, theories, reactions, opinions, reviews and lore from the people who actually watch it.",
    memberWord: "SubPlotter",
    signup: "curated",              // approved list in CREATORS, edited by us
    audience: "about film, TV, games, comics or anime",
    cast: true,                     // the seven characters in cast.js
    accent: null,                   // null = the default palette in css.js
    type: null,                     // null = the default type in css.js
    favicon: null,                  // null = the cast favicon in cast.js
    assets: "subplot",              // which pair in images.js
  },
  wordie: {
    key: "wordie",
    name: "WORDIE",
    domain: "wordie.media",
    tagline: "Every video, in writing. Your words, your name, your channel - just for the people who would rather read.",
    memberWord: "Wordie",
    signup: "open",                 // OAuth proves the channel, checks and a human gate it
    audience: "on any subject",     // open platform: not an entertainment site
    cast: false,                    // typographic, no characters - Tom's call, 4 Sep 2026
    accent: { ink: "#12121C", tint: "#0F7B6C", tintInk: "#0A5A4E", wash: "#E6F4F1", warm: "#F0A202" },
    type: {
      disp: '"Lora",Georgia,"Times New Roman",serif',
      body: '"Inter",ui-sans-serif,system-ui,-apple-system,sans-serif',
      mono: '"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace',
      google: "family=Lora:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500",
    },
    // A drawn mark, not type: a serif W muddies at 16px. Stroked W over a short amber rule.
    favicon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="13" fill="#0F7B6C"/><path d="M13 19 L23 46 L32 27 L41 46 L51 19" fill="none" stroke="#FFFFFF" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 52 H34" stroke="#F0A202" stroke-width="4" stroke-linecap="round"/></svg>',
    // No share card yet. Rather than serve SUBPLOT's - cast, clapperboard and all -
    // Wordie advertises no og:image and 404s /og.png until it has its own.
    assets: null,
  },
};

const HOSTS = { "subplot.tv": "subplot", "wordie.media": "wordie" };

export function brandFor(host = "") {
  const h = String(host).toLowerCase().replace(/^www\./, "").split(":")[0];
  return BRANDS[HOSTS[h]] || (h.startsWith("wordie") ? BRANDS.wordie : BRANDS.subplot);
}

let active = BRANDS.subplot;
export const setBrand = b => { active = b || BRANDS.subplot; };
export const brand = () => active;

// The helpers every template should reach for instead of writing a literal.
export const member = () => active.memberWord;                 // "SubPlotter" / "Wordie"
export const joinCta = () => `Become a ${active.memberWord}`;
export const mail = box => `${box}@${active.domain}`;          // hello@ / corrections@
export const siteUrl = () => `https://${active.domain}`;
export const hasCast = () => active.cast !== false;
export const audience = () => active.audience;
export const faviconSvg = () => active.favicon;              // null = fall back to the cast favicon
export const assetKey = () => active.assets;                 // null = this brand has no card yet
export const hasShareCard = () => !!active.assets;

// Google Fonts URL for whichever type the brand uses.
export const fontHref = () =>
  "https://fonts.googleapis.com/css2?" + (active.type?.google || SUBPLOT_GOOGLE) + "&display=swap";

// Palette, type and chrome overrides, emitted into the page head for any brand that is not
// the default. Keep this the ONLY place a brand's look is expressed as CSS.
export function brandCss(b = active) {
  const out = [];
  const a = b.accent;
  if (a) out.push(`--ink:${a.ink};--blue:${a.tint};--blue-ink:${a.tintInk};--blue-wash:${a.wash};--orange:${a.warm};--tint:var(--blue)`);
  const t = b.type;
  if (t) out.push(`--disp:${t.disp};--body:${t.body};--mono:${t.mono}`);
  let css = out.length ? `:root{${out.join(";")}}` : "";

  // Wordie reads editorial rather than fan-site: a serif wordmark that needs positive
  // tracking at display size, a lighter masthead rule, and more air around the edges.
  if (b.key === "wordie") css += `
.wordmark{font-weight:700;letter-spacing:.005em}
.top-in{padding-top:3.4rem;padding-bottom:2.1rem}
.plotline{height:7px;margin:1.15rem 0 1.05rem}
.plotline::before{height:2px}
.plotline::after{top:5px;height:2px;width:min(26%,11rem)}
.tagline{max-width:44rem;line-height:1.55}
.band{padding-top:2.4rem;padding-bottom:2.4rem}`;
  return css;
}
