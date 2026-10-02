-- 403: Reverse a payment, or delete an expense — admin only, never once
-- the bank has confirmed it.
--
-- A payment recorded by mistake (PO-2026-0261: an advance to Surafel
-- Getiye entered before the money left) had no way back short of hand-
-- written SQL. Deleting a paid expense from the list left its ledger
-- entries behind. Two admin tools replace both:
--
--   reverse_expense_payment(id, reason, entry_date)
--     · takes the expense back to "approved, awaiting payment" (or "sent"
--       back to approved), clears who paid and the bank reference;
--     · posts one adjusting entry that cancels every payment entry,
--       account by account, dated the original payment unless told
--       otherwise. The original entry stays, both are labelled
--       'expense_payment_reversed', so a later real payment posts afresh;
--     · keeps the bill itself: an approved bill is recorded as owed again
--       (sync_expense_accrual), the same as any other approved bill.
--
--   delete_expense(id, reason)
--     · reverses the payment first if there is one, voids its payment
--       requests, takes the bill out of the books, keeps a full snapshot,
--       then deletes the row. If other records still point at it (a
--       payment request, an asset, a GRN…) it stays archived and void
--       instead — out of every list and every total.
--
-- Both refuse an expense the bank has confirmed: matched to a bank line or
-- transfer, inside a matched batch, or a vendor request whose payment was
-- matched. That is final here; the match itself can only be undone in
-- bank reconciliation, where it is logged on its own.
--
-- Every use is written to expense_admin_actions with the reason, who and
-- when. Direct deletes and hand edits can no longer get around it: a
-- trigger refuses to delete a bank-matched or paid expense, or to move a
-- paid one backwards, outside these two functions.

-- ── Log ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expense_admin_actions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id        uuid NOT NULL,          -- no FK: the expense may be gone
  expense_code      text,
  action            text NOT NULL CHECK (action IN ('payment_reversed', 'deleted', 'archived')),
  from_state        text,
  to_state          text,
  amount_etb        numeric,
  bank_ref          text,
  reason            text NOT NULL,
  entry_date        date,
  reversal_entry_id uuid,
  snapshot          jsonb,
  done_by           uuid DEFAULT auth.uid(),
  done_at           timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_admin_actions_done_by_fkey') THEN
    ALTER TABLE expense_admin_actions ADD CONSTRAINT expense_admin_actions_done_by_fkey
      FOREIGN KEY (done_by) REFERENCES user_profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS expense_admin_actions_expense_idx ON expense_admin_actions (expense_id, done_at DESC);
ALTER TABLE expense_admin_actions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'expense_admin_actions' AND policyname = 'expense_admin_actions_read') THEN
    CREATE POLICY expense_admin_actions_read ON expense_admin_actions FOR SELECT TO authenticated
      USING (COALESCE(get_user_role()::text IN ('admin', 'finance', 'executive'), false));
  END IF;
END $$;
GRANT SELECT ON expense_admin_actions TO authenticated;

-- ── Has the bank confirmed this expense? ────────────────────────────────
-- Plain words for why, or NULL when nothing at the bank points at it.
CREATE OR REPLACE FUNCTION expense_bank_match(p_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT 'it is matched to bank transfer ' || COALESCE(t.transfer_id_code, '(no code)')
       FROM expenses e LEFT JOIN transfers t ON t.id = e.transfer_id
      WHERE e.id = p_id AND e.transfer_id IS NOT NULL),
    (SELECT 'it is matched to the bank statement line of ' || to_char(l.value_date, 'DD Mon YYYY')
       FROM bank_statement_lines l WHERE l.matched_expense_id = p_id LIMIT 1),
    (SELECT 'it was paid in batch ' || COALESCE(b.payment_code, '') || ', which is matched to the bank'
       FROM batch_payment_expenses x JOIN batch_payments b ON b.id = x.batch_payment_id
      WHERE x.expense_id = p_id AND b.transfer_id IS NOT NULL LIMIT 1),
    (SELECT 'its vendor request ' || COALESCE(v.record_name, '') || ' was paid and matched to the bank'
       FROM expenses e JOIN vendor_receipt_facilitation v ON v.id = COALESCE(e.vendor_receipt_facilitation_id, e.vrf_id)
      WHERE e.id = p_id AND v.out_transfer_id IS NOT NULL)
  )
$$;

