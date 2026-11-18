-- Add a searchable free-text target species to the global Primer definition.
-- The descriptor is appended rather than replacing the row so existing custom
-- definitions are preserved. The NOT EXISTS guard makes a manual replay safe:
-- it never appends a duplicate target_species field.
UPDATE material_types
SET fields = json_insert(
  fields,
  '$[#]',
  json('{"key":"target_species","label":"Target species","dataType":"string","required":false,"searchable":true}')
)
WHERE key = 'primer'
  AND json_valid(fields)
  AND json_type(fields) = 'array'
  AND NOT EXISTS (
    SELECT 1
    FROM json_each(material_types.fields) AS field
    WHERE json_extract(field.value, '$.key') = 'target_species'
  );
