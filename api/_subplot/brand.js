// Brand layer. SUBPLOT and Wordie are the same machine wearing different clothes: one
// codebase, one pipeline, one set of bug fixes. What differs is the name, the voice, the
// palette, the type, and - the real difference - who is allowed to publish.
//
//   subplot  curated. A closed list of approved creators, entertainment only.
//   wordie   open. Any YouTuber can apply, proves the channel by OAuth, then passes
//            automatic checks and a human yes before anything of theirs publishes.
//
// The brand is resolved from the request host and held per request (see setBrand below), so
// it stays correct across awaits even when one instance serves several requests at once.
//
// RULE: nothing outside this file may hardcode a brand name, a member word, an address or a
// domain. Use the helpers below. Everything here is per-brand or it is a bug.

import { AsyncLocalStorage } from "node:async_hooks";
import { monogramSvg, accentToday } from "./wordmark.js";

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
    googleAuth: false,              // no Google sign-in, so no Google-data disclosure
    legalUpdated: "3 September 2026",
    privacyUpdated: "3 October 2026",    // AdSense-required Google cookie and opt-out lines
    audience: "about film, TV, games, comics or anime",
    taking: "We&rsquo;re taking film, TV, games, comics, anime and everything adjacent. Long-form, reactions, breakdowns, lore, interviews.",
    cast: true,                     // the seven characters in cast.js
    accent: null,                   // null = the default palette in css.js
    type: null,                     // null = the default type in css.js
    favicon: () => monogramSvg(accentToday()[2]),   // white screen O on a tile in the day's colour (ultramarine on the house day)
    layout: "editorial",            // lead story, wire list, rail
    wordmark: null,                 // null = the plain wordmark in css.js
    assets: "subplot",              // which pair in images.js
    feedStore: "5yFLBuHJj59ySXY9e", // Apify KV store the publisher writes to
    // null = fall back to the SUBPLOT_APPROVED_ONLY env var, which is how this brand has
    // always gated. A brand that names its own list instead gates unconditionally.
    approvedHandles: null,
    // How an article gets filed. Order matters - first hit wins - and `fallback` catches
    // anything unmatched, so every article lands in a section that exists in `sections`.
    topics: {
      order: ["dc", "anime", "gaming", "marvel", "scifi"],
      fallback: "screen",
      kw: {
        dc:     ["dc","batman","lanterns","green lantern","john stewart","superman","hal jordan","dark knight","the flash","wonder woman"],
        anime:  ["dragon ball","goku","vegeta","ultra instinct","toonami","anime","one piece","naruto","jujutsu","demon slayer"],
        gaming: ["gta","call of duty","elder scrolls","warhammer","grand theft auto","gaming","blood angels","miniature","police chase","outlaws","playstation","xbox","nintendo","ps5"],
        marvel: ["marvel","mcu","deadpool","wolverine","avengers","doom","secret wars","scarlet witch","spider-man","vision","x-men","kang","loki","franklin richards","hugh jackman","ryan reynolds","robert downey","kevin feige","elizabeth olsen","cassandra nova","infinity stones","doomsday","hunter b-15","fantastic four"],
        scifi:  ["star trek","star wars","stargate","voth","strange new worlds","prometheus","sci-fi","galaxy's edge","harry potter","ghosts","moaning myrtle","transformers","optimus","lord of the rings","dune","alien","predator"],
      },
    },
    searchHint: "Search creators, shows, franchises",
    sections: {                     // an entertainment site: six franchises
      marvel: "Marvel",
      dc: "DC",
      scifi: "Sci-Fi & Fantasy",
      gaming: "Gaming",
      anime: "Anime",
      screen: "Screen",
    },
    // Monthly publishing fee, in USD, off the creator's share (Creator Agreement v3), on both
    // brands. Tom's ruling, 28 Sep 2026: it covers the production cost of each article, which YouTube does
    // not carry for a video. Payouts read the fee off the rate card, not from here; this
    // only drives what the terms say.
    publishingFee: 50,
  },
  wordie: {
    key: "wordie",
    name: "Wordie",
    domain: "wordie.media",
    tagline: "Every video, in writing. Your words, your name, your channel - just for the people who would rather read.",
    memberWord: "Wordie",
    signup: "open",                 // OAuth proves the channel, checks and a human gate it
    googleAuth: true,               // Google sign-in proves channel ownership at signup
    legalUpdated: "4 September 2026",
    privacyUpdated: "14 October 2026",   // AdSense cookie and opt-out lines, ported from SUBPLOT
    audience: "on any subject",     // open platform: not an entertainment site
    taking: "We&rsquo;re taking channels on any subject - tech, travel, finance, fitness, food, history, gaming, film, whatever you make. If there are words in it, it works.",
    cast: false,                    // typographic, no characters - Tom's call, 4 Sep 2026
    accent: { ink: "#12121C", tint: "#0F7B6C", tintInk: "#0A5A4E", wash: "#E6F4F1", warm: "#F0A202" },
    type: {
      disp: '"Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif',
      body: '"Inter",ui-sans-serif,system-ui,-apple-system,sans-serif',
      mono: '"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace',
      google: "family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500",
    },
    // A drawn mark, not type: a serif W muddies at 16px. Stroked W over a short amber rule.
    favicon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0F7B6C"/><circle cx="24" cy="27" r="9.5" fill="#fff"/><circle cx="44" cy="27" r="9.5" fill="#fff"/><circle cx="25.8" cy="28.6" r="5.1" fill="#12121C"/><circle cx="45.8" cy="28.6" r="5.1" fill="#12121C"/><path d="M27 41 C30 38 38 38 41 41 L34 51 Z" fill="#F0A202"/></svg>',
    layout: "grid",                 // thumbnail grid, the idiom YouTubers already read
    wordmark: { head: "Word", tail: "ie" },   // two-tone, sentence case
    feedStore: "YhkBlKFJ0wkpaOmck", // Wordie's OWN store. SUBPLOT's creators agreed to
                                    // SUBPLOT, not to Wordie - their work must not appear here
    // EMPTY LIST, NOT null, and the difference matters. An empty list means "nobody is
    // approved for Wordie yet", and it FAILS CLOSED: no handle can pass it. null would fall
    // through to the SUBPLOT_APPROVED_ONLY env var, which is Production-scoped and therefore
    // absent on the Preview deployment wordie.media runs from - i.e. no gate at all. That is
    // exactly how seven creators who had approved nothing appeared here on 4 Sep. The signup
    // flow adds a handle here only once that creator's approval is recorded on board
    // 18429671241. Never set this back to null.
    approvedHandles: [],
    topics: {
      // Narrow before broad: a Formula 1 video is sport, not cars-as-tech, so sport is
      // tested before tech. `screen` is the fallback because a video about a film or show
      // is the most common thing a channel makes that matches no specialist keyword.
      order: ["gaming", "money", "health", "food", "travel", "sport", "science", "tech", "culture"],
      fallback: "screen",
      kw: {
        gaming:  ["gaming","gameplay","playstation","xbox","nintendo","ps5","steam","speedrun","esports","minecraft","fortnite","roblox","valorant","league of legends","call of duty","gta","elden ring","zelda","pokemon","indie game"],
        money:   ["stocks","investing","crypto","bitcoin","etf","dividend","portfolio","recession","inflation","interest rate","mortgage","side hustle","startup","entrepreneur","business","marketing","dropshipping","real estate","personal finance","budgeting","salary","tax","s&p","nasdaq","dow jones","index fund","401k","pension","savings","debt","valuation","earnings","hedge fund","bear market","bull market"],
        health:  ["workout","gym","hypertrophy","lifting","powerlifting","running","marathon","yoga","pilates","calisthenics","weight loss","protein","nutrition","sleep","mobility","physio","mental health","meditation"],
        food:    ["recipe","cooking","baking","sourdough","bbq","grill","air fryer","meal prep","restaurant","street food","chef","taste test","kitchen","pasta","coffee","espresso","cocktail","brewing"],
        travel:  ["travel","flight","airline","business class","hotel","hostel","backpacking","road trip","itinerary","visa","passport","cruise","van life","digital nomad","tokyo","bali","iceland","airport","abroad","expat","tourist","layover","weeks in","days in","a day in","border crossing","train journey"],
        sport:   ["nfl","nba","mlb","nhl","premier league","la liga","champions league","formula 1","f1","motogp","ufc","boxing","wrestling","olympics","world cup","tennis","golf","cycling","transfer window"],
        science: ["nasa","spacex","rocket","telescope","black hole","quantum","physics","chemistry","biology","evolution","archaeology","ancient","roman","medieval","world war","cold war","history of","documentary","climate","geology","empire","dynasty","civilisation","civilization","pharaoh","revolution","battle of","the fall of","century","bc","ad "],
        tech:    ["iphone","android","macbook","laptop","gpu","cpu","nvidia","apple","google","microsoft","samsung","linux","windows","coding","programming","javascript","python","developer","self-hosted","ai","chatgpt","llm","robot","ev","tesla","drone","3d printing","smart home","review of the"],
        culture: ["album","single","tour","concert","festival","spotify","rapper","guitar","piano","producer","beat","songwriting","band","k-pop","musical","art","painting","fashion","photography","book","novel"],
      },
    },
    searchHint: "Search creators, channels, topics",
    sections: {                     // an open platform: what YouTubers actually make, not franchises
      tech: "Tech",
      gaming: "Gaming",
      screen: "Film & TV",
      money: "Money & Business",
      health: "Health & Fitness",
      food: "Food",
      travel: "Travel",
      science: "Science & History",
      culture: "Music & Culture",
      sport: "Sport",
    },
    // No share card yet. Rather than serve SUBPLOT's - cast, clapperboard and all -
    // Wordie advertises no og:image and 404s /og.png until it has its own.
    assets: null,
    publishingFee: 50,              // same $50 monthly publishing fee as SUBPLOT (Tom, 28 Sep 2026)
  },
};

