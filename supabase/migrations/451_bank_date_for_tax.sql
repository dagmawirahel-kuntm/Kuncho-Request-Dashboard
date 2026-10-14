-- 451 — The bank's date for tax and the books; "marked paid" stays as entered
--
-- Matching an expense to its bank statement line flipped it to paid but
-- never kept the bank's date. Withholding was then filed by whatever date
-- someone typed when marking it paid (or the expense date), so payments
-- landed in the wrong tax month: 13 of 185 matched expenses, 7 of them
-- with withholding (ETB 20,105 in the wrong month).
--
--   • expenses.bank_date — the date the money left per the bank statement.
--     Derived, never typed: from the expense's own bank line, its batch's
--     line, its vendor request's line, or (paid in parts) its last matched
--     part. Set on match, cleared on unmatch, follows a corrected line date.
--   • paid_date / payment_state_changed_at are untouched: they remain the
--     "marked paid" date and moment.
--   • Withholding (WHT payable by month, receipts to prepare, the tax plan)
--     uses the bank date first. Input VAT stays on the invoice date.
--   • The ledger's payment entry (cash out) is dated by the bank date, so
--     the books' cash equals the statement each month. Existing entries are
--     moved too, closed months included; every move is listed in
--     journal_entry_redates.

SET search_path TO public;

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS bank_date date;
COMMENT ON COLUMN expenses.bank_date IS 'Date the money left per the matched bank statement line — used for withholding and the ledger payment entry (451). paid_date stays as the marked-paid date.';

CREATE TABLE IF NOT EXISTS journal_entry_redates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  expense_id       uuid,
  old_date         date NOT NULL,
  new_date         date NOT NULL,
  reason           text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE journal_entry_redates IS 'Every ledger payment entry moved to (or back from) a bank date (451).';
ALTER TABLE journal_entry_redates ENABLE ROW LEVEL SECURITY;
CREATE POLICY journal_entry_redates_read ON journal_entry_redates FOR SELECT
  USING (get_user_role() IN ('admin', 'finance', 'executive'));

-- The bank date of one expense, from whatever it is matched through.
CREATE OR REPLACE FUNCTION public.expense_bank_date_for(p_id uuid, p_transfer uuid, p_vrf uuid, p_in_parts boolean)
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT CASE WHEN p_in_parts THEN
    (SELECT max(t.date) FROM expense_payments q JOIN transfers t ON t.id = q.transfer_id
      WHERE q.expense_id = p_id AND q.state = 'paid')
  ELSE COALESCE(
    (SELECT t.date FROM transfers t WHERE t.id = p_transfer),
    (SELECT t.date FROM batch_payment_expenses x JOIN batch_payments b ON b.id = x.batch_payment_id
       JOIN transfers t ON t.id = b.transfer_id WHERE x.expense_id = p_id ORDER BY t.date DESC LIMIT 1),
    (SELECT t.date FROM vendor_receipt_facilitation v JOIN transfers t ON t.id = v.out_transfer_id WHERE v.id = p_vrf))
  END
$function$;

-- Always derived: any write to bank_date (or to what it comes from) recomputes it.
CREATE OR REPLACE FUNCTION public.trg_expense_bank_date()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  NEW.bank_date := expense_bank_date_for(NEW.id, NEW.transfer_id,
    COALESCE(NEW.vendor_receipt_facilitation_id, NEW.vrf_id), COALESCE(NEW.in_parts, false));
  RETURN NEW;
END $function$;
CREATE OR REPLACE TRIGGER trg_expense_bank_date
  BEFORE INSERT OR UPDATE OF transfer_id, vendor_receipt_facilitation_id, vrf_id, in_parts, bank_date ON expenses
  FOR EACH ROW EXECUTE FUNCTION trg_expense_bank_date();

-- Date the expense's payment entries by the bank (or, unmatched, back to the
-- marked-paid date). Payment histories that were reversed are left alone.
CREATE OR REPLACE FUNCTION public.expense_redate_payment_entries(p_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE e expenses%ROWTYPE; j record; v_date date; n integer := 0;
BEGIN
  SELECT * INTO e FROM expenses WHERE id = p_id;
  IF NOT FOUND OR COALESCE(e.in_parts, false) THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM journal_entries WHERE source_table = 'expenses' AND source_id = p_id AND description LIKE 'Reversed%') THEN
    RETURN 0;
  END IF;
  FOR j IN SELECT id, entry_date, description FROM journal_entries
            WHERE source_table = 'expenses' AND source_id = p_id
              AND (description LIKE 'Bill paid:%' OR description LIKE 'Paid ahead of delivery:%'
                OR description LIKE 'Vendor advance recorded:%' OR description LIKE 'Expense paid:%') LOOP
    v_date := COALESCE(e.bank_date,
      CASE WHEN j.description LIKE 'Bill paid:%' OR j.description LIKE 'Paid ahead of delivery:%'
           THEN COALESCE(e.paid_date::date, e.payment_state_changed_at::date)
           ELSE e.date END);
    IF v_date IS NOT NULL AND v_date <> j.entry_date THEN
      UPDATE journal_entries SET entry_date = v_date WHERE id = j.id;
      INSERT INTO journal_entry_redates (journal_entry_id, expense_id, old_date, new_date, reason)
      VALUES (j.id, p_id, j.entry_date, v_date,
              CASE WHEN e.bank_date IS NOT NULL THEN 'Dated by the bank statement line'
                   ELSE 'Bank line unmatched — back to the marked-paid date' END);
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $function$;

