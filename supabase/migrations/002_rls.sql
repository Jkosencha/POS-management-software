-- ============================================================
-- 002_rls.sql — Row Level Security policies
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

-- No direct insert — must go through checkout() RPC (security definer)

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
