// Amazon affiliate box on article pages.
//
// WORDIE (Tom, 14 Oct 2026: "we should put Amazon ads into it for now"): on, with the tracking id below
// (WORDIE_AMAZON_TAG in Vercel overrides it). Wordie has no AdSense account yet, so this is its only
// advertising for now.
// SUBPLOT: stays off here. SUBPLOT's own box ships with its launch commit (Tom, 10 Oct 2026: Amazon
// closes an Associates account with no 3 qualifying sales in its first 180 days, so its links wait for
// launch). Both read their tag from their own env var and never share one.
//
// The link is an Amazon search for the article's subject (its largest subject group, or failing that
// its first tag), which Associates allows as a text link and which needs no product API. It carries
// rel="sponsored nofollow", and the disclosure Amazon requires sits in the box itself.
import { brand } from "./brand.js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function amazonTag() {
  if (brand().key !== "wordie") return "";
  // The tracking id is public by nature (it rides in every link), so it lives in code with an env
  // override. subplottv-20 is the account's only id today; SUBPLOT's box is not live, so every
  // click on it is Wordie's until Tom adds a Wordie-specific id and sets WORDIE_AMAZON_TAG.
  const t = String(process.env.WORDIE_AMAZON_TAG || "subplottv-20").trim();
  return /^[a-z0-9-]{3,40}$/i.test(t) ? t : "";
}

// Largest subject group the article belongs to; then its first tag of two or more words or a
// single long one, so a generic tag like "video" never becomes a shopping search.
export function subjectFor(a, data) {
  const subs = Object.values((data && data.subjects) || {}).filter((s) => s.items && s.items.includes(a.id));
  subs.sort((x, y) => y.n - x.n);
  if (subs.length && subs[0].t) return String(subs[0].t).trim();
  const tag = (a.t || []).map((t) => String(t).trim()).find((t) => /\s/.test(t) || t.length >= 6);
  return tag || "";
}

export function box(a, data) {
  const tag = amazonTag();
  if (!tag) return "";
  const subject = subjectFor(a, data);
  if (!subject || subject.length > 80) return "";
  const url = "https://www.amazon.com/s?k=" + encodeURIComponent(subject) + "&tag=" + encodeURIComponent(tag);
  return `<aside class="buybox" aria-label="Shop" style="margin:2.4rem 0 0;padding:1rem 1.25rem;border:1px solid var(--rule-2);border-radius:12px">
        <p style="margin:0 0 .5rem;font-size:.72rem;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3)">Shop</p>
        <p style="margin:0">Find <a href="${esc(url)}" target="_blank" rel="sponsored nofollow noopener" style="color:var(--blue)">${esc(subject)} on Amazon</a>.</p>
        <p style="margin:.5rem 0 0;font-size:.78rem;color:var(--ink-3)">As an Amazon Associate, ${esc(brand().name)} earns from qualifying purchases.</p>
      </aside>`;
}