CREATE OR REPLACE FUNCTION public.trg_expense_bank_date_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM expense_redate_payment_entries(NEW.id);
  RETURN NULL;
END $function$;
-- Runs before trg_post_expense_payment_to_ledger (name order), which itself
-- posts new payment entries on the bank date.
CREATE OR REPLACE TRIGGER trg_expense_bank_date_ledger
  AFTER UPDATE OF bank_date ON expenses
  FOR EACH ROW WHEN (OLD.bank_date IS DISTINCT FROM NEW.bank_date)
  EXECUTE FUNCTION trg_expense_bank_date_ledger();

-- Matches made elsewhere reach the expense by touching bank_date.
CREATE OR REPLACE FUNCTION public.touch_expense_bank_dates(p_ids uuid[])
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $function$
  UPDATE expenses SET bank_date = bank_date WHERE id = ANY (p_ids);
$function$;

CREATE OR REPLACE FUNCTION public.trg_bank_date_from_batch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF TG_TABLE_NAME = 'batch_payments' THEN
    PERFORM touch_expense_bank_dates(ARRAY(SELECT expense_id FROM batch_payment_expenses WHERE batch_payment_id = NEW.id));
  ELSE
    PERFORM touch_expense_bank_dates(ARRAY[CASE WHEN TG_OP = 'DELETE' THEN OLD.expense_id ELSE NEW.expense_id END]);
  END IF;
  RETURN NULL;
END $function$;
CREATE OR REPLACE TRIGGER trg_bank_date_from_batch
  AFTER UPDATE OF transfer_id ON batch_payments
  FOR EACH ROW WHEN (OLD.transfer_id IS DISTINCT FROM NEW.transfer_id)
  EXECUTE FUNCTION trg_bank_date_from_batch();
CREATE OR REPLACE TRIGGER trg_bank_date_from_batch_member
  AFTER INSERT OR DELETE ON batch_payment_expenses
  FOR EACH ROW EXECUTE FUNCTION trg_bank_date_from_batch();

CREATE OR REPLACE FUNCTION public.trg_bank_date_from_vrf()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM touch_expense_bank_dates(ARRAY(SELECT id FROM expenses WHERE vendor_receipt_facilitation_id = NEW.id OR vrf_id = NEW.id));
  RETURN NULL;
END $function$;
CREATE OR REPLACE TRIGGER trg_bank_date_from_vrf
  AFTER UPDATE OF out_transfer_id ON vendor_receipt_facilitation
  FOR EACH ROW WHEN (OLD.out_transfer_id IS DISTINCT FROM NEW.out_transfer_id)
  EXECUTE FUNCTION trg_bank_date_from_vrf();

CREATE OR REPLACE FUNCTION public.trg_bank_date_from_part()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM touch_expense_bank_dates(ARRAY[CASE WHEN TG_OP = 'DELETE' THEN OLD.expense_id ELSE NEW.expense_id END]);
  RETURN NULL;
END $function$;
CREATE OR REPLACE TRIGGER trg_bank_date_from_part
  AFTER INSERT OR DELETE OR UPDATE OF transfer_id, state ON expense_payments
  FOR EACH ROW EXECUTE FUNCTION trg_bank_date_from_part();

-- A corrected bank line date follows through to everything it paid.
CREATE OR REPLACE FUNCTION public.trg_bank_date_from_transfer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM touch_expense_bank_dates(ARRAY(
    SELECT id FROM expenses WHERE transfer_id = NEW.id
    UNION SELECT x.expense_id FROM batch_payment_expenses x JOIN batch_payments b ON b.id = x.batch_payment_id WHERE b.transfer_id = NEW.id
    UNION SELECT e.id FROM expenses e JOIN vendor_receipt_facilitation v ON v.id = COALESCE(e.vendor_receipt_facilitation_id, e.vrf_id) WHERE v.out_transfer_id = NEW.id
    UNION SELECT q.expense_id FROM expense_payments q WHERE q.transfer_id = NEW.id));
  RETURN NULL;
END $function$;
CREATE OR REPLACE TRIGGER trg_bank_date_from_transfer
  AFTER UPDATE OF date ON transfers
  FOR EACH ROW WHEN (OLD.date IS DISTINCT FROM NEW.date)
  EXECUTE FUNCTION trg_bank_date_from_transfer();

REVOKE EXECUTE ON FUNCTION expense_bank_date_for(uuid, uuid, uuid, boolean), expense_redate_payment_entries(uuid),
  touch_expense_bank_dates(uuid[]) FROM PUBLIC, anon, authenticated;

