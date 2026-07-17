-- ============================================================
-- Payment lifecycle enforcement, current-FY rows only.
--
-- Pre-FY2026/27 rows are grandfathered: null approver/payer is
-- expected and permitted for historical records, and nothing here
-- ever fires retroactively on them. A row with no resolvable date
-- (fiscal_period_for_date returns NULL) is treated the same way —
-- conservatively un-enforced rather than guessing.
--
-- Segregation of duties, made concrete: finance_approved_by (who
-- approved) and disbursed_by (who paid) must be two different people,
-- both admin/finance, before a current-FY expense can reach sent or
-- paid. BEFORE INSERT/UPDATE + RAISE EXCEPTION — the migration-069
-- shape, not the GRN AFTER-INSERT shape (that one's for "record an
-- event that flips a status", this is "block a bad state outright").
-- ============================================================

SET search_path TO public;

-- SECURITY DEFINER: the disbursed_by role check below looks up a
-- DIFFERENT user's role (the payer, not the caller) in user_profiles,
-- whose RLS only grants a role broad read via admin_all or restricts
-- everyone else to their own row (id = auth.uid()) — found by testing
-- this exact check as a finance-role caller: the subquery silently
-- returned zero rows under RLS, so `NOT IN (...)` evaluated to NULL,
-- not TRUE, and the whole role gate silently no-op'd regardless of
-- who was named as disbursed_by. Same gap shape as staff_effective_
-- day_rate() found earlier in this project. get_user_role() (used
-- elsewhere in this trigger indirectly) is already SECURITY DEFINER
-- for exactly this reason; this function needs the same treatment
-- for its own cross-user lookup.
CREATE OR REPLACE FUNCTION enforce_expense_payment_lifecycle()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current_fy   UUID;
  v_row_fy       UUID;
  v_is_current   BOOLEAN;
BEGIN
  SELECT id INTO v_current_fy FROM fiscal_periods WHERE is_current;
  v_row_fy := fiscal_period_for_date(NEW.date);
  v_is_current := (v_row_fy IS NOT NULL AND v_row_fy = v_current_fy);

  IF v_is_current THEN
    -- Closes the direct-boolean bypass: on a current-FY row,
    -- payment_status can only move as a side effect of payment_state
    -- changing in the same statement, never on its own (e.g. a raw
    -- checkbox toggle on the expense form that doesn't go through the
    -- new lifecycle).
    IF TG_OP = 'UPDATE'
       AND NEW.payment_status IS DISTINCT FROM OLD.payment_status
       AND NEW.payment_state IS NOT DISTINCT FROM OLD.payment_state THEN
      RAISE EXCEPTION 'payment_status can no longer be set directly on a current fiscal year expense — use payment_state instead';
    END IF;

    IF NEW.payment_state IN ('approved_to_pay', 'sent', 'paid') AND NEW.finance_approved_by IS NULL THEN
      RAISE EXCEPTION 'A current fiscal year expense needs a real finance approver (finance_approved_by) before it can reach %', NEW.payment_state;
    END IF;

    IF NEW.payment_state IN ('sent', 'paid') THEN
      IF NEW.disbursed_by IS NULL THEN
        RAISE EXCEPTION 'A current fiscal year expense needs a payer identity (disbursed_by) before it can reach %', NEW.payment_state;
      END IF;
      IF NEW.disbursed_by = NEW.finance_approved_by THEN
        RAISE EXCEPTION 'The same person cannot both approve (finance_approved_by) and pay (disbursed_by) an expense';
      END IF;
      IF (SELECT role FROM user_profiles WHERE id = NEW.disbursed_by) NOT IN ('admin', 'finance') THEN
        RAISE EXCEPTION 'disbursed_by must be an admin or finance user';
      END IF;
    END IF;
  END IF;

  -- payment_state is the source of truth going forward; payment_status
  -- mirrors it one-directionally (never the reverse) so anything still
  -- reading the old boolean — including the Phase 1 budget views'
  -- Actual calculation — keeps working unchanged. See migration 070:
  -- expense_amounts' CASE keys off e.payment_status directly; this
  -- trigger is what keeps that column meaning exactly what it always
  -- meant, now driven by the richer lifecycle instead of a raw toggle.
  -- Unconditional — applies to grandfathered/historical rows too, not
  -- just current-FY ones, since backward-compat sync isn't an
  -- enforcement concern and shouldn't be gated like one (found by
  -- testing a historical paid row and seeing payment_status stay false).
  NEW.payment_status := (NEW.payment_state = 'paid');

  IF TG_OP = 'INSERT' OR NEW.payment_state IS DISTINCT FROM OLD.payment_state THEN
    NEW.payment_state_changed_at := NOW();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_expense_payment_lifecycle ON expenses;
