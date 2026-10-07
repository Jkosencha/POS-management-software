-- ============================================================
-- setup_demo_project.sql: every migration (001-015) in order, for a
-- brand-new Supabase project. Generated from supabase/migrations;
-- paste the whole file into the SQL editor of the NEW project and run.
-- Do NOT run this on the production project.
-- ============================================================


-- >>>>>>>>>> migrations/001_schema.sql
-- ============================================================
-- 001_schema.sql: core tables + triggers + checkout RPC
-- Run this in the Supabase SQL editor (Project → SQL Editor)
-- ============================================================

-- 1. User profiles
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null,
  role text not null check (role in ('owner','manager','cashier')) default 'cashier',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 2. Products
create table if not exists products (
  id bigint generated always as identity primary key,
  name text not null,
  sku text unique,
  barcode text unique,
  category text not null default 'General',
  price numeric(12,2) not null check (price >= 0),
  stock integer not null default 0,
  low_at integer not null default 5,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists products_barcode_idx on products (barcode);
create index if not exists products_category_idx on products (category);

-- 3. Sales
create table if not exists sales (
  id bigint generated always as identity primary key,
  receipt_no text unique not null,
  cashier_id uuid references profiles(id),
  subtotal numeric(12,2) not null,
  discount_pct numeric(5,2) not null default 0,
  discount_amt numeric(12,2) not null default 0,
  total numeric(12,2) not null,
  vat_amount numeric(12,2) not null,
  method text not null check (method in ('Cash','M-Pesa','Card')),
  tendered numeric(12,2),
  change numeric(12,2),
  mpesa_ref text,
  created_at timestamptz not null default now()
);
create index if not exists sales_created_at_idx on sales (created_at);

-- 4. Sale line items
create table if not exists sale_items (
  id bigint generated always as identity primary key,
  sale_id bigint not null references sales(id) on delete cascade,
  product_id bigint references products(id),
  name text not null,
  qty integer not null check (qty > 0),
  unit_price numeric(12,2) not null,
  line_total numeric(12,2) not null
);
create index if not exists sale_items_sale_id_idx on sale_items (sale_id);

-- 5. Stock movements
create table if not exists stock_movements (
  id bigint generated always as identity primary key,
  product_id bigint not null references products(id),
  qty_change integer not null,
  reason text not null check (reason in ('sale','restock','adjustment','spoilage','return')),
  note text,
  sale_id bigint references sales(id),
  by_user uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists stock_movements_product_created_idx on stock_movements (product_id, created_at);

-- 6. Store settings (single row enforced by PK constraint)
create table if not exists settings (
  id boolean primary key default true check (id),
  store_name text not null default 'Sunrise Minimart',
  currency text not null default 'KSh',
  tax_rate numeric(5,2) not null default 16,
  receipt_footer text not null default 'Thank you, karibu tena!'
);
insert into settings default values on conflict do nothing;

-- ============================================================
-- Stock integrity trigger
-- ============================================================
create or replace function apply_stock_movement()
returns trigger as $$
begin
  update products
  set stock = stock + new.qty_change, updated_at = now()
  where id = new.product_id;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_apply_stock on stock_movements;
create trigger trg_apply_stock
  after insert on stock_movements
  for each row execute function apply_stock_movement();

-- Auto-create profile on first sign-up
-- Table name is schema-qualified and search_path pinned because triggers on
-- auth.users run in a context where "public" isn't guaranteed to be on the
-- search path: an unqualified `profiles` reference fails there even though
-- the table exists (see 42P01 "relation does not exist" during user creation).
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'cashier')
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- Receipt number sequence + atomic checkout RPC
-- ============================================================
create sequence if not exists receipt_seq start 1;

create or replace function checkout(
  p_items    jsonb,
  p_payment  jsonb
)
returns jsonb
language plpgsql
security definer
as $$
declare
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
begin
  select tax_rate into v_tax_rate from settings limit 1;

  v_discount_pct := coalesce((p_payment->>'discount_pct')::numeric, 0);

  -- Validate all items first (fail fast before any inserts)
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'qty')::integer;

    select * into v_product
    from products
    where id = (v_item->>'product_id')::bigint and active = true
    for update;  -- lock row to prevent race conditions

    if not found then
      raise exception 'Product % not found or inactive', v_item->>'product_id';
    end if;

    if v_product.stock < v_qty then
      raise exception 'Insufficient stock for "%": % available, % requested',
        v_product.name, v_product.stock, v_qty;
    end if;

    v_subtotal := v_subtotal + (v_product.price * v_qty);
  end loop;

  v_discount_amt := round(v_subtotal * (v_discount_pct / 100), 2);
  v_total        := v_subtotal - v_discount_amt;
  v_vat_amount   := round(v_total * (v_tax_rate / (100 + v_tax_rate)), 2);

  v_receipt_no := 'S' || lpad(nextval('receipt_seq')::text, 4, '0');

  insert into sales (
    receipt_no, cashier_id,
    subtotal, discount_pct, discount_amt, total, vat_amount,
    method, tendered, change, mpesa_ref
  ) values (
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
  returning id into v_sale_id;

  -- Insert line items and deduct stock
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'qty')::integer;

    select * into v_product
    from products where id = (v_item->>'product_id')::bigint;

    v_line_total := v_product.price * v_qty;

    insert into sale_items (sale_id, product_id, name, qty, unit_price, line_total)
    values (v_sale_id, v_product.id, v_product.name, v_qty, v_product.price, v_line_total);

    insert into stock_movements (product_id, qty_change, reason, sale_id, by_user)
    values (v_product.id, -v_qty, 'sale', v_sale_id, auth.uid());
  end loop;

  return jsonb_build_object(
    'sale_id',    v_sale_id,
    'receipt_no', v_receipt_no,
    'total',      v_total,
    'vat_amount', v_vat_amount
  );
