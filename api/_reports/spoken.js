// Is a brand read out as a sponsor in a video? Used by the flight audit (and safe for any job that has a transcript).
//
// Why (9 Oct 2026): a full audit of every campaign row against the videos' own transcripts found sponsor reads
// whose description carried no brand link at all (for example Shopify x The Reel Rejects, 12 Jul 2026), so the
// link-based finders could never see them. A transcript check closes that gap.
//
// Strict on purpose: the brand (or a spelling auto captions are known to use for it) must sit inside a sponsor
// phrase: "thank you to BRAND", "BRAND for sponsoring", "sponsored by BRAND", "brought to you by BRAND",
// "today's sponsor BRAND", "partnered with BRAND", "go to BRAND.com", "BRAND dot com". A brand that is merely
// mentioned (a film called Huel, a game reviewed) does not count. On 2,356 transcripts this found no false read
// for the brands below; brands that are common words (Factor, Meta, Round...) are never matched here.
const decode = s => String(s || "").replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&gt;|&lt;/g, " ");
const sq = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
// Spellings seen in real auto captions. Add only ones seen in a transcript.
export const HEARD = {
  huel: ["huel", "hule", "huell", "hual", "hewel"], prizepicks: ["prizepicks", "prizepick", "prizepix"],
  liquidiv: ["liquidiv", "liquid4", "liquidfour"], betterhelp: ["betterhelp", "betterhel"],
  zocdoc: ["zocdoc", "zockdock", "zocdock", "zockdoc", "zachdoc", "zdoc"], lmnt: ["lmnt", "element", "elementt"],
  quince: ["quince", "quints"], klover: ["klover", "clover"], outskill: ["outskill", "outskills"],
};
export const COMMON = /^(meta|factor|round|dose|kora|beam|fox|outcome|opera|human|recall|worthy|webtoon|star trek|warner bros|hbo|netflix|amazon|apple)$/i;
const BEFORE = /(thank(s| you)( so much)?( to)?|sponsored by|brought to you by|today'?s sponsor,?|our sponsor,?|partnered with|partner(ing)? with|go (over )?to|head (over )?to|check out|visit)\s*$/;
const AFTER = /^(for sponsoring|is sponsoring|sponsored|for partnering|dot com|\.com|com\b|slash)/;
const variants = brand => { const b = sq(brand).replace(/^the/, ""); return (HEARD[b] || [b]).map(sq).filter(v => v.length >= 3); };
// transcript: plain text, or the actor's [{ text, start }] list. Returns { heard, quote, at } or null.
export function spokenRead(transcript, brand) {
  if (!transcript || !brand || COMMON.test(String(brand).trim())) return null;
  const lines = Array.isArray(transcript) ? transcript : [{ text: transcript, start: null }];
  const words = [], starts = [];
  for (const l of lines) for (const w of decode(l.text).toLowerCase().normalize("NFKD").replace(/[^a-z0-9.'\s]/g, " ").split(/\s+/).filter(Boolean)) { words.push(w); starts.push(l.start); }
  const vs = new Set(variants(brand)); if (!vs.size) return null;
  for (let i = 0; i < words.length; i++) for (let k = 1; k <= 4 && i + k <= words.length; k++) {
    const key = words.slice(i, i + k).map(sq).join("").replace(/dotcom$|com$/, "");
    if (!vs.has(key)) continue;
    const before = words.slice(Math.max(0, i - 8), i).join(" "), after = words.slice(i + k, i + k + 6).join(" ");
    if (BEFORE.test(before) || AFTER.test(after) || /\.com/.test(words[i + k - 1])) {
      return { heard: words.slice(i, i + k).join(" "), quote: words.slice(Math.max(0, i - 8), i + k + 10).join(" "), at: starts[i] != null ? Math.round(starts[i]) : null };
    }
  }
  return null;
}
