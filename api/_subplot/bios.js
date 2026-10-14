// CREATOR BIOS, 3 Oct 2026. A short, human-approved paragraph about each creator in the AdSense
// review set: who they are, what they cover, how big the channel is. Shown on the creator page
// and in an "About the creator" box on each of their articles, so every byline maps to a real,
// described person. Facts come from each channel's own public YouTube page (3 Oct 2026);
// subscriber figures are written as "more than" a rounded-down number so they stay true as the
// channel grows. Approved by Tom James before going live. Keyed on YouTube handle, lower case,
// without the @.
export const BIOS = {
  breakdownsandblockbusters: "Breakdowns & Blockbusters (formerly Bullets & Blockbusters) is a YouTube channel about how blockbuster films get made and why they succeed or fail: unmade scripts, troubled productions and the franchise decisions behind them. It has more than 240,000 subscribers and over 400 videos.",
  lorereloaded: "Lore Reloaded makes independent analysis, documentaries and deep dives into Star Trek, Stargate and wider science fiction lore, with a particular interest in how institutions like Starfleet actually work. The channel has more than 140,000 subscribers and over 1,000 videos.",
  chaosgaming: "Chaos is the Call of Duty channel of Jimmy, known to fans as the series' Top 10 historian. It covers every Call of Duty game with rankings, retrospectives and news, and has more than 2.6 million subscribers and over 8,000 videos.",
  chaostrektv: "ChaosTrek is Jimmy's Star Trek channel, a companion to his Call of Duty channel Chaos. It covers the Star Trek films and series with rankings, reviews and breakdowns, and has more than 13,000 subscribers.",
  danco: "DanCo is a comic book channel best known for its versus breakdowns, comparing characters from Marvel, DC and beyond on their powers, feats and comic book history. It has more than 580,000 subscribers and around 3,000 videos.",
  heavyspoilers: "Heavy Spoilers, presented by Paul, explains films and TV series in depth: endings, Easter eggs, comic book references and the theories they set up. The channel has more than 1.6 million subscribers and around 2,800 videos.",
  commentatorscursefgc: "Commentator's Curse FGC tells the stories behind the fighting game community: the players, rivalries and tournament runs that are easy to forget. It is a small channel built on long-form research, with more than 2,000 subscribers.",
  geekdom101plus: "Geekdom101 Plus is the second channel of Danny, host of Geekdom101 and World of Geekdom, with extra videos on anime, comics and pop culture. It has more than 3,000 subscribers.",
  everythingalways: "Everything Always covers the Marvel Cinematic Universe in detail, from trailers and casting news to Easter eggs and fan theories. It is hosted by entertainment journalist Michael Roman and has more than one million subscribers and over 3,000 videos.",
  beyondthetrailer: "Beyond The Trailer is hosted by Grace Randolph, who covers Hollywood's biggest films and series with reviews, breakdowns and audience reaction. The channel has more than 930,000 subscribers and over 8,000 videos.",
  arealknowitall: "Mr. Know-It-All is film and TV analysis hosted by Johnny, who looks at how films and series are made as well as what ends up on screen. The channel has more than 77,000 subscribers and around 1,000 videos.",
};

export const bioFor = handle => BIOS[String(handle || "").replace(/^@/, "").toLowerCase()] || "";
