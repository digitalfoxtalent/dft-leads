// The Ecosystem's own database: Postgres on Neon, created 22 Oct 2026 as "dft-ecosystem" and connected to
// this Vercel project as DATABASE_URL (Production and Preview). See Claude Share
// general/projects/ecosystem-migration.md for the plan this is part of.
//
// SECURITY
//  - The connection string lives only in Vercel's environment and is only ever used here, on the server.
//    Nothing in this folder sends it, or any query result, to a browser except through the page renderers,
//    which escape every value.
//  - read() runs inside a READ ONLY transaction, so even a bug in a page cannot change data: Postgres
//    itself refuses any write. Pages only ever call read() and logAccess().
//  - Every query is parameterised ($1, $2 ...). Nothing a visitor types is ever pasted into SQL.
//
// Tests swap the executor for an in-memory Postgres (PGlite) with setExecutor().

import { neon } from "@neondatabase/serverless";

let exec = null;

function neonExecutor() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = neon(url);
  return {
    read: async (text, params = []) => (await sql.transaction([sql.query(text, params)], { readOnly: true }))[0],
    write: async (text, params = []) => sql.query(text, params),
    batch: async (list) => sql.transaction(list.map(([t, p]) => sql.query(t, p || []))),
  };
}

function ex() { return exec || (exec = neonExecutor()); }
export function setExecutor(e) { exec = e; }
export const hasDatabase = () => !!(exec || process.env.DATABASE_URL);

export const read = (text, params) => ex().read(text, params);
export const write = (text, params) => ex().write(text, params);
export const batch = (list) => ex().batch(list);
