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
