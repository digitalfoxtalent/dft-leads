// Tables for the nightly full backup (backup.js). Kept apart so schema.js can load them without a cycle.

export const BACKUP_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS mirror.backup_updates (
     id bigint PRIMARY KEY,
     board_id bigint NOT NULL,
     item_id bigint,
     reply_to bigint,                                  -- set on replies: the update they answer
     body_html text,
     body_text text,
     creator text,
     created_at timestamptz,
     updated_at timestamptz,
     backed_up_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS backup_updates_item ON mirror.backup_updates (item_id)`,
  `CREATE INDEX IF NOT EXISTS backup_updates_board ON mirror.backup_updates (board_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS mirror.backup_docs (
     id bigint PRIMARY KEY,
     object_id bigint,
     name text,
     workspace_id bigint,
     url text,
     created_by text,
     created_at timestamptz,
     updated_at timestamptz,
     blocks jsonb NOT NULL DEFAULT '[]',
     body_text text,
     backed_up_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS mirror.backup_files (
     id bigint PRIMARY KEY,                            -- monday asset id
     name text,
     extension text,
     size_bytes bigint,
     board_id bigint,
     item_id bigint,
     update_id bigint,
     column_id text,
     created_at timestamptz,
     stored_at timestamptz,                            -- when the file itself was copied (second stage)
     stored_url text,
     seen_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS mirror.backup_state (
     kind text NOT NULL,                               -- 'board' or 'docs'
     ref bigint NOT NULL,                              -- board id, or 0 for docs
     page int NOT NULL DEFAULT 1,
     pass_started_at timestamptz,
     done_at timestamptz,
     full_at timestamptz,                              -- last pass that re-read everything (weekly)
     PRIMARY KEY (kind, ref)
   )`,
  `CREATE TABLE IF NOT EXISTS mirror.backup_runs (
     id bigserial PRIMARY KEY,
     started_at timestamptz NOT NULL DEFAULT now(),
     finished_at timestamptz,
     updates_written int NOT NULL DEFAULT 0,
     docs_written int NOT NULL DEFAULT 0,
     files_seen int NOT NULL DEFAULT 0,
     api_calls int NOT NULL DEFAULT 0,
     ok boolean,
     note text
   )`,
  `INSERT INTO mirror.locks (name) VALUES ('backup') ON CONFLICT (name) DO NOTHING`,
  // Second stage (files.js): the files themselves, in the private file store.
  `ALTER TABLE mirror.backup_files ADD COLUMN IF NOT EXISTS stored_bytes bigint`,
  `ALTER TABLE mirror.backup_files ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0`,
  `ALTER TABLE mirror.backup_files ADD COLUMN IF NOT EXISTS last_error text`,
  `ALTER TABLE mirror.backup_files ADD COLUMN IF NOT EXISTS skipped text`, // why a file will not be copied
  `CREATE INDEX IF NOT EXISTS backup_files_todo ON mirror.backup_files (created_at DESC) WHERE stored_at IS NULL AND skipped IS NULL`,
  `CREATE INDEX IF NOT EXISTS backup_files_item ON mirror.backup_files (item_id)`,
  `ALTER TABLE mirror.backup_runs ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'pass'`, // 'pass' (backup.js) or 'files' (files.js)
  `ALTER TABLE mirror.backup_runs ADD COLUMN IF NOT EXISTS bytes_stored bigint NOT NULL DEFAULT 0`,
  `INSERT INTO mirror.locks (name) VALUES ('backup_files') ON CONFLICT (name) DO NOTHING`,
];
