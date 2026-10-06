-- Payments in parts.
--
-- Until now an expense was paid in one go. "Pay part" (migrations 164–174)
-- cut the expense in two: the paid share kept the code, the rest became a
-- new expense — so a bill paid 30 / 60 / 10 turned into three expenses, the
-- history of what was paid against the bill lived nowhere, and the one split
-- ever made left its remainder stuck out of the To Pay queue.
--
-- Now one expense carries many payments (expense_payments):
--
--   the plan        parts that add up to the bill (amount − vendor credit).
--                   Each part has a kind (advance, installment, on delivery,
--                   final, retention), and is due now, on a date, or on
--                   delivery (a GRN on the purchase order, plus some days)
--   approval        once, on the expense. Finance approves the whole bill;
--                   each part only needs a payer who is not the approver.
--                   The parts can never add up to more than the bill
--   withholding     a choice per bill (wht_mode): all of it from the last
--                   part (the default — the earlier parts go out in full),
--                   or a share from each part in proportion to its size
--   each part       planned → sent (payer, method, account) → paid (matched
--                   to a bank line, or cash confirmed). Paying less than a
--                   part splits it; the rest stays planned
--   the books       each paid part posts its own entry (source
--                   expense_payments): it clears what was owed when the bill
--                   was recorded at approval, else it is the cost itself.
--                   The expense's own whole-payment posting stays out of it
--   the expense     keeps its full amount; paid_to_date_etb and the balance
--                   follow the parts, and it turns paid when the last is
--   PRQs            one per part, each showing the parts before it and the
--                   balance after
--   purchase orders can carry a plan in percent (payment_plan); the PO's
--                   expense gets its parts from it
--   VRF payments    stay as they are — they are paid through their VRF
--
-- The one old split (GEN-FUEL-20260801-01 + its remainder) is folded back
-- into a single expense with two parts.

-- ── Columns ─────────────────────────────────────────────────────────────────
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS in_parts boolean NOT NULL DEFAULT false;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS paid_to_date_etb numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS wht_mode text NOT NULL DEFAULT 'last';
ALTER TABLE sourcing_bundles ADD COLUMN IF NOT EXISTS payment_plan jsonb;
ALTER TABLE sourcing_bundles ADD COLUMN IF NOT EXISTS plan_wht_mode text NOT NULL DEFAULT 'last';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_wht_mode_check') THEN
    ALTER TABLE expenses ADD CONSTRAINT expenses_wht_mode_check CHECK (wht_mode IN ('last', 'each'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sourcing_bundles_plan_wht_mode_check') THEN
    ALTER TABLE sourcing_bundles ADD CONSTRAINT sourcing_bundles_plan_wht_mode_check CHECK (plan_wht_mode IN ('last', 'each'));
  END IF;
END $$;

COMMENT ON COLUMN expenses.in_parts IS 'Paid in parts: its payments are the rows of expense_payments (migration 430)';
COMMENT ON COLUMN expenses.paid_to_date_etb IS 'Gross paid so far across its paid parts (withholding included)';
COMMENT ON COLUMN expenses.wht_mode IS 'Paid in parts: withholding taken all from the last part (last) or a share from each part (each)';
COMMENT ON COLUMN sourcing_bundles.plan_wht_mode IS 'The withholding choice its expense takes with the plan (last | each)';
COMMENT ON COLUMN sourcing_bundles.payment_plan IS 'Payment plan in percent: [{pct, kind, due_on: now|date|delivery, days, label}] (migration 430)';

CREATE TABLE IF NOT EXISTS expense_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES expenses(id) ON DELETE RESTRICT,
  seq integer NOT NULL,
  kind text NOT NULL DEFAULT 'installment'
    CHECK (kind IN ('advance', 'installment', 'on_delivery', 'final', 'retention')),
  label text,
  amount_etb numeric(14,2) NOT NULL CHECK (amount_etb > 0),
  wht_etb numeric(14,2) NOT NULL DEFAULT 0 CHECK (wht_etb >= 0),
  cash_etb numeric(14,2) GENERATED ALWAYS AS (amount_etb - wht_etb) STORED,
  due_on text NOT NULL DEFAULT 'date' CHECK (due_on IN ('now', 'date', 'delivery')),
  due_date date,
  due_days integer CHECK (due_days IS NULL OR due_days >= 0),
  state text NOT NULL DEFAULT 'planned' CHECK (state IN ('planned', 'sent', 'paid', 'cancelled')),
  payment_method text,
  account_id uuid REFERENCES accounts(id),
  disbursed_by uuid REFERENCES user_profiles(id),
  bank_ref text,
  transfer_id uuid REFERENCES transfers(id),
  sent_at timestamptz,
  paid_date date,
  confirmed_by uuid REFERENCES user_profiles(id),
  legacy_entry boolean NOT NULL DEFAULT false,
  note text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expense_payments_wht_le_amount CHECK (wht_etb <= amount_etb),
  CONSTRAINT expense_payments_seq_key UNIQUE (expense_id, seq) DEFERRABLE INITIALLY IMMEDIATE
);
COMMENT ON TABLE expense_payments IS 'The parts an expense is paid in (migration 430). Written only through the RPCs.';
COMMENT ON COLUMN expense_payments.legacy_entry IS 'Paid before parts existed; already in the books under the expense itself, so it posts nothing of its own';

CREATE INDEX IF NOT EXISTS expense_payments_expense_idx ON expense_payments (expense_id, seq);
CREATE INDEX IF NOT EXISTS expense_payments_transfer_idx ON expense_payments (transfer_id) WHERE transfer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS expense_payments_open_idx ON expense_payments (state) WHERE state IN ('planned', 'sent');

ALTER TABLE expense_payments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'expense_payments' AND policyname = 'ep_read') THEN
    -- Whoever can see the expense can see how it is being paid.
    CREATE POLICY ep_read ON expense_payments FOR SELECT
      USING (EXISTS (SELECT 1 FROM expenses e WHERE e.id = expense_payments.expense_id));
  END IF;
