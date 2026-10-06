-- ============================================================
-- 012_day_close_delete.sql: let the owner delete a saved Z-report
-- (e.g. a day closed twice, or closed with wrong figures)
-- Run in: Supabase SQL editor
-- ============================================================

DROP POLICY IF EXISTS "owner deletes day closes" ON day_closes;
CREATE POLICY "owner deletes day closes"
  ON day_closes FOR DELETE
  USING (get_my_role() = 'owner');
