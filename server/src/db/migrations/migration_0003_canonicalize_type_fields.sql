UPDATE material_types SET fields =
  '[{"key":"cas_number","label":"CAS number","dataType":"string","required":false,"searchable":true},{"key":"molecular_formula","label":"Molecular formula","dataType":"string","required":false},{"key":"molecular_weight","label":"Molecular weight","dataType":"number","required":false,"unit":"g/mol"},{"key":"purity","label":"Purity","dataType":"string","required":false},{"key":"grade","label":"Grade","dataType":"string","required":false},{"key":"safety_notes","label":"Safety notes","dataType":"text","required":false}]'
WHERE key = 'chemical';
UPDATE material_types SET fields =
  '[{"key":"formulation","label":"Formulation","dataType":"string","required":false},{"key":"kit_components","label":"Kit components","dataType":"text","required":false},{"key":"application","label":"Application","dataType":"string","required":false}]'
WHERE key = 'reagent';
UPDATE material_types SET fields =
  '[{"key":"target","label":"Target","dataType":"string","required":false,"searchable":true},{"key":"host_species","label":"Host species","dataType":"enum","required":false,"options":["Rabbit","Mouse","Goat","Rat","Chicken","Sheep","Donkey","Guinea pig","Other"]},{"key":"clonality","label":"Clonality","dataType":"enum","required":false,"options":["Monoclonal","Polyclonal","Recombinant"]},{"key":"clone_id","label":"Clone","dataType":"string","required":false},{"key":"conjugate","label":"Conjugate","dataType":"string","required":false},{"key":"species_reactivity","label":"Species reactivity","dataType":"string","required":false},{"key":"applications","label":"Applications","dataType":"string","required":false}]'
WHERE key = 'antibody';
UPDATE material_types SET fields =
  '[{"key":"sequence","label":"Sequence (5'' to 3'')","dataType":"sequence","required":false,"searchable":true},{"key":"sequence_length","label":"Sequence length","dataType":"number","required":false,"unit":"nt"},{"key":"modifications","label":"Modifications","dataType":"string","required":false},{"key":"purification","label":"Purification","dataType":"enum","required":false,"options":["Desalted","HPLC","PAGE","Other"]},{"key":"tm_celsius","label":"Tm","dataType":"number","required":false,"unit":"°C"}]'
WHERE key = 'primer';
UPDATE material_types SET fields =
  '[{"key":"composition","label":"Composition","dataType":"text","required":false},{"key":"ph","label":"pH","dataType":"number","required":false},{"key":"recipe_reference","label":"Recipe reference","dataType":"string","required":false},{"key":"preparation_notes","label":"Preparation notes","dataType":"text","required":false}]'
WHERE key = 'solution';
UPDATE material_types SET fields =
  '[{"key":"organism","label":"Organism","dataType":"string","required":false,"searchable":true},{"key":"strain","label":"Strain","dataType":"string","required":false},{"key":"genotype","label":"Genotype","dataType":"string","required":false},{"key":"plasmid","label":"Plasmid","dataType":"string","required":false},{"key":"selection_marker","label":"Selection marker","dataType":"string","required":false},{"key":"preservation_method","label":"Preservation method","dataType":"enum","required":false,"options":["Glycerol -80°C","Cryovial LN2","Lyophilized","Other"]}]'
WHERE key = 'biological_stock';
UPDATE material_types SET fields =
  '[{"key":"custom_notes","label":"Notes","dataType":"text","required":false}]'
WHERE key = 'other';
