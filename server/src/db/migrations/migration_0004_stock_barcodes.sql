ALTER TABLE stocks ADD COLUMN barcode TEXT;
CREATE INDEX IF NOT EXISTS idx_stocks_barcode ON stocks(group_id, barcode);
