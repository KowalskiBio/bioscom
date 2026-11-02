CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS material_types (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  fields TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  type_key TEXT NOT NULL DEFAULT 'chemical',
  name TEXT NOT NULL DEFAULT '',
  description TEXT,
  attributes TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  archived_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_materials_group ON materials(group_id, type_key);
CREATE INDEX IF NOT EXISTS idx_materials_name ON materials(group_id, name);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  manufacturer_name TEXT,
  supplier_name TEXT,
  catalog_number TEXT,
  product_name TEXT,
  variant TEXT,
  attributes TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_products_material ON products(material_id);
CREATE INDEX IF NOT EXISTS idx_products_catalog ON products(catalog_number);
CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  lot_code TEXT,
  origin_type TEXT NOT NULL DEFAULT 'unknown',
  received_at INTEGER,
  prepared_at INTEGER,
  prepared_by TEXT,
  expires_at INTEGER,
  attributes TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_batches_material ON batches(material_id);
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON batches(expires_at);
CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  parent_id TEXT REFERENCES locations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT,
  container_type TEXT,
  emoji TEXT,
  color TEXT,
  rack_name TEXT,
  box_name TEXT,
  parent_shelf_id TEXT,
  is_range_shelf INTEGER,
  range_start TEXT,
  range_end TEXT,
  owner_group_id TEXT,
  owner_group_name TEXT,
  rack_positions TEXT,
  sort_index INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_locations_parent ON locations(parent_id);
CREATE INDEX IF NOT EXISTS idx_locations_group ON locations(group_id, kind);
CREATE TABLE IF NOT EXISTS container_shares (
  container_location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL,
  PRIMARY KEY (container_location_id, group_id)
);
CREATE INDEX IF NOT EXISTS idx_shares_group ON container_shares(group_id);
CREATE TABLE IF NOT EXISTS stocks (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  batch_id TEXT NOT NULL REFERENCES batches(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  position TEXT,
  custom_position TEXT,
  shelf_override TEXT,
  current_quantity REAL,
  quantity_unit TEXT,
  concentration REAL,
  concentration_unit TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'available',
  container_type TEXT,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_stocks_batch ON stocks(batch_id);
CREATE INDEX IF NOT EXISTS idx_stocks_location ON stocks(location_id);
CREATE INDEX IF NOT EXISTS idx_stocks_group ON stocks(group_id, status);
CREATE TABLE IF NOT EXISTS batch_inputs (
  id TEXT PRIMARY KEY,
  output_batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  source_stock_id TEXT NOT NULL REFERENCES stocks(id),
  quantity_used REAL,
  unit TEXT,
  role TEXT
);
CREATE TABLE IF NOT EXISTS legacy_chemical_map (
  group_id TEXT NOT NULL,
  chemical_id TEXT NOT NULL,
  material_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  stock_id TEXT NOT NULL,
  migrated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, chemical_id)
);
