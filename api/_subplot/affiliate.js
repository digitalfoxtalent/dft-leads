// Amazon affiliate box on article pages (Tom, 10 Oct 2026: Amazon links go live with the launch, not before,
// because Amazon closes an Associates account that makes no 3 qualifying sales in its first 180 days).
//
// OFF until both are true: the site is launched (launch.js) and AMAZON_ASSOCIATES_TAG is set in Vercel's
// environment (the tracking id from Tom's Associates account, for example "subplot-20"). With either missing,
// box() returns "" and nothing on the page changes.
//
// The link is an Amazon search for the article's subject (the same subject SUBPLOT already groups articles
// under, such as "Avengers: Doomsday"), which Associates allows as a text link and which needs no product API.
// It carries rel="sponsored nofollow" and the disclosure Amazon requires sits in the box itself.
import { LAUNCHED } from "./launch.js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function amazonTag() {
  const t = String(process.env.AMAZON_ASSOCIATES_TAG || "").trim();
  return LAUNCHED && /^[a-z0-9-]{3,40}$/i.test(t) ? t : "";
}

// The article's subject: the largest subject group it belongs to. No subject, no box.
export function subjectFor(a, data) {
  const subs = Object.values((data && data.subjects) || {}).filter((s) => s.items && s.items.includes(a.id));
  subs.sort((x, y) => y.n - x.n);
  return subs.length ? String(subs[0].t || "").trim() : "";
}

export function box(a, data) {
  const tag = amazonTag();
  if (!tag) return "";
  const subject = subjectFor(a, data);
  if (!subject || subject.length > 80) return "";
  const url = "https://www.amazon.com/s?k=" + encodeURIComponent(subject) + "&tag=" + encodeURIComponent(tag);
  return `<aside class="buybox" aria-label="Shop" style="margin:2.4rem 0 0;padding:1rem 1.25rem;border:1px solid var(--rule-2);border-radius:4px">
        <p style="margin:0 0 .5rem;font-size:.72rem;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3)">Shop</p>
        <p style="margin:0">Find <a href="${esc(url)}" target="_blank" rel="sponsored nofollow noopener" style="color:var(--blue)">${esc(subject)} on Amazon</a>: films, series, games, books and collectibles.</p>
        <p style="margin:.5rem 0 0;font-size:.78rem;color:var(--ink-3)">As an Amazon Associate, SUBPLOT earns from qualifying purchases.</p>
      </aside>`;
}
