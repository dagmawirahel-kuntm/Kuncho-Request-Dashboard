-- 506: A cost bucket can take its own category's spending by itself.
--
-- A bucket (503) takes overhead of some kinds (fuel, rent, …) recorded with
-- no project. Taxes and government fees aren't a kind: they are a category,
-- Government Expense, and two such bills recorded with no project sat in
-- "Other company overhead" while three others were in the Taxes &
-- Government Fees bucket. A bucket can now take spending in its default
-- category when it is recorded with no project (bucket_takes_category), and
-- the Taxes & Government Fees bucket does, so every payment to the
-- government counts in one place. The tax hub (/taxes) reads that bucket
-- through tax_bucket().

SET search_path TO public;

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS bucket_takes_category boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.projects.bucket_takes_category IS
  'Spending in this bucket''s default category (bucket_category_id) recorded with no project lands here by itself (506).';

-- The bucket that takes a category's spending recorded with no project.
CREATE OR REPLACE FUNCTION public.bucket_for_category(p_category uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT id FROM projects
   WHERE is_internal AND active_for_year AND costing_closed_at IS NULL
     AND bucket_takes_category AND bucket_category_id = p_category
   ORDER BY project_name LIMIT 1;
$f$;

-- Recorded with no project: its kind first (503), then its category.
-- Purchase orders keep their items' categories, so they never route by one.
CREATE OR REPLACE FUNCTION public.trg_bucket_route_expense()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $f$
BEGIN
  IF NEW.project_id IS NULL AND NEW.expense_type IS NOT NULL THEN
    NEW.project_id := bucket_for_expense_type(NEW.expense_type::text);
  END IF;
  IF NEW.project_id IS NULL AND NEW.category_id IS NOT NULL
     AND NEW.expense_type IS DISTINCT FROM 'purchase_order'::expense_category THEN
    NEW.project_id := bucket_for_category(NEW.category_id);
  END IF;
  RETURN NEW;
END $f$;

-- The bucket government payments go to: the one taking Government Expense.
-- An id only, so anyone signed in may ask; what it holds stays behind the
-- overhead functions' own access checks.
CREATE OR REPLACE FUNCTION public.tax_bucket()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT p.id FROM projects p JOIN categories c ON c.id = p.bucket_category_id
   WHERE p.is_internal AND p.bucket_takes_category AND lower(btrim(c.category_name)) = 'government expense'
   ORDER BY p.active_for_year DESC, p.project_name LIMIT 1;
$f$;
REVOKE EXECUTE ON FUNCTION public.tax_bucket() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tax_bucket() TO authenticated;

-- Taxes & Government Fees takes Government Expense.
UPDATE projects SET bucket_takes_category = true
 WHERE is_internal AND bucket_category_id IS NOT NULL
   AND bucket_category_id = (SELECT id FROM categories WHERE lower(btrim(category_name)) = 'government expense' LIMIT 1)
   AND lower(btrim(project_name)) = 'taxes & government fees';

-- Spending already recorded with no project goes to its bucket, as
-- expense_move_to_bucket would move it; one that can't move stays put.
DO $d$
DECLARE r record; v_bucket uuid;
BEGIN
  FOR r IN
    SELECT e.id, e.category_id FROM expenses e
     WHERE e.project_id IS NULL AND e.category_id IS NOT NULL
       AND NOT COALESCE(e.is_archived, false) AND e.approval_status::text <> 'rejected'
       AND COALESCE(e.payment_state, '') <> 'void'
       AND e.expense_type IS DISTINCT FROM 'purchase_order'::expense_category
  LOOP
    v_bucket := bucket_for_category(r.category_id);
    CONTINUE WHEN v_bucket IS NULL;
    BEGIN
      UPDATE expenses SET project_id = v_bucket WHERE id = r.id AND project_id IS NULL;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Expense % stays where it is: %', r.id, SQLERRM;
    END;
  END LOOP;
END $d$;
