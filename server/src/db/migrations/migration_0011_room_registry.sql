-- Additive support for the one-time canonical room-registry migration.
-- Canonical physical rooms remain tree.rooms[].id inside each group JSON
-- document; this migration never creates, renames or deletes a room.
--
-- The migration resolves legacy asset-room and instrument names against the
-- relational mirror of those rooms, grouped by lab. These indexes keep those
-- group-scoped name lookups cheap without changing any stored data.
CREATE INDEX IF NOT EXISTS idx_locations_group_room_name
  ON locations(group_id, name) WHERE kind = 'room';
CREATE INDEX IF NOT EXISTS idx_instruments_owner_lab
  ON instruments(owner_lab_id);
