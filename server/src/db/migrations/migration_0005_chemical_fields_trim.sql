UPDATE material_types SET fields =
  '[{"key":"cas_number","label":"CAS number","dataType":"string","required":false,"searchable":true},{"key":"molecular_formula","label":"Molecular formula","dataType":"string","required":false},{"key":"molecular_weight","label":"Molecular weight","dataType":"number","required":false,"unit":"g/mol"},{"key":"safety_notes","label":"Safety notes","dataType":"text","required":false}]'
WHERE key = 'chemical';