-- ── What reversing would do (for the confirm dialog) ────────────────────
CREATE OR REPLACE FUNCTION expense_reversal_preview(p_expense_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  e        expenses%ROWTYPE;
  v_match  text;
  v_why    text;
  v_lines  jsonb;
  v_date   date;
  v_back   text;
BEGIN
  IF NOT COALESCE(get_user_role() = 'admin', false) THEN
    RETURN jsonb_build_object('allowed', false, 'why_not', 'Only an admin can reverse a payment or delete an expense');
  END IF;
  SELECT * INTO e FROM expenses WHERE id = p_expense_id;
  IF e.id IS NULL THEN RETURN jsonb_build_object('allowed', false, 'why_not', 'Expense not found'); END IF;

  v_match := expense_bank_match(p_expense_id);
  IF v_match IS NOT NULL THEN
    v_why := 'The bank has confirmed this payment — ' || v_match || '. It can no longer be reversed or deleted.';
  ELSIF COALESCE(e.credit_applied_etb, 0) > 0 THEN
    v_why := 'Part of this was paid from vendor credit — take the credit off first.';
  END IF;

  SELECT min(je.entry_date) INTO v_date FROM journal_entries je WHERE je.source_table = 'expenses' AND je.source_id = p_expense_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('account', c.account_name, 'code', c.account_code,
                                              'debit', GREATEST(-x.net, 0), 'credit', GREATEST(x.net, 0)) ORDER BY x.net), '[]'::jsonb)
    INTO v_lines
    FROM (SELECT jl.account_id, sum(jl.debit - jl.credit) AS net
            FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
           WHERE je.source_table = 'expenses' AND je.source_id = p_expense_id
           GROUP BY 1 HAVING abs(sum(jl.debit - jl.credit)) >= 0.005) x
    JOIN chart_of_accounts c ON c.id = x.account_id;

  v_back := CASE WHEN e.finance_approved_by IS NOT NULL OR e.approval_status::text = 'finance_approved' THEN 'approved_to_pay' ELSE 'unpaid' END;

  RETURN jsonb_build_object(
    'allowed',      v_why IS NULL,
    'why_not',      v_why,
    'bank_match',   v_match,
    'state',        e.payment_state,
    'can_reverse',  v_why IS NULL AND e.payment_state IN ('sent', 'paid', 'advance'),
    'can_delete',   v_why IS NULL,
    'back_to',      v_back,
    'entry_date',   COALESCE(v_date, CURRENT_DATE),
    'lines',        v_lines,
    'payment_requests', (SELECT count(*) FROM payment_requests pr WHERE pr.expense_id = p_expense_id AND pr.status = 'issued')
  );
END $$;

-- ── The shared core: cancel the payment entries, move the state back ────
CREATE OR REPLACE FUNCTION expense_undo_payment_core(p_expense_id uuid, p_reason text, p_entry_date date, p_move_state boolean DEFAULT true)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  e       expenses%ROWTYPE;
  v_rev   uuid;
  v_date  date;
  v_back  text;
  r       record;
BEGIN
  SELECT * INTO e FROM expenses WHERE id = p_expense_id FOR UPDATE;

  SELECT COALESCE(p_entry_date, min(je.entry_date), CURRENT_DATE) INTO v_date
    FROM journal_entries je WHERE je.source_table = 'expenses' AND je.source_id = p_expense_id;

  FOR r IN
    SELECT jl.account_id, jl.party_type, jl.party_id, jl.project_id, sum(jl.debit - jl.credit) AS net
      FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
     WHERE je.source_table = 'expenses' AND je.source_id = p_expense_id
     GROUP BY 1, 2, 3, 4
    HAVING abs(sum(jl.debit - jl.credit)) >= 0.005
  LOOP
    IF v_rev IS NULL THEN
      INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description, created_by)
      VALUES (v_date, 'adjusting', 'expense_payment_reversed', p_expense_id,
              'Payment reversed: ' || COALESCE(e.expense_code, p_expense_id::text) || ' — ' || btrim(p_reason), auth.uid())
      RETURNING id INTO v_rev;
    END IF;
    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes, party_type, party_id, project_id)
    VALUES (v_rev, r.account_id, GREATEST(-r.net, 0), GREATEST(r.net, 0), 'Reverses the payment recorded in error',
            r.party_type, r.party_id, r.project_id);
  END LOOP;
  IF v_rev IS NOT NULL THEN
    SET CONSTRAINTS trg_check_journal_entry_balance IMMEDIATE;
    SET CONSTRAINTS trg_check_journal_entry_balance DEFERRED;
  END IF;

  -- The original entries and their reversal now sit together, netting to
  -- nothing; a later real payment posts as if this one never happened.
  UPDATE journal_entries
     SET source_table = 'expense_payment_reversed',
         description  = description || ' (reversed)'
   WHERE source_table = 'expenses' AND source_id = p_expense_id;

  IF p_move_state AND e.payment_state IN ('sent', 'paid', 'advance') THEN
    v_back := CASE WHEN e.finance_approved_by IS NOT NULL THEN 'approved_to_pay' ELSE 'unpaid' END;
    UPDATE expenses
       SET payment_state = v_back,
           disbursed_by = NULL, bank_ref = NULL, paid_date = NULL, total_payment_date = NULL,
           payment_confirmed_by = NULL, payment_confirmed_at = NULL,
           notes = NULLIF(concat_ws(E'\n', NULLIF(notes, ''),
                     format('Payment reversed %s by %s: %s', to_char(now() AT TIME ZONE 'Africa/Addis_Ababa', 'DD Mon YYYY'),
                            COALESCE((SELECT full_name FROM user_profiles WHERE id = auth.uid()), 'admin'), btrim(p_reason))), '')
     WHERE id = p_expense_id;
  END IF;
  RETURN v_rev;
