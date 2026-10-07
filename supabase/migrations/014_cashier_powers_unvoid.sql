-- ============================================================
-- 014_cashier_powers_unvoid.sql
--   1. Save new staff members' email again (and back-fill it)
--   2. Cashiers: see all sales, void sales, add products, restock
--   3. Un-void a sale; managers/owners delete voided sales
-- Run in: Supabase SQL editor (after 013)
-- ============================================================

-- ------------------------------------------------------------
-- 1. handle_new_user: 005 added the email column, but re-running the
--    001 version later replaced it with one that doesn't save email.
--    This combines both (email + pinned search_path).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role, email)
  VALUES (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'cashier'),
    new.email
  )
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  RETURN new;
END;
$$;

UPDATE profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND p.email IS DISTINCT FROM u.email;

-- ------------------------------------------------------------
-- 2. Cashier permissions
-- ------------------------------------------------------------
-- Every active staff member can see every sale (cost figures stay out of
-- the cashier screens in the app)
DROP POLICY IF EXISTS "sales_select" ON sales;
CREATE POLICY "sales_select" ON sales
  FOR SELECT USING (get_my_role() IS NOT NULL);

DROP POLICY IF EXISTS "sale_items_select" ON sale_items;
CREATE POLICY "sale_items_select" ON sale_items
  FOR SELECT USING (get_my_role() IS NOT NULL);

-- Any active staff member can add a product (only managers/owners edit them)
DROP POLICY IF EXISTS "products_insert_manager" ON products;
DROP POLICY IF EXISTS "products_insert_staff" ON products;
CREATE POLICY "products_insert_staff" ON products
  FOR INSERT WITH CHECK (get_my_role() IS NOT NULL);

-- Cashiers may record restocks; other manual movements stay manager/owner
DROP POLICY IF EXISTS "stock_movements_insert_manager" ON stock_movements;
DROP POLICY IF EXISTS "stock_movements_insert_staff" ON stock_movements;
CREATE POLICY "stock_movements_insert_staff" ON stock_movements
  FOR INSERT WITH CHECK (
    (get_my_role() IN ('manager', 'owner') AND reason IN ('restock', 'adjustment', 'spoilage', 'return'))
    OR (get_my_role() = 'cashier' AND reason = 'restock')
  );