// Which host is which publication. EXACT MATCH ONLY, and anything absent is not a
// publication at all. This used to end "...: BRANDS.subplot", so every unrecognised host -
// a new domain, a deployment alias, the project's own dft-leads.vercel.app - silently became
// SUBPLOT. That is the same shape as the roster rewrite that leaked the rates board: an
// unconditioned default catching everything nobody thought to name. Fail closed instead.
const HOSTS = {
  "subplot.tv": "subplot",
  "subplot.digitalfoxtalent.com": "subplot",   // legacy, normally 308s to subplot.tv first
  "wordie.media": "wordie",
};

// Vercel gives every deployment throwaway aliases. Only the BRANCH alias carries anything
// trustworthy - the git branch in its own name. The hash alias (dft-leads-<hash>-<team>
// .vercel.app) says nothing, which is why it used to render the Wordie build as SUBPLOT.
// Named one by one rather than captured by a pattern. A team slug contains hyphens too
// (tom-james-projects-dft), so any "grab the branch bit" regex guesses wrong - the first
// version of this line read the branch as "wordie-tom-james-projects". Naming both is
// duller and correct, and a new branch simply gets no publication until it is added here.
const BRANCH_ALIASES = [
  [/^dft-leads-git-wordie-[a-z0-9-]+\.vercel\.app$/, "wordie"],
  [/^dft-leads-git-main-[a-z0-9-]+\.vercel\.app$/,   "subplot"],
];

