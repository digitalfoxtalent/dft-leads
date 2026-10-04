// Legal + contact pages, brand-aware. One set of documents, both publications. Plain, short, honest. Operator named here (not on the masthead).
// v1 September 2026. Drafted without a lawyer; review before public launch.
import { esc } from "./render.js";
import { brand, member, joinCta, mail, audience, pubFee } from "./brand.js";

const B = () => brand().name;
const DOMAIN = () => brand().domain;

export const OPERATOR = "Digital Fox Talent LLC";
export const OPERATOR_SHORT = "the operator";
const UPDATED = "3 September 2026";
const PRIVACY_UPDATED = "3 October 2026";

// Simple document page: title, dek, then prose sections.
function docPage({ base, title, dek, sections, aside }) {
  return `
<main class="homeview">
  <div class="wrap about">
    <a class="back" href="${base}/">&larr; Back to the front page</a>
    <div class="aboutcols">
    <div class="abouttext">
      <h1 class="headline" style="font-size:clamp(1.9rem,4vw,2.8rem);margin-top:1rem">${esc(title)}</h1>
      <p class="meta" style="margin:.4rem 0 1.6rem">${esc(dek)}</p>
      ${sections.map(([h, ...ps]) => `<h2>${esc(h)}</h2>${ps.map(p => `<p>${p}</p>`).join("")}`).join("")}
    </div>
    <aside class="aboutrail">${aside || ""}</aside>
    </div>
  </div>
</main>`;
}

const railBox = (h, body) => `<div class="box" style="padding:1.2rem 1.3rem;margin-bottom:1.2rem"><h3 style="margin:0 0 .5rem;font-family:var(--disp);font-size:.78rem;letter-spacing:.1em;text-transform:uppercase">${h}</h3>${body}</div>`;

export function contactBody(base) {
  return docPage({
    base, title: "Contact", dek: "Two addresses. Real people read both.",
    sections: [
      ["General", `Anything about the site, partnerships, press, or working with us: <a href="mailto:${mail("hello")}">${mail("hello")}</a>.`],
      ["Corrections", `If an article has something wrong in it, write to <a href="mailto:${mail("corrections")}">${mail("corrections")}</a> with the link and what needs fixing. We correct it and note the correction on the article. If you are the creator and want a piece taken down, the same address works and it comes down.`],
      ["Creators", `Make videos ${audience()} and want them here under your name? <a href="${base}/join">${joinCta()}</a>. It takes about a minute and you only need your YouTube handle.`],
      ["Advertising", `Ads on ${esc(B())} are served by advertising networks. To reach our readers directly, email <a href="mailto:${mail("hello")}">${mail("hello")}</a>.`],
    ],
    aside: railBox("Response time", `<p class="note" style="border:0;padding:0;margin:0">Usually within two working days. Corrections faster.</p>`),
  });
}

export function privacyBody(base) {
  return docPage({
    base, title: "Privacy", dek: `How ${B()} handles your data. Last updated ${PRIVACY_UPDATED}.`,
    sections: [
      ["Who we are", `${B()} (${DOMAIN()}) is published by ${OPERATOR}. Questions about this policy go to <a href="mailto:${mail("hello")}">${mail("hello")}</a>.`],
      ["What we collect when you read", `Reading ${B()} does not require an account and we do not ask you for anything. We use Vercel Web Analytics, which counts visits and page views without cookies and without identifying you. Videos are embedded through YouTube's privacy-enhanced player and only load after you press play; from that point YouTube's own <a href="https://policies.google.com/privacy" rel="noopener">privacy policy</a> applies.`],
      ["Advertising", `We show ads served by third-party advertising networks, which may use cookies or similar technologies to measure ads and, where you have consented, to personalise them. Where the law requires it (including the UK and EEA) you will see a consent banner before any such cookie is set, and you can change your choice at any time from the link in the footer. Third-party vendors, including Google, use cookies to serve ads based on your prior visits to this website or other websites. Google's use of advertising cookies enables it and its partners to serve ads to you based on your visits to this site and/or other sites on the Internet. You can opt out of personalised advertising by visiting Google's <a href="https://adssettings.google.com" rel="noopener">Ads Settings</a>, and you can opt out of other vendors' use of cookies for personalised advertising at <a href="https://www.aboutads.info/choices" rel="noopener">aboutads.info</a>. Google's use of advertising data is described at <a href="https://policies.google.com/technologies/ads" rel="noopener">policies.google.com/technologies/ads</a>.`],
      ["What we collect when you apply as a creator", `The application form asks for your YouTube handle, your name, an email address, what you make and roughly how big your channel is. We keep that in our work-management system (monday.com) to review the application, contact you, and, if you join, to run and pay your account. We do not sell or share it with anyone else, and if you ask us to delete it we will, unless we need to keep a record of a payment.`],
      ["Email", `If you email us we keep the message for as long as we need it to reply and act on it.`],
      ["Your rights", `You can ask what we hold about you, ask us to correct or delete it, or object to how we use it, by emailing <a href="mailto:${mail("hello")}">${mail("hello")}</a>. If you are in the UK or EEA you also have the right to complain to your data-protection regulator.`],
      ["Children", `${B()} is not directed at children under 13 and we do not knowingly collect information from them.`],
      ["Changes", `If this policy changes we update the date at the top. Substantive changes are noted on the About page.`],
    ],
    aside: railBox("In short", `<p class="note" style="border:0;padding:0;margin:0">No accounts, no tracking cookies of our own. Ads and YouTube embeds are third parties, and you get a consent choice where the law gives you one. Creator applications are kept only to run the programme.</p>`),
  });
}

