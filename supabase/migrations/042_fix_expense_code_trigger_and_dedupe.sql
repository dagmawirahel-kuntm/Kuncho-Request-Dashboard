-- ═══════════════════════════════════════════════════════════════
-- Fixes the root cause of the duplicate-expense bug reported after
-- migration 038 (seed expenses from Airtable):
--
--   The trg_generate_expense_code trigger (from 006_expense_workflow.sql)
--   fires BEFORE INSERT and unconditionally OVERWRITES NEW.expense_code
--   with a freshly auto-generated value, even when the INSERT explicitly
--   supplied one. Migration 038's idempotency guards (`ON CONFLICT
--   (expense_code) DO NOTHING` / `WHERE NOT EXISTS (... expense_code =
--   i.expense_code)`) compared against the *original* Airtable code, but
--   the rows already sitting in the table had long since had that code
--   replaced by the trigger. So every re-run of the import (needed the
--   first time because of an incomplete paste) was treated as "all new"
--   and inserted a second full copy of every row, each under a fresh
--   auto-generated code -- which is why the duplicates don't show up as
--   matching expense_code values, only as matching vendor/date/amount.
--
-- This migration:
--   1. Patches generate_expense_code() to leave an explicitly-supplied
--      expense_code alone on INSERT (still auto-generates when one
--      isn't given, and still keeps the "code follows project/category/
--      date" behavior on UPDATE).
--   2. Removes the duplicate rows created by the double-import, keeping
--      the earliest copy of each (vendor_id, date, amount_etb,
--      item_service_description, expense_type) group.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION generate_expense_code()
RETURNS TRIGGER AS $$
DECLARE
  v_project_tag TEXT;
  v_ledger_tag  TEXT;
  v_date_tag    TEXT;
  v_prefix      TEXT;
  v_seq         INT;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.expense_code IS NOT NULL THEN
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

  SELECT COUNT(*) + 1 INTO v_seq
  FROM expenses
  WHERE expense_code LIKE v_prefix || '-%'
    AND id IS DISTINCT FROM NEW.id;

  NEW.expense_code := v_prefix || '-' || LPAD(v_seq::TEXT, 2, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Remove the duplicate copies introduced by the double-import. Keep the
-- earliest row (lowest created_at, tie-broken by id) per logical group.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY vendor_id, date, amount_etb, item_service_description, expense_type
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM expenses
  WHERE vendor_id IS NOT NULL
)
DELETE FROM expenses
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

COMMIT;

-- Verify: should show zero duplicate groups and the corrected total.
SELECT
  vendor_id, date, amount_etb, item_service_description, expense_type, COUNT(*)
FROM expenses
WHERE vendor_id IS NOT NULL
GROUP BY vendor_id, date, amount_etb, item_service_description, expense_type
HAVING COUNT(*) > 1;

SELECT
  count(*) FILTER (WHERE vendor_id IS NOT NULL) AS linked_to_vendor,
  count(*) FILTER (WHERE vendor_id IS NULL)     AS no_vendor_link,
  count(*)                                       AS total
FROM expenses;
