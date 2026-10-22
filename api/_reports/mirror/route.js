// Routing for the read-only monday copy on the Ecosystem host. api/reports.js calls this only after the
// visitor is signed in with a DFT Google account, and only on ecosystem.digitalfoxtalent.com (never on
// the reports host or a preview build).

import { ensureSchema } from "./schema.js";
import { hasDatabase } from "./db.js";
import { securityHeaders, renderDepartment, renderBoard, renderItem, renderStatus, DEPT_NAMES } from "./pages.js";

const BOARD = /^boards\/(\d{1,19})$/;
const ITEM = /^boards\/(\d{1,19})\/items\/(\d{1,19})$/;
const DEPT = /^([a-z]+)\/boards$/;

export function isMirrorRoute(route) {
  const r = String(route || "");
  if (BOARD.test(r) || ITEM.test(r) || r === "data/mirror") return true;
  const m = r.match(DEPT);
  return !!(m && DEPT_NAMES[m[1]]);
}

const one = v => String(Array.isArray(v) ? v[0] : v == null ? "" : v);

export async function mirrorPage(route, req, res, email) {
  securityHeaders(res);
  if (req.method && req.method !== "GET" && req.method !== "HEAD") return { status: 405, html: "Method not allowed" };
  if (!email) return { status: 401, html: "Sign in required" };
  if (!hasDatabase()) return { status: 503, html: "The Ecosystem database is not connected yet." };
  await ensureSchema();
  const q = one(req.query && req.query.q).slice(0, 100).trim();
  const page = one(req.query && req.query.page);
  let m;
  if ((m = route.match(ITEM))) return renderItem(email, m[1], m[2]);
  if ((m = route.match(BOARD))) return renderBoard(email, m[1], q, page);
  if (route === "data/mirror") return renderStatus(email);
  if ((m = route.match(DEPT))) return renderDepartment(email, m[1], q);
  return { status: 404, html: "Not found" };
}