END $$;
REVOKE ALL ON FUNCTION expense_undo_payment_core(uuid, text, date, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION expense_admin_guard(p_expense_id uuid, p_reason text)
RETURNS expenses
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE e expenses%ROWTYPE; v_match text;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(get_user_role() = 'admin', false) THEN
    RAISE EXCEPTION 'Only an admin can reverse a payment or delete an expense';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Say why — the reason is kept with the record'; END IF;
  SELECT * INTO e FROM expenses WHERE id = p_expense_id;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Expense not found'; END IF;
  v_match := expense_bank_match(p_expense_id);
  IF v_match IS NOT NULL THEN
    RAISE EXCEPTION 'The bank has confirmed this payment — %. It can no longer be reversed or deleted.', v_match;
  END IF;
  IF COALESCE(e.credit_applied_etb, 0) > 0 THEN
    RAISE EXCEPTION 'Part of this was paid from vendor credit — take the credit off first';
  END IF;
  RETURN e;
END $$;
REVOKE ALL ON FUNCTION expense_admin_guard(uuid, text) FROM PUBLIC, anon, authenticated;

-- ── Reverse a payment ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reverse_expense_payment(p_expense_id uuid, p_reason text, p_entry_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  e      expenses%ROWTYPE;
  v_rev  uuid;
  v_to   text;
BEGIN
  e := expense_admin_guard(p_expense_id, p_reason);
  IF e.payment_state NOT IN ('sent', 'paid', 'advance') THEN
    RAISE EXCEPTION 'There is no payment to reverse — this expense is %', replace(e.payment_state, '_', ' ');
  END IF;

  PERFORM set_config('kuncho.expense_admin_op', 'on', true);
  v_rev := expense_undo_payment_core(p_expense_id, p_reason, p_entry_date);
  PERFORM set_config('kuncho.expense_admin_op', 'off', true);

  SELECT payment_state INTO v_to FROM expenses WHERE id = p_expense_id;
  INSERT INTO expense_admin_actions (expense_id, expense_code, action, from_state, to_state, amount_etb, bank_ref, reason,
                                     entry_date, reversal_entry_id, snapshot)
  VALUES (p_expense_id, e.expense_code, 'payment_reversed', e.payment_state, v_to, e.amount_etb, e.bank_ref, btrim(p_reason),
          (SELECT entry_date FROM journal_entries WHERE id = v_rev), v_rev, to_jsonb(e));

  RETURN jsonb_build_object('expense_code', e.expense_code, 'from', e.payment_state, 'to', v_to, 'reversal_entry_id', v_rev);
END $$;

-- ── Delete an expense ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION delete_expense(p_expense_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  e       expenses%ROWTYPE;
  v_rev   uuid;
  v_log   uuid;
  v_snap  jsonb;
  v_gone  boolean := false;
BEGIN
  e := expense_admin_guard(p_expense_id, p_reason);
  PERFORM set_config('kuncho.expense_admin_op', 'on', true);

  -- 1. Take any payment back out of the books first.
  IF e.payment_state IN ('sent', 'paid', 'advance')
     OR EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'expenses' AND source_id = p_expense_id) THEN
    -- The state is left alone: step 3 voids it outright, so the bill is
    -- not briefly recorded as owed again only to be taken out.
    v_rev := expense_undo_payment_core(p_expense_id, p_reason, NULL, false);
  END IF;

  -- 2. Nothing left to pay it with.
  UPDATE payment_requests
     SET status = 'void', voided_by = auth.uid(), voided_at = now(), void_reason = 'Expense deleted: ' || btrim(p_reason)
   WHERE expense_id = p_expense_id AND status = 'issued';

  -- 3. Void and archive: the bill leaves the books (sync_expense_accrual
  --    and the input VAT sync both net themselves to nothing).
  UPDATE expenses SET payment_state = 'void', is_archived = true WHERE id = p_expense_id;

  SELECT to_jsonb(x) || jsonb_build_object(
           'order_items', COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM expense_order_items i WHERE i.expense_id = p_expense_id), '[]'::jsonb),
           'labour_workers', COALESCE((SELECT jsonb_agg(to_jsonb(w)) FROM labor_expense_workers w WHERE w.expense_id = p_expense_id), '[]'::jsonb))
    INTO v_snap FROM expenses x WHERE x.id = p_expense_id;
  v_snap := v_snap || jsonb_build_object('before', to_jsonb(e));

  INSERT INTO expense_admin_actions (expense_id, expense_code, action, from_state, to_state, amount_etb, bank_ref, reason,
                                     entry_date, reversal_entry_id, snapshot)
  VALUES (p_expense_id, e.expense_code, 'deleted', e.payment_state, 'deleted', e.amount_etb, e.bank_ref, btrim(p_reason),
          (SELECT entry_date FROM journal_entries WHERE id = v_rev), v_rev, v_snap)
  RETURNING id INTO v_log;

  -- 4. Delete the row if nothing else still points at it.
  BEGIN
    DELETE FROM expenses WHERE id = p_expense_id;
    v_gone := true;
  EXCEPTION WHEN foreign_key_violation THEN
    UPDATE expense_admin_actions SET action = 'archived', to_state = 'void',
           reason = reason || ' (kept archived: other records still refer to it)' WHERE id = v_log;
  END;

  PERFORM set_config('kuncho.expense_admin_op', 'off', true);
  RETURN jsonb_build_object('expense_code', e.expense_code, 'deleted', v_gone, 'reversal_entry_id', v_rev);