END $$;
GRANT SELECT ON expense_payments TO authenticated;

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON expense_payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS expense_payment_id uuid REFERENCES expense_payments(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS payment_requests_expense_payment_idx ON payment_requests (expense_payment_id) WHERE expense_payment_id IS NOT NULL;

INSERT INTO notification_kinds (kind, grp, label, description, default_priority, sort_order) VALUES
  ('expense.part_paid', 'Expenses', 'Part of your expense was paid', 'Bills paid in parts: each part as it is confirmed', 'normal', 16)
ON CONFLICT (kind) DO NOTHING;

-- ── Helpers ─────────────────────────────────────────────────────────────────
-- What the parts must add up to: the bill, less any vendor credit already
-- applied (money the vendor holds). Withholding is inside it — it is taken
-- from the last part.
CREATE OR REPLACE FUNCTION expense_parts_payable(e expenses)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT round(COALESCE(e.amount_etb, 0) - COALESCE(e.credit_applied_etb, 0), 2)
$$;

CREATE OR REPLACE FUNCTION expense_part_position(p_id uuid, OUT part_no integer, OUT part_count integer)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT (SELECT count(*) FROM expense_payments q WHERE q.expense_id = p.expense_id AND q.state <> 'cancelled' AND q.seq <= p.seq)::int,
         (SELECT count(*) FROM expense_payments q WHERE q.expense_id = p.expense_id AND q.state <> 'cancelled')::int
    FROM expense_payments p WHERE p.id = p_id
$$;

CREATE OR REPLACE FUNCTION expense_parts_grn_date(p_expense_id uuid)
RETURNS date LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT min(g.received_at)::date
    FROM expenses e JOIN goods_received_notes g ON g.sourcing_bundle_id = e.sourcing_bundle_id
   WHERE e.id = p_expense_id
$$;

-- Which expenses can be paid in parts: everything but VRF payments, batch
-- members and archived or void bills.
CREATE OR REPLACE FUNCTION expense_parts_check_open(e expenses)
RETURNS void LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF e.id IS NULL THEN RAISE EXCEPTION 'Expense not found'; END IF;
  IF COALESCE(e.is_archived, false) OR e.payment_state = 'void' THEN
    RAISE EXCEPTION '% is archived or void', COALESCE(e.expense_code, 'This expense');
  END IF;
  IF e.expense_type = 'vrf' OR e.vendor_receipt_facilitation_id IS NOT NULL OR e.payment_method = 'vrf' THEN
    RAISE EXCEPTION 'A VRF payment is paid through its VRF, not in parts';
  END IF;
  IF EXISTS (SELECT 1 FROM batch_payment_expenses WHERE expense_id = e.id) THEN
    RAISE EXCEPTION '% is in a batch payment — take it out of the batch to pay it in parts', COALESCE(e.expense_code, 'This expense');
  END IF;
END $$;

-- ── Keeping the expense in step with its parts ──────────────────────────────
-- The parts always add up to the bill: when the bill changes (a GRN short,
-- withholding recorded, vendor credit applied) the last planned part takes
-- the difference. Withholding sits on the last planned part, or is shared
-- across the planned parts by size (wht_mode = 'each'). The expense's
-- paid-to-date, partially-paid flag and payment state follow the parts.
CREATE OR REPLACE FUNCTION expense_parts_refresh(p_expense_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e expenses%ROWTYPE;
  v_prev_sync text := COALESCE(current_setting('kuncho.parts_sync', true), 'off');
  v_prev_admin text := COALESCE(current_setting('kuncho.expense_admin_op', true), 'off');
  v_any boolean; v_total numeric; v_sum numeric; v_last expense_payments%ROWTYPE;
  v_wht_taken numeric; v_wht_left numeric; v_paid numeric; v_open integer;
  v_state text; v_lp expense_payments%ROWTYPE; v_partial boolean;
  v_plan_sum numeric; v_acc numeric := 0; v_w numeric; r record;
BEGIN
  SELECT * INTO e FROM expenses WHERE id = p_expense_id FOR UPDATE;
  IF e.id IS NULL THEN RETURN; END IF;
  v_any := EXISTS (SELECT 1 FROM expense_payments WHERE expense_id = p_expense_id AND state <> 'cancelled');
  PERFORM set_config('kuncho.parts_sync', 'on', true);

  IF NOT v_any THEN
    UPDATE expenses SET in_parts = false, paid_to_date_etb = 0, partially_paid = false
     WHERE id = p_expense_id AND (in_parts OR paid_to_date_etb <> 0);
    PERFORM set_config('kuncho.parts_sync', v_prev_sync, true);
    RETURN;
  END IF;

  v_total := expense_parts_payable(e);
  SELECT COALESCE(sum(amount_etb), 0) INTO v_sum FROM expense_payments WHERE expense_id = p_expense_id AND state <> 'cancelled';
  SELECT * INTO v_last FROM expense_payments WHERE expense_id = p_expense_id AND state = 'planned' ORDER BY seq DESC LIMIT 1;
  IF abs(v_sum - v_total) >= 0.005 THEN
    IF v_last.id IS NULL OR v_last.amount_etb + (v_total - v_sum) <= 0 THEN
      RAISE EXCEPTION 'The bill is now % but its parts add up to % — change the payment plan to match', v_total, v_sum;
    END IF;
    UPDATE expense_payments SET amount_etb = amount_etb + (v_total - v_sum) WHERE id = v_last.id;
  END IF;

  SELECT COALESCE(sum(wht_etb), 0) INTO v_wht_taken FROM expense_payments WHERE expense_id = p_expense_id AND state IN ('sent', 'paid');
  v_wht_left := GREATEST(COALESCE(e.wht_amount, 0) - v_wht_taken, 0);
  IF v_last.id IS NOT NULL AND e.wht_mode = 'each' THEN
    -- A share from each planned part, by size; the last takes the rounding.
    SELECT COALESCE(sum(amount_etb), 0) INTO v_plan_sum FROM expense_payments WHERE expense_id = p_expense_id AND state = 'planned';
    FOR r IN SELECT id, amount_etb, wht_etb FROM expense_payments
              WHERE expense_id = p_expense_id AND state = 'planned' ORDER BY seq LOOP
      v_w := CASE WHEN r.id = v_last.id THEN v_wht_left - v_acc
                  ELSE round(v_wht_left * r.amount_etb / NULLIF(v_plan_sum, 0), 2) END;
      v_acc := v_acc + v_w;
      IF v_w > r.amount_etb THEN
        RAISE EXCEPTION 'The withholding share (%) is more than its part (%)', v_w, r.amount_etb;
      END IF;
      UPDATE expense_payments SET wht_etb = v_w WHERE id = r.id AND wht_etb <> v_w;
    END LOOP;
  ELSE
  UPDATE expense_payments SET wht_etb = 0
   WHERE expense_id = p_expense_id AND state = 'planned' AND wht_etb <> 0 AND id IS DISTINCT FROM v_last.id;
  IF v_last.id IS NOT NULL THEN
    SELECT * INTO v_last FROM expense_payments WHERE id = v_last.id;
    IF v_wht_left > v_last.amount_etb THEN
      RAISE EXCEPTION 'The withholding (%) is more than the last part (%) — make the last part bigger', v_wht_left, v_last.amount_etb;
    END IF;
    UPDATE expense_payments SET wht_etb = v_wht_left WHERE id = v_last.id AND wht_etb <> v_wht_left;
  ELSIF abs(COALESCE(e.wht_amount, 0) - v_wht_taken) >= 0.005 THEN
    RAISE EXCEPTION 'Every part is already sent, so the withholding can no longer change (% withheld, now %)', v_wht_taken, COALESCE(e.wht_amount, 0);
  END IF;
  END IF;

  SELECT COALESCE(sum(amount_etb) FILTER (WHERE state = 'paid'), 0), count(*) FILTER (WHERE state IN ('planned', 'sent'))
    INTO v_paid, v_open FROM expense_payments WHERE expense_id = p_expense_id AND state <> 'cancelled';
  SELECT * INTO v_lp FROM expense_payments WHERE expense_id = p_expense_id AND state = 'paid'
   ORDER BY paid_date DESC NULLS LAST, seq DESC LIMIT 1;
  v_partial := v_paid > 0 AND v_open > 0;
  v_state := CASE
    WHEN v_open = 0 THEN 'paid'
    WHEN e.payment_state = 'paid' THEN CASE WHEN e.finance_approved_by IS NOT NULL THEN 'approved_to_pay' ELSE 'unpaid' END
    ELSE e.payment_state END;
  IF e.payment_state = 'paid' AND v_state <> 'paid' THEN
    PERFORM set_config('kuncho.expense_admin_op', 'on', true);
  END IF;

  UPDATE expenses SET
    in_parts = true,
    paid_to_date_etb = v_paid,
    partially_paid = v_partial,
    partial_paid_amount = CASE WHEN v_partial THEN v_paid END,
    payment_state = v_state,
    paid_date = CASE WHEN v_state = 'paid' THEN v_lp.paid_date::timestamptz END,
    total_payment_date = CASE WHEN v_state = 'paid' THEN v_lp.paid_date END,
    disbursed_by = CASE WHEN v_state = 'paid' THEN COALESCE(v_lp.disbursed_by, disbursed_by) ELSE disbursed_by END,
    payment_method = COALESCE(v_lp.payment_method, payment_method),
    account_id = COALESCE(account_id, v_lp.account_id)
  WHERE id = p_expense_id
    AND (NOT in_parts OR paid_to_date_etb IS DISTINCT FROM v_paid OR partially_paid IS DISTINCT FROM v_partial
         OR payment_state IS DISTINCT FROM v_state
         OR (v_state = 'paid' AND paid_date IS DISTINCT FROM v_lp.paid_date::timestamptz)
         OR (v_state <> 'paid' AND paid_date IS NOT NULL)
         OR payment_method IS DISTINCT FROM COALESCE(v_lp.payment_method, payment_method)
         OR (account_id IS NULL AND v_lp.account_id IS NOT NULL));

  PERFORM set_config('kuncho.expense_admin_op', v_prev_admin, true);
  PERFORM set_config('kuncho.parts_sync', v_prev_sync, true);
END $$;

-- Columns only the parts may move; and an expense in parts is paid through
-- its parts, never whole.
CREATE OR REPLACE FUNCTION guard_expense_parts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sync boolean := COALESCE(current_setting('kuncho.parts_sync', true), '') = 'on';
BEGIN
  IF NOT v_sync AND (NEW.in_parts IS DISTINCT FROM OLD.in_parts OR NEW.paid_to_date_etb IS DISTINCT FROM OLD.paid_to_date_etb) THEN
    RAISE EXCEPTION 'Payments in parts follow the payment plan — change the plan, not the expense';
  END IF;
  IF NEW.in_parts AND NOT v_sync AND NEW.payment_state IS DISTINCT FROM OLD.payment_state
     AND (NEW.payment_state IN ('sent', 'paid', 'advance') OR OLD.payment_state = 'paid') THEN
    RAISE EXCEPTION '% is paid in parts — pay, confirm or reverse its parts instead', COALESCE(NEW.expense_code, 'This expense');
  END IF;
  IF NEW.in_parts THEN
    NEW.payment_status := (NEW.payment_state = 'paid');
    IF NEW.payment_state IS DISTINCT FROM OLD.payment_state THEN
      NEW.payment_state_changed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER trg_guard_expense_parts BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION guard_expense_parts();

-- The whole-payment lifecycle and posting are for expenses paid in one go.
CREATE OR REPLACE TRIGGER trg_enforce_expense_payment_lifecycle
  BEFORE INSERT OR UPDATE OF payment_state, payment_status, finance_approved_by, disbursed_by ON expenses
  FOR EACH ROW WHEN (NOT NEW.in_parts) EXECUTE FUNCTION enforce_expense_payment_lifecycle();
CREATE OR REPLACE TRIGGER trg_post_expense_payment_to_ledger
  AFTER INSERT OR UPDATE OF payment_state ON expenses
  FOR EACH ROW WHEN (NOT NEW.in_parts) EXECUTE FUNCTION post_expense_payment_to_ledger();

-- The bill changed: the plan follows.
CREATE OR REPLACE FUNCTION trg_expense_parts_follow_bill()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.amount_etb IS DISTINCT FROM OLD.amount_etb OR NEW.wht_amount IS DISTINCT FROM OLD.wht_amount
     OR NEW.credit_applied_etb IS DISTINCT FROM OLD.credit_applied_etb OR NEW.wht_mode IS DISTINCT FROM OLD.wht_mode THEN
    PERFORM expense_parts_refresh(NEW.id);
  END IF;
  RETURN NULL;
END $$;
CREATE OR REPLACE TRIGGER trg_expense_parts_follow_bill
  AFTER UPDATE OF amount_etb, wht_amount, credit_applied_etb, wht_mode ON expenses
  FOR EACH ROW WHEN (NEW.in_parts) EXECUTE FUNCTION trg_expense_parts_follow_bill();

-- An expense in parts cannot join a batch wire.
CREATE OR REPLACE FUNCTION guard_batch_parts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM expenses WHERE id = NEW.expense_id AND in_parts) THEN
    RAISE EXCEPTION '% is paid in parts — pay its parts on their own, not in a batch',
      COALESCE((SELECT expense_code FROM expenses WHERE id = NEW.expense_id), 'This expense');
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER trg_guard_batch_parts BEFORE INSERT OR UPDATE OF expense_id ON batch_payment_expenses
  FOR EACH ROW EXECUTE FUNCTION guard_batch_parts();

-- ── Posting each part ───────────────────────────────────────────────────────
-- A paid part clears its share of what was owed when the bill was recorded
-- at approval. A bill already paid the old way (cash basis, posted under the
-- expense) takes its later parts as cost directly. A bill from an earlier
-- year posts no payments here, the same as a whole payment. Idempotent: it
-- re-derives the part's entry, and a part that is no longer paid is
-- reversed.
CREATE OR REPLACE FUNCTION expense_part_post(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p expense_payments%ROWTYPE; e expenses%ROWTYPE;
  v_lines jsonb := '[]'::jsonb; v_cash uuid; v_label text; v_adv_staff uuid;
  v_accrued boolean; v_legacy boolean; v_cost uuid; v_pos record; v_desc text;
BEGIN
  SELECT * INTO p FROM expense_payments WHERE id = p_id;
  IF p.id IS NULL THEN RETURN; END IF;
  SELECT * INTO e FROM expenses WHERE id = p.expense_id;
  SELECT * INTO v_pos FROM expense_part_position(p.id);
  v_desc := format('Part %s of %s paid: %s', v_pos.part_no, v_pos.part_count, COALESCE(e.expense_code, e.id::text));

  IF p.state = 'paid' AND NOT p.legacy_entry THEN
    v_accrued := EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'expense_accrual' AND source_id = e.id);
    v_legacy  := EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'expenses' AND source_id = e.id);
    IF NOT v_accrued AND NOT v_legacy THEN
      PERFORM sync_expense_accrual(e.id);
      v_accrued := EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'expense_accrual' AND source_id = e.id);
    END IF;

    SELECT ca.staff_id INTO v_adv_staff
      FROM cash_advance_expenses x JOIN cash_advances ca ON ca.id = x.cash_advance_id
     WHERE x.expense_id = e.id LIMIT 1;
    IF v_adv_staff IS NOT NULL THEN
      v_cash := coa_id('staff_advances');
      v_label := 'the cash advance to ' || COALESCE(ledger_party_name('staff', v_adv_staff), 'a staff member');
    ELSE
      SELECT c.id INTO v_cash FROM chart_of_accounts c WHERE c.linked_account_id = COALESCE(p.account_id, e.account_id);
      IF v_cash IS NULL AND p.payment_method = 'cash' THEN v_cash := coa_id('cash_on_hand'); END IF;
      v_label := COALESCE((SELECT account_name FROM accounts WHERE id = COALESCE(p.account_id, e.account_id)),
                          (SELECT account_name FROM chart_of_accounts WHERE id = v_cash), 'cash');
    END IF;
    IF p.cash_etb > 0 AND v_cash IS NULL THEN
      PERFORM log_posting_failure('expense_payments', p.id,
        format('Cannot post %s: no bank or cash account on the part (account_id=%s)', v_desc, COALESCE(p.account_id, e.account_id)));
      RETURN;
    END IF;

    IF v_accrued THEN
      v_lines := jsonb_build_array(ledger_line(expense_payable_account(e.expense_type), p.amount_etb,
                   format('Clears part %s of %s of what was owed', v_pos.part_no, v_pos.part_count),
                   e.project_id, e.vendor_id, NULL, e.paid_to_staff_id));
    ELSIF v_legacy OR in_current_fy(e.date) THEN
      v_cost := expense_cost_account(e.id);
      IF v_cost IS NULL THEN
        PERFORM log_posting_failure('expense_payments', p.id,
          format('Cannot post %s: its General Ledger (category %s) has no account in the chart', v_desc, e.category_id));
        RETURN;
      END IF;
      v_lines := expense_cost_lines(e, v_cost, p.amount_etb,
                   format('%s (part %s of %s)', COALESCE(e.item_service_description, ''), v_pos.part_no, v_pos.part_count));
    END IF;

    IF jsonb_array_length(v_lines) > 0 THEN
      IF p.cash_etb > 0 THEN
        v_lines := v_lines || jsonb_build_array(ledger_line(v_cash, -p.cash_etb, 'Paid via ' || v_label, NULL, NULL, NULL, v_adv_staff));
      END IF;
      IF p.wht_etb > 0 THEN
        v_lines := v_lines || jsonb_build_array(ledger_line(coa_id('wht_payable'), -p.wht_etb,
                     'Withholding tax withheld from this part, owed to the tax authority'));
      END IF;
    END IF;
  END IF;

  PERFORM ledger_sync('expense_payments', p.id, COALESCE(p.paid_date, CURRENT_DATE), v_desc, v_lines);
EXCEPTION WHEN OTHERS THEN
  PERFORM log_posting_failure('expense_payments', p_id, SQLERRM);
END $$;

CREATE OR REPLACE FUNCTION trg_expense_part_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e expenses%ROWTYPE; v_req uuid; v_pos record;
BEGIN
  PERFORM expense_part_post(NEW.id);
  -- Cancelling happens only while a plan is replaced, which refreshes once
  -- the new parts are in.
  IF TG_OP = 'UPDATE' AND NEW.state IS DISTINCT FROM OLD.state AND NEW.state <> 'cancelled' THEN
    PERFORM expense_parts_refresh(NEW.expense_id);
    IF NEW.state = 'paid' AND NOT NEW.legacy_entry THEN
      SELECT * INTO e FROM expenses WHERE id = NEW.expense_id;
      v_req := e.purchaser_user_id;
      IF v_req IS NULL AND e.sourcing_bundle_id IS NOT NULL THEN
        SELECT procurement_officer_id INTO v_req FROM sourcing_bundles WHERE id = e.sourcing_bundle_id;
      END IF;
      SELECT * INTO v_pos FROM expense_part_position(NEW.id);
      IF e.payment_state <> 'paid' THEN
        PERFORM notify(ARRAY[v_req], 'expense.part_paid',
          format('Part %s of %s paid', v_pos.part_no, v_pos.part_count),
          concat_ws(' · ', e.expense_code, notify_short(e.item_service_description, 60), notify_etb(NEW.cash_etb))
            || format(' — %s still to pay.', notify_etb(expense_parts_payable(e) - e.paid_to_date_etb)),
          '/expenses/' || e.id, 'expense', e.id);
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END $$;
-- transfer_id is listed because an unmatch sets only it; the BEFORE trigger
-- below then moves the state, which UPDATE OF does not see.
CREATE OR REPLACE TRIGGER trg_expense_part_changed
  AFTER INSERT OR UPDATE OF state, amount_etb, wht_etb, paid_date, account_id, payment_method, transfer_id ON expense_payments
  FOR EACH ROW EXECUTE FUNCTION trg_expense_part_changed();