// Returns null for a host this project does not publish on. Callers must handle that, and
// must not substitute a brand of their own choosing.
export function brandFor(host = "") {
  const h = String(host).toLowerCase().replace(/^www\./, "").split(":")[0].trim();
  if (HOSTS[h]) return BRANDS[HOSTS[h]];
  for (const [re, key] of BRANCH_ALIASES) if (re.test(h)) return BRANDS[key];
  return null;
}

// The active brand is held per request, not per module. Wordie and SUBPLOT share one function,
// and a lambda that serves two requests at once (Vercel fluid compute) would otherwise let one
// request's setBrand repoint the other mid-await, e.g. half of SUBPLOT's feed reads hitting
// Wordie's store. enterWith binds the brand to the calling request's async context only.
// `fallback` covers code that runs outside any request (tests, scripts).
const als = new AsyncLocalStorage();
let fallback = BRANDS.subplot;
const A = () => als.getStore() || fallback;
export const setBrand = b => { const v = b || BRANDS.subplot; fallback = v; als.enterWith(v); };
export const brand = () => A();

// The helpers every template should reach for instead of writing a literal.
export const member = () => A().memberWord;                 // "SubPlotter" / "Wordie"
export const joinCta = () => `Become a ${A().memberWord}`;
export const mail = box => `${box}@${A().domain}`;          // hello@ / corrections@
export const siteUrl = () => `https://${A().domain}`;
export const hasCast = () => A().cast !== false;
export const audience = () => A().audience;
export const taking = () => A().taking;
export const pubFee = () => Number(A().publishingFee || 0);   // monthly publishing fee, USD; 0 = none
export const faviconSvg = () => typeof A().favicon === "function" ? A().favicon() : A().favicon;  // null = fall back to the cast favicon
export const assetKey = () => A().assets;                 // null = this brand has no card yet
export const hasShareCard = () => !!A().assets;
export const layout = () => A().layout || "editorial";
export const wordmark = () => A().wordmark;              // null = plain single-colour
export const sections = () => A().sections;              // the site's categories, per brand
export const feedStore = () => A().feedStore;            // which Apify store this brand reads
export const approvedHandles = () => A().approvedHandles; // null = use the env-var gate instead
export const topics = () => A().topics;                  // how this brand files an article
export const searchHint = () => A().searchHint;
export const usesGoogleAuth = () => A().googleAuth === true;
export const legalUpdated = () => A().legalUpdated;
export const privacyUpdated = () => A().privacyUpdated || A().legalUpdated;

// Google Fonts URL for whichever type the brand uses.
export const fontHref = () =>
  "https://fonts.googleapis.com/css2?" + (A().type?.google || SUBPLOT_GOOGLE) + "&display=swap";

// Palette, type and chrome overrides, emitted into the page head for any brand that is not
// the default. Keep this the ONLY place a brand's look is expressed as CSS.
export function brandCss(b = A()) {
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
