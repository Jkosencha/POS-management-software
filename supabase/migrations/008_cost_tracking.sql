-- ============================================================
-- 008_cost_tracking.sql — cost price + supplier, for real profit/margin
-- Run in: Supabase SQL editor
-- ============================================================

-- 1. Cost basis + supplier on products (current values, updated on each restock)
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS cost_price numeric(12,2),
  ADD COLUMN IF NOT EXISTS supplier   text;

-- 2. What was actually paid per unit on a given stock movement (restock audit trail)
ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS unit_cost numeric(12,2);

-- 3. Cost snapshot per sale line, so margin on old sales stays accurate even
--    if a product's cost_price changes later
ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS cost_price numeric(12,2);

-- 4. checkout() now snapshots each product's current cost_price onto the
--    sale_item at the moment of sale (same pattern as unit_price already does)
CREATE OR REPLACE FUNCTION checkout(
  p_items    jsonb,
  p_payment  jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sale_id     bigint;
  v_receipt_no  text;
  v_subtotal    numeric(12,2) := 0;
  v_discount_pct numeric(5,2);
  v_discount_amt numeric(12,2);
  v_total       numeric(12,2);
  v_vat_amount  numeric(12,2);
  v_tax_rate    numeric(5,2);
  v_item        jsonb;
  v_product     products%rowtype;
  v_qty         integer;
  v_line_total  numeric(12,2);
BEGIN
  SELECT tax_rate INTO v_tax_rate FROM settings LIMIT 1;

  v_discount_pct := coalesce((p_payment->>'discount_pct')::numeric, 0);

  -- Validate all items first (fail fast before any inserts)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := (v_item->>'qty')::integer;

    SELECT * INTO v_product
    FROM products
    WHERE id = (v_item->>'product_id')::bigint AND active = true
    FOR UPDATE;  -- lock row to prevent race conditions

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % not found or inactive', v_item->>'product_id';
    END IF;

    IF v_product.stock < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock for "%": % available, % requested',
        v_product.name, v_product.stock, v_qty;
    END IF;

    v_subtotal := v_subtotal + (v_product.price * v_qty);
  END LOOP;

  v_discount_amt := round(v_subtotal * (v_discount_pct / 100), 2);
  v_total        := v_subtotal - v_discount_amt;
  v_vat_amount   := round(v_total * (v_tax_rate / (100 + v_tax_rate)), 2);

  v_receipt_no := 'S' || lpad(nextval('receipt_seq')::text, 4, '0');

  INSERT INTO sales (
    receipt_no, cashier_id,
    subtotal, discount_pct, discount_amt, total, vat_amount,
    method, tendered, change, mpesa_ref
  ) VALUES (
    v_receipt_no,
    auth.uid(),
    v_subtotal,
    v_discount_pct,
    v_discount_amt,
    v_total,
    v_vat_amount,
    p_payment->>'method',
    (p_payment->>'tendered')::numeric,
    (p_payment->>'change')::numeric,
    nullif(p_payment->>'mpesa_ref', '')
  )
  RETURNING id INTO v_sale_id;

  -- Insert line items and deduct stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := (v_item->>'qty')::integer;

    SELECT * INTO v_product
    FROM products WHERE id = (v_item->>'product_id')::bigint;

    v_line_total := v_product.price * v_qty;

    INSERT INTO sale_items (sale_id, product_id, name, qty, unit_price, line_total, cost_price)
    VALUES (v_sale_id, v_product.id, v_product.name, v_qty, v_product.price, v_line_total, v_product.cost_price);

    INSERT INTO stock_movements (product_id, qty_change, reason, sale_id, by_user)
    VALUES (v_product.id, -v_qty, 'sale', v_sale_id, auth.uid());
  END LOOP;

  RETURN jsonb_build_object(
    'sale_id',    v_sale_id,
    'receipt_no', v_receipt_no,
    'total',      v_total,
    'vat_amount', v_vat_amount
  );
END;
$$;
