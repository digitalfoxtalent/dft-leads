// The front page of reports.digitalfoxtalent.com: one card per report.
// To add a report: add an entry to REPORTS and a route in api/reports.js.

export const REPORTS = [
  { path: "/campaigns", title: "Campaign reach", live: true,
    blurb: "Every sponsor integration's lifetime views and listens, across YouTube and the podcast apps. Filter by creator, open any campaign for the detail.",
    sources: ["monday", "YouTube", "Megaphone"] },
];

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function homePage() {
  const cards = REPORTS.map(r =>
    '<a class="card" href="' + esc(r.path) + '"><span class="eyebrow">' + (r.live ? '<i></i>Live' : 'Coming soon') + '</span>' +
    '<h2>' + esc(r.title) + '</h2><p>' + esc(r.blurb) + '</p>' +
    '<span class="src">' + r.sources.map(esc).join(" · ") + '</span><span class="go">Open report</span></a>').join("") +
    '<div class="card next"><span class="eyebrow">Next</span><h2>More reports</h2><p>New reports will appear here as they are built.</p></div>';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">' +
    '<title>DFT Reports</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Crect width=%2224%22 height=%2224%22 rx=%226%22 fill=%22%23FF8800%22/%3E%3C/svg%3E">' +
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Hanken+Grotesk:wght@400;500;600&family=Martian+Mono:wght@400;500&display=swap">' +
    '<style>:root{--bg:#F2F3F6;--surface:#FFF;--ink:#14161B;--body:#3A3F49;--muted:#687080;--line:#DFE2E8;--accent:#C05600;--fill:#FF8800;--good:#2C7A4B;--shadow:0 1px 2px rgba(20,22,27,.05),0 8px 24px -12px rgba(20,22,27,.12)}' +
    '@media (prefers-color-scheme:dark){:root{--bg:#0E1014;--surface:#171A20;--ink:#F2F3F6;--body:#C8CCD4;--muted:#8B919D;--line:#2A2F38;--accent:#FF9A2E;--good:#6FC48E;--shadow:0 10px 30px -14px rgba(0,0,0,.6)}}' +
    '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--body);font:15px/1.5 "Hanken Grotesk",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:40px 20px 80px}' +
    '.wrap{max-width:1100px;margin:0 auto}.brand{display:flex;align-items:center;gap:10px;font-weight:600;color:var(--ink);font-size:14px}.brand i{width:26px;height:26px;border-radius:7px;background:var(--fill);display:grid;place-items:center}.brand svg{width:18px;height:18px}' +
    'h1{font-family:"Bricolage Grotesque",sans-serif;font-weight:800;color:var(--ink);font-size:clamp(34px,6vw,54px);line-height:1.02;margin:18px 0 10px;letter-spacing:-.01em}h1 em{font-style:normal;color:var(--accent)}' +
    '.lede{max-width:560px;color:var(--muted);margin:0 0 34px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}' +
    '.card{display:flex;flex-direction:column;gap:10px;background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:22px;box-shadow:var(--shadow);color:inherit;text-decoration:none;transition:transform .15s,border-color .15s}' +
    'a.card:hover{transform:translateY(-2px);border-color:var(--fill)}a.card:focus-visible{outline:3px solid var(--fill);outline-offset:3px}' +
    '.card h2{font-family:"Bricolage Grotesque",sans-serif;font-weight:700;color:var(--ink);font-size:24px;margin:0}.card p{margin:0}' +
    '.eyebrow,.src{font-family:"Martian Mono",monospace;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.eyebrow{display:flex;align-items:center;gap:6px}.eyebrow i{width:7px;height:7px;border-radius:50%;background:var(--good)}' +
    '.go{margin-top:auto;padding-top:6px;color:var(--accent);font-weight:600}.go:after{content:" \\2192"}.next{background:transparent;border-style:dashed;box-shadow:none}.next h2{color:var(--muted)}</style></head>' +
    '<body><div class="wrap"><div class="brand"><i aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M3 4l5 5h8l5-5v9a9 9 0 0 1-18 0V4z" fill="#1A1A1A"/><path d="M9 15.5l3 2 3-2" stroke="#FF8800" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></i>Digital Fox Talent</div><h1>DFT <em>reports</em></h1>' +
    '<p class="lede">The team\'s reporting home. Each report reads from monday, so the numbers match what the team sees there.</p>' +
    '<div class="grid">' + cards + '</div></div></body></html>';
}