export function termsBody(base) {
  return docPage({
    base, title: "Terms of use", dek: `The rules for using ${B()}. Last updated ${UPDATED}.`,
    sections: [
      ["The site", `${B()} (${DOMAIN()}) is published by ${OPERATOR}. By using the site you agree to these terms. If you are a creator publishing here, the <a href="${base}/creators">Creator Agreement</a> also applies to you.`],
      ["What the articles are", `Every article is adapted from a single creator's own video and published under that creator's name. The first draft is written with the help of AI from the video's transcript, then checked against the video. Opinions, theories, reactions and reviews are the creator's own and are presented as such; nothing here is a statement of fact by ${B()} unless it says so. Where an article reports a rumour, it is a rumour.`],
      ["Using the content", `You may read, link to and share articles freely. You may not copy, republish, scrape or use the articles, images or code on this site to train models or build other products without written permission. Video thumbnails and embedded videos belong to their creators and to YouTube.`],
      ["Creators' rights", `Creators own their takes. Each creator has granted ${B()} a non-exclusive licence to adapt and publish their videos as articles and can withdraw at any time, at which point their articles come down.`],
      ["Corrections and takedowns", `We fix errors and say so. Email <a href="mailto:${mail("corrections")}">${mail("corrections")}</a>. If you believe something on the site infringes your rights, email the same address with the link and the details and we will respond promptly.`],
      ["Advertising", `The site is supported by advertising served by third-party networks. Advertisers do not influence what is published or how it is written.`],
      ["No warranty, limited liability", `The site is provided as is. We do our best to keep it accurate and available but do not promise either, and to the extent the law allows, ${OPERATOR} is not liable for any loss arising from your use of the site or reliance on anything in it.`],
      ["Changes and law", `We may update these terms; the date at the top tells you when. These terms are governed by the laws of the United States and the state in which ${OPERATOR} is organised.`],
    ],
    aside: railBox("The gist", `<p class="note" style="border:0;padding:0;margin:0">Read and share freely. Don't scrape or republish. The takes belong to the creators. Tell us when we get something wrong and we'll fix it.</p>`),
  });
}

// The publishing fee paragraph (Version 3). Plain about the amount, the reason and the floor.
function moneyFee() {
  const f = pubFee();
  return `Each month we deduct a publishing fee of $${f} from your share. It covers the cost of producing your articles: drafting each one from your video, checking it against the video, editing, hosting and serving it. A YouTube upload does not carry that cost, because you have already made the video; an article has to be made again, in writing, and that work is ours. It matches the fee in our other creator agreements. The fee only ever comes out of what your articles earned that month, so it can never leave you owing us anything: your payout for the month is 60% of the net receipts minus $${f}, or nothing if that comes to less than zero. In a month where your articles earn nothing, you pay nothing. There are no other fees, charges or deductions.`;
}

export function creatorsBody(base) {
  return docPage({
    base, title: "Creator Agreement", dek: `The deal, in full. Version ${pubFee() ? 3 : 2}, September 2026. Applying to become a ${member()} is acceptance of this agreement.`,
    sections: [
      ["Who this is between", `You, the owner of the YouTube channel named in your application, and ${OPERATOR}, which publishes ${B()}.`],
      ["What you grant", `A non-exclusive, worldwide licence for ${B()} to adapt your public videos into written articles, publish them on ${DOMAIN()} and its feeds under your channel name, and use your channel name, handle and video thumbnails to present them. Non-exclusive means you keep every other right: your videos stay yours, you can do anything else with them, and you can work with anyone else.`],
      ["What we do", `We draft each article from your video's transcript with the help of AI, check it against the video, and publish it with a link to the original video at the end and a note that it was adapted from your video. Your claims keep the strength you gave them. We do not put words in your mouth; if something drifts, tell us and it is fixed.`],
      ["Money", `Advertising revenue attributed to your articles is split 60/40 in your favour: you keep 60%, ${B()} keeps 40%, calculated on net advertising receipts (what the ad networks actually pay us for those pages). ${pubFee() ? moneyFee() : `Sixty percent means sixty percent. There are no fees, charges or deductions of any kind before or after that split.`} We report monthly and pay monthly once your balance reaches $50; smaller balances roll over. Payment is by the method you give us and you are responsible for any taxes on what you receive.`],
      ["Leaving", `You can leave at any time by emailing <a href="mailto:${mail("hello")}">${mail("hello")}</a> from the address on your application. Your articles come down within seven days, and any balance you are owed is paid at the next monthly run. We can also end the agreement at any time on the same terms. Individual articles can be taken down on request at any point without leaving.`],
      ["Your side", `You confirm the channel is yours (or you are authorised to speak for it), that its videos are your own work, and that publishing them as articles does not break anyone else's rights. Where a video quotes or uses others' material, the article will too, in the same way, and you are responsible for that use.`],
      ["Changes", `If we change this agreement we email you at the address on your application at least 30 days before the change takes effect. If you do not want the new terms, you can leave before they apply and the old terms cover everything up to then.`],
      ["Law", `This agreement is governed by the laws of the United States and the state in which ${OPERATOR} is organised.`],
    ],
    aside: railBox("Plain-English version", `<ul class="note" style="border:0;padding:0 0 0 1rem;margin:0"><li>60% to you on what your articles earn</li>${pubFee() ? `<li>A $${pubFee()} monthly publishing fee comes off your share, never more than you earned</li><li>Non-exclusive, no minimum term</li>` : `<li>Non-exclusive, no fees, no minimum term</li>`}<li>Paid monthly from $50</li><li>Leave any time; articles come down</li><li>Applying is the agreement</li></ul>`),
  });
}
