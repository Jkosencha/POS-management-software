-- ============================================================
-- reset_production_data.sql: clear test/dummy data before going live
--
-- DELETES: all sales (and their line items), stock movements, stock
--          batches, partner allocations and payouts, saved Z-reports,
--          and every product. Receipt numbers restart at S0001.
-- KEEPS:   staff accounts and roles, store settings, categories,
--          partners.
--
-- Run ONLY on the production project, in the Supabase SQL editor.
-- This cannot be undone. Download a backup first if unsure.
-- To keep the product list (and only clear its stock), see step 3.
-- ============================================================

BEGIN;

-- 1. Sales and everything hanging off them
DELETE FROM batch_allocations;
DELETE FROM sale_items;
DELETE FROM sales;

-- 2. Stock history, batches, payouts, Z-reports
DELETE FROM stock_batches;
DELETE FROM stock_movements;
DELETE FROM partner_payouts;
DELETE FROM day_closes;

-- 3. Products. To KEEP the products (with zero stock) instead, replace
--    the next line with:  UPDATE products SET stock = 0;
DELETE FROM products;

-- 4. Receipt numbers start again at S0001
ALTER SEQUENCE receipt_seq RESTART WITH 1;

COMMIT;