end;
$$;


-- >>>>>>>>>> migrations/002_rls.sql
-- ============================================================
-- 002_rls.sql: Row Level Security policies
-- Run AFTER 001_schema.sql
-- ============================================================

-- Enable RLS on every table
alter table profiles        enable row level security;
alter table products        enable row level security;
alter table sales           enable row level security;
alter table sale_items      enable row level security;
alter table stock_movements enable row level security;
alter table settings        enable row level security;

-- Helper: get caller's role without triggering RLS (security definer)
create or replace function get_my_role()
returns text
language sql
security definer
stable
as $$
  select role from profiles where id = auth.uid();
$$;

-- ============================================================
-- profiles
-- ============================================================
drop policy if exists "profiles_select" on profiles;
create policy "profiles_select" on profiles
  for select using (
    id = auth.uid()
    or get_my_role() in ('manager', 'owner')
  );

drop policy if exists "profiles_insert_self" on profiles;
create policy "profiles_insert_self" on profiles
  for insert with check (id = auth.uid());

drop policy if exists "profiles_update_owner" on profiles;
create policy "profiles_update_owner" on profiles
  for update using (get_my_role() = 'owner');

-- ============================================================
-- products
-- ============================================================
drop policy if exists "products_select_authenticated" on products;
create policy "products_select_authenticated" on products
  for select using (auth.uid() is not null);

drop policy if exists "products_insert_manager" on products;
create policy "products_insert_manager" on products
  for insert with check (get_my_role() in ('manager', 'owner'));

drop policy if exists "products_update_manager" on products;
create policy "products_update_manager" on products
  for update using (get_my_role() in ('manager', 'owner'));

-- No hard deletes; owners set active = false (covered by update policy)

-- ============================================================
-- sales
-- ============================================================
drop policy if exists "sales_select" on sales;
create policy "sales_select" on sales
  for select using (
    cashier_id = auth.uid()
    or get_my_role() in ('manager', 'owner')
  );

-- No direct insert: must go through checkout() RPC (security definer)

-- ============================================================
-- sale_items
-- ============================================================
drop policy if exists "sale_items_select" on sale_items;
create policy "sale_items_select" on sale_items
  for select using (
    exists (
      select 1 from sales s
      where s.id = sale_id
        and (s.cashier_id = auth.uid() or get_my_role() in ('manager', 'owner'))
    )
  );

-- ============================================================
-- stock_movements
-- ============================================================
drop policy if exists "stock_movements_select" on stock_movements;
create policy "stock_movements_select" on stock_movements
  for select using (get_my_role() in ('manager', 'owner'));

-- Managers can insert restock/adjustment/spoilage/return directly
drop policy if exists "stock_movements_insert_manager" on stock_movements;
create policy "stock_movements_insert_manager" on stock_movements
  for insert with check (
    get_my_role() in ('manager', 'owner')
    and reason in ('restock', 'adjustment', 'spoilage', 'return')
  );

-- ============================================================
-- settings
-- ============================================================
drop policy if exists "settings_select" on settings;
create policy "settings_select" on settings
  for select using (auth.uid() is not null);

drop policy if exists "settings_update_owner" on settings;
create policy "settings_update_owner" on settings
  for update using (get_my_role() = 'owner');


