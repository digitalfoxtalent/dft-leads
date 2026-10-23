// The Inbox's one table (pages.js renderInbox). Kept apart so schema.js can load it without a cycle.

export const INBOX_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS mirror.inbox_seen (email text PRIMARY KEY, seen_at timestamptz NOT NULL DEFAULT now())`,
];
