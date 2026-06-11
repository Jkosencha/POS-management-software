-- ============================================================
-- 005_void_and_users.sql
-- Run in: Supabase SQL editor
-- ============================================================

-- 1. Void columns on sales
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS status     text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS voided_at  timestamptz,
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS voided_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE sales ADD CONSTRAINT sales_status_check
    CHECK (status IN ('completed','voided'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Email on profiles (for user management UI)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email text;

-- Update handle_new_user to capture email and honour role metadata
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, full_name, role, email)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    COALESCE(new.raw_user_meta_data->>'role', 'cashier'),
    new.email
  )
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  RETURN new;
END;
$$;

-- Back-fill email for any existing profiles
UPDATE profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND p.email IS NULL;

-- 3. Owner can update profiles (role management)
DROP POLICY IF EXISTS "owner updates profiles" ON profiles;
CREATE POLICY "owner updates profiles"
  ON profiles FOR UPDATE
  USING (get_my_role() = 'owner');

-- 4. Day-close / Z-report table
CREATE TABLE IF NOT EXISTS day_closes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closed_at      timestamptz NOT NULL DEFAULT now(),
  closed_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  period_start   timestamptz NOT NULL,
  period_end     timestamptz NOT NULL,
  opening_float  numeric(12,2) NOT NULL DEFAULT 0,
  cash_sales     numeric(12,2) NOT NULL DEFAULT 0,
  mpesa_sales    numeric(12,2) NOT NULL DEFAULT 0,
  card_sales     numeric(12,2) NOT NULL DEFAULT 0,
  total_sales    numeric(12,2) NOT NULL DEFAULT 0,
  sale_count     integer NOT NULL DEFAULT 0,
  void_count     integer NOT NULL DEFAULT 0,
  expected_cash  numeric(12,2) NOT NULL DEFAULT 0,
  actual_cash    numeric(12,2),
  variance       numeric(12,2),
  notes          text
);

ALTER TABLE day_closes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "manager reads day closes" ON day_closes;
CREATE POLICY "manager reads day closes"
  ON day_closes FOR SELECT
  USING (get_my_role() IN ('manager','owner'));

DROP POLICY IF EXISTS "manager inserts day closes" ON day_closes;
CREATE POLICY "manager inserts day closes"
  ON day_closes FOR INSERT
  WITH CHECK (get_my_role() IN ('manager','owner'));

-- 5. void_sale RPC
CREATE OR REPLACE FUNCTION void_sale(p_sale_id bigint, p_reason text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role text;
  v_sale sales%ROWTYPE;
BEGIN
  SELECT get_my_role() INTO v_role;
  IF v_role NOT IN ('manager','owner') THEN
    RAISE EXCEPTION 'Only managers and owners can void sales';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF v_sale.status = 'voided' THEN
    RAISE EXCEPTION 'Sale % is already voided', v_sale.receipt_no;
  END IF;

  -- Restock every item
  INSERT INTO stock_movements (product_id, qty_change, reason, note, sale_id, by_user)
  SELECT si.product_id, si.qty, 'return',
         'Void ' || v_sale.receipt_no || CASE WHEN p_reason <> '' THEN ': ' || p_reason ELSE '' END,
         p_sale_id, auth.uid()
  FROM sale_items si
  WHERE si.sale_id = p_sale_id;

  UPDATE sales SET
    status      = 'voided',
    voided_at   = now(),
    void_reason = p_reason,
    voided_by   = auth.uid()
  WHERE id = p_sale_id;

  RETURN jsonb_build_object('ok', true, 'receipt_no', v_sale.receipt_no);
END;
$$;
