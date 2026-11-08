-- 503: jobs and cost buckets.
--
-- "Internal" mixed two different things: cost buckets that never end
-- (Workshop, Taxes, Salaries, Office Materials…) and jobs whose client wasn't
-- known yet, marked internal because the form wanted a client or the box.
-- Now:
--   · is_internal means a cost bucket, nothing else. A job may have no client
--     yet (it is flagged until one is set, and needs one before it is marked
--     delivered), or be Kuncho's own work (own_work: never has a client);
--   · a bucket has an owner, who approves its spending before finance; a
--     monthly budget; a default category (its ledger) for spending with none;
--     and an in-use switch (active_for_year) that keeps it in the pickers;
--   · overhead_summary() gives each bucket month by month against its budget
--     and last year, plus the overhead recorded with no bucket;
--   · the 24 projects marked internal before 503 carry a suggested kind, and
--     finance sorts them once (project_sort_kind).
--
-- The columns go in first, on their own, with a short lock wait (as 499b).

-- ── 503a (applied on its own) ───────────────────────────────────────────────
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS own_work boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bucket_owner_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bucket_monthly_budget numeric CHECK (bucket_monthly_budget IS NULL OR bucket_monthly_budget >= 0),
  ADD COLUMN IF NOT EXISTS bucket_category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suggested_kind text CHECK (suggested_kind IS NULL OR suggested_kind IN ('bucket', 'job', 'own', 'test')),
  ADD COLUMN IF NOT EXISTS kind_sorted_at timestamptz;

COMMENT ON COLUMN public.projects.is_internal IS 'A cost bucket: never ends, never closes (503). A job with no client is not internal.';
COMMENT ON COLUMN public.projects.own_work IS 'A job that is Kuncho''s own work: it never has a client (503).';
COMMENT ON COLUMN public.projects.bucket_owner_id IS 'Who approves a cost bucket''s spending before finance (503).';

-- ── 503b ────────────────────────────────────────────────────────────────────
-- The one-time sort: what each project marked internal before 503 looks like.
UPDATE public.projects SET suggested_kind = CASE
    WHEN btrim(project_name) IN ('Wellosefer Apartement', 'Debre-Berhan Chalachew', 'Refugee Event', 'Cop 32') THEN 'job'
    WHEN btrim(project_name) = 'New Office Project' THEN 'own'
    WHEN btrim(project_name) IN ('Test', 'Test 2', 'New Project') THEN 'test'
    ELSE 'bucket' END
 WHERE is_internal AND suggested_kind IS NULL AND kind_sorted_at IS NULL;