END $$;

GRANT EXECUTE ON FUNCTION expense_bank_match(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION expense_reversal_preview(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION reverse_expense_payment(uuid, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_expense(uuid, text) TO authenticated;

-- ── No way around it ────────────────────────────────────────────────────
-- Deleting: never once the bank has confirmed it; never a paid or posted
-- expense except through delete_expense.
CREATE OR REPLACE FUNCTION guard_expense_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_match text;
BEGIN
  v_match := expense_bank_match(OLD.id);
  IF v_match IS NOT NULL THEN
    RAISE EXCEPTION 'This expense cannot be deleted — % ', v_match;
  END IF;
  IF COALESCE(current_setting('kuncho.expense_admin_op', true), 'off') <> 'on'
     AND (OLD.payment_state IN ('sent', 'paid', 'advance')
          OR EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'expenses' AND source_id = OLD.id)) THEN
    RAISE EXCEPTION 'This expense has a payment recorded — an admin can delete it from the expense page, which takes the payment back out of the books first';
  END IF;
  RETURN OLD;
END $$;

CREATE OR REPLACE TRIGGER trg_guard_expense_delete
  BEFORE DELETE ON expenses FOR EACH ROW EXECUTE FUNCTION guard_expense_delete();

-- A deleted bill leaves nothing owed behind. Before this, deleting an
-- approved expense left its "Bill approved" entry in the ledger forever.
CREATE OR REPLACE FUNCTION clear_ledger_for_deleted_expense()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'expense_accrual' AND source_id = OLD.id) THEN
    BEGIN
      PERFORM ledger_sync('expense_accrual', OLD.id, COALESCE(OLD.date, CURRENT_DATE),
                          'Bill deleted: ' || COALESCE(OLD.expense_code, OLD.id::text), '[]'::jsonb);
    EXCEPTION WHEN OTHERS THEN
      PERFORM ledger_sync('expense_accrual', OLD.id, CURRENT_DATE,
                          'Bill deleted: ' || COALESCE(OLD.expense_code, OLD.id::text), '[]'::jsonb);
    END;
  END IF;
  RETURN OLD;
END $$;

CREATE OR REPLACE TRIGGER trg_clear_ledger_for_deleted_expense
  AFTER DELETE ON expenses FOR EACH ROW EXECUTE FUNCTION clear_ledger_for_deleted_expense();

-- Moving a paid or advanced expense backwards is a reversal; it goes
-- through reverse_expense_payment so the books follow.
CREATE OR REPLACE FUNCTION guard_expense_payment_undo()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF OLD.payment_state IN ('paid', 'advance')
     AND NEW.payment_state IN ('unpaid', 'approved_to_pay', 'sent', 'void')
     AND COALESCE(current_setting('kuncho.expense_admin_op', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'A recorded payment can only be undone with Reverse payment (admin), which also corrects the books';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_guard_expense_payment_undo
  BEFORE UPDATE OF payment_state ON expenses FOR EACH ROW EXECUTE FUNCTION guard_expense_payment_undo();
