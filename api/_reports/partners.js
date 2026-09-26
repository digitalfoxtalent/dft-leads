// Partner views: one partner's campaigns, shared outside DFT with its own link.
//
// Each partner has its own key (only the SHA-256 is kept here). Opening
// /campaigns/<id>?k=<key> sets a partner cookie that opens THAT page only, plus the public
// per-video lookups it uses. It never opens Campaign reach, Platform monetization or any other report.
// To revoke a partner's link, change its keySha. To add a partner, add an entry.
//
// A campaign belongs to a partner when the deal's CLIENTS, its CLIENT mirror (from CONTACTS)
// or its QB Customer mirror names the partner.
// The page data is stripped on the server: no brand price, deal value, creator cost, sales lead,
// monday links or other clients' deals ever reach a partner's browser.

export const PARTNERS = {
  rhapsody: { name: "Rhapsody", match: /rhapsody/i, keySha: "ae376105a3428435a38819ca20c7c9058c2193f1b00688050b399d7ba1ec2894" },
};
