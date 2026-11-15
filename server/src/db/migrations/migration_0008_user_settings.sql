-- Per-account settings (account-backed, intentionally not per-lab). A single row
-- per user holds an additive JSON document; the catalog column preferences live
-- under the root property "columnsByType".
CREATE TABLE IF NOT EXISTS user_settings (
  uid TEXT PRIMARY KEY,
  settings TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL DEFAULT 0
);
