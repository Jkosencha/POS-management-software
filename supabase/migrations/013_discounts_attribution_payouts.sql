-- ============================================================
-- 013_discounts_attribution_payouts.sql
--   1. checkout(): discount limits (cashiers 20%, managers/owners 100%)
--      and offline sales keep the cashier who rang them up
--   2. partner_payouts: record money paid out to each partner
--   3. remove the unused M-Pesa STK request table
-- Run in: Supabase SQL editor (after 012)
-- ============================================================

-- ------------------------------------------------------------
-- 1. checkout(): same as 011 plus cashier attribution + discount limits
-- ------------------------------------------------------------
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
  v_cashier      uuid;
  v_cashier_role text;
  v_max_discount numeric := 100;
BEGIN
  IF get_my_role() IS NULL THEN
    RAISE EXCEPTION 'Your account is not active';
  END IF;

  -- Who rang the sale up. Offline sales synced later (possibly by someone
  -- else on the same till) carry their original cashier; trust it only if
  -- that person is an active staff member.
  v_cashier := auth.uid();
  IF nullif(p_payment->>'cashier_id', '') IS NOT NULL THEN
    SELECT id INTO v_cashier FROM profiles
    WHERE id = (p_payment->>'cashier_id')::uuid AND active AND deleted_at IS NULL;
    v_cashier := coalesce(v_cashier, auth.uid());
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

  -- Discount limits: cashiers up to 20%, managers and owners up to 100%
  SELECT role INTO v_cashier_role FROM profiles WHERE id = v_cashier;
  IF v_cashier_role = 'cashier' THEN v_max_discount := 20; END IF;
  IF v_discount_pct < 0 OR v_discount_pct > v_max_discount THEN
    RAISE EXCEPTION 'A discount of % percent is not allowed for your role (maximum % percent)', v_discount_pct, v_max_discount;
  END IF;

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
    v_cashier,
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
    VALUES (v_product.id, -v_qty, 'sale', v_sale_id, v_cashier);

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
-- 2. Partner payouts (money taken out of the business by a partner)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS partner_payouts (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  partner_id bigint NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  amount     numeric(12,2) NOT NULL CHECK (amount > 0),
  paid_on    date NOT NULL DEFAULT current_date,
  note       text,
  created_by uuid REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_payouts_partner_idx ON partner_payouts (partner_id, paid_on);

ALTER TABLE partner_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "partner_payouts_select" ON partner_payouts;
CREATE POLICY "partner_payouts_select" ON partner_payouts
  FOR SELECT USING (get_my_role() IN ('manager', 'owner'));

DROP POLICY IF EXISTS "partner_payouts_insert_owner" ON partner_payouts;
CREATE POLICY "partner_payouts_insert_owner" ON partner_payouts
  FOR INSERT WITH CHECK (get_my_role() = 'owner');

DROP POLICY IF EXISTS "partner_payouts_delete_owner" ON partner_payouts;
CREATE POLICY "partner_payouts_delete_owner" ON partner_payouts
  FOR DELETE USING (get_my_role() = 'owner');

-- ------------------------------------------------------------
-- 3. M-Pesa is now recorded with one tap (Pochi la Biashara); the STK push
--    request log from 004 is no longer used.
-- ------------------------------------------------------------
DROP TABLE IF EXISTS mpesa_requests;