-- A restock's supplier is recorded on the movement; the trigger below copies
-- buying price + supplier onto the product (cashiers can't update products)
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS supplier text;

CREATE OR REPLACE FUNCTION apply_stock_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE products
  SET stock = stock + new.qty_change, updated_at = now()
  WHERE id = new.product_id;

  -- Sales and void-returns handle batches themselves (checkout / void_sale / unvoid_sale)
  IF new.sale_id IS NOT NULL AND new.reason IN ('sale', 'return') THEN
    RETURN new;
  END IF;

  IF new.qty_change > 0 THEN
    INSERT INTO stock_batches (product_id, partner_id, qty_received, qty_remaining, unit_cost, movement_id)
    SELECT new.product_id, new.partner_id, new.qty_change, new.qty_change,
           coalesce(new.unit_cost, p.cost_price), new.id
    FROM products p WHERE p.id = new.product_id;
  ELSIF new.qty_change < 0 THEN
    PERFORM consume_stock_batches(new.product_id, -new.qty_change, NULL, new.id, 0, new.partner_id);
  END IF;

  -- A restock updates the product's current buying price and supplier
  IF new.reason = 'restock' AND (new.unit_cost IS NOT NULL OR nullif(trim(new.supplier), '') IS NOT NULL) THEN
    UPDATE products SET
      cost_price = coalesce(new.unit_cost, cost_price),
      supplier   = coalesce(nullif(trim(new.supplier), ''), supplier)
    WHERE id = new.product_id;
  END IF;

  RETURN new;
END;
$$;

-- void_sale: same as 010, open to every active staff member
CREATE OR REPLACE FUNCTION void_sale(p_sale_id bigint, p_reason text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
BEGIN
  IF get_my_role() IS NULL THEN
    RAISE EXCEPTION 'Your account is not active';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF v_sale.status = 'voided' THEN
    RAISE EXCEPTION 'Sale % is already voided', v_sale.receipt_no;
  END IF;

  -- Restock every item (the trigger skips batches for these)
  INSERT INTO stock_movements (product_id, qty_change, reason, note, sale_id, by_user)
  SELECT si.product_id, si.qty, 'return',
         'Void ' || v_sale.receipt_no || CASE WHEN p_reason <> '' THEN ': ' || p_reason ELSE '' END,
         p_sale_id, auth.uid()
  FROM sale_items si
  WHERE si.sale_id = p_sale_id AND si.product_id IS NOT NULL;

  -- Put units back into the batches they came from
  UPDATE stock_batches b
  SET qty_remaining = b.qty_remaining + x.qty
  FROM (
    SELECT a.batch_id, sum(a.qty) AS qty
    FROM batch_allocations a
    JOIN sale_items si ON si.id = a.sale_item_id
    WHERE si.sale_id = p_sale_id AND a.batch_id IS NOT NULL AND NOT a.restored
    GROUP BY a.batch_id
  ) x
  WHERE b.id = x.batch_id;

  -- Units that weren't tracked in a batch come back as Shared stock
  INSERT INTO stock_batches (product_id, partner_id, qty_received, qty_remaining, unit_cost)
  SELECT a.product_id, NULL, sum(a.qty), sum(a.qty), max(a.unit_cost)
  FROM batch_allocations a
  JOIN sale_items si ON si.id = a.sale_item_id
  WHERE si.sale_id = p_sale_id AND a.batch_id IS NULL AND NOT a.restored
  GROUP BY a.product_id;

  UPDATE batch_allocations SET restored = true
  WHERE sale_item_id IN (SELECT id FROM sale_items WHERE sale_id = p_sale_id);

  UPDATE sales SET
    status      = 'voided',
    voided_at   = now(),
    void_reason = p_reason,
    voided_by   = auth.uid()
  WHERE id = p_sale_id;

  RETURN jsonb_build_object('ok', true, 'receipt_no', v_sale.receipt_no);
END;
$$;

-- ------------------------------------------------------------
-- 3a. Un-void: put a wrongly voided sale back. Takes the stock out again
--     (oldest batches first) and re-credits partners.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION unvoid_sale(p_sale_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale    sales%ROWTYPE;
  v_item    sale_items%ROWTYPE;
  v_product products%ROWTYPE;
BEGIN
  IF get_my_role() IS NULL THEN
    RAISE EXCEPTION 'Your account is not active';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF v_sale.status <> 'voided' THEN
    RAISE EXCEPTION 'Sale % is not voided', v_sale.receipt_no;
  END IF;

  -- Check there's enough stock before changing anything
  FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id AND product_id IS NOT NULL
  LOOP
    SELECT * INTO v_product FROM products WHERE id = v_item.product_id FOR UPDATE;
    IF v_product.stock < v_item.qty THEN
      RAISE EXCEPTION 'Not enough stock to un-void: "%" has % left, sale needs %',
        v_product.name, v_product.stock, v_item.qty;
    END IF;
  END LOOP;

  -- The old (restored) allocations are replaced by fresh ones
  DELETE FROM batch_allocations
  WHERE sale_item_id IN (SELECT id FROM sale_items WHERE sale_id = p_sale_id);

  FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id AND product_id IS NOT NULL
  LOOP
    INSERT INTO stock_movements (product_id, qty_change, reason, note, sale_id, by_user)
    VALUES (v_item.product_id, -v_item.qty, 'sale', 'Un-void ' || v_sale.receipt_no, p_sale_id, auth.uid());

    PERFORM consume_stock_batches(
      v_item.product_id, v_item.qty, v_item.id, NULL,
      v_item.unit_price * (1 - v_sale.discount_pct / 100), NULL
    );
  END LOOP;

  UPDATE sales SET
    status      = 'completed',
    voided_at   = NULL,
    void_reason = NULL,
    voided_by   = NULL
  WHERE id = p_sale_id;

  RETURN jsonb_build_object('ok', true, 'receipt_no', v_sale.receipt_no);
END;
$$;

REVOKE ALL ON FUNCTION unvoid_sale(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION unvoid_sale(bigint) TO authenticated;

-- ------------------------------------------------------------
-- 3b. Permanently delete a voided sale (managers / owners)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_voided_sale(p_sale_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
BEGIN
  IF get_my_role() IS NULL OR get_my_role() NOT IN ('manager', 'owner') THEN
    RAISE EXCEPTION 'Only managers and owners can delete voided sales';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF v_sale.status <> 'voided' THEN
    RAISE EXCEPTION 'Only voided sales can be deleted. Void % first.', v_sale.receipt_no;
  END IF;

  -- Keep the stock audit trail, just unlinked from the deleted sale
  UPDATE stock_movements SET sale_id = NULL WHERE sale_id = p_sale_id;
  DELETE FROM sales WHERE id = p_sale_id;  -- sale_items + allocations cascade

  RETURN jsonb_build_object('ok', true, 'receipt_no', v_sale.receipt_no);
END;
$$;

REVOKE ALL ON FUNCTION delete_voided_sale(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION delete_voided_sale(bigint) TO authenticated;