-- >>>>>>>>>> migrations/003_seed.sql
-- ============================================================
-- 003_seed.sql: sample minimart products
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


-- >>>>>>>>>> migrations/004_mpesa.sql
-- M-Pesa STK push request tracking
-- Run in: Supabase SQL editor

create table if not exists mpesa_requests (
  id            uuid primary key default gen_random_uuid(),
  checkout_id   text unique not null,          -- MerchantRequestID from Daraja
  phone         text not null,
  amount        numeric(10, 2) not null,
  status        text not null default 'pending', -- pending | success | failed | timeout
  mpesa_ref     text,                            -- M-Pesa confirmation code (e.g. RGQ71KX63I)
  result_desc   text,                            -- human-readable result from Safaricom
  cashier_id    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists mpesa_requests_checkout_id on mpesa_requests(checkout_id);
create index if not exists mpesa_requests_cashier_id  on mpesa_requests(cashier_id);
create index if not exists mpesa_requests_created_at  on mpesa_requests(created_at desc);

-- Keep updated_at current
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_mpesa_updated_at on mpesa_requests;
create trigger trg_mpesa_updated_at
  before update on mpesa_requests
  for each row execute function touch_updated_at();

-- RLS -----------------------------------------------------------------
alter table mpesa_requests enable row level security;

-- Cashiers can see their own requests (for live status polling)
create policy "cashier reads own mpesa requests"
  on mpesa_requests for select
  using (cashier_id = auth.uid());

-- Manager/owner can see all
create policy "manager reads all mpesa requests"
  on mpesa_requests for select
  using (get_my_role() in ('manager', 'owner'));

-- Only the service_role (Edge Functions) may insert / update
-- (cashier initiates via Edge Function, not direct insert)
-- No client-side insert/update policies needed

-- Realtime -----------------------------------------------------------
alter publication supabase_realtime add table mpesa_requests;


-- >>>>>>>>>> migrations/005_void_and_users.sql
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


-- >>>>>>>>>> migrations/006_prevent_self_demotion.sql
-- ============================================================
-- 006_prevent_self_demotion.sql
-- Prevents any user from changing their own role,
-- even if they bypass the UI (e.g. via SQL or API).
-- Run in: Supabase SQL editor
-- ============================================================

CREATE OR REPLACE FUNCTION prevent_self_role_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF new.id = auth.uid() AND new.role IS DISTINCT FROM old.role THEN
    RAISE EXCEPTION 'You cannot change your own role. Ask another owner to change it for you.';
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_role_change ON profiles;
CREATE TRIGGER trg_prevent_self_role_change
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION prevent_self_role_change();


-- >>>>>>>>>> migrations/007_profile_self_edit.sql
-- ============================================================
-- 007_profile_self_edit.sql
-- Allows any authenticated user to update their own profile.
-- The prevent_self_role_change() trigger (from 006) still
-- blocks users from changing their own role via this policy.
-- Run in: Supabase SQL editor
-- ============================================================

DROP POLICY IF EXISTS "user updates own profile" ON profiles;

CREATE POLICY "user updates own profile"
  ON profiles FOR UPDATE
  USING (id = auth.uid());


-- >>>>>>>>>> migrations/008_cost_tracking.sql
-- ============================================================
-- 008_cost_tracking.sql: cost price + supplier, for real profit/margin
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


-- >>>>>>>>>> migrations/009_categories_staff_purge.sql
-- ============================================================
-- 009_categories_staff_purge.sql
--   1. categories table (add / rename / deactivate / delete)
--   2. staff edit, deactivate and delete
--   3. owner-only "danger zone" sales purge (password confirmed)
-- Run in: Supabase SQL editor
-- ============================================================

-- ------------------------------------------------------------
-- 1. Categories
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Back-fill from the categories products already use, plus the column default
INSERT INTO categories (name)
SELECT DISTINCT category FROM products WHERE category IS NOT NULL
ON CONFLICT (name) DO NOTHING;
INSERT INTO categories (name) VALUES ('General') ON CONFLICT (name) DO NOTHING;

-- products.category stays a text column, but now must name a real category.
-- ON UPDATE CASCADE: renaming a category renames it on every product.
-- ON DELETE RESTRICT: a category that still has products can't be deleted.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_category_fkey;
ALTER TABLE products
  ADD CONSTRAINT products_category_fkey
  FOREIGN KEY (category) REFERENCES categories(name)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "categories_select" ON categories;
CREATE POLICY "categories_select" ON categories
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "categories_insert_manager" ON categories;
CREATE POLICY "categories_insert_manager" ON categories
  FOR INSERT WITH CHECK (get_my_role() IN ('manager', 'owner'));

DROP POLICY IF EXISTS "categories_update_manager" ON categories;
CREATE POLICY "categories_update_manager" ON categories
  FOR UPDATE USING (get_my_role() IN ('manager', 'owner'));

DROP POLICY IF EXISTS "categories_delete_manager" ON categories;
CREATE POLICY "categories_delete_manager" ON categories
  FOR DELETE USING (get_my_role() IN ('manager', 'owner'));

-- ------------------------------------------------------------
-- 2. Staff: deactivate + delete
-- ------------------------------------------------------------
-- Deleting a staff member removes their login (auth.users row) but keeps
-- their profile row, flagged deleted, so sales and stock history still
-- show who did what. That means profiles must no longer cascade-delete
-- with auth.users.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- Deactivated or deleted staff get no role, so every RLS policy that
-- checks get_my_role() locks them out server-side.
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM profiles
  WHERE id = auth.uid() AND active AND deleted_at IS NULL;
$$;

-- Nobody can change their own role or deactivate themselves
CREATE OR REPLACE FUNCTION prevent_self_role_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF new.id = auth.uid() AND new.role IS DISTINCT FROM old.role THEN
    RAISE EXCEPTION 'You cannot change your own role. Ask another owner to change it for you.';
  END IF;
  IF new.id = auth.uid() AND new.active IS DISTINCT FROM old.active THEN
    RAISE EXCEPTION 'You cannot deactivate your own account.';
  END IF;
  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION delete_staff(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_my_role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Only owners can delete staff';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot delete your own account';
  END IF;

  UPDATE profiles SET active = false, deleted_at = now()
  WHERE id = p_user_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff member not found';
  END IF;

  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION delete_staff(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION delete_staff(uuid) TO authenticated;

-- ------------------------------------------------------------
-- 3. Danger zone: delete sales in a date range
-- ------------------------------------------------------------
-- Owner only, and the owner's current password is re-checked server-side
-- (against auth.users), so the RPC can't be called with just a session.
-- sale_items are removed by their ON DELETE CASCADE. Stock levels are NOT
-- changed; the 'sale' stock movements stay in the audit log, unlinked.
CREATE OR REPLACE FUNCTION purge_sales(p_from timestamptz, p_to timestamptz, p_password text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ok    boolean;
  v_count integer;
BEGIN
  IF get_my_role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Only owners can delete sales data';
  END IF;

  SELECT encrypted_password = extensions.crypt(p_password, encrypted_password)
  INTO v_ok
  FROM auth.users WHERE id = auth.uid();

  IF NOT coalesce(v_ok, false) THEN
    RAISE EXCEPTION 'Incorrect password';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to THEN
    RAISE EXCEPTION 'Invalid date range';
  END IF;

  UPDATE stock_movements SET sale_id = NULL
  WHERE sale_id IN (SELECT id FROM sales WHERE created_at >= p_from AND created_at < p_to);

  DELETE FROM sales WHERE created_at >= p_from AND created_at < p_to;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION purge_sales(timestamptz, timestamptz, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION purge_sales(timestamptz, timestamptz, text) TO authenticated;


-- >>>>>>>>>> migrations/010_partners.sql
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


-- >>>>>>>>>> migrations/011_realtime_offline_fixes.sql
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


-- >>>>>>>>>> migrations/012_day_close_delete.sql
-- ============================================================
-- 012_day_close_delete.sql: let the owner delete a saved Z-report
-- (e.g. a day closed twice, or closed with wrong figures)
-- Run in: Supabase SQL editor
-- ============================================================

DROP POLICY IF EXISTS "owner deletes day closes" ON day_closes;
CREATE POLICY "owner deletes day closes"
  ON day_closes FOR DELETE
  USING (get_my_role() = 'owner');


-- >>>>>>>>>> migrations/013_discounts_attribution_payouts.sql
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


-- >>>>>>>>>> migrations/014_cashier_powers_unvoid.sql
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


-- >>>>>>>>>> migrations/015_staff_can_see_names.sql
-- ============================================================
-- 015_staff_can_see_names.sql
-- Cashiers can see every sale (014), so they need to read colleagues'
-- profiles to show who made each sale. Editing profiles is unchanged
-- (owner, or yourself).
-- Run in: Supabase SQL editor (after 014)
-- ============================================================

DROP POLICY IF EXISTS "profiles_select" ON profiles;
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT USING (
    id = auth.uid()                -- always your own (needed to sign in)
    OR get_my_role() IS NOT NULL   -- any active staff member sees the team
  );
