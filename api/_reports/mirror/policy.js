// What the mirror copies, where each board shows up in the Ecosystem, and who may see it.
//
// WHO SEES WHAT (Tom, 22 Oct 2026: finance visible "only to you, or those that have access")
//  - A main (public) board in an open workspace: every signed-in DFT team member, as in monday.
//  - A private or shareable board, a board in a closed workspace, and every board in a restricted area
//    (finance, legal, the TJ folder, the calc workspaces, anything named private, pay, commission and so on):
//    only the people on that board in monday (owners and subscribers), plus Tom.
//  - When in doubt the rule is "listed": nobody sees a board until monday says who may.
//
// NEVER COPIED: boards that hold credentials (the API Keys board, Passwords, Logins and anything named that
// way). They stay in monday only, and their contents never reach the Ecosystem database.

export const TOM = "tom@digitalfoxtalent.com";
export const TEAM_DOMAIN = "digitalfoxtalent.com";

const EXCLUDED_IDS = new Set(["18422548864", "8305039248", "18424950247"]);
const SECRET_NAME = /\b(api[ -]?keys?|passwords?|logins?|credentials?|secrets?|tokens?)\b/i;
export const isExcluded = b => EXCLUDED_IDS.has(String(b.id)) || SECRET_NAME.test(String(b.name || ""));

const RESTRICTED_AREA = /^(finance|legal|tj|culture)$/i;
const RESTRICTED_NAME = /private|leadership|comp\b|payroll|commission|salary|pay cap|shareholder|valuation|cost base|exit readiness|invoice|payment|p&l|revenue|quickbooks|bank/i;
const RESTRICTED_WORKSPACES = /^(partner calcs|talent calcs|tj)$/i;

// Top-level folder (or workspace) -> Ecosystem department, using the nine departments on the map.
const FOLDER_DEPT = [
  [/^brand partnerships$/i, "partnerships"],
  [/^talent booking/i, "partnerships"],
  [/^talent management$/i, "talent"],
  [/^platform monetization$/i, "platforms"],
  [/^show development$/i, "shows"],
  [/^marketing/i, "marketing"],
  [/^finance$|^legal$|^tj$|^culture$|^business development$|agency handbook/i, "finance"],
  [/^archive/i, "data"],
];
const WORKSPACE_DEPT = [
  [/^partner calcs$|^talent calcs$/i, "finance"],
  [/^wordie$/i, "content"],
  [/^origin$/i, "shows"],
  [/crm|performance|rhapsody/i, "partnerships"],
  [/^dft home$/i, "partnerships"],
  [/^test \/ old boards$|^workforms$/i, "data"],
];
export const MAIN_WORKSPACE = "@digitalfoxtalent";

export function departmentFor({ workspaceName, folderPath, boardName }) {
  const ws = String(workspaceName || "");
  const top = String(folderPath || "").split(" / ")[0];
  if (ws === MAIN_WORKSPACE) {
    // Articles live under Platform Monetization in monday but belong to Content Production on the map.
    if (/(^| \/ )articles( \/ |$)/i.test(folderPath || "") || /^articles/i.test(boardName || "")) return "content";
    for (const [re, d] of FOLDER_DEPT) if (re.test(top)) return d;
    return "data";
  }
  for (const [re, d] of WORKSPACE_DEPT) if (re.test(ws)) return d;
  return "talent"; // the creator workspaces (one per creator)
}

const cleanEmails = list => [...new Set((list || [])
  .map(x => String((x && x.email) || x || "").toLowerCase().trim())
  .filter(e => e.endsWith("@" + TEAM_DOMAIN)))];

export function accessFor({ boardType, boardKind, workspaceKind, workspaceName, folderPath, boardName, department, owners, subscribers }) {
  // A subitems board has no folder of its own: it stays Tom-only until its parent board's copy hands
  // down the parent's access (sync.js). Never default it to the whole team.
  if (boardType === "sub_items_board") return { access: "listed", allowed: [TOM] };
  const top = String(folderPath || "").split(" / ")[0];
  const restricted = boardKind !== "public" || workspaceKind === "closed"
    || RESTRICTED_AREA.test(top) || RESTRICTED_WORKSPACES.test(String(workspaceName || ""))
    || RESTRICTED_NAME.test(String(boardName || ""));
  if (!restricted) return { access: "team", allowed: [] };
  const allowed = cleanEmails([...(owners || []), ...(subscribers || [])]);
  if (!allowed.includes(TOM)) allowed.push(TOM);
  return { access: "listed", allowed };
}

// Can this signed-in email see this board row? `team` is the set of active, non-guest monday users
// (copied on every sync): a Google account that is not, or is no longer, on monday sees nothing.
export function canSee(board, email, team) {
  const e = String(email || "").toLowerCase();
  if (!e.endsWith("@" + TEAM_DOMAIN)) return false;
  if (team && !team.has(e)) return false;
  if (!board || board.gone) return false;
  if (board.access === "team") return true;
  return Array.isArray(board.allowed_emails) && board.allowed_emails.includes(e);
}
