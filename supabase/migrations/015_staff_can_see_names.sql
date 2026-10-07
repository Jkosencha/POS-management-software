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
