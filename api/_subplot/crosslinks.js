// Cross-links between SUBPLOT and the Digital Fox Talent creator booking pages.
//
// Decided by Tom 23 Sep 2026:
//   - each DFT creator page (digitalfoxtalent.com/brands/creators/<slug>) shows the
//     creator's three latest SUBPLOT articles and a link to their SUBPLOT page, for
//     creators approved for SUBPLOT only;
//   - each SUBPLOT creator page links back with "Business enquiries: book <name>".
// SUBPLOT is named as a place the creator's videos are published as articles. Nothing
// on either side says who owns it (Tom, 18 Sep 2026: SUBPLOT may be named and linked
// from DFT; what must not be said is that DFT owns it).
//
// THE ONE SWITCH. Both directions stay off until SUBPLOT is made indexable: linking to
// pages that carry noindex does nothing for search, and the back-link would visibly
// connect the two sites before there is any benefit. Flip LIVE to true in the same
// commit that removes SUBPLOT's noindex. Nothing else needs changing.
export const LIVE = false;

export const SUBPLOT_ORIGIN = "https://subplot.tv";
export const DFT_CREATOR_PAGE = "https://digitalfoxtalent.com/brands/creators/";

// YouTube handle (lower case, with @) -> DFT booking page slug. Generated from
// digitalfox_frontend data/creators.json on 23 Sep 2026. DFT slugs are permanent; add a
// line here when a SUBPLOT creator joins the DFT roster. A handle not listed simply gets
// no back-link (GIQUE, Better Gaming and Mr. Know-It-All have no DFT page).
export const DFT_SLUG_BY_HANDLE = {
  "@newrockstars": "new-rockstars",
  "@heavyspoilers": "heavy-spoilers",
  "@screencrush": "screencrush",
  "@reelrejects": "reel-rejects",
  "@breakdownsandblockbusters": "breakdowns-and-blockbusters",
  "@cinepals": "cinepals",
  "@variant": "variant-comics",
  "@vettedpodcast": "vetted",
  "@everythingalways": "everything-always",
  "@thecosmicwonder": "the-cosmic-wonder",
  "@thegoldman25": "the-gold-man",
  "@thekristianharloff": "kristian-harloff",
  "@lorereloaded": "lore-reloaded",
  "@redarcade": "red-arcade",
  "@sideserfcakes": "sideserf-cake-studio",
  "@wesnemo": "wesnemo",
  "@thenormies": "the-normies",
  "@theperfectmixx": "the-perfect-mix",
  "@galaxygeeks": "galaxy-geeks",
  "@geekdom101": "geekdom101",
  "@baddmedicine": "badd-medicine",
  "@heroesreforged": "heroes-reforged",
  "@coyjandreau": "coy-jandreau",
  "@chaosgaming": "chaos-gaming",
  "@wesworldyt": "wesworld",
  "@moviemanmark": "movie-man-mark",
  "@squirrelstampede": "squirrel-stampede",
  "@emmaiden": "emmaiden",
  "@filmthreat": "film-threat",
  "@jessicavanel": "jessica-vanel",
  "@downtoearthkh": "down-to-earth-kristian-harloff",
  "@coltonogburnchannel": "colton-ogburn",
  "@cinedesi": "cinedesi",
  "@beyondthetrailer": "beyond-the-trailer",
  "@danco": "danco",
  "@deepdivenr": "the-deep-dive",
  "@moviefactsproyt": "movie-facts-pro",
  "@themoviecouple": "the-movie-couple",
  "@film_paradise": "film-paradise",
  "@witchinghournr": "the-witching-hour",
  "@worldofgeekdom": "world-of-geekdom",
  "@ajm_nerdcore": "ajm-nerdcore",
  "@morechaosgaming": "more-chaos-gaming",
  "@chaostrektv": "chaostrek",
  "@geekdom101plus": "geekdom101-plus",
  "@dreamteamsworld": "dream-teams-world",
  "@jaydenrodrigues": "jayden-rodrigues"
};

export const dftPageFor = handle => {
  const slug = DFT_SLUG_BY_HANDLE[String(handle || "").toLowerCase()];
  return slug ? DFT_CREATOR_PAGE + slug : null;
};
