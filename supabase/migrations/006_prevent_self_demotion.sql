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
