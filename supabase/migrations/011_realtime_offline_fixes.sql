-- ============================================================
-- 011_realtime_offline_fixes.sql
--   1. Turn on realtime for sales (live dashboard / sidebar / reports)
--   2. Offline sales: keep the time they were actually rung up, and
--      never record the same sale twice when a sync is retried
--   3. partner_sales_records without a row cap (the app pages through it)
-- Run in: Supabase SQL editor (after 010)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Realtime. The app subscribes to INSERTs on sales, but only
--    mpesa_requests was ever added to the realtime publication.
-- ------------------------------------------------------------
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE sales;
EXCEPTION WHEN duplicate_object THEN NULL;  -- already enabled
END $$;

-- ------------------------------------------------------------
-- 2. Idempotent checkout
-- ------------------------------------------------------------
-- client_id: a UUID the browser generates per sale. Retrying the same sale
-- (e.g. the connection dropped after the server saved it) returns the
-- original sale instead of creating a duplicate.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS sales_client_id_key ON sales (client_id) WHERE client_id IS NOT NULL;

CREATE OR REPLACE FUNCTION checkout(
  p_items    jsonb,
  p_payment  jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id      bigint;
  v_item_id      bigint;
  v_receipt_no   text;
  v_subtotal     numeric(12,2) := 0;
  v_discount_pct numeric(5,2);
  v_discount_amt numeric(12,2);
  v_total        numeric(12,2);
  v_vat_amount   numeric(12,2);
  v_tax_rate     numeric(5,2);
  v_item         jsonb;
  v_product      products%rowtype;
  v_qty          integer;
  v_line_total   numeric(12,2);
  v_client_id    uuid;
  v_created_at   timestamptz;
  v_existing     sales%rowtype;
BEGIN
  IF get_my_role() IS NULL THEN
    RAISE EXCEPTION 'Your account is not active';
  END IF;

  -- Already recorded? Return the original sale.
  v_client_id := nullif(p_payment->>'client_id', '')::uuid;
  IF v_client_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM sales WHERE client_id = v_client_id;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'sale_id',    v_existing.id,
        'receipt_no', v_existing.receipt_no,
        'total',      v_existing.total,
        'vat_amount', v_existing.vat_amount,
        'duplicate',  true
      );
    END IF;
  END IF;

  -- Offline sales carry the time they were rung up. Only trust it within
  -- a sane window; otherwise use the server time.
  v_created_at := coalesce(nullif(p_payment->>'created_at', '')::timestamptz, now());
  IF v_created_at > now() + interval '5 minutes' OR v_created_at < now() - interval '14 days' THEN
    v_created_at := now();
  END IF;

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
    method, tendered, change, mpesa_ref,
    client_id, created_at
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
    nullif(p_payment->>'mpesa_ref', ''),
    v_client_id,
    v_created_at
  )
  RETURNING id INTO v_sale_id;

  -- Insert line items, deduct stock, and allocate the units to batches
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := (v_item->>'qty')::integer;

    SELECT * INTO v_product
    FROM products WHERE id = (v_item->>'product_id')::bigint;

    v_line_total := v_product.price * v_qty;

    INSERT INTO sale_items (sale_id, product_id, name, qty, unit_price, line_total, cost_price)
    VALUES (v_sale_id, v_product.id, v_product.name, v_qty, v_product.price, v_line_total, v_product.cost_price)
    RETURNING id INTO v_item_id;

    INSERT INTO stock_movements (product_id, qty_change, reason, sale_id, by_user)
    VALUES (v_product.id, -v_qty, 'sale', v_sale_id, auth.uid());

    PERFORM consume_stock_batches(
      v_product.id, v_qty, v_item_id, NULL,
      v_product.price * (1 - v_discount_pct / 100), NULL
    );
  END LOOP;

  RETURN jsonb_build_object(
    'sale_id',    v_sale_id,
    'receipt_no', v_receipt_no,
    'total',      v_total,
    'vat_amount', v_vat_amount
  );
END;
$$;

-- ------------------------------------------------------------
-- 3. partner_sales_records: same as 010 without LIMIT 5000
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION partner_sales_records(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  allocation_id bigint,
  sold_at       timestamptz,
  receipt_no    text,
  product_name  text,
  partner_id    bigint,
  qty           integer,
  revenue       numeric,
  cost          numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, s.created_at, s.receipt_no, si.name, b.partner_id,
         a.qty, a.revenue, a.qty * coalesce(a.unit_cost, 0)
  FROM batch_allocations a
  JOIN sale_items si ON si.id = a.sale_item_id
  JOIN sales s       ON s.id = si.sale_id
  LEFT JOIN stock_batches b ON b.id = a.batch_id
  WHERE s.status = 'completed' AND s.created_at >= p_from AND s.created_at < p_to
    AND get_my_role() IN ('manager', 'owner')
  ORDER BY s.created_at DESC, a.id;
$$;
