-- ============================================================
-- 010_partners.sql: business partners + per-partner stock and sales
--
-- How it works:
--   * Every unit of stock lives in a stock_batch, owned by a partner
--     (partner_id NULL = "Shared", split evenly between all partners).
--   * Restocks (and other stock increases) create a new batch for the
--     chosen owner.
--   * Sales and stock decreases use up the oldest batches first (FIFO).
--     Each use is recorded in batch_allocations, so every unit sold can be
--     traced to whose stock it was, at what cost, for how much revenue.
--
-- Run in: Supabase SQL editor (after 009)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Partners
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS partners (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  color      text NOT NULL DEFAULT '#7c6cf0' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE partners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "partners_select" ON partners;
CREATE POLICY "partners_select" ON partners
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "partners_insert_owner" ON partners;
CREATE POLICY "partners_insert_owner" ON partners
  FOR INSERT WITH CHECK (get_my_role() = 'owner');

DROP POLICY IF EXISTS "partners_update_owner" ON partners;
CREATE POLICY "partners_update_owner" ON partners
  FOR UPDATE USING (get_my_role() = 'owner');

DROP POLICY IF EXISTS "partners_delete_owner" ON partners;
CREATE POLICY "partners_delete_owner" ON partners
  FOR DELETE USING (get_my_role() = 'owner');

-- ------------------------------------------------------------
-- 2. Stock batches
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_batches (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id    bigint NOT NULL REFERENCES products(id),
  partner_id    bigint REFERENCES partners(id) ON DELETE RESTRICT,  -- NULL = Shared
  qty_received  integer NOT NULL CHECK (qty_received >= 0),
  qty_remaining integer NOT NULL CHECK (qty_remaining >= 0),
  unit_cost     numeric(12,2),
  movement_id   bigint REFERENCES stock_movements(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_batches_fifo_idx
  ON stock_batches (product_id, created_at, id) WHERE qty_remaining > 0;
CREATE INDEX IF NOT EXISTS stock_batches_partner_idx ON stock_batches (partner_id);

ALTER TABLE stock_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_batches_select" ON stock_batches;
CREATE POLICY "stock_batches_select" ON stock_batches
  FOR SELECT USING (get_my_role() IN ('manager', 'owner'));

-- Managers/owners may re-assign a batch to another owner (e.g. opening stock).
-- Batches are only ever created/consumed by the triggers and RPCs below.
DROP POLICY IF EXISTS "stock_batches_update" ON stock_batches;
CREATE POLICY "stock_batches_update" ON stock_batches
  FOR UPDATE USING (get_my_role() IN ('manager', 'owner'));

-- Only partner_id may change from the client
CREATE OR REPLACE FUNCTION guard_batch_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND (
       new.product_id    IS DISTINCT FROM old.product_id
    OR new.qty_received  IS DISTINCT FROM old.qty_received
    OR new.qty_remaining IS DISTINCT FROM old.qty_remaining
    OR new.unit_cost     IS DISTINCT FROM old.unit_cost
  ) THEN
    RAISE EXCEPTION 'Only the owner of a stock batch can be changed';
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_batch_update ON stock_batches;
CREATE TRIGGER trg_guard_batch_update
  BEFORE UPDATE ON stock_batches
  FOR EACH ROW EXECUTE FUNCTION guard_batch_update();

-- ------------------------------------------------------------
-- 3. Batch allocations: which batch each sold / removed unit came from
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS batch_allocations (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id     bigint REFERENCES stock_batches(id) ON DELETE SET NULL,  -- NULL = untracked, counts as Shared
  product_id   bigint NOT NULL REFERENCES products(id),
  sale_item_id bigint REFERENCES sale_items(id) ON DELETE CASCADE,
  movement_id  bigint REFERENCES stock_movements(id) ON DELETE CASCADE,
  qty          integer NOT NULL CHECK (qty > 0),
  revenue      numeric(12,2) NOT NULL DEFAULT 0,  -- after the sale's discount
  unit_cost    numeric(12,2),
  restored     boolean NOT NULL DEFAULT false,    -- true once a voided sale put it back
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS batch_allocations_sale_item_idx ON batch_allocations (sale_item_id);
CREATE INDEX IF NOT EXISTS batch_allocations_batch_idx ON batch_allocations (batch_id);

ALTER TABLE batch_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "batch_allocations_select" ON batch_allocations;
CREATE POLICY "batch_allocations_select" ON batch_allocations
  FOR SELECT USING (get_my_role() IN ('manager', 'owner'));

-- Owner chosen for a stock increase / preferred source for a decrease
ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS partner_id bigint REFERENCES partners(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- 4. FIFO consumption
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION consume_stock_batches(
  p_product_id     bigint,
  p_qty            integer,
  p_sale_item_id   bigint,
  p_movement_id    bigint,
  p_unit_revenue   numeric,
  p_prefer_partner bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_left  integer := p_qty;
  v_batch stock_batches%ROWTYPE;
  v_take  integer;
BEGIN
  FOR v_batch IN
    SELECT * FROM stock_batches
    WHERE product_id = p_product_id AND qty_remaining > 0
    ORDER BY coalesce(p_prefer_partner IS NOT NULL AND partner_id = p_prefer_partner, false) DESC,
             created_at, id
    FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := least(v_left, v_batch.qty_remaining);

    UPDATE stock_batches SET qty_remaining = qty_remaining - v_take WHERE id = v_batch.id;

    INSERT INTO batch_allocations (batch_id, product_id, sale_item_id, movement_id, qty, revenue, unit_cost)
    VALUES (v_batch.id, p_product_id, p_sale_item_id, p_movement_id, v_take,
            round(coalesce(p_unit_revenue, 0) * v_take, 2), v_batch.unit_cost);

    v_left := v_left - v_take;
  END LOOP;

  -- More sold than tracked in batches (shouldn't happen): record it as Shared
  IF v_left > 0 THEN
    INSERT INTO batch_allocations (batch_id, product_id, sale_item_id, movement_id, qty, revenue, unit_cost)
    SELECT NULL, p_product_id, p_sale_item_id, p_movement_id, v_left,
           round(coalesce(p_unit_revenue, 0) * v_left, 2), cost_price
    FROM products WHERE id = p_product_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION consume_stock_batches(bigint, integer, bigint, bigint, numeric, bigint) FROM public, anon, authenticated;

-- ------------------------------------------------------------
-- 5. Stock movement trigger: keep products.stock AND batches in sync
-- ------------------------------------------------------------
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

  -- Sales and void-returns handle batches themselves (checkout / void_sale)
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

  RETURN new;
END;
$$;

-- ------------------------------------------------------------
-- 6. Opening batches for stock already on the shelf (as Shared).
--    Re-assign them to a partner from Inventory > History.
-- ------------------------------------------------------------
INSERT INTO stock_batches (product_id, partner_id, qty_received, qty_remaining, unit_cost)
SELECT p.id, NULL, p.stock, p.stock, p.cost_price
FROM products p
WHERE p.stock > 0
  AND NOT EXISTS (SELECT 1 FROM stock_batches b WHERE b.product_id = p.id);

-- Past sales count as Shared so partner totals include history
INSERT INTO batch_allocations (batch_id, product_id, sale_item_id, qty, revenue, unit_cost, created_at)
SELECT NULL, si.product_id, si.id, si.qty,
       round(si.line_total * (1 - s.discount_pct / 100), 2), si.cost_price, s.created_at
FROM sale_items si
JOIN sales s ON s.id = si.sale_id
WHERE si.product_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM batch_allocations a WHERE a.sale_item_id = si.id);

-- ------------------------------------------------------------
-- 7. checkout(): same as 008, plus FIFO batch allocation per line
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
BEGIN
  IF get_my_role() IS NULL THEN
    RAISE EXCEPTION 'Your account is not active';
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
-- 8. void_sale(): same as 005, plus putting units back in their batches
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION void_sale(p_sale_id bigint, p_reason text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_sale sales%ROWTYPE;
BEGIN
  SELECT get_my_role() INTO v_role;
  IF v_role IS NULL OR v_role NOT IN ('manager','owner') THEN
    RAISE EXCEPTION 'Only managers and owners can void sales';
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
-- 9. Reporting RPCs (manager / owner only)
-- ------------------------------------------------------------

-- Per-partner totals for a period. Shared revenue/cost/stock is split
-- evenly between all partners and reported separately (shared_*).
CREATE OR REPLACE FUNCTION partner_summary(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  partner_id     bigint,
  name           text,
  color          text,
  own_revenue    numeric,
  shared_revenue numeric,
  own_cost       numeric,
  shared_cost    numeric,
  units_sold     numeric,
  stock_units    numeric,
  stock_value    numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH sold AS (
    SELECT b.partner_id,
           sum(a.revenue)                          AS revenue,
           sum(a.qty * coalesce(a.unit_cost, 0))   AS cost,
           sum(a.qty)                              AS units
    FROM batch_allocations a
    JOIN sale_items si ON si.id = a.sale_item_id
    JOIN sales s       ON s.id = si.sale_id
    LEFT JOIN stock_batches b ON b.id = a.batch_id
    WHERE s.status = 'completed' AND s.created_at >= p_from AND s.created_at < p_to
    GROUP BY b.partner_id
  ),
  stock AS (
    SELECT sb.partner_id,
           sum(sb.qty_remaining)                            AS units,
           sum(sb.qty_remaining * coalesce(sb.unit_cost, 0)) AS value
    FROM stock_batches sb
    WHERE sb.qty_remaining > 0
    GROUP BY sb.partner_id
  ),
  n AS (SELECT greatest(count(*), 1)::numeric AS c FROM partners)
  SELECT p.id, p.name, p.color,
         coalesce(so.revenue, 0),
         round(coalesce(sh.revenue, 0) / n.c, 2),
         coalesce(so.cost, 0),
         round(coalesce(sh.cost, 0) / n.c, 2),
         coalesce(so.units, 0) + coalesce(sh.units, 0) / n.c,
         coalesce(st.units, 0) + coalesce(sst.units, 0) / n.c,
         round(coalesce(st.value, 0) + coalesce(sst.value, 0) / n.c, 2)
  FROM partners p
  CROSS JOIN n
  LEFT JOIN sold  so  ON so.partner_id = p.id
  LEFT JOIN sold  sh  ON sh.partner_id IS NULL
  LEFT JOIN stock st  ON st.partner_id = p.id
  LEFT JOIN stock sst ON sst.partner_id IS NULL
  WHERE get_my_role() IN ('manager', 'owner')
  ORDER BY p.id;
$$;

-- Line-level sales records for a period, tagged with the stock owner
-- (partner_id NULL = Shared)
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
  ORDER BY s.created_at DESC, a.id
  LIMIT 5000;
$$;

REVOKE ALL ON FUNCTION partner_summary(timestamptz, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION partner_summary(timestamptz, timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION partner_sales_records(timestamptz, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION partner_sales_records(timestamptz, timestamptz) TO authenticated;
