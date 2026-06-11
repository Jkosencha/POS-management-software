-- ============================================================
-- 003_seed.sql — sample minimart products
-- Run AFTER 001_schema.sql
-- ============================================================

insert into products (name, sku, category, price, stock, low_at) values
  ('White Bread 400g',       'BRD400', 'Bakery',    65,  24, 6),
  ('Fresh Milk 500ml',       'MLK500', 'Dairy',     60,  30, 8),
  ('Eggs (Tray of 30)',      'EGG30',  'Dairy',    420,  10, 3),
  ('Maize Flour 2kg',        'UNG2K',  'Dry Goods', 165, 18, 5),
  ('Sugar 1kg',              'SGR1K',  'Dry Goods', 175, 22, 6),
  ('Rice 2kg',               'RCE2K',  'Dry Goods', 320, 14, 4),
  ('Cooking Oil 1L',         'OIL1L',  'Dry Goods', 330, 12, 4),
  ('Soda 500ml',             'SDA500', 'Drinks',     70, 48, 12),
  ('Drinking Water 1L',      'WTR1L',  'Drinks',     55, 36, 10),
  ('Juice 1L',               'JCE1L',  'Drinks',    180, 15, 5),
  ('Tea Leaves 250g',        'TEA250', 'Dry Goods', 145, 16, 5),
  ('Biscuits Pack',          'BSC01',  'Snacks',     50, 40, 10),
  ('Crisps 100g',            'CRP100', 'Snacks',     90, 25, 8),
  ('Bar Soap 800g',          'SOP800', 'Household', 160, 20, 6),
  ('Washing Powder 500g',    'WSH500', 'Household', 130, 17, 5),
  ('Toilet Tissue (4 Pack)', 'TSU4PK', 'Household', 220, 13, 4),
  ('Toothpaste 100ml',       'TPT100', 'Household', 150, 11, 4),
  ('Matchbox',               'MTC01',  'Household',  10, 60, 15)
on conflict (sku) do nothing;