-- A bank match taken off (unmatch_bank_line) puts the part back to sent.
CREATE OR REPLACE FUNCTION trg_expense_part_unmatched()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.transfer_id IS NOT NULL AND NEW.transfer_id IS NULL AND NEW.state = 'paid' THEN
    NEW.state := 'sent'; NEW.paid_date := NULL; NEW.confirmed_by := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER trg_expense_part_unmatched BEFORE UPDATE OF transfer_id ON expense_payments
  FOR EACH ROW EXECUTE FUNCTION trg_expense_part_unmatched();

CREATE OR REPLACE TRIGGER trg_guard_closed_bank_match BEFORE UPDATE OF transfer_id ON expense_payments
  FOR EACH ROW EXECUTE FUNCTION guard_closed_bank_match();

-- ── Planning ────────────────────────────────────────────────────────────────
-- Replaces the planned (unsent) parts. Parts already sent or paid stay; the
-- new parts come after them and, together, must add up to the bill. An empty
-- list drops the plan (only while nothing is sent or paid).
CREATE OR REPLACE FUNCTION expense_parts_replace_plan(p_expense_id uuid, p_parts jsonb, p_wht_mode text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e expenses%ROWTYPE; v_total numeric; v_kept numeric; v_new numeric := 0;
  v_seq integer; x jsonb; v_amt numeric; v_due text; v_kind text;
BEGIN
  SELECT * INTO e FROM expenses WHERE id = p_expense_id FOR UPDATE;
  PERFORM expense_parts_check_open(e);
  IF NOT e.in_parts AND e.payment_state IN ('sent', 'advance', 'paid') THEN
    RAISE EXCEPTION '% was already paid or sent in one go — confirm or reverse that payment first', COALESCE(e.expense_code, 'This expense');
  END IF;
  IF jsonb_typeof(COALESCE(p_parts, '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'The plan must be a list of parts'; END IF;
  IF p_wht_mode IS NOT NULL AND p_wht_mode NOT IN ('last', 'each') THEN
    RAISE EXCEPTION 'Withholding is taken from the last part (last) or from each part (each), not %', p_wht_mode;
  END IF;
  IF p_wht_mode IS NOT NULL AND p_wht_mode IS DISTINCT FROM e.wht_mode
     AND EXISTS (SELECT 1 FROM expense_payments WHERE expense_id = p_expense_id AND state IN ('sent', 'paid') AND wht_etb > 0) THEN
    RAISE EXCEPTION 'Withholding has already been taken from a sent part — the choice can no longer change';
  END IF;

  v_total := expense_parts_payable(e);
  SELECT COALESCE(sum(amount_etb), 0) INTO v_kept FROM expense_payments WHERE expense_id = p_expense_id AND state IN ('sent', 'paid');

  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p_parts, '[]'::jsonb)) LOOP
    v_amt := round((x->>'amount')::numeric, 2);
    v_due := COALESCE(NULLIF(x->>'due_on', ''), 'date');
    v_kind := COALESCE(NULLIF(x->>'kind', ''), 'installment');
    IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'Every part needs an amount above 0'; END IF;
    IF v_due NOT IN ('now', 'date', 'delivery') THEN RAISE EXCEPTION 'Unknown due rule %', v_due; END IF;
    IF v_kind NOT IN ('advance', 'installment', 'on_delivery', 'final', 'retention') THEN RAISE EXCEPTION 'Unknown kind of part %', v_kind; END IF;
    IF v_due = 'delivery' AND e.sourcing_bundle_id IS NULL THEN
      RAISE EXCEPTION 'Only a purchase order has a delivery to pay on — give this part a date';
    END IF;
    v_new := v_new + v_amt;
  END LOOP;

  IF jsonb_array_length(COALESCE(p_parts, '[]'::jsonb)) = 0 THEN
    IF v_kept > 0 THEN
      RAISE EXCEPTION 'Some parts are already sent or paid — the rest of the bill (%) still needs parts', v_total - v_kept;
    END IF;
  ELSIF abs(v_kept + v_new - v_total) >= 0.01 THEN
    RAISE EXCEPTION 'The parts add up to % but the bill is % %', v_kept + v_new, v_total,
      CASE WHEN v_kept > 0 THEN format('(%s already sent or paid)', v_kept) ELSE '' END;
  END IF;

  -- The planned parts being replaced are kept, cancelled: a Payment Request
  -- may point at one, and the plan's history stays readable.
  UPDATE expense_payments p SET state = 'cancelled', note = concat_ws(E'\n', NULLIF(p.note, ''), 'Replaced by a new payment plan')
   WHERE p.expense_id = p_expense_id AND p.state = 'planned';

  SELECT COALESCE(max(seq), 0) INTO v_seq FROM expense_payments WHERE expense_id = p_expense_id;
  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p_parts, '[]'::jsonb)) LOOP
    v_seq := v_seq + 1;
    INSERT INTO expense_payments (expense_id, seq, kind, label, amount_etb, due_on, due_date, due_days, note)
    VALUES (p_expense_id, v_seq, COALESCE(NULLIF(x->>'kind', ''), 'installment'), NULLIF(btrim(x->>'label'), ''),
            round((x->>'amount')::numeric, 2), COALESCE(NULLIF(x->>'due_on', ''), 'date'),
            NULLIF(x->>'due_date', '')::date, NULLIF(x->>'days', '')::integer, NULLIF(btrim(x->>'note'), ''));
  END LOOP;

  -- After the new parts are in, so the sum already matches the bill.
  IF p_wht_mode IS NOT NULL AND p_wht_mode IS DISTINCT FROM e.wht_mode THEN
    UPDATE expenses SET wht_mode = p_wht_mode WHERE id = p_expense_id;
  END IF;
  PERFORM expense_parts_refresh(p_expense_id);
END $$;

