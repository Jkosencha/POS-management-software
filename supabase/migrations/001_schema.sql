-- ============================================================
-- 001_schema.sql — core tables + triggers + checkout RPC
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
-- search path — an unqualified `profiles` reference fails there even though
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
