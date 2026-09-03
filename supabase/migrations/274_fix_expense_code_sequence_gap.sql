-- generate_expense_code() numbered the next code as
-- COUNT(existing rows with this prefix) + 1 — not a real sequence, just
-- today's row count. Deleting any row from a prefix group (e.g.
-- undo_labor_rollup, built specifically so a bad rollup can be redone)
-- drops the count by one without freeing the highest suffix already
-- issued, so the very next insert recomputes a number that collides
-- with a row that's still there.
--
-- Reported case: roll up Ceramic Works (…-01), roll up Silcon Works
-- (…-02), undo Ceramic Works (count drops to 1, …-01 freed), re-roll
-- Ceramic Works -> COUNT(1)+1 = 2 -> tries to reuse …-02, which Silcon
-- Works still holds -> "duplicate key value violates unique constraint
-- expenses_expense_code_unique". Not specific to labor rollups — any
-- deletion of a non-last-numbered row in a same-day/prefix group hits
-- the same collision on the next insert.
--
-- Fix: derive the next number from the highest suffix actually in use,
-- not how many rows happen to exist, so a gap left by a delete is never
-- reissued to a different row.
CREATE OR REPLACE FUNCTION public.generate_expense_code()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_project_tag TEXT;
  v_ledger_tag  TEXT;
  v_date_tag    TEXT;
  v_prefix      TEXT;
  v_seq         INT;
BEGIN
  IF NEW.expense_code IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT UPPER(LEFT(REGEXP_REPLACE(project_name, '[^A-Za-z0-9]', '', 'g'), 4))
    INTO v_project_tag FROM projects WHERE id = NEW.project_id;
  SELECT UPPER(LEFT(REGEXP_REPLACE(category_name, '[^A-Za-z0-9]', '', 'g'), 4))
    INTO v_ledger_tag FROM categories WHERE id = NEW.category_id;

  v_project_tag := COALESCE(NULLIF(v_project_tag, ''), 'GEN');
  v_ledger_tag  := COALESCE(NULLIF(v_ledger_tag, ''), 'MISC');
  v_date_tag    := TO_CHAR(COALESCE(NEW.date, CURRENT_DATE), 'YYYYMMDD');
  v_prefix      := v_project_tag || '-' || v_ledger_tag || '-' || v_date_tag;

  SELECT COALESCE(MAX(SUBSTRING(expense_code FROM '-([0-9]+)$')::int), 0) + 1 INTO v_seq
  FROM expenses
  WHERE expense_code LIKE v_prefix || '-%'
    AND id IS DISTINCT FROM NEW.id;

  NEW.expense_code := v_prefix || '-' || LPAD(v_seq::TEXT, 2, '0');
  RETURN NEW;
END;
$function$;