-- Is this a bucket, and whose? NULL owner when it has none.
CREATE OR REPLACE FUNCTION public.bucket_owner_of(p_project uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT bucket_owner_id FROM projects WHERE id = p_project AND is_internal;
$f$;

-- ── A job needs its client before it is marked delivered ───────────────────
CREATE OR REPLACE FUNCTION public.project_mark_delivered(p_project uuid, p_note text DEFAULT NULL::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE p projects%ROWTYPE; v_name text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());
BEGIN
  IF NOT project_can_deliver(p_project) THEN RAISE EXCEPTION 'The project''s PM marks it delivered'; END IF;
  SELECT * INTO p FROM projects WHERE id = p_project FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Project not found'; END IF;
  IF p.is_internal THEN RAISE EXCEPTION '% is a cost bucket: it is never delivered', btrim(p.project_name); END IF;
  IF p.client_id IS NULL AND NOT p.own_work THEN
    RAISE EXCEPTION 'Set the client on % first: the invoice goes to them. If it is Kuncho''s own work, say so on the project form.', btrim(p.project_name);
  END IF;
  IF p.delivered_at IS NOT NULL THEN RAISE EXCEPTION 'Already marked delivered on %', to_char(p.delivered_at AT TIME ZONE 'Africa/Addis_Ababa', 'DD Mon YYYY'); END IF;
  PERFORM set_config('kuncho.lifecycle', 'on', true);
  UPDATE projects SET delivered_at = now(), delivered_by = auth.uid(), delivered_by_name = v_name WHERE id = p_project;
  PERFORM set_config('kuncho.lifecycle', 'off', true);
  INSERT INTO project_lifecycle_events (project_id, kind, note, by_user, by_name) VALUES (p_project, 'delivered', NULLIF(btrim(p_note), ''), auth.uid(), v_name);
END $f$;

-- ── A bucket's owner approves its spending before finance ──────────────────
-- pending → manager_approved is the owner's step (it was never used before).
-- With an owner set, finance can't approve from pending unless the approver is
-- the owner; admin can always. The owner may also turn it down, or withdraw
-- their approval while finance hasn't acted.
CREATE OR REPLACE FUNCTION public.enforce_expense_approval_transitions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_role user_role;
  v_owner uuid;
  v_bucket text;
  v_is_owner boolean;
BEGIN
  v_role := get_user_role();

  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    SELECT p.bucket_owner_id, btrim(p.project_name) INTO v_owner, v_bucket FROM projects p WHERE p.id = NEW.project_id AND p.is_internal;
    v_is_owner := v_owner IS NOT NULL AND auth.uid() = v_owner;

    IF OLD.approval_status = 'pending' AND NEW.approval_status = 'manager_approved' THEN
      IF v_owner IS NULL THEN
        RAISE EXCEPTION 'Only spending on a cost bucket with an owner takes an owner''s approval';
      END IF;
      IF NOT v_is_owner AND COALESCE(v_role::text, '') <> 'admin' THEN
        RAISE EXCEPTION 'The owner of % approves its spending', v_bucket;
      END IF;
      NEW.manager_approved_by := auth.uid();
      NEW.manager_approved_at := NOW();

    ELSIF OLD.approval_status = 'pending' AND NEW.approval_status IN ('finance_approved', 'rejected') THEN
      IF NEW.approval_status = 'rejected' AND v_is_owner THEN
        NULL;  -- the bucket's owner turns it down
      ELSIF v_role IS NULL OR v_role NOT IN ('finance', 'admin') THEN
        RAISE EXCEPTION 'Only Finance can approve or reject an expense';
      ELSIF NEW.approval_status = 'finance_approved' AND v_owner IS NOT NULL AND NOT v_is_owner AND v_role::text <> 'admin' THEN
        RAISE EXCEPTION '% is a cost bucket: its owner, %, approves its spending first',
          v_bucket, COALESCE((SELECT full_name FROM user_profiles WHERE id = v_owner), 'its owner');
      END IF;
      IF NEW.approval_status = 'finance_approved' THEN
        NEW.finance_approved_by := auth.uid();
        NEW.finance_approved_at := NOW();
      END IF;

    ELSIF OLD.approval_status = 'manager_approved' AND NEW.approval_status IN ('finance_approved', 'rejected') THEN
      IF v_role IS NULL OR v_role NOT IN ('finance', 'admin') THEN
        RAISE EXCEPTION 'Only Finance can approve or reject an expense';
      END IF;
      IF NEW.approval_status = 'finance_approved' THEN
        NEW.finance_approved_by := auth.uid();
        NEW.finance_approved_at := NOW();
      END IF;

    ELSIF OLD.approval_status = 'manager_approved' AND NEW.approval_status = 'pending' THEN
      IF NOT v_is_owner AND COALESCE(v_role::text, '') NOT IN ('finance', 'admin') THEN
        RAISE EXCEPTION 'Only the owner or finance can take back an owner''s approval';
      END IF;
      NEW.manager_approved_by := NULL;
      NEW.manager_approved_at := NULL;

    ELSIF OLD.approval_status = 'rejected' AND NEW.approval_status = 'pending' THEN
      NEW.rejection_reason := NULL;
      NEW.manager_approved_by := NULL;
      NEW.manager_approved_at := NULL;
      NEW.finance_approved_by := NULL;
      NEW.finance_approved_at := NULL;

    ELSIF OLD.approval_status = 'finance_approved' AND NEW.approval_status = 'pending' THEN
      IF v_role IS NULL OR v_role NOT IN ('finance', 'admin') THEN
        RAISE EXCEPTION 'Only Finance can withdraw an approval';
      END IF;
      NEW.finance_approved_by := NULL;
      NEW.finance_approved_at := NULL;
      NEW.manager_approved_by := NULL;
      NEW.manager_approved_at := NULL;

    ELSE
      RAISE EXCEPTION 'Invalid approval status transition from % to %', OLD.approval_status, NEW.approval_status;
    END IF;
  END IF;

  RETURN NEW;
END;
$f$;

-- The owner's decision, for owners who can't edit expenses otherwise.
CREATE OR REPLACE FUNCTION public.bucket_expense_decide(p_expense uuid, p_approve boolean, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE e expenses%ROWTYPE; v_owner uuid;
BEGIN
  SELECT * INTO e FROM expenses WHERE id = p_expense FOR UPDATE;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Expense not found'; END IF;
  v_owner := bucket_owner_of(e.project_id);
  IF v_owner IS NULL THEN RAISE EXCEPTION 'That expense is not on a cost bucket with an owner'; END IF;
  IF auth.uid() IS DISTINCT FROM v_owner AND COALESCE(get_user_role()::text, '') <> 'admin' THEN
    RAISE EXCEPTION 'Only the bucket''s owner decides this';
  END IF;
  IF e.approval_status <> 'pending' THEN RAISE EXCEPTION 'It isn''t waiting for the owner any more'; END IF;
  IF p_approve THEN
    UPDATE expenses SET approval_status = 'manager_approved' WHERE id = p_expense;
  ELSE
    IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Say why it is turned down'; END IF;
    UPDATE expenses SET approval_status = 'rejected', rejection_reason = btrim(p_reason) WHERE id = p_expense;
  END IF;
END $f$;

-- What waits for the caller as a bucket owner (admin: every owner's).
CREATE OR REPLACE FUNCTION public.bucket_waiting()
RETURNS TABLE(id uuid, expense_code text, date date, description text, amount numeric, payee text,
              requested_by text, bucket_id uuid, bucket text, owner_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT e.id, e.expense_code, e.date, e.item_service_description, e.amount_etb,
         COALESCE(v.vendor_name, s.employee_name, e.vendors_name), up.full_name, p.id, btrim(p.project_name), o.full_name
    FROM expenses e JOIN projects p ON p.id = e.project_id AND p.is_internal AND p.bucket_owner_id IS NOT NULL
    LEFT JOIN vendors v ON v.id = e.vendor_id LEFT JOIN staff s ON s.id = e.paid_to_staff_id
    LEFT JOIN user_profiles up ON up.id = e.purchaser_user_id LEFT JOIN user_profiles o ON o.id = p.bucket_owner_id
   WHERE e.approval_status = 'pending' AND NOT COALESCE(e.is_archived, false)
     AND (p.bucket_owner_id = auth.uid() OR COALESCE(get_user_role()::text = 'admin', false))
   ORDER BY e.created_at;
$f$;

-- ── A bucket's default category (its ledger) for spending with none ────────
-- Purchase orders keep the category their items give them.
CREATE OR REPLACE FUNCTION public.trg_bucket_default_category()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $f$
BEGIN
  IF NEW.category_id IS NULL AND NEW.project_id IS NOT NULL AND NEW.expense_type::text <> 'purchase_order' THEN
    NEW.category_id := (SELECT bucket_category_id FROM projects WHERE id = NEW.project_id AND is_internal);
  END IF;
  RETURN NEW;
END $f$;

CREATE OR REPLACE TRIGGER trg_a_bucket_default_category
  BEFORE INSERT OR UPDATE OF project_id ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION trg_bucket_default_category();

-- The bucket's category counts as a default, not a manual pick.
CREATE OR REPLACE FUNCTION public.stamp_expense_category_source()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $f$
BEGIN
  IF COALESCE(current_setting('app.ledger_fill', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.category_id IS NOT DISTINCT FROM OLD.category_id THEN
    RETURN NEW;
  END IF;
  IF NEW.category_id IS NULL THEN
    NEW.category_source := NULL;
  ELSIF NEW.category_id IS NOT DISTINCT FROM resolve_expense_category(NEW.expense_type, NEW.sourcing_bundle_id) THEN
    NEW.category_source := CASE WHEN NEW.expense_type = 'purchase_order' THEN 'po' ELSE 'default' END;
  ELSIF NEW.project_id IS NOT NULL
        AND NEW.category_id = (SELECT bucket_category_id FROM projects WHERE id = NEW.project_id AND is_internal) THEN
    NEW.category_source := 'default';
  ELSE
    NEW.category_source := 'manual';
  END IF;
  NEW.category_source_ref := NULL;
  RETURN NEW;
END $f$;

-- ── Overhead, month by month ───────────────────────────────────────────────
-- Every bucket the caller may see (admin, finance, executives: all; an owner:
-- theirs), plus "Other company overhead": spending marked overhead with no
-- bucket. Spending counts by expense date, rejected and void left out.
CREATE OR REPLACE FUNCTION public.overhead_summary(p_months integer DEFAULT 12)
RETURNS TABLE(id uuid, name text, in_use boolean, owner_id uuid, owner_name text, monthly_budget numeric,
              category_id uuid, category_name text, months jsonb, this_month numeric, same_month_last_year numeric,
              last_12 numeric, n_costs integer, waiting_owner integer, to_sort boolean, suggested_kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH me AS (
    SELECT auth.uid() AS uid, COALESCE(get_user_role()::text IN ('admin', 'finance', 'executive'), false) AS sees_all
  ), cur AS (
    SELECT date_trunc('month', bot_today())::date AS m
  ), ms AS (
    SELECT (cur.m - make_interval(months => k))::date AS m FROM cur, generate_series(0, GREATEST(p_months, 1) - 1) k
  ), b AS (
    SELECT p.id, btrim(p.project_name) AS name, p.active_for_year AS in_use, p.bucket_owner_id, p.bucket_monthly_budget,
           p.bucket_category_id, p.kind_sorted_at IS NULL AND p.suggested_kind IS NOT NULL AS to_sort, p.suggested_kind
      FROM projects p, me WHERE p.is_internal AND (me.sees_all OR p.bucket_owner_id = me.uid)
    UNION ALL
    SELECT NULL, 'Other company overhead', true, NULL, NULL, NULL, false, NULL FROM me WHERE me.sees_all
  ), e AS (
    SELECT x.project_id, date_trunc('month', x.date)::date AS m, x.amount_etb
      FROM expenses x, cur
     WHERE NOT COALESCE(x.is_archived, false) AND x.approval_status::text <> 'rejected' AND COALESCE(x.payment_state, '') <> 'void'
       AND (x.project_id IN (SELECT id FROM b WHERE id IS NOT NULL) OR (x.project_id IS NULL AND x.is_overhead))
       AND x.date >= (cur.m - make_interval(months => GREATEST(p_months, 13)))::date
  )
  SELECT b.id, b.name, b.in_use, b.bucket_owner_id, u.full_name, b.bucket_monthly_budget, b.bucket_category_id, c.category_name,
         (SELECT jsonb_agg(jsonb_build_object('month', ms.m,
                   'spent', COALESCE((SELECT sum(e.amount_etb) FROM e WHERE e.project_id IS NOT DISTINCT FROM b.id AND e.m = ms.m), 0)) ORDER BY ms.m)
            FROM ms),
         COALESCE((SELECT sum(e.amount_etb) FROM e, cur WHERE e.project_id IS NOT DISTINCT FROM b.id AND e.m = cur.m), 0),
         COALESCE((SELECT sum(e.amount_etb) FROM e, cur WHERE e.project_id IS NOT DISTINCT FROM b.id AND e.m = (cur.m - interval '12 months')::date), 0),
         COALESCE((SELECT sum(e.amount_etb) FROM e, cur WHERE e.project_id IS NOT DISTINCT FROM b.id AND e.m > (cur.m - interval '12 months')::date), 0),
         (SELECT count(*)::int FROM e, cur WHERE e.project_id IS NOT DISTINCT FROM b.id AND e.m > (cur.m - interval '12 months')::date),
         (SELECT count(*)::int FROM expenses x WHERE b.bucket_owner_id IS NOT NULL AND x.project_id = b.id
             AND x.approval_status = 'pending' AND NOT COALESCE(x.is_archived, false)),
         b.to_sort, b.suggested_kind
    FROM b LEFT JOIN user_profiles u ON u.id = b.bucket_owner_id LEFT JOIN categories c ON c.id = b.bucket_category_id
   ORDER BY b.id IS NULL, b.in_use DESC, 12 DESC, b.name;
$f$;

-- One bucket's spending in one month (p_project NULL: overhead with no bucket).
CREATE OR REPLACE FUNCTION public.overhead_month_lines(p_project uuid, p_month date)
RETURNS TABLE(id uuid, expense_code text, date date, description text, amount numeric, payee text,
              approval_status text, payment_state text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT e.id, e.expense_code, e.date, e.item_service_description, e.amount_etb,
         COALESCE(v.vendor_name, s.employee_name, e.vendors_name), e.approval_status::text, e.payment_state
    FROM expenses e LEFT JOIN vendors v ON v.id = e.vendor_id LEFT JOIN staff s ON s.id = e.paid_to_staff_id
   WHERE (CASE WHEN p_project IS NULL THEN e.project_id IS NULL AND e.is_overhead ELSE e.project_id = p_project END)
     AND date_trunc('month', e.date)::date = date_trunc('month', p_month)::date
     AND NOT COALESCE(e.is_archived, false) AND e.approval_status::text <> 'rejected' AND COALESCE(e.payment_state, '') <> 'void'
     AND (COALESCE(get_user_role()::text IN ('admin', 'finance', 'executive'), false)
          OR (p_project IS NOT NULL AND bucket_owner_of(p_project) = auth.uid()))
   ORDER BY e.date DESC, e.amount_etb DESC;
$f$;

-- ── The one-time sort of the projects marked internal before 503 ───────────
-- bucket: stays a bucket, in use if anything was ever spent or requested on it.
-- job: a job whose client isn't known yet. own: Kuncho's own work.
-- test: not a real project; it becomes a job and closes without delivery.
CREATE OR REPLACE FUNCTION public.project_sort_kind(p_project uuid, p_kind text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE p projects%ROWTYPE;
BEGIN
  IF NOT project_can_close_costing() THEN RAISE EXCEPTION 'Finance sorts the internal projects'; END IF;
  SELECT * INTO p FROM projects WHERE id = p_project FOR UPDATE;
  IF p.id IS NULL OR NOT p.is_internal OR p.kind_sorted_at IS NOT NULL THEN RAISE EXCEPTION 'That project is already sorted'; END IF;
  IF p_kind = 'bucket' THEN
    UPDATE projects SET kind_sorted_at = now(),
           active_for_year = EXISTS (SELECT 1 FROM expenses e WHERE e.project_id = p_project)
                          OR EXISTS (SELECT 1 FROM orders o WHERE o.project_id = p_project)
     WHERE id = p_project;
  ELSIF p_kind IN ('job', 'own', 'test') THEN
    UPDATE projects SET is_internal = false, own_work = (p_kind = 'own'), kind_sorted_at = now() WHERE id = p_project;
    IF p_kind = 'test' THEN
      PERFORM project_close_out(p_project, false, 'Not a real project (sorted out of the internal list)');
    END IF;
  ELSE
    RAISE EXCEPTION 'Sort it as a bucket, a job, our own work or a test';
  END IF;
END $f$;

GRANT EXECUTE ON FUNCTION public.bucket_expense_decide(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bucket_waiting() TO authenticated;
GRANT EXECUTE ON FUNCTION public.overhead_summary(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.overhead_month_lines(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.project_sort_kind(uuid, text) TO authenticated;

-- ── 503c (applied on its own) ───────────────────────────────────────────────
-- The Closing tab says when a job still needs its client.
DO $do$
DECLARE d text := pg_get_functiondef('public.project_closing(uuid)'::regprocedure);
BEGIN
  IF position('''needs_client''' IN d) > 0 THEN RETURN; END IF;
  IF position('''is_internal'', p.is_internal, ''active_for_year'', p.active_for_year,' IN d) = 0 THEN
    RAISE EXCEPTION 'project_closing is not the 502 version';
  END IF;
  d := replace(d, '''is_internal'', p.is_internal, ''active_for_year'', p.active_for_year,',
               '''is_internal'', p.is_internal, ''active_for_year'', p.active_for_year,
    ''needs_client'', NOT p.is_internal AND p.client_id IS NULL AND NOT p.own_work,');
  EXECUTE d;
END $do$;

-- ── 503d (applied on its own) ───────────────────────────────────────────────
-- A cost bucket's latest spending, every status, for its own page.
CREATE OR REPLACE FUNCTION public.bucket_recent(p_project uuid, p_limit integer DEFAULT 40)
RETURNS TABLE(id uuid, expense_code text, date date, description text, amount numeric, payee text,
              approval_status text, payment_state text, requested_by text, rejection_reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT e.id, e.expense_code, e.date, e.item_service_description, e.amount_etb,
         COALESCE(v.vendor_name, s.employee_name, e.vendors_name), e.approval_status::text, e.payment_state,
         up.full_name, e.rejection_reason
    FROM expenses e LEFT JOIN vendors v ON v.id = e.vendor_id LEFT JOIN staff s ON s.id = e.paid_to_staff_id
    LEFT JOIN user_profiles up ON up.id = e.purchaser_user_id
   WHERE e.project_id = p_project AND NOT COALESCE(e.is_archived, false)
     AND EXISTS (SELECT 1 FROM projects p WHERE p.id = p_project AND p.is_internal)
     AND (COALESCE(get_user_role()::text IN ('admin', 'finance', 'executive'), false) OR bucket_owner_of(p_project) = auth.uid())
   ORDER BY e.date DESC, e.created_at DESC
   LIMIT LEAST(GREATEST(p_limit, 1), 200);
$f$;
GRANT EXECUTE ON FUNCTION public.bucket_recent(uuid, integer) TO authenticated;