-- ── New payment entries post on the bank date ─────────────────────────
DO $$
DECLARE d text; n int;
BEGIN
  d := pg_get_functiondef('post_expense_payment_to_ledger'::regproc);
  n := (length(d) - length(replace(d, 'COALESCE(NEW.paid_date, NEW.payment_state_changed_at::date, CURRENT_DATE)', ''))) / length('COALESCE(NEW.paid_date, NEW.payment_state_changed_at::date, CURRENT_DATE)');
  IF n <> 1 THEN RAISE EXCEPTION 'post_expense_payment_to_ledger: expected 1 accrual payment date, found %', n; END IF;
  d := replace(d, 'COALESCE(NEW.paid_date, NEW.payment_state_changed_at::date, CURRENT_DATE)',
                  'COALESCE(NEW.bank_date, NEW.paid_date::date, NEW.payment_state_changed_at::date, CURRENT_DATE)');
  -- Cash-basis entries that move money: the advance paid and the plain payment.
  IF position('VALUES (NEW.date,''operational'',''expenses'',NEW.id,''Vendor advance recorded: ''' in d) = 0
     OR position('VALUES (NEW.date,''operational'',''expenses'',NEW.id,''Expense paid: ''' in d) = 0 THEN
    RAISE EXCEPTION 'post_expense_payment_to_ledger: cash-basis entries not found';
  END IF;
  d := replace(d, 'VALUES (NEW.date,''operational'',''expenses'',NEW.id,''Vendor advance recorded: ''',
                  'VALUES (COALESCE(NEW.bank_date, NEW.date),''operational'',''expenses'',NEW.id,''Vendor advance recorded: ''');
  d := replace(d, 'VALUES (NEW.date,''operational'',''expenses'',NEW.id,''Expense paid: ''',
                  'VALUES (COALESCE(NEW.bank_date, NEW.date),''operational'',''expenses'',NEW.id,''Expense paid: ''');
  EXECUTE d;
END $$;

-- ── Withholding follows the bank date ─────────────────────────────────
DO $$
DECLARE d text; old_expr text := 'COALESCE(e.total_payment_date, e.paid_date::date, e.date)';
BEGIN
  d := pg_get_functiondef('tax_plan_compute'::regproc);
  IF position(old_expr in d) = 0 THEN RAISE EXCEPTION 'tax_plan_compute: payment date expression not found'; END IF;
  EXECUTE replace(d, old_expr, 'COALESCE(e.bank_date, e.total_payment_date, e.paid_date::date, e.date)');
END $$;

DO $$
DECLARE d text; old_expr text := 'COALESCE(e.total_payment_date, (e.paid_date)::date, e.date)';
        old_vrf text := 'COALESCE(f.sent_date, f.trxn_date)';
        new_vrf text := 'COALESCE((SELECT t.date FROM transfers t WHERE t.id = f.out_transfer_id), f.sent_date, f.trxn_date)';
BEGIN
  d := pg_get_viewdef('v_wht_payable_by_ec_period'::regclass);
  IF position(old_expr in d) = 0 OR position(old_vrf in d) = 0 THEN RAISE EXCEPTION 'v_wht_payable_by_ec_period: date expressions not found'; END IF;
  d := replace(d, old_expr, 'COALESCE(e.bank_date, e.total_payment_date, (e.paid_date)::date, e.date)');
  d := replace(d, old_vrf, new_vrf);
  EXECUTE 'CREATE OR REPLACE VIEW v_wht_payable_by_ec_period WITH (security_invoker = true) AS ' || d;
END $$;

CREATE OR REPLACE VIEW v_wht_receipts_to_prepare WITH (security_invoker = true) AS
SELECT e.id AS expense_id, e.expense_code, e.date, e.paid_date, e.amount_etb, e.wht_amount, e.net_payable,
       e.vendor_id, v.vendor_name, v.tin AS vendor_tin, e.project_id, p.project_name, e.disbursed_by,
       e.bank_date,
       COALESCE(e.bank_date, e.total_payment_date, e.paid_date::date, e.date) AS tax_date
  FROM expenses e
  LEFT JOIN vendors v ON v.id = e.vendor_id
  LEFT JOIN projects p ON p.id = e.project_id
 WHERE e.payment_state = 'paid' AND COALESCE(e.wht_amount, 0) > 0
   AND e.wht_receipt_prepared = false AND NOT COALESCE(e.is_archived, false);

-- ── Backfill: every expense already matched gets its bank date, and its
--    payment entries move to it (closed months included; see
--    journal_entry_redates). ─────────────────────────────────────────────
UPDATE expenses e SET bank_date = bank_date
 WHERE e.transfer_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM batch_payment_expenses x JOIN batch_payments b ON b.id = x.batch_payment_id WHERE x.expense_id = e.id AND b.transfer_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM vendor_receipt_facilitation v WHERE v.id = COALESCE(e.vendor_receipt_facilitation_id, e.vrf_id) AND v.out_transfer_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM expense_payments q WHERE q.expense_id = e.id AND q.transfer_id IS NOT NULL);
