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