CREATE OR REPLACE FUNCTION set_expense_payment_plan(p_expense_id uuid, p_parts jsonb, p_wht_mode text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can plan how a bill is paid';
  END IF;
  PERFORM expense_parts_replace_plan(p_expense_id, p_parts, p_wht_mode);
END $$;

-- ── Paying ──────────────────────────────────────────────────────────────────
-- Sends one planned part. Less than the part splits it: this much goes now,
-- the rest stays planned right after it.
CREATE OR REPLACE FUNCTION pay_expense_part(
  p_payment_id uuid, p_disbursed_by uuid, p_method text, p_account_id uuid DEFAULT NULL,
  p_amount numeric DEFAULT NULL, p_bank_ref text DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p expense_payments%ROWTYPE; e expenses%ROWTYPE; v_rest numeric;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can pay a bill';
  END IF;
  SELECT * INTO p FROM expense_payments WHERE id = p_payment_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Payment part not found'; END IF;
  IF p.state <> 'planned' THEN RAISE EXCEPTION 'This part is already %', p.state; END IF;
  SELECT * INTO e FROM expenses WHERE id = p.expense_id FOR UPDATE;
  PERFORM expense_parts_check_open(e);

  IF e.approval_status::text <> 'finance_approved' OR e.finance_approved_by IS NULL THEN
    RAISE EXCEPTION 'Finance approves the whole bill first — then its parts can be paid';
  END IF;
  IF p_disbursed_by IS NULL THEN RAISE EXCEPTION 'Pick who is paying this part'; END IF;
  IF p_disbursed_by = e.finance_approved_by THEN
    RAISE EXCEPTION 'The person who approved the bill cannot also pay it — pick someone else';
  END IF;
  IF COALESCE((SELECT role::text FROM user_profiles WHERE id = p_disbursed_by), '') NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'The payer must be an admin or finance user';
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('transfer', 'cpo', 'cheque', 'cash', 'other') THEN
    RAISE EXCEPTION 'Pick how this part is paid (transfer, CPO, cheque, cash or other)';
  END IF;
  IF p_method IN ('transfer', 'cpo', 'cheque') AND COALESCE(p_account_id, e.account_id) IS NULL THEN
    RAISE EXCEPTION 'Pick the account this part is paid from';
  END IF;
  IF p.due_on = 'delivery' AND e.sourcing_bundle_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM goods_received_notes g WHERE g.sourcing_bundle_id = e.sourcing_bundle_id) THEN
    RAISE EXCEPTION 'This part is due on delivery — record the GRN first';
  END IF;

  IF p_amount IS NOT NULL AND round(p_amount, 2) > p.amount_etb THEN
    RAISE EXCEPTION 'That is more than this part (%) — change the plan to pay more now', p.amount_etb;
  END IF;
  IF p_amount IS NOT NULL AND round(p_amount, 2) <= 0 THEN RAISE EXCEPTION 'Pay more than 0'; END IF;
  IF p_amount IS NOT NULL AND round(p_amount, 2) < p.amount_etb THEN
    v_rest := p.amount_etb - round(p_amount, 2);
    UPDATE expense_payments SET seq = seq + 1 WHERE expense_id = p.expense_id AND seq > p.seq;
    INSERT INTO expense_payments (expense_id, seq, kind, label, amount_etb, due_on, due_date, due_days, note)
    VALUES (p.expense_id, p.seq + 1, p.kind, p.label, v_rest, p.due_on, p.due_date, p.due_days,
            format('The rest of a part paid short (%s of %s)', round(p_amount, 2), p.amount_etb));
    UPDATE expense_payments SET amount_etb = round(p_amount, 2) WHERE id = p.id;
  END IF;

  -- Places the withholding: on this part only if it is the last.
  PERFORM expense_parts_refresh(p.expense_id);
  SELECT * INTO p FROM expense_payments WHERE id = p_payment_id;
  IF p.cash_etb < 0 THEN RAISE EXCEPTION 'The withholding is more than this part'; END IF;

  UPDATE expense_payments SET
    state = 'sent', disbursed_by = p_disbursed_by, payment_method = p_method,
    account_id = COALESCE(p_account_id, e.account_id), bank_ref = NULLIF(btrim(p_bank_ref), ''),
    sent_at = now(), note = COALESCE(NULLIF(btrim(p_note), ''), note)
  WHERE id = p.id;
  RETURN p.id;
END $$;

-- Pay an amount now against a bill: starts a plan when there is none (this
-- much now, the rest as the final part), else pays the next planned part —
-- splitting it when the amount is less.
CREATE OR REPLACE FUNCTION pay_expense_amount(
  p_expense_id uuid, p_amount numeric, p_disbursed_by uuid, p_method text,
  p_account_id uuid DEFAULT NULL, p_bank_ref text DEFAULT NULL, p_note text DEFAULT NULL, p_wht_mode text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e expenses%ROWTYPE; v_total numeric; v_next uuid;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can pay a bill';
  END IF;
  SELECT * INTO e FROM expenses WHERE id = p_expense_id;
  PERFORM expense_parts_check_open(e);
  IF p_amount IS NULL OR round(p_amount, 2) <= 0 THEN RAISE EXCEPTION 'Pay more than 0'; END IF;
  IF NOT e.in_parts THEN
    v_total := expense_parts_payable(e);
    IF round(p_amount, 2) >= v_total THEN
      RAISE EXCEPTION 'That is the whole bill (%) — pay it the usual way', v_total;
    END IF;
    PERFORM expense_parts_replace_plan(p_expense_id, jsonb_build_array(
      jsonb_build_object('amount', round(p_amount, 2), 'kind', 'installment', 'due_on', 'now'),
      jsonb_build_object('amount', v_total - round(p_amount, 2), 'kind', 'final', 'due_on', 'date')), p_wht_mode);
  END IF;
  SELECT id INTO v_next FROM expense_payments WHERE expense_id = p_expense_id AND state = 'planned' ORDER BY seq LIMIT 1;
  IF v_next IS NULL THEN RAISE EXCEPTION 'Every part of this bill is already sent or paid'; END IF;
  RETURN pay_expense_part(v_next, p_disbursed_by, p_method, p_account_id, p_amount, p_bank_ref, p_note);
END $$;

CREATE OR REPLACE FUNCTION confirm_expense_part_cash(p_payment_id uuid, p_paid_date date DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p expense_payments%ROWTYPE;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can confirm a payment';
  END IF;
  SELECT * INTO p FROM expense_payments WHERE id = p_payment_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Payment part not found'; END IF;
  IF p.state <> 'sent' THEN RAISE EXCEPTION 'Only a sent part can be confirmed (this one is %)', p.state; END IF;
  IF p.payment_method IN ('transfer', 'cpo', 'cheque') THEN
    RAISE EXCEPTION 'A % part is confirmed by matching it to a bank statement line', p.payment_method;
  END IF;
  UPDATE expense_payments SET state = 'paid', paid_date = COALESCE(p_paid_date, CURRENT_DATE), confirmed_by = auth.uid()
   WHERE id = p.id;
END $$;

CREATE OR REPLACE FUNCTION match_expense_part_to_transfer(p_payment_id uuid, p_transfer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p expense_payments%ROWTYPE; t transfers%ROWTYPE;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can match a payment to a bank line';
  END IF;
  SELECT * INTO p FROM expense_payments WHERE id = p_payment_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Payment part not found'; END IF;
  IF p.state <> 'sent' THEN RAISE EXCEPTION 'Only a sent part can be matched to a bank line (this one is %)', p.state; END IF;
  SELECT * INTO t FROM transfers WHERE id = p_transfer_id;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Bank line not found'; END IF;
  UPDATE expense_payments SET
    transfer_id = t.id, state = 'paid', paid_date = COALESCE(t.date, CURRENT_DATE),
    account_id = COALESCE(account_id, t.from_account_id), confirmed_by = auth.uid()
  WHERE id = p.id;
END $$;

-- Undo a part sent by mistake (not yet confirmed).
CREATE OR REPLACE FUNCTION unsend_expense_part(p_payment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p expense_payments%ROWTYPE;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can change a payment';
  END IF;
  SELECT * INTO p FROM expense_payments WHERE id = p_payment_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Payment part not found'; END IF;
  IF p.state <> 'sent' THEN RAISE EXCEPTION 'Only a sent part can be taken back (this one is %)', p.state; END IF;
  UPDATE expense_payments SET state = 'planned', disbursed_by = NULL, bank_ref = NULL, sent_at = NULL
   WHERE id = p.id;
  -- Whether it still carries the withholding depends on what is left.
  PERFORM expense_parts_refresh(p.expense_id);
END $$;

-- Admin: undo a cash part confirmed in error. The books are corrected by a
-- reversing entry. A bank-matched part is undone from bank reconciliation.
CREATE OR REPLACE FUNCTION reverse_expense_part(p_payment_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p expense_payments%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(get_user_role() = 'admin', false) THEN
    RAISE EXCEPTION 'Only an admin can reverse a payment';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Say why — the reason is kept with the part'; END IF;
  SELECT * INTO p FROM expense_payments WHERE id = p_payment_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Payment part not found'; END IF;
  IF p.state <> 'paid' THEN RAISE EXCEPTION 'Only a paid part can be reversed (this one is %)', p.state; END IF;
  IF p.legacy_entry THEN RAISE EXCEPTION 'This part was paid before parts existed — reverse it on the expense''s history'; END IF;
  IF p.transfer_id IS NOT NULL THEN
    RAISE EXCEPTION 'The bank confirmed this part — undo the match in Bank reconciliation instead';
  END IF;
  UPDATE expense_payments SET
    state = 'planned', paid_date = NULL, confirmed_by = NULL, disbursed_by = NULL, sent_at = NULL, bank_ref = NULL,
    note = concat_ws(E'\n', NULLIF(note, ''), format('Payment reversed %s by %s: %s',
             to_char(now() AT TIME ZONE 'Africa/Addis_Ababa', 'DD Mon YYYY'),
             COALESCE((SELECT full_name FROM user_profiles WHERE id = auth.uid()), 'admin'), btrim(p_reason)))
  WHERE id = p.id;
  PERFORM expense_parts_refresh(p.expense_id);
END $$;

-- The old "Pay part" button's RPC now pays a part: same call, no new expense.
CREATE OR REPLACE FUNCTION split_expense_partial_payment(p_expense_id uuid, p_paid_amount numeric, p_disbursed_by uuid DEFAULT NULL::uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e expenses%ROWTYPE;
BEGIN
  SELECT * INTO e FROM expenses WHERE id = p_expense_id;
  PERFORM pay_expense_amount(p_expense_id, p_paid_amount, p_disbursed_by,
                             COALESCE(NULLIF(e.payment_method, 'vrf'), 'transfer'), e.account_id, NULL,
                             'Paid through the old Pay part button');
  RETURN p_expense_id;
END $$;

-- Whole-payment paths refuse a bill in parts with a clear message.
CREATE OR REPLACE FUNCTION match_expense_to_transfer(p_expense_id uuid, p_transfer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_from_account_id uuid;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can match an expense to a bank line';
  END IF;
  IF EXISTS (SELECT 1 FROM batch_payment_expenses WHERE expense_id = p_expense_id) THEN
    RAISE EXCEPTION 'This expense belongs to a batch payment — match the batch to a bank line instead';
  END IF;
  IF EXISTS (SELECT 1 FROM expenses WHERE id = p_expense_id AND in_parts) THEN
    RAISE EXCEPTION 'This expense is paid in parts — match the bank line to the part it paid';
  END IF;
  SELECT from_account_id INTO v_from_account_id FROM transfers WHERE id = p_transfer_id;
  UPDATE expenses
  SET payment_state = 'paid',
      transfer_id   = p_transfer_id,
      account_id    = COALESCE(account_id, v_from_account_id)
  WHERE id = p_expense_id;
END $$;

-- ── Purchase order plans ────────────────────────────────────────────────────
-- A PO's plan is in percent of its bill. A plan with any part due before
-- delivery makes the PO pay-in-advance, so its expense exists from the
-- order on; a plan due wholly on delivery keeps it pay-on-delivery.
CREATE OR REPLACE FUNCTION po_plan_parts(p_plan jsonb, p_total numeric)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE x jsonb; v_out jsonb := '[]'::jsonb; v_left numeric := round(p_total, 2); v_amt numeric; i integer := 0; n integer;
BEGIN
  n := jsonb_array_length(p_plan);
  FOR x IN SELECT * FROM jsonb_array_elements(p_plan) LOOP
    i := i + 1;
    v_amt := CASE WHEN i = n THEN v_left ELSE round(p_total * (x->>'pct')::numeric / 100, 2) END;
    v_left := v_left - v_amt;
    IF v_amt > 0 THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'amount', v_amt, 'kind', COALESCE(x->>'kind', 'installment'), 'due_on', COALESCE(x->>'due_on', 'delivery'),
        'days', x->>'days', 'label', x->>'label'));
    END IF;
  END LOOP;
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION trg_bundle_payment_plan_check()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE x jsonb; v_sum numeric := 0;
BEGIN
  IF NEW.payment_plan IS NULL OR NEW.payment_plan = 'null'::jsonb THEN
    NEW.payment_plan := NULL;
    RETURN NEW;
  END IF;
  IF jsonb_typeof(NEW.payment_plan) <> 'array' THEN RAISE EXCEPTION 'A payment plan is a list of parts'; END IF;
  IF jsonb_array_length(NEW.payment_plan) = 0 THEN
    NEW.payment_plan := NULL;
    RETURN NEW;
  END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(NEW.payment_plan) LOOP
    IF COALESCE((x->>'pct')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'Every part of the plan needs a share above 0%%'; END IF;
    IF COALESCE(x->>'due_on', 'delivery') NOT IN ('now', 'date', 'delivery') THEN RAISE EXCEPTION 'Unknown due rule %', x->>'due_on'; END IF;
    IF COALESCE(x->>'kind', 'installment') NOT IN ('advance', 'installment', 'on_delivery', 'final', 'retention') THEN
      RAISE EXCEPTION 'Unknown kind of part %', x->>'kind';
    END IF;
    v_sum := v_sum + (x->>'pct')::numeric;
  END LOOP;
  IF abs(v_sum - 100) > 0.001 THEN RAISE EXCEPTION 'The plan''s parts add up to % — they must make 100%%', v_sum || '%'; END IF;
  NEW.payment_pattern := CASE
    WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.payment_plan) y WHERE COALESCE(y->>'due_on', 'delivery') <> 'delivery')
    THEN 'pay_in_advance' ELSE 'pay_on_delivery' END;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER trg_bundle_payment_plan_check BEFORE INSERT OR UPDATE OF payment_plan, payment_pattern ON sourcing_bundles
  FOR EACH ROW EXECUTE FUNCTION trg_bundle_payment_plan_check();

CREATE OR REPLACE FUNCTION apply_po_payment_plan(p_expense_id uuid, p_plan jsonb, p_wht_mode text DEFAULT 'last')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e expenses%ROWTYPE;
BEGIN
  SELECT * INTO e FROM expenses WHERE id = p_expense_id;
  IF e.id IS NULL OR COALESCE(e.is_archived, false) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM expense_payments WHERE expense_id = p_expense_id AND state IN ('sent', 'paid')) THEN
    RAISE EXCEPTION 'Money has already gone out on this order — change the plan on its expense, %', e.expense_code;
  END IF;
  IF NOT e.in_parts AND e.payment_state IN ('sent', 'advance', 'paid') THEN RETURN; END IF;
  PERFORM expense_parts_replace_plan(p_expense_id,
    CASE WHEN p_plan IS NULL THEN '[]'::jsonb ELSE po_plan_parts(p_plan, expense_parts_payable(e)) END,
    CASE WHEN p_plan IS NULL THEN NULL ELSE p_wht_mode END);
END $$;

CREATE OR REPLACE FUNCTION trg_po_expense_takes_plan()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_plan jsonb; v_mode text;
BEGIN
  SELECT payment_plan, plan_wht_mode INTO v_plan, v_mode FROM sourcing_bundles WHERE id = NEW.sourcing_bundle_id;
  IF v_plan IS NOT NULL THEN
    -- A plan that does not fit (say the withholding is more than the last
    -- part) must not stop the order: the bill is then paid whole, or
    -- planned by hand on the expense.
    BEGIN
      PERFORM apply_po_payment_plan(NEW.id, v_plan, v_mode);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Payment plan of % not applied: %', NEW.expense_code, SQLERRM;
    END;
  END IF;
  RETURN NULL;
END $$;
CREATE OR REPLACE TRIGGER trg_po_expense_takes_plan AFTER INSERT ON expenses
  FOR EACH ROW WHEN (NEW.sourcing_bundle_id IS NOT NULL AND NEW.expense_type = 'purchase_order')
  EXECUTE FUNCTION trg_po_expense_takes_plan();

CREATE OR REPLACE FUNCTION trg_bundle_plan_to_expense()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.expense_id IS NOT NULL AND (NEW.payment_plan IS DISTINCT FROM OLD.payment_plan
                                      OR NEW.plan_wht_mode IS DISTINCT FROM OLD.plan_wht_mode) THEN
    PERFORM apply_po_payment_plan(NEW.expense_id, NEW.payment_plan, NEW.plan_wht_mode);
  END IF;
  RETURN NULL;
END $$;
CREATE OR REPLACE TRIGGER trg_bundle_plan_to_expense AFTER UPDATE OF payment_plan, plan_wht_mode ON sourcing_bundles
  FOR EACH ROW EXECUTE FUNCTION trg_bundle_plan_to_expense();

-- ── Views ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_expense_payments WITH (security_invoker = on) AS
SELECT p.id, p.expense_id, p.seq, p.kind, p.label, p.amount_etb, p.wht_etb, p.cash_etb,
  p.due_on, p.due_date, p.due_days, p.state, p.payment_method, p.account_id, a.account_name,
  p.disbursed_by, payer.full_name AS disbursed_by_name, p.bank_ref, p.transfer_id, t.transfer_id_code,
  p.sent_at, p.paid_date, p.confirmed_by, p.legacy_entry, p.note, p.created_at, p.updated_at,
  (count(*) FILTER (WHERE p.state <> 'cancelled') OVER (PARTITION BY p.expense_id ORDER BY p.seq))::int AS part_no,
  (count(*) FILTER (WHERE p.state <> 'cancelled') OVER (PARTITION BY p.expense_id))::int AS part_count,
  COALESCE(sum(p.amount_etb) FILTER (WHERE p.state = 'paid') OVER (PARTITION BY p.expense_id ORDER BY p.seq
    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS paid_before,
  e.expense_code, e.item_service_description, e.vendor_id, COALESCE(v.vendor_name, e.vendors_name) AS vendor_name,
  e.project_id, pr.project_name, e.sourcing_bundle_id, sb.bundle_code,
  e.amount_etb AS expense_amount, expense_parts_payable(e) AS expense_payable, e.wht_amount AS expense_wht,
  e.wht_mode AS expense_wht_mode,
  e.paid_to_date_etb AS expense_paid_to_date, e.finance_approved_by, e.approval_status::text AS approval_status,
  g.grn_date,
  CASE WHEN p.state <> 'planned' THEN NULL
       WHEN p.due_on = 'now' THEN CURRENT_DATE
       WHEN p.due_on = 'date' THEN p.due_date
       ELSE g.grn_date + COALESCE(p.due_days, 0) END AS due_by,
  CASE WHEN p.state <> 'planned' THEN false
       WHEN p.due_on = 'now' THEN true
       WHEN p.due_on = 'date' THEN p.due_date IS NULL OR p.due_date <= CURRENT_DATE
       ELSE g.grn_date IS NOT NULL AND g.grn_date + COALESCE(p.due_days, 0) <= CURRENT_DATE END AS is_due,
  (SELECT jsonb_build_object('id', r.id, 'code', r.request_code, 'revision', r.revision)
     FROM payment_requests r WHERE r.expense_payment_id = p.id AND r.status = 'issued'
    ORDER BY r.revision DESC LIMIT 1) AS prq
FROM expense_payments p
JOIN expenses e ON e.id = p.expense_id
LEFT JOIN vendors v ON v.id = e.vendor_id
LEFT JOIN projects pr ON pr.id = e.project_id
LEFT JOIN sourcing_bundles sb ON sb.id = e.sourcing_bundle_id
LEFT JOIN accounts a ON a.id = p.account_id
LEFT JOIN user_profiles payer ON payer.id = p.disbursed_by
LEFT JOIN transfers t ON t.id = p.transfer_id
LEFT JOIN LATERAL (SELECT min(gr.received_at)::date AS grn_date FROM goods_received_notes gr
                    WHERE e.sourcing_bundle_id IS NOT NULL AND gr.sourcing_bundle_id = e.sourcing_bundle_id) g ON true;
GRANT SELECT ON v_expense_payments TO authenticated;

-- To pay: a bill in parts shows its next planned part.
CREATE OR REPLACE VIEW v_to_pay_queue WITH (security_invoker = on) AS
SELECT e.id,
    e.expense_code,
    e.item_service_description,
    e.amount_etb,
    e.vendor_id,
    v.vendor_name,
    e.project_id,
    p.project_name,
    c.cost_group_id,
    cg.name AS cost_group_name,
    e.verify_wht,
    e.finance_approved_by,
    e.finance_approved_at,
    EXTRACT(day FROM (now() - e.finance_approved_at)) AS days_since_approval,
    e.sourcing_bundle_id,
    sb.payment_pattern,
    e.net_payable,
    e.wht_amount,
    COALESCE(e.credit_applied_etb, 0::numeric) AS credit_applied_etb,
    CASE WHEN e.in_parts THEN np.cash_etb::numeric
         ELSE COALESCE(e.amount_etb, 0::numeric) - COALESCE(e.wht_amount, 0::numeric) - COALESCE(e.credit_applied_etb, 0::numeric) END AS cash_to_send,
    e.in_parts,
    np.id AS part_id,
    np.part_no,
    np.part_count,
    np.kind AS part_kind,
    np.label AS part_label,
    np.amount_etb AS part_amount,
    np.wht_etb AS part_wht,
    np.due_on AS part_due_on,
    np.due_by AS part_due_by,
    np.is_due AS part_is_due,
    e.paid_to_date_etb,
    expense_parts_payable(e) - e.paid_to_date_etb AS balance_etb,
    (SELECT count(*) FROM expense_payments q WHERE q.expense_id = e.id AND q.state = 'sent')::int AS parts_sent,
    e.wht_mode
   FROM expenses e
     LEFT JOIN vendors v ON v.id = e.vendor_id
     LEFT JOIN projects p ON p.id = e.project_id
     LEFT JOIN categories c ON c.id = e.category_id
     LEFT JOIN cost_groups cg ON cg.id = c.cost_group_id
     LEFT JOIN sourcing_bundles sb ON sb.id = e.sourcing_bundle_id
     LEFT JOIN LATERAL (SELECT q.* FROM v_expense_payments q
                         WHERE e.in_parts AND q.expense_id = e.id AND q.state = 'planned'
                         ORDER BY q.seq LIMIT 1) np ON true
  WHERE e.payment_state = 'approved_to_pay' AND NOT COALESCE(e.is_archived, false)
    AND (NOT e.in_parts OR np.id IS NOT NULL);

-- Waiting on the bank: sent parts too, one row each.
CREATE OR REPLACE VIEW v_awaiting_bank_confirmation WITH (security_invoker = on) AS
SELECT e.id,
    e.expense_code,
    e.item_service_description,
    e.vendor_id,
    v.vendor_name,
    e.amount_etb,
    e.net_payable,
    e.payment_method,
    e.account_id,
    a.account_name,
    e.payment_state_changed_at,
    EXTRACT(day FROM (now() - e.payment_state_changed_at)) AS days_waiting,
    bpe.batch_payment_id,
    NULL::uuid AS part_id,
    NULL::integer AS part_no,
    NULL::integer AS part_count
   FROM expenses e
     LEFT JOIN vendors v ON v.id = e.vendor_id
     LEFT JOIN accounts a ON a.id = e.account_id
     LEFT JOIN batch_payment_expenses bpe ON bpe.expense_id = e.id
  WHERE e.payment_state = 'sent' AND e.payment_method = ANY (ARRAY['transfer', 'cpo', 'cheque'])
    AND e.transfer_id IS NULL AND NOT COALESCE(e.is_archived, false) AND NOT e.in_parts
UNION ALL
SELECT q.expense_id,
    q.expense_code,
    q.item_service_description,
    q.vendor_id,
    q.vendor_name,
    q.amount_etb::numeric(12,2),
    q.cash_etb::numeric(14,2),
    q.payment_method,
    q.account_id,
    q.account_name,
    q.sent_at,
    EXTRACT(day FROM (now() - q.sent_at)),
    NULL::uuid,
    q.id,
    q.part_no,
    q.part_count
   FROM v_expense_payments q
  WHERE q.state = 'sent' AND q.payment_method = ANY (ARRAY['transfer', 'cpo', 'cheque']) AND q.transfer_id IS NULL;

-- ── Payment Requests: one per part ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION save_payment_request(p_source_type text, p_source_id uuid, p_document_html text, p_snapshot jsonb DEFAULT '{}'::jsonb, p_payee_lines jsonb DEFAULT '[]'::jsonb, p_title text DEFAULT NULL::text, p_total_amount numeric DEFAULT 0, p_amount_in_words text DEFAULT NULL::text, p_worker_count integer DEFAULT 0, p_draft_count integer DEFAULT 1, p_period_start date DEFAULT NULL::date, p_period_end date DEFAULT NULL::date, p_project_names text[] DEFAULT NULL::text[], p_notes text DEFAULT NULL::text, p_bank_scope text DEFAULT 'all'::text, p_bank_id uuid DEFAULT NULL::uuid)
 RETURNS payment_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev  payment_requests%ROWTYPE;
  v_new   payment_requests%ROWTYPE;
  v_scope text := COALESCE(p_bank_scope, 'all');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'executive', 'finance') THEN
    RAISE EXCEPTION 'Only admin, executive or finance can issue a Payment Request';
  END IF;
  IF p_source_type NOT IN ('expense', 'batch_payment', 'payroll', 'vrf') THEN
    RAISE EXCEPTION 'Unknown Payment Request source type: %', p_source_type;
  END IF;
  IF v_scope NOT IN ('all', 'bank', 'unassigned') THEN
    RAISE EXCEPTION 'Unknown Payment Request bank scope: %', v_scope;
  END IF;
  IF v_scope <> 'all' AND p_source_type <> 'payroll' THEN
    RAISE EXCEPTION 'Only a payroll run can be split by bank (got scope % for source %)', v_scope, p_source_type;
  END IF;
  IF v_scope = 'bank' AND p_bank_id IS NULL THEN
    RAISE EXCEPTION 'A per-bank Payment Request must name the bank';
  END IF;
  IF v_scope <> 'bank' AND p_bank_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only a per-bank Payment Request carries a bank (scope was %)', v_scope;
  END IF;
  IF p_document_html IS NULL OR length(btrim(p_document_html)) = 0 THEN
    RAISE EXCEPTION 'Cannot save an empty Payment Request document';
  END IF;
  IF p_source_type = 'expense' THEN
    IF NOT EXISTS (SELECT 1 FROM expenses WHERE id = p_source_id) THEN
      RAISE EXCEPTION 'Expense % not found', p_source_id;
    END IF;
    -- A bill in parts is requested part by part (save_expense_part_request).
    IF EXISTS (SELECT 1 FROM expenses WHERE id = p_source_id AND in_parts) THEN
      RAISE EXCEPTION 'This expense is paid in parts — issue the Payment Request for the part being paid';
    END IF;
  ELSIF p_source_type = 'batch_payment' THEN
    IF NOT EXISTS (SELECT 1 FROM batch_payments WHERE id = p_source_id) THEN
      RAISE EXCEPTION 'Batch payment % not found', p_source_id;
    END IF;
  ELSIF p_source_type = 'vrf' THEN
    IF NOT EXISTS (SELECT 1 FROM vendor_receipt_facilitation WHERE id = p_source_id AND NOT is_archived) THEN
      RAISE EXCEPTION 'VRF % not found', p_source_id;
    END IF;
    -- A PRQ authorises the payment, so it follows approval.
    IF NOT EXISTS (SELECT 1 FROM vendor_receipt_facilitation WHERE id = p_source_id AND payment_state IN ('approved', 'sent')) THEN
      RAISE EXCEPTION 'Approve the VRF payment before issuing its Payment Request';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM payroll WHERE id = p_source_id) THEN
      RAISE EXCEPTION 'Payroll run % not found', p_source_id;
    END IF;
    IF v_scope = 'bank' AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = p_bank_id) THEN
      RAISE EXCEPTION 'Bank account % not found', p_bank_id;
    END IF;
  END IF;
  SELECT * INTO v_prev
  FROM payment_requests
  WHERE status = 'issued'
    AND ((p_source_type = 'expense'       AND expense_id       = p_source_id AND expense_payment_id IS NULL)
      OR (p_source_type = 'batch_payment' AND batch_payment_id = p_source_id)
      OR (p_source_type = 'vrf'           AND vrf_id           = p_source_id)
      OR (p_source_type = 'payroll'       AND payroll_id       = p_source_id
          AND bank_scope = v_scope
          AND bank_id IS NOT DISTINCT FROM p_bank_id))
  ORDER BY revision DESC, issued_at DESC
  LIMIT 1;
  IF v_prev.id IS NOT NULL THEN
    UPDATE payment_requests SET status = 'superseded', updated_at = now() WHERE id = v_prev.id;
  END IF;
  INSERT INTO payment_requests (
    source_type, expense_id, batch_payment_id, payroll_id, vrf_id,
    bank_scope, bank_id,
    title, total_amount, amount_in_words, worker_count, draft_count,
    period_start, period_end, project_names,
    payee_lines, document_html, snapshot,
    revision, supersedes_id, issued_by, notes
  ) VALUES (
    p_source_type,
    CASE WHEN p_source_type = 'expense'       THEN p_source_id END,
    CASE WHEN p_source_type = 'batch_payment' THEN p_source_id END,
    CASE WHEN p_source_type = 'payroll'       THEN p_source_id END,
    CASE WHEN p_source_type = 'vrf'           THEN p_source_id END,
    v_scope, p_bank_id,
    p_title, COALESCE(p_total_amount, 0), p_amount_in_words,
    COALESCE(p_worker_count, 0), COALESCE(p_draft_count, 1),
    p_period_start, p_period_end, p_project_names,
    COALESCE(p_payee_lines, '[]'::jsonb), p_document_html, COALESCE(p_snapshot, '{}'::jsonb),
    COALESCE(v_prev.revision, 0) + 1, v_prev.id, auth.uid(), p_notes
  )
  RETURNING * INTO v_new;
  RETURN v_new;
END $function$;

CREATE OR REPLACE FUNCTION save_expense_part_request(
  p_payment_id uuid, p_document_html text, p_snapshot jsonb DEFAULT '{}'::jsonb, p_payee_lines jsonb DEFAULT '[]'::jsonb,
  p_title text DEFAULT NULL, p_total_amount numeric DEFAULT 0, p_amount_in_words text DEFAULT NULL,
  p_project_names text[] DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS payment_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p expense_payments%ROWTYPE; v_prev payment_requests%ROWTYPE; v_new payment_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'executive', 'finance') THEN
    RAISE EXCEPTION 'Only admin, executive or finance can issue a Payment Request';
  END IF;
  IF p_document_html IS NULL OR length(btrim(p_document_html)) = 0 THEN
    RAISE EXCEPTION 'Cannot save an empty Payment Request document';
  END IF;
  SELECT * INTO p FROM expense_payments WHERE id = p_payment_id;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Payment part not found'; END IF;
  IF p.state = 'cancelled' THEN RAISE EXCEPTION 'This part was replaced by a new plan'; END IF;

  SELECT * INTO v_prev FROM payment_requests
   WHERE status = 'issued' AND expense_payment_id = p_payment_id
   ORDER BY revision DESC, issued_at DESC LIMIT 1;
  IF v_prev.id IS NOT NULL THEN
    UPDATE payment_requests SET status = 'superseded', updated_at = now() WHERE id = v_prev.id;
  END IF;
  INSERT INTO payment_requests (
    source_type, expense_id, expense_payment_id, bank_scope, title, total_amount, amount_in_words,
    worker_count, draft_count, project_names, payee_lines, document_html, snapshot,
    revision, supersedes_id, issued_by, notes)
  VALUES (
    'expense', p.expense_id, p.id, 'all', p_title, COALESCE(p_total_amount, 0), p_amount_in_words,
    0, 1, p_project_names, COALESCE(p_payee_lines, '[]'::jsonb), p_document_html, COALESCE(p_snapshot, '{}'::jsonb),
    COALESCE(v_prev.revision, 0) + 1, v_prev.id, auth.uid(), p_notes)
  RETURNING * INTO v_new;
  RETURN v_new;
END $$;

CREATE OR REPLACE VIEW v_payment_requests WITH (security_invoker = on) AS
 SELECT pr.id,
    pr.request_code,
    pr.source_type,
    pr.expense_id,
    pr.batch_payment_id,
    COALESCE(e.expense_code, bp.payment_code, pay.payroll_record, f.record_name) AS source_code,
    pr.title,
    pr.total_amount,
    pr.amount_in_words,
    pr.worker_count,
    pr.draft_count,
    pr.period_start,
    pr.period_end,
    pr.project_names,
    pr.status,
    pr.revision,
    pr.supersedes_id,
    prev.request_code AS supersedes_code,
    pr.issued_by,
    iss.full_name AS issued_by_name,
    pr.issued_at,
    pr.voided_by,
    vby.full_name AS voided_by_name,
    pr.voided_at,
    pr.void_reason,
    pr.notes,
        CASE
            WHEN pr.expense_payment_id IS NOT NULL THEN
              CASE part.state WHEN 'paid' THEN 'paid' WHEN 'sent' THEN 'sent' WHEN 'cancelled' THEN 'void' ELSE e.payment_state END
            WHEN (pr.source_type = 'expense'::text) THEN e.payment_state
            WHEN (pr.source_type = 'payroll'::text) THEN
            CASE
                WHEN (pay.payment_status = 'paid'::text) THEN 'paid'::text
                ELSE 'unpaid'::text
            END
            WHEN (pr.source_type = 'vrf'::text) THEN
            CASE
                WHEN (f.payment_state = 'sent'::text) THEN 'paid'::text
                ELSE 'unpaid'::text
            END
            ELSE ( SELECT
                    CASE
                        WHEN bool_and((x.payment_state = 'paid'::text)) THEN 'paid'::text
                        WHEN bool_or((x.payment_state = ANY (ARRAY['sent'::text, 'paid'::text]))) THEN 'sent'::text
                        ELSE 'unpaid'::text
                    END AS "case"
               FROM (batch_payment_expenses bpe
                 JOIN expenses x ON ((x.id = bpe.expense_id)))
              WHERE (bpe.batch_payment_id = pr.batch_payment_id))
        END AS payment_state,
    pr.created_at,
    pr.updated_at,
    pr.payroll_id,
    pr.bank_scope,
    pr.bank_id,
    bank.account_name AS bank_name,
    pr.vrf_id,
    pr.expense_payment_id,
    pos.part_no,
    pos.part_count
   FROM payment_requests pr
     LEFT JOIN expenses e ON e.id = pr.expense_id
     LEFT JOIN batch_payments bp ON bp.id = pr.batch_payment_id
     LEFT JOIN payroll pay ON pay.id = pr.payroll_id
     LEFT JOIN vendor_receipt_facilitation f ON f.id = pr.vrf_id
     LEFT JOIN payment_requests prev ON prev.id = pr.supersedes_id
     LEFT JOIN user_profiles iss ON iss.id = pr.issued_by
     LEFT JOIN user_profiles vby ON vby.id = pr.voided_by
     LEFT JOIN accounts bank ON bank.id = pr.bank_id
     LEFT JOIN expense_payments part ON part.id = pr.expense_payment_id
     LEFT JOIN LATERAL expense_part_position(pr.expense_payment_id) pos ON pr.expense_payment_id IS NOT NULL
  WHERE ((get_user_role() = ANY (ARRAY['admin'::user_role, 'executive'::user_role, 'finance'::user_role])) OR (pr.issued_by = auth.uid()));

-- ── Bank reconciliation: a line can pay a part ─────────────────────────────
CREATE OR REPLACE VIEW v_bank_line_status WITH (security_invoker = true) AS
 WITH base AS (
         SELECT l.id, l.import_id, l.line_no, l.value_date, l.post_date, l.transaction_type, l.narration,
            l.debit_amount, l.credit_amount, l.running_balance, l.reference, l.reference_code,
            l.matched_expense_id, l.transfer_id, l.match_status, l.created_at, l.matched_expense_amount,
            l.variance_amount, l.matched_payroll_id, l.matched_sale_id, l.credit_classification, l.account_id,
            l.fingerprint, l.classification, l.classification_note, l.classified_by, l.classified_at,
                CASE
                    WHEN (COALESCE(l.debit_amount, (0)::numeric) > (0)::numeric) THEN 'debit'::text
                    ELSE 'credit'::text
                END AS direction,
            COALESCE(NULLIF(l.debit_amount, (0)::numeric), l.credit_amount, (0)::numeric) AS amount
           FROM bank_statement_lines l
        ), links AS (
         SELECT b_1.id,
            ( SELECT jsonb_build_object('id', bp.id, 'label', COALESCE(bp.payment_code, 'Batch payment'::text), 'amount', ( SELECT COALESCE(sum(COALESCE(e.net_payable, e.amount_etb)), (0)::numeric) AS "coalesce"
                           FROM (batch_payment_expenses x
                             JOIN expenses e ON ((e.id = x.expense_id)))
                          WHERE (x.batch_payment_id = bp.id))) AS jsonb_build_object
                   FROM batch_payments bp
                  WHERE (bp.transfer_id = b_1.transfer_id)
                 LIMIT 1) AS batch,
            ( SELECT jsonb_agg(z.j) FROM (
                SELECT jsonb_build_object('id', e.id, 'label', ((COALESCE(e.expense_code, ''::text) || ' '::text) || COALESCE(e.item_service_description, ''::text)), 'amount', COALESCE(e.net_payable, e.amount_etb)) AS j
                  FROM expenses e
                 WHERE e.transfer_id = b_1.transfer_id
                   AND NOT (EXISTS ( SELECT 1 FROM batch_payments bp WHERE (bp.transfer_id = b_1.transfer_id)))
                UNION ALL
                SELECT jsonb_build_object('id', e.id, 'part_id', q.id,
                         'label', COALESCE(e.expense_code, '') || format(' part %s of %s ', pos.part_no, pos.part_count) || COALESCE(e.item_service_description, ''),
                         'amount', q.cash_etb)
                  FROM expense_payments q
                  JOIN expenses e ON e.id = q.expense_id
                  CROSS JOIN LATERAL expense_part_position(q.id) pos
                 WHERE q.transfer_id = b_1.transfer_id
              ) z) AS expenses,
            ( SELECT jsonb_agg(jsonb_build_object('id', s.id, 'label', ((COALESCE(s.invoice_number, ''::text) || ' '::text) || COALESCE(s.sales_description, ''::text)), 'amount', s.amount)) AS jsonb_agg
                   FROM sales s
                  WHERE (s.transfer_id = b_1.transfer_id)) AS sales,
            ( SELECT jsonb_build_object('id', p.id, 'label', COALESCE(p.payroll_record, 'Payroll'::text), 'amount', ( SELECT COALESCE(sum(ps.net_amount), (0)::numeric) AS "coalesce"
                           FROM payroll_staff ps
                          WHERE (ps.payroll_id = p.id))) AS jsonb_build_object
                   FROM payroll p
                  WHERE ((p.transfer_id = b_1.transfer_id) OR (p.id = b_1.matched_payroll_id))
                 LIMIT 1) AS payroll,
            ( SELECT jsonb_build_object('id', v.id, 'label', COALESCE(v.record_name, 'Vendor request'::text), 'amount', COALESCE(v.net_sent, v.amount_transferred)) AS jsonb_build_object
                   FROM vendor_receipt_facilitation v
                  WHERE (v.out_transfer_id = b_1.transfer_id)
                 LIMIT 1) AS vrf,
            ( SELECT jsonb_build_object('account_id', a.id, 'account_name', a.account_name, 'source', ct.source, 'line_id', ( SELECT x.id
                           FROM bank_statement_lines x
                          WHERE (x.transfer_id = ct.id)
                         LIMIT 1)) AS jsonb_build_object
                   FROM ((transfers t
                     JOIN transfers ct ON ((ct.id = t.counterpart_id)))
                     JOIN accounts a ON ((a.id = COALESCE(ct.from_account_id, ct.to_account_id))))
                  WHERE (t.id = b_1.transfer_id)) AS internal,
            (EXISTS ( SELECT 1
                   FROM vrf_returns r
                  WHERE (r.transfer_id = b_1.transfer_id))) AS vrf_return,
            (EXISTS ( SELECT 1
                   FROM bank_balance_anchors a
                  WHERE (a.transfer_id = b_1.transfer_id))) AS opening_balance
           FROM base b_1
        )
 SELECT b.id AS line_id,
    b.import_id,
    b.account_id,
    b.line_no,
    b.value_date,
    b.transaction_type,
    b.narration,
    b.reference,
    b.reference_code,
    b.debit_amount,
    b.credit_amount,
    b.running_balance,
    b.transfer_id,
    b.direction,
    b.amount,
    b.classification,
    b.classification_note,
    lk.batch,
    lk.expenses,
    lk.sales,
    lk.payroll,
    lk.vrf,
        CASE
            WHEN (lk.batch IS NOT NULL) THEN 'batch'::text
            WHEN (lk.expenses IS NOT NULL) THEN 'expense'::text
            WHEN (lk.sales IS NOT NULL) THEN 'sale'::text
            WHEN (lk.payroll IS NOT NULL) THEN 'payroll'::text
            WHEN (lk.vrf IS NOT NULL) THEN 'vrf'::text
            WHEN lk.vrf_return THEN 'vrf_return'::text
            WHEN lk.opening_balance THEN 'opening_balance'::text
            WHEN (b.classification = 'internal_transfer'::text) THEN 'internal'::text
            WHEN (b.classification IS NOT NULL) THEN 'classified'::text
            ELSE NULL::text
        END AS reconciled_as,
        CASE
            WHEN (lk.batch IS NOT NULL) THEN ((lk.batch ->> 'amount'::text))::numeric
            WHEN (lk.expenses IS NOT NULL) THEN ( SELECT sum(((x.value ->> 'amount'::text))::numeric) AS sum
               FROM jsonb_array_elements(lk.expenses) x(value))
            WHEN (lk.sales IS NOT NULL) THEN ( SELECT sum(((x.value ->> 'amount'::text))::numeric) AS sum
               FROM jsonb_array_elements(lk.sales) x(value))
            WHEN (lk.payroll IS NOT NULL) THEN ((lk.payroll ->> 'amount'::text))::numeric
            WHEN (lk.vrf IS NOT NULL) THEN ((lk.vrf ->> 'amount'::text))::numeric
            ELSE NULL::numeric
        END AS linked_amount,
    lk.internal
   FROM (base b
     JOIN links lk ON ((lk.id = b.id)));

CREATE OR REPLACE FUNCTION apply_bank_line_match(p_line_id uuid, p_kind text, p_target_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE l v_bank_line_status; v_amt numeric; f record; ex record; q expense_payments%ROWTYPE;
BEGIN
  l := bank_line_guard(p_line_id);
  IF p_kind IN ('expense', 'expense_part', 'batch', 'vrf', 'payroll') AND l.direction <> 'debit' THEN
    RAISE EXCEPTION 'Money coming in cannot pay a %', replace(p_kind, '_', ' ');
  END IF;
  IF p_kind = 'sale' AND l.direction <> 'credit' THEN RAISE EXCEPTION 'Money going out cannot settle a sale'; END IF;
  IF p_kind = 'expense' THEN
    SELECT COALESCE(net_payable, amount_etb) INTO v_amt FROM expenses WHERE id = p_target_id AND transfer_id IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'That expense is not open for a bank line'; END IF;
    PERFORM match_expense_to_transfer(p_target_id, l.transfer_id);
    UPDATE bank_statement_lines SET matched_expense_id = p_target_id, matched_expense_amount = v_amt,
      variance_amount = l.amount - v_amt, match_status = 'matched_expense' WHERE id = p_line_id;
  ELSIF p_kind = 'expense_part' THEN
    SELECT * INTO q FROM expense_payments WHERE id = p_target_id AND transfer_id IS NULL AND state = 'sent';
    IF q.id IS NULL THEN RAISE EXCEPTION 'That part is not sent, or already has a bank line'; END IF;
    PERFORM match_expense_part_to_transfer(q.id, l.transfer_id);
    UPDATE bank_statement_lines SET matched_expense_id = q.expense_id, matched_expense_amount = q.cash_etb,
      variance_amount = l.amount - q.cash_etb, match_status = 'matched_expense' WHERE id = p_line_id;
  ELSIF p_kind = 'batch' THEN
    IF EXISTS (SELECT 1 FROM batch_payments WHERE id = p_target_id AND transfer_id IS NOT NULL) THEN
      RAISE EXCEPTION 'That batch already has a bank line';
    END IF;
    PERFORM match_batch_to_transfer(p_target_id, l.transfer_id);
    UPDATE bank_statement_lines SET match_status = 'matched_expense' WHERE id = p_line_id;
  ELSIF p_kind = 'sale' THEN
    SELECT amount INTO v_amt FROM sales WHERE id = p_target_id AND transfer_id IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'That sale is not open for a bank line'; END IF;
    PERFORM match_sale_to_transfer(p_target_id, l.transfer_id);
    UPDATE bank_statement_lines SET matched_sale_id = p_target_id, matched_expense_amount = v_amt,
      variance_amount = l.amount - v_amt, match_status = 'matched_sale' WHERE id = p_line_id;
  ELSIF p_kind = 'payroll' THEN
    IF NOT EXISTS (SELECT 1 FROM payroll WHERE id = p_target_id) THEN RAISE EXCEPTION 'Payroll run not found'; END IF;
    UPDATE bank_statement_lines SET matched_payroll_id = p_target_id, match_status = 'manual' WHERE id = p_line_id;
  ELSIF p_kind = 'vrf' THEN
    SELECT * INTO f FROM vendor_receipt_facilitation WHERE id = p_target_id AND NOT is_archived;
    IF NOT FOUND THEN RAISE EXCEPTION 'Vendor request not found'; END IF;
    IF f.out_transfer_id IS NOT NULL THEN RAISE EXCEPTION 'That vendor request already has a bank line'; END IF;
    IF f.payment_state = 'approved' THEN
      PERFORM mark_vrf_sent(p_target_id, l.transfer_id, NULL);
    ELSE
      PERFORM set_config('kuncho.vrf_payment_op', 'on', true);
      UPDATE vendor_receipt_facilitation SET out_transfer_id = l.transfer_id WHERE id = p_target_id;
      PERFORM set_config('kuncho.vrf_payment_op', 'off', true);
    END IF;
    FOR ex IN SELECT e.id FROM expenses e
              WHERE f.record_name IS NOT NULL AND e.transfer_id IS NULL AND e.expense_code LIKE '%' || f.record_name
                AND abs(COALESCE(e.net_payable, e.amount_etb) - COALESCE(f.net_sent, f.amount_transferred)) <= 1 LOOP
      PERFORM match_expense_to_transfer(ex.id, l.transfer_id);
    END LOOP;
    UPDATE bank_statement_lines SET match_status = 'manual' WHERE id = p_line_id;
  ELSIF p_kind = 'internal_line' THEN
    PERFORM pair_internal_transfer(p_line_id, p_target_id, NULL, NULL);
  ELSIF p_kind = 'internal_account' THEN
    PERFORM pair_internal_transfer(p_line_id, NULL, p_target_id, NULL);
  ELSIF p_kind = 'purchase_order' THEN
    RAISE EXCEPTION 'This purchase order has no payment recorded — record the payment on the order first, then match the line to it';
  ELSE
    RAISE EXCEPTION 'Unknown match kind %', p_kind;
  END IF;
END; $function$;

CREATE OR REPLACE FUNCTION unmatch_bank_line(p_line_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE l v_bank_line_status; v_label text;
BEGIN
  l := bank_line_guard(p_line_id, true);
  IF l.reconciled_as IS NULL THEN RAISE EXCEPTION 'This line is not reconciled — nothing to undo'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Say why this is being undone'; END IF;
  IF l.reconciled_as = 'opening_balance' THEN
    RAISE EXCEPTION 'This is the balance the statement started from — reopen the import instead';
  END IF;
  IF l.reconciled_as = 'vrf_return' THEN
    RAISE EXCEPTION 'Undo the return on its vendor request';
  END IF;
  v_label := bank_line_target_label(l);
  PERFORM set_config('kuncho.bank_event_logged', 'on', true);

  IF l.reconciled_as IN ('classified', 'internal') THEN
    PERFORM unclassify_bank_line(p_line_id);
  ELSE
    UPDATE batch_payments SET transfer_id = NULL WHERE transfer_id = l.transfer_id;
    UPDATE expenses SET transfer_id = NULL WHERE transfer_id = l.transfer_id;
    -- A part it paid goes back to sent; the part's posting is reversed.
    UPDATE expense_payments SET transfer_id = NULL WHERE transfer_id = l.transfer_id;
    UPDATE sales SET transfer_id = NULL, amount_received = NULL, withheld_by_client = NULL WHERE transfer_id = l.transfer_id;
    UPDATE payroll SET transfer_id = NULL WHERE transfer_id = l.transfer_id;
    IF EXISTS (SELECT 1 FROM vendor_receipt_facilitation WHERE out_transfer_id = l.transfer_id) THEN
      PERFORM set_config('kuncho.vrf_payment_op', 'on', true);
      UPDATE vendor_receipt_facilitation SET out_transfer_id = NULL WHERE out_transfer_id = l.transfer_id;
      PERFORM set_config('kuncho.vrf_payment_op', 'off', true);
    END IF;
    UPDATE bank_statement_lines SET matched_expense_id = NULL, matched_sale_id = NULL, matched_payroll_id = NULL,
      matched_expense_amount = NULL, variance_amount = NULL, match_status = 'unmatched'
    WHERE id = p_line_id;
  END IF;

  INSERT INTO bank_line_events (line_id, account_id, action, kind, target_label, note)
  VALUES (p_line_id, l.account_id, 'unmatched', l.reconciled_as, v_label, btrim(p_reason));
  PERFORM set_config('kuncho.bank_event_logged', 'off', true);
END $function$;

CREATE OR REPLACE FUNCTION suggest_bank_line_matches(p_line_id uuid)
 RETURNS TABLE(kind text, target_id uuid, label text, detail text, amount numeric, target_date date, score integer, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE l v_bank_line_status; v_text text;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can reconcile bank lines';
  END IF;
  SELECT * INTO l FROM v_bank_line_status WHERE line_id = p_line_id;
  IF l.line_id IS NULL THEN RETURN; END IF;
  v_text := COALESCE(l.narration, '') || ' ' || COALESCE(l.reference, '');
  RETURN QUERY
  WITH cand AS (
    SELECT 'expense'::text AS kind, e.id AS target_id,
      btrim(COALESCE(e.expense_code, '') || ' ' || COALESCE(e.item_service_description, '')) AS label,
      COALESCE(v.vendor_name, st.employee_name, '') || ' · ' || replace(e.payment_state::text, '_', ' ') AS detail,
      COALESCE(e.net_payable, e.amount_etb) AS amount, e.date AS target_date,
      (e.bank_ref IS NOT NULL AND e.bank_ref = l.reference_code) AS ref_hit,
      (bank_text_names_code(v_text, e.expense_code)
        OR EXISTS (SELECT 1 FROM sourcing_bundles sb WHERE (sb.expense_id = e.id OR sb.id = e.sourcing_bundle_id)
                   AND bank_text_names_code(v_text, sb.bundle_code))) AS code_hit,
      bank_amount_fit(l.amount, COALESCE(e.net_payable, e.amount_etb), 'debit') AS fit,
      CASE WHEN e.payment_state = 'sent' THEN 10 WHEN e.payment_state = 'approved_to_pay' THEN 5 ELSE 0 END AS bonus
    FROM expenses e
    LEFT JOIN vendors v ON v.id = e.vendor_id
    LEFT JOIN staff st ON st.id = e.paid_to_staff_id
    WHERE l.direction = 'debit' AND e.transfer_id IS NULL AND NOT e.in_parts
      AND e.payment_state IN ('approved_to_pay', 'sent', 'paid', 'advance')
      AND NOT EXISTS (SELECT 1 FROM batch_payment_expenses x WHERE x.expense_id = e.id)
      AND NOT EXISTS (SELECT 1 FROM vendor_receipt_facilitation f
                      WHERE f.out_transfer_id IS NULL AND f.record_name IS NOT NULL AND e.expense_code LIKE '%' || f.record_name)
      AND e.date BETWEEN l.value_date - 120 AND l.value_date + 10
    UNION ALL
    SELECT 'expense_part', q.id,
      btrim(COALESCE(e.expense_code, '') || format(' part %s of %s ', pos.part_no, pos.part_count) || COALESCE(e.item_service_description, '')),
      COALESCE(v.vendor_name, st.employee_name, '') || ' · part sent',
      q.cash_etb, COALESCE(q.sent_at::date, e.date),
      (q.bank_ref IS NOT NULL AND q.bank_ref = l.reference_code),
      (bank_text_names_code(v_text, e.expense_code)
        OR EXISTS (SELECT 1 FROM sourcing_bundles sb WHERE (sb.expense_id = e.id OR sb.id = e.sourcing_bundle_id)
                   AND bank_text_names_code(v_text, sb.bundle_code))),
      bank_amount_fit(l.amount, q.cash_etb, 'debit'),
      10
    FROM expense_payments q
    JOIN expenses e ON e.id = q.expense_id
    CROSS JOIN LATERAL expense_part_position(q.id) pos
    LEFT JOIN vendors v ON v.id = e.vendor_id
    LEFT JOIN staff st ON st.id = e.paid_to_staff_id
    WHERE l.direction = 'debit' AND q.state = 'sent' AND q.transfer_id IS NULL
      AND COALESCE(q.sent_at::date, e.date) BETWEEN l.value_date - 120 AND l.value_date + 10
    UNION ALL
    SELECT 'batch', b.id, COALESCE(b.payment_code, 'Batch payment'),
      (SELECT count(*) FROM batch_payment_expenses x WHERE x.batch_payment_id = b.id)::text || ' payments',
      t.total, b.created_at::date,
      false, bank_text_names_code(v_text, b.payment_code),
      bank_amount_fit(l.amount, t.total, 'debit'), 5
    FROM batch_payments b
    CROSS JOIN LATERAL (SELECT COALESCE(sum(COALESCE(e.net_payable, e.amount_etb)), 0) AS total
                        FROM batch_payment_expenses x JOIN expenses e ON e.id = x.expense_id WHERE x.batch_payment_id = b.id) t
    WHERE l.direction = 'debit' AND b.transfer_id IS NULL
      AND b.created_at::date BETWEEN l.value_date - 60 AND l.value_date + 10
    UNION ALL
    SELECT 'vrf', f.id, COALESCE(f.record_name, 'Vendor request'),
      COALESCE(f.facilitator_name, '') || ' · ' || COALESCE(f.payment_state, ''),
      COALESCE(f.net_sent, f.amount_transferred), f.trxn_date,
      false, bank_text_names_code(v_text, f.record_name),
      bank_amount_fit(l.amount, COALESCE(f.net_sent, f.amount_transferred), 'debit'),
      CASE WHEN f.initial_account_id = l.account_id THEN 5 ELSE 0 END
    FROM vendor_receipt_facilitation f
    WHERE l.direction = 'debit' AND f.out_transfer_id IS NULL AND NOT f.is_archived
      AND f.trxn_date BETWEEN l.value_date - 60 AND l.value_date + 10
    UNION ALL
    SELECT 'payroll', p.id, COALESCE(p.payroll_record, 'Payroll run'),
      COALESCE((SELECT st.employee_name FROM payroll_staff ps JOIN staff st ON st.id = ps.staff_id
                WHERE ps.payroll_id = p.id AND bank_amount_fit(l.amount, ps.net_amount, 'debit') >= 55 LIMIT 1), 'run')
        || ' · ' || COALESCE(p.payment_status, ''),
      (SELECT COALESCE(sum(ps.net_amount), 0) FROM payroll_staff ps WHERE ps.payroll_id = p.id), p.end_date,
      false, false,
      greatest(bank_amount_fit(l.amount, (SELECT COALESCE(sum(ps.net_amount), 0) FROM payroll_staff ps WHERE ps.payroll_id = p.id), 'debit'),
               CASE WHEN EXISTS (SELECT 1 FROM payroll_staff ps WHERE ps.payroll_id = p.id AND bank_amount_fit(l.amount, ps.net_amount, 'debit') >= 55)
                    THEN 45 ELSE 0 END),
      CASE WHEN upper(v_text) ~ '(SALARY|\mSAL\M|PAYROLL|WAGE)' THEN 25 ELSE 0 END
    FROM payroll p
    WHERE l.direction = 'debit' AND p.transfer_id IS NULL
      AND p.end_date BETWEEN l.value_date - 60 AND l.value_date + 30
    UNION ALL
    SELECT 'sale', s.id, btrim(COALESCE(s.invoice_number, '') || ' ' || COALESCE(s.sales_description, '')),
      COALESCE(c.client_name, '') || ' · ' || CASE WHEN s.carried_forward THEN 'owed from last year' ELSE s.sales_status::text END,
      s.amount, s.date,
      (s.bank_ref IS NOT NULL AND s.bank_ref = l.reference_code), bank_text_names_code(v_text, s.invoice_number),
      greatest(bank_amount_fit(l.amount, s.amount, 'credit'),
               bank_amount_fit(l.amount, s.amount - COALESCE(w.expected_wht, 0), 'credit'),
               CASE WHEN l.amount < s.amount AND l.amount >= s.amount * 0.85 THEN 30 ELSE 0 END),
      CASE WHEN c.client_name IS NOT NULL AND upper(v_text) LIKE '%' || upper(split_part(c.client_name, ' ', 1)) || '%' THEN 15 ELSE 0 END
    FROM sales s
    LEFT JOIN clients c ON c.id = s.client_id
    LEFT JOIN v_sale_wht w ON w.sale_id = s.id
    WHERE l.direction = 'credit' AND s.transfer_id IS NULL AND NOT COALESCE(s.is_archived, false)
      AND (s.date BETWEEN l.value_date - 180 AND l.value_date + 10
           OR (s.carried_forward AND s.sales_status = 'Invoiced'))
    UNION ALL
    SELECT 'internal_line', o.line_id, 'Transfer ' || CASE WHEN o.direction = 'debit' THEN 'from ' ELSE 'to ' END || a.account_name,
      COALESCE(o.narration, o.reference, ''), o.amount, o.value_date,
      false, false, CASE WHEN abs(o.amount - l.amount) <= 0.01 THEN 80 ELSE 0 END, 0
    FROM v_bank_line_status o JOIN accounts a ON a.id = o.account_id
    WHERE o.account_id <> l.account_id AND o.direction <> l.direction AND o.reconciled_as IS NULL
      AND abs(o.amount - l.amount) <= 0.01 AND o.value_date BETWEEN l.value_date - 5 AND l.value_date + 5
    UNION ALL
    SELECT 'internal_account', a.id, 'Transfer ' || CASE WHEN l.direction = 'credit' THEN 'from ' ELSE 'to ' END || a.account_name,
      'Kuncho''s own account', l.amount, l.value_date, false, false, 60, 0
    FROM accounts a
    WHERE a.id <> l.account_id AND length(split_part(a.account_name, ' ', 1)) >= 4
      AND upper(v_text) LIKE '%' || upper(split_part(a.account_name, ' ', 1)) || '%'
    UNION ALL
    SELECT 'purchase_order', sb.id, sb.bundle_code, COALESCE(sb.vendor_name, '') || ' · no expense recorded',
      sb.total_value, sb.created_at::date, false, true, bank_amount_fit(l.amount, sb.total_value, l.direction), -30
    FROM sourcing_bundles sb
    WHERE l.direction = 'debit' AND bank_text_names_code(v_text, sb.bundle_code)
      AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.id = sb.expense_id OR e.sourcing_bundle_id = sb.id)
  )
  SELECT c.kind, c.target_id, c.label, c.detail, round(c.amount, 2), c.target_date,
    (CASE WHEN c.ref_hit THEN 100
          WHEN c.code_hit AND c.fit >= 40 THEN 95
          WHEN c.code_hit THEN 70
          ELSE c.fit END + c.bonus)::int AS score,
    CASE WHEN c.ref_hit THEN 'Reference is its bank reference'
         WHEN c.kind = 'purchase_order' THEN 'Narration names this purchase order, but its payment was never recorded — record it on the order, then match'
         WHEN c.code_hit AND c.fit >= 55 AND abs(l.amount - c.amount) > 0.01 THEN 'Narration names it; amount plus a ' || round(l.amount - c.amount, 2) || ' fee'
         WHEN c.code_hit AND c.fit >= 40 THEN 'Narration names it and the amount fits'
         WHEN c.code_hit THEN 'Narration names it, but the amount differs'
         WHEN c.kind = 'payroll' THEN CASE WHEN c.bonus > 0 THEN 'Salary narration; ' ELSE '' END || c.detail
         WHEN c.kind = 'sale' AND c.fit = 30 THEN 'Less than the invoice by ' || round(c.amount - l.amount, 2) || ' — withholding or deductions?'
         WHEN c.kind = 'internal_line' THEN 'Same amount, opposite direction, on another account'
         WHEN c.kind = 'internal_account' THEN 'Narration mentions this bank'
         WHEN c.fit >= 60 THEN 'Same amount'
         WHEN c.fit >= 55 THEN 'Amount plus a ' || round(l.amount - c.amount, 2) || ' fee'
         ELSE 'Amount is close' END
  FROM cand c
  WHERE c.ref_hit OR c.code_hit OR c.fit >= 20
  ORDER BY 7 DESC, abs(c.target_date - l.value_date)
  LIMIT 10;
END; $function$;

CREATE OR REPLACE FUNCTION auto_reconcile_bank_lines_pass(p_import_id uuid DEFAULT NULL::uuid, p_account_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; s record; s2 record; v_expense uuid; v_batch uuid; v_sale uuid; v_part uuid; v_done int := 0; ru record;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can reconcile bank lines';
  END IF;
  FOR r IN
    SELECT st.* FROM v_bank_line_status st
    WHERE st.reconciled_as IS NULL AND st.transfer_id IS NOT NULL
      AND (p_import_id IS NULL OR st.import_id = p_import_id)
      AND (p_account_id IS NULL OR st.account_id = p_account_id)
      AND NOT bank_period_closed(st.account_id, st.value_date)
    ORDER BY st.value_date, st.line_no
  LOOP
    v_expense := NULL; v_batch := NULL; v_sale := NULL; v_part := NULL;
    IF r.reference_code IS NOT NULL THEN
      IF r.direction = 'debit' THEN
        SELECT q.id INTO v_part FROM expense_payments q
          WHERE q.bank_ref = r.reference_code AND q.state = 'sent' AND q.transfer_id IS NULL LIMIT 1;
        IF v_part IS NULL THEN
          SELECT e.id, x.batch_payment_id INTO v_expense, v_batch FROM expenses e
            LEFT JOIN batch_payment_expenses x ON x.expense_id = e.id
            WHERE e.bank_ref = r.reference_code AND e.transfer_id IS NULL AND NOT e.in_parts LIMIT 1;
        END IF;
      ELSE
        SELECT id INTO v_sale FROM sales WHERE bank_ref = r.reference_code AND transfer_id IS NULL LIMIT 1;
      END IF;
      IF COALESCE(v_part, v_batch, v_expense, v_sale) IS NOT NULL THEN
        BEGIN
          IF v_part IS NOT NULL THEN PERFORM apply_bank_line_match(r.line_id, 'expense_part', v_part);
          ELSIF v_batch IS NOT NULL THEN PERFORM apply_bank_line_match(r.line_id, 'batch', v_batch);
          ELSIF v_expense IS NOT NULL THEN PERFORM apply_bank_line_match(r.line_id, 'expense', v_expense);
          ELSE PERFORM apply_bank_line_match(r.line_id, 'sale', v_sale); END IF;
          v_done := v_done + 1; CONTINUE;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
      END IF;
    END IF;
    SELECT * INTO s FROM suggest_bank_line_matches(r.line_id) x ORDER BY x.score DESC LIMIT 1;
    SELECT * INTO s2 FROM suggest_bank_line_matches(r.line_id) x ORDER BY x.score DESC OFFSET 1 LIMIT 1;
    IF s.score >= 95 AND s.kind IN ('expense', 'expense_part', 'batch', 'vrf', 'sale') AND (s2.score IS NULL OR s2.score < 95) THEN
      BEGIN
        PERFORM apply_bank_line_match(r.line_id, s.kind, s.target_id); v_done := v_done + 1; CONTINUE;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
    SELECT * INTO ru FROM bank_line_rules b
      WHERE b.is_active AND (b.direction IS NULL OR b.direction = r.direction)
        AND (b.account_id IS NULL OR b.account_id = r.account_id)
        AND upper(COALESCE(r.narration, '') || ' ' || COALESCE(r.reference, '') || ' ' || COALESCE(r.transaction_type, ''))
            LIKE '%' || upper(btrim(b.match_text)) || '%'
      ORDER BY length(b.match_text) DESC LIMIT 1;
    IF ru.id IS NOT NULL THEN
      BEGIN
        IF ru.classification = 'internal_transfer' THEN
          PERFORM pair_internal_transfer(r.line_id, NULL, ru.counter_account_id, ru.note);
        ELSE
          PERFORM classify_bank_line(r.line_id, ru.classification, ru.note);
        END IF;
        UPDATE bank_line_rules SET times_applied = times_applied + 1, last_applied_at = now() WHERE id = ru.id;
        v_done := v_done + 1;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
  END LOOP;
  RETURN v_done;
END; $function$;

-- ── Grants ──────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION expense_parts_refresh(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION expense_parts_replace_plan(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION expense_part_post(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION apply_po_payment_plan(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION set_expense_payment_plan(uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION pay_expense_part(uuid, uuid, text, uuid, numeric, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION pay_expense_amount(uuid, numeric, uuid, text, uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION confirm_expense_part_cash(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION match_expense_part_to_transfer(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION unsend_expense_part(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION reverse_expense_part(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION save_expense_part_request(uuid, text, jsonb, jsonb, text, numeric, text, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_expense_payment_plan(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION pay_expense_part(uuid, uuid, text, uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION pay_expense_amount(uuid, numeric, uuid, text, uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_expense_part_cash(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION match_expense_part_to_transfer(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION unsend_expense_part(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION reverse_expense_part(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION save_expense_part_request(uuid, text, jsonb, jsonb, text, numeric, text, text[], text) TO authenticated;

-- ── Fold the old split back together ───────────────────────────────────────
-- The paid share and its remainder become one expense with two parts: the
-- first already paid (and already in the books under the expense), the
-- second planned. The remainder expense is archived; its recorded bill is
-- taken back out of the books by the accrual sync.
DO $$
DECLARE ch expenses%ROWTYPE; par expenses%ROWTYPE; v_admin uuid;
BEGIN
  SELECT id INTO v_admin FROM user_profiles WHERE role = 'admin' ORDER BY created_at LIMIT 1;
  -- The finance-field guards check the caller's role; act as an admin.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  PERFORM set_config('app.notify_off', 'on', true);
  FOR ch IN SELECT * FROM expenses c
            WHERE c.split_parent_id IS NOT NULL AND NOT COALESCE(c.is_archived, false)
              AND c.payment_state IN ('unpaid', 'approved_to_pay') AND c.transfer_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM payment_requests r WHERE r.expense_id = c.id)
              AND NOT EXISTS (SELECT 1 FROM batch_payment_expenses x WHERE x.expense_id = c.id)
              AND NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.source_table = 'expenses' AND j.source_id = c.id)
  LOOP
    SELECT * INTO par FROM expenses WHERE id = ch.split_parent_id;
    CONTINUE WHEN par.id IS NULL OR par.payment_state <> 'paid' OR par.in_parts
               OR COALESCE(par.credit_applied_etb, 0) > 0 OR COALESCE(ch.credit_applied_etb, 0) > 0;

    PERFORM set_config('kuncho.parts_sync', 'on', true);
    PERFORM set_config('kuncho.expense_admin_op', 'on', true);
    INSERT INTO expense_payments (expense_id, seq, kind, amount_etb, wht_etb, state, payment_method, account_id,
                                  disbursed_by, bank_ref, transfer_id, sent_at, paid_date, legacy_entry, note)
    VALUES (par.id, 1, 'installment', par.amount_etb, COALESCE(par.wht_amount, 0), 'paid', par.payment_method, par.account_id,
            par.disbursed_by, par.bank_ref, par.transfer_id, par.payment_state_changed_at, COALESCE(par.paid_date::date, par.date), true,
            'Paid with the old Pay part button, before payments in parts existed');
    INSERT INTO expense_payments (expense_id, seq, kind, amount_etb, due_on, note)
    VALUES (par.id, 2, 'final', ch.amount_etb, 'date',
            format('The rest — it was split off as %s and is folded back in', COALESCE(ch.expense_code, ch.id::text)));

    UPDATE expenses SET
      amount_etb = par.amount_etb + ch.amount_etb,
      wht_amount = NULLIF(COALESCE(par.wht_amount, 0) + COALESCE(ch.wht_amount, 0), 0),
      in_parts = true,
      notes = concat_ws(E'\n', NULLIF(notes, ''), format('Payments in parts: %s folded back in as part 2 of 2', COALESCE(ch.expense_code, ch.id::text)))
    WHERE id = par.id;

    UPDATE expenses SET is_archived = true,
      notes = concat_ws(E'\n', NULLIF(notes, ''), format('Folded back into %s as its part 2 of 2 (payments in parts)', COALESCE(par.expense_code, par.id::text)))
    WHERE id = ch.id;

    PERFORM expense_parts_refresh(par.id);
    PERFORM set_config('kuncho.expense_admin_op', 'off', true);
    PERFORM set_config('kuncho.parts_sync', 'off', true);
  END LOOP;
  PERFORM set_config('app.notify_off', 'off', true);
END $$;