CREATE TRIGGER trg_enforce_expense_payment_lifecycle
  BEFORE INSERT OR UPDATE OF payment_state, payment_status, finance_approved_by, disbursed_by ON expenses
  FOR EACH ROW EXECUTE FUNCTION enforce_expense_payment_lifecycle();

-- ── Extend the existing finance-only field lock (migration 006) to
-- cover the three new user-settable payment columns. ────────────────
CREATE OR REPLACE FUNCTION enforce_expense_finance_fields()
RETURNS TRIGGER AS $$
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    IF NEW.payment_status        IS DISTINCT FROM OLD.payment_status
    OR NEW.paid_date             IS DISTINCT FROM OLD.paid_date
    OR NEW.bank_ref               IS DISTINCT FROM OLD.bank_ref
    OR NEW.partially_paid        IS DISTINCT FROM OLD.partially_paid
    OR NEW.partial_paid_amount   IS DISTINCT FROM OLD.partial_paid_amount
    OR NEW.partial_payment_date  IS DISTINCT FROM OLD.partial_payment_date
    OR NEW.partial_payment_notes IS DISTINCT FROM OLD.partial_payment_notes
    OR NEW.total_payment_date    IS DISTINCT FROM OLD.total_payment_date
    OR NEW.account_id            IS DISTINCT FROM OLD.account_id
    OR NEW.transfer_id           IS DISTINCT FROM OLD.transfer_id
    OR NEW.tax_summary_id        IS DISTINCT FROM OLD.tax_summary_id
    OR NEW.verify_wht            IS DISTINCT FROM OLD.verify_wht
    OR NEW.wht_handling_method   IS DISTINCT FROM OLD.wht_handling_method
    OR NEW.wht_fund              IS DISTINCT FROM OLD.wht_fund
    OR NEW.payment_state         IS DISTINCT FROM OLD.payment_state
    OR NEW.disbursed_by          IS DISTINCT FROM OLD.disbursed_by
    OR NEW.payment_method        IS DISTINCT FROM OLD.payment_method
    THEN
      RAISE EXCEPTION 'Only Finance or Admin can modify payment and finance-linked fields on an expense';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Verify: both triggers present on expenses
SELECT tgname FROM pg_trigger WHERE tgrelid = 'expenses'::regclass AND NOT tgisinternal ORDER BY tgname;

-- Verify: a grandfathered (pre-FY) row can still be freely edited with
-- null approver/payer — spot check against a known historical row.
SELECT count(*) AS pre_fy_paid_rows_with_null_approver
FROM expenses
WHERE payment_state = 'paid'
  AND finance_approved_by IS NULL
  AND fiscal_period_for_date(date) IS DISTINCT FROM (SELECT id FROM fiscal_periods WHERE is_current);

-- Verify: payment_status sync applies to ALL paid rows, including
-- grandfathered ones — should return 0.
SELECT count(*) AS paid_rows_with_stale_payment_status
FROM expenses
WHERE payment_state = 'paid' AND payment_status IS DISTINCT FROM true;
