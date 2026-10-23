CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  join_code TEXT,
  created INTEGER
);

CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  password_hash TEXT,
  password_salt TEXT,
  hash_version TEXT CHECK (hash_version IN ('firebase-scrypt', 'argon2id', 'unverified') OR hash_version IS NULL),
  name TEXT,
  role TEXT NOT NULL DEFAULT 'reader',
  group_id TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_uid ON sessions(uid);

CREATE TABLE IF NOT EXISTS group_inventory_docs (
  group_id TEXT PRIMARY KEY,
  tree TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS group_backups (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backups_group ON group_backups(group_id, timestamp);

CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  src_id TEXT,
  timestamp INTEGER NOT NULL,
  user_name TEXT,
  action TEXT
);
CREATE INDEX IF NOT EXISTS idx_history_group ON history(group_id, timestamp);

CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'shared',
  group_id TEXT,
  title TEXT,
  content TEXT,
  category TEXT,
  author_name TEXT,
  author_uid TEXT,
  author_lab TEXT,
  author_avatar TEXT,
  timestamp INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notices_scope ON notices(scope, group_id);

CREATE TABLE IF NOT EXISTS notice_reactions (
  id TEXT PRIMARY KEY,
  notice_id TEXT NOT NULL,
  text TEXT,
  timestamp INTEGER NOT NULL DEFAULT 0,
  user_id TEXT,
  user_name TEXT,
  user_avatar TEXT
);
CREATE INDEX IF NOT EXISTS idx_reactions_notice ON notice_reactions(notice_id);

CREATE TABLE IF NOT EXISTS instruments (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'shared',
  group_id TEXT,
  name TEXT NOT NULL DEFAULT '',
  description TEXT,
  location TEXT,
  contact_person TEXT,
  contact_email TEXT,
  owner_lab_id TEXT,
  owner_lab_name TEXT
);

CREATE TABLE IF NOT EXISTS instrument_bookings (
  id TEXT PRIMARY KEY,
  instrument_id TEXT NOT NULL,
  date TEXT,
  start_time TEXT,
  end_time TEXT,
  user_id TEXT,
  user_name TEXT,
  lab_name TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_bookings_instrument ON instrument_bookings(instrument_id);

CREATE TABLE IF NOT EXISTS print_catalog (
  id TEXT PRIMARY KEY,
  group_id TEXT,
  name TEXT NOT NULL DEFAULT '',
  description TEXT,
  category TEXT,
  material TEXT,
  estimated_time TEXT,
  image TEXT
);

CREATE TABLE IF NOT EXISTS print_requests (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'shared',
  group_id TEXT,
  catalog_item_id TEXT,
  catalog_item_name TEXT,
  custom_design INTEGER,
  note TEXT,
  quantity INTEGER,
  request_date TEXT,
  requested_by TEXT,
  requested_by_uid TEXT,
  requested_by_lab_name TEXT,
  status TEXT
);

CREATE TABLE IF NOT EXISTS game_challenges (
  id TEXT PRIMARY KEY,
  game_type TEXT NOT NULL,
  challenger_name TEXT,
  challenger_uid TEXT,
  opponent_name TEXT,
  opponent_uid TEXT,
  winner_uid TEXT,
  status TEXT,
  created_at INTEGER NOT NULL DEFAULT 0,
  turn TEXT,
  board TEXT,
  frog_round TEXT,
  frog_scores TEXT,
  frog_status TEXT
);

CREATE TABLE IF NOT EXISTS sandbox_docs (
  key TEXT PRIMARY KEY,
  tree TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS quarantined_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  reason TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quarantine_source ON quarantined_rows(source);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_password_resets_uid ON password_resets(uid);
