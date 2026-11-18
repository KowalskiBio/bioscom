-- Optional stable links from shared SQL instruments to physical chemical rooms
-- stored in the group inventory JSON documents. Columns stay nullable: legacy
-- instruments are unassigned and free-text locations are not rewritten.
ALTER TABLE instruments ADD COLUMN room_group_id TEXT;
ALTER TABLE instruments ADD COLUMN room_id TEXT;
CREATE INDEX IF NOT EXISTS idx_instruments_room_link ON instruments(room_group_id, room_id);
