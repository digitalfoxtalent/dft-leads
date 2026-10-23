// Tables for the monday mirror. Everything sits in its own Postgres schema, "mirror", so the later
// editable Ecosystem tables can live beside it without mixing a copy with the source of truth.
//
// The shape follows monday on purpose (boards > groups > items > column values, subitems, updates),
// so every board can be shown the way the team already knows it, and moved back if ever needed.

import { batch } from "./db.js";
import { EDIT_SCHEMA } from "./edit.js";
import { SWITCH_SCHEMA } from "./switch.js";

export const SCHEMA_SQL = [
  `CREATE SCHEMA IF NOT EXISTS mirror`,
  `CREATE TABLE IF NOT EXISTS mirror.boards (
     id bigint PRIMARY KEY,
     name text NOT NULL,
     description text,
     board_type text NOT NULL DEFAULT 'board',         -- board | sub_items_board
     board_kind text,                                  -- public | private | share
     workspace_id bigint,
     workspace_name text,
     workspace_kind text,                              -- open | closed
     folder_id bigint,
     folder_path text,
     department text NOT NULL DEFAULT 'data',
     access text NOT NULL DEFAULT 'listed',            -- team | listed
     allowed_emails text[] NOT NULL DEFAULT '{}',
     columns jsonb NOT NULL DEFAULT '[]',
     groups jsonb NOT NULL DEFAULT '[]',
     parent_board_id bigint,                           -- for a subitems board, the board it belongs to
     monday_items int,
     mirror_items int,
     monday_updated_at timestamptz,
     synced_at timestamptz,
     full_synced_at timestamptz,
     sync_error text,
     seen_at timestamptz NOT NULL DEFAULT now(),
     gone boolean NOT NULL DEFAULT false               -- archived or deleted in monday since
   )`,
  `CREATE TABLE IF NOT EXISTS mirror.items (
     id bigint PRIMARY KEY,
     board_id bigint NOT NULL,
     parent_id bigint,
     group_id text,
     name text,
     vals jsonb NOT NULL DEFAULT '{}',                 -- column id -> [text, raw value]
     created_at timestamptz,
     updated_at timestamptz,
     creator text,
     pos int,                                          -- order on the monday board (from the last full copy)
     deleted boolean NOT NULL DEFAULT false,
     synced_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS items_board ON mirror.items (board_id) WHERE NOT deleted`,
  `CREATE INDEX IF NOT EXISTS items_parent ON mirror.items (parent_id) WHERE parent_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS mirror.updates (
     id bigint PRIMARY KEY,
     item_id bigint NOT NULL,
     body text,
     creator text,
     created_at timestamptz
   )`,
  `CREATE INDEX IF NOT EXISTS updates_item ON mirror.updates (item_id)`,
  `CREATE TABLE IF NOT EXISTS mirror.sync_runs (
     id bigserial PRIMARY KEY,
     started_at timestamptz NOT NULL DEFAULT now(),
     finished_at timestamptz,
     mode text,
     boards_synced int NOT NULL DEFAULT 0,
     items_written int NOT NULL DEFAULT 0,
     api_calls int NOT NULL DEFAULT 0,
     ok boolean,
     note text
   )`,
  `CREATE TABLE IF NOT EXISTS mirror.access_log (
     id bigserial PRIMARY KEY,
     at timestamptz NOT NULL DEFAULT now(),
     email text,
     path text,
     board_id bigint,
     allowed boolean NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS access_log_at ON mirror.access_log (at)`,
  `CREATE TABLE IF NOT EXISTS mirror.team (
     email text PRIMARY KEY,                           -- active, non-guest monday users, refreshed each sync
     name text,
     seen_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS mirror.locks (name text PRIMARY KEY, until timestamptz NOT NULL DEFAULT 'epoch')`,
  `INSERT INTO mirror.locks (name) VALUES ('sync') ON CONFLICT (name) DO NOTHING`,
  ...EDIT_SCHEMA, // the edit log (edit.js)
  ...SWITCH_SCHEMA, // the editing switch per section (switch.js)
];

let ready = false;
export async function ensureSchema() {
  if (ready) return;
  await batch(SCHEMA_SQL.map(s => [s, []]));
  ready = true;
}
export const _resetSchemaFlag = () => { ready = false; };
