// SUBPLOT formats. Every article carries ONE format: what kind of piece it is, as opposed to
// what it is about (that is the category in data.js). Each format has a character from the
// cast and that character's own colour, lifted from its artwork in cast.js, so the palette is
// the cast and nothing is invented. Colour keys on format and never on subject: subject stays
// a plain text label, and a Marvel-heavy day still shows a spread of colours.
//
// Three tints, three jobs. `col` is for marks only (the card rule, the dot, the thread stripe).
// `ink` is the only version used for text, so yellow and teal stay legible. `wash` is for
// backgrounds (a Snippet bubble, a character plinth). A format colour never fills a card.
//
// The publisher does not yet write a format. Until it does, formatOf() reads it off the
// headline and tags; a store record that carries `format` wins the moment one appears. Anything
// the heuristic is unsure about is a breakdown, which is SubPlot blue, the house colour, so a
// wrong guess is invisible rather than embarrassing.

export const FORMATS = {
  breakdown: { name: "Breakdown", cast: "subplot",     col: "#2218E8", ink: "#1A12B8", wash: "#EFEEFD" },
  news:      { name: "News",      cast: "goblin",      col: "#F712AE", ink: "#B80C80", wash: "#FEEAF7" },
  theory:    { name: "Theory",    cast: "theorist",    col: "#831DCC", ink: "#6414A0", wash: "#F3EAFA" },
  review:    { name: "Review",    cast: "critic",      col: "#FF8806", ink: "#B25A00", wash: "#FFF1E2" },
  ranking:   { name: "Ranking",   cast: "speedrunner", col: "#0CE5CF", ink: "#0A8F82", wash: "#E3FBF8" },
  reaction:  { name: "Reaction",  cast: "reactor",     col: "#FFBC00", ink: "#8A6400", wash: "#FFF7DB" },
  lore:      { name: "Lore",      cast: "lorekeeper",  col: "#16161C", ink: "#16161C", wash: "#EBE8E1" },
};
export const FORMAT_KEYS = Object.keys(FORMATS);

// Order matters: the first family that matches wins. Theory sits above news so "trailer
// revealed, and I have a theory why" reads as the theory it is; rankings and reviews sit above
// news because "X ranked" or "X review" is unambiguous even when the headline also says
// "confirmed". Lore is mostly the evergreen feeds and the explainer shapes.
const RULES = [
  ["theory",   /\btheor(?:y|ies)\b|\bpredict|\bwhat if\b|\bcould (?:be|mean|explain)\b|\bmight (?:be|mean)\b|\bsuggests?\b|\bhere'?s how\b|\bhere'?s why\b/],
  ["ranking",  /\brank(?:ed|ing|s)?\b|\bvs\.?\b|\bversus\b|\bwho wins\b|\bworst to best\b|\bbest to worst\b|\btier list\b|\btop \d+\b|\bevery .{0,40}\b(?:ranked|rated)\b|\bguide\b|\bhow to\b|\bfastest\b|\bstrongest\b|\bweakest\b/],
  ["review",   /\breview(?:s|ed)?\b|\brecap\b|\bretrospective\b|\bfinale\b|\bepisode \d+\b|\bseason \d+\b|\bverdict\b|\bwas it good\b|\bworth (?:watching|playing)\b/],
  ["news",     /\bleak(?:s|ed)?\b|\breportedly\b|\bconfirm(?:s|ed)?\b|\brumou?rs?\b|\btrailer\b|\bannounc|\breveal(?:s|ed)?\b|\brelease date\b|\bin development\b|\bcast(?:ing)?\b|\bdelay(?:ed|s)?\b|\bfirst look\b|\bbox office\b|\bpresale\b|\btracking\b|\breshoots?\b|\bpanel\b|\bbreaking\b/],
  ["lore",     /\blore\b|\bexplained\b|\bhistory of\b|\bwho is\b|\bwhat is\b|\borigins?\b|\bcanon\b|\btimeline\b|\bthe real reason\b|\bwas never\b|\bremembering\b/],
  ["reaction", /\bi (?:think|don'?t|do not|love|hate|can'?t)\b|\bwhy i\b|\bopinion\b|\bhot take\b|\breaction\b|\bunpopular\b|\boverrated\b|\bunderrated\b|\bproblem\b|\bmistakes?\b|\bwrong\b|\bfailed\b|\bmay be the best\b|\bmy \b/],
];

export function formatOf(a) {
  const given = String(a.format || a.f || "").toLowerCase();
  if (FORMATS[given]) return given;
  const blob = (String(a.h || a.headline || "") + " " + (a.t || a.tags || []).join(" ")).toLowerCase();
  for (const [k, re] of RULES) if (re.test(blob)) return k;
  if (a.evergreen) return "lore";
  return "breakdown";
}

// CSS custom properties for every format, emitted once into the page stylesheet.
export const formatCss = () => `:root{${FORMAT_KEYS.map(k => {
  const f = FORMATS[k]; return `--f-${k}:${f.col};--f-${k}-ink:${f.ink};--f-${k}-wash:${f.wash};`;
}).join("")}}`;
