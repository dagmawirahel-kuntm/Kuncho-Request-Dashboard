-- 322 — VRF recorded as its own transaction, not as an expense
--
-- Until now a VRF was typed in as loose figures (amount transferred, money
-- returned, commission, "net facilitation cost", status), and settling it
-- created a "VRF" expense for the whole receipt. That expense counted the
-- same money a second time (the returned money is spent again as ordinary
-- expenses), 8 of them were posted to the ledger as company costs, 11 sat in
-- the approval and to-pay queues long after the money had moved, and
-- v_account_balances counted a VRF's outflow twice once its bank line was
-- matched. Figures were entered inconsistently -- "transferred" sometimes
-- before WHT, sometimes after -- and WHT reached the record on only 5 of 20.
--
-- The new model:
--
--   1. One typed figure, the rest derived. receipt_amount (VAT-inclusive) is
--      entered; WHT is worked out from tax_rate_references (the WHT rate on
--      the pre-VAT value, at or above the goods / services threshold) unless
--      overridden; commission follows an agreed basis -- a % of the receipt,
--      a % of its VAT, or a fixed sum. net_sent and expected_return are
--      generated columns.
--   2. Returns are their own entries (vrf_returns), so a VRF can come back in
--      parts; money_returned and status are derived from them.
--   3. Returned money lands in a holding account -- an account marked
--      is_vrf_holding, with the holder's name. Company payments and personal
--      draws come out of it; v_vrf_holding_accounts shows what each holder
--      keeps for Kuncho.
--   4. No expense. The VRF expenses are archived (kept, not deleted) and the
--      ledger postings they made are reversed. Each VRF posts its own entries
--      through 1085 "VRF Funds in Transit": the bank pays the net sent into
--      transit, the commission is expensed out of it (51057, now "VRF
--      Commission"), and each return moves from transit to its holding
--      account. Transit nets to zero once a VRF reconciles. The WHT is a cost
--      when it is remitted, like every other WHT payment.
--      v_account_balances stops counting a VRF's outflow when its bank line
--      is already counted, and counts returns and personal draws.
--   5. WHT on VRFs feeds v_wht_payable_by_ec_period directly.
--   6. Every VRF has a name; names and facilitators can't be blanked, and
--      323 requires both on new records once the new form is live.
--
-- Existing records are converted by rule, never by hand-picked ids, and every
-- figure the data could not settle is listed on the record (review_notes) for
-- a person to confirm. Nothing the deployed frontend reads is dropped:
-- amount_transferred, money_returned, net_facilitation_cost and status stay,
-- maintained from the new fields on records recorded the new way
-- (structured = true); a record written by the old form keeps its typed
-- figures until the new form is live.

SET search_path TO public;

-- The conversion below writes the ledger and the audit trail as a person.
-- It runs as the first admin account.
DO $$
DECLARE v_admin uuid;
BEGIN
  SELECT id INTO v_admin FROM user_profiles WHERE role = 'admin' ORDER BY created_at NULLS LAST LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
END $$;

-- ── Columns ───────────────────────────────────────────────────────────────

ALTER TABLE vendor_receipt_facilitation
  ADD COLUMN IF NOT EXISTS structured       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS receipt_amount   numeric(14,2) CHECK (receipt_amount IS NULL OR receipt_amount > 0),
  ADD COLUMN IF NOT EXISTS supply_kind      text NOT NULL DEFAULT 'goods' CHECK (supply_kind IN ('goods', 'services')),
  ADD COLUMN IF NOT EXISTS wht_amount       numeric(14,2) CHECK (wht_amount IS NULL OR wht_amount >= 0),
  ADD COLUMN IF NOT EXISTS wht_overridden   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS commission_basis text CHECK (commission_basis IN ('receipt_pct', 'vat_pct', 'fixed')),
  ADD COLUMN IF NOT EXISTS out_transfer_id  uuid REFERENCES transfers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS needs_review     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_notes     text[] NOT NULL DEFAULT '{}';

ALTER TABLE vendor_receipt_facilitation
  ADD COLUMN IF NOT EXISTS net_sent numeric(14,2)
    GENERATED ALWAYS AS (receipt_amount - COALESCE(wht_amount, 0)) STORED,
  ADD COLUMN IF NOT EXISTS expected_return numeric(14,2)
    GENERATED ALWAYS AS (receipt_amount - COALESCE(wht_amount, 0) - COALESCE(commission_amount, 0)) STORED;

-- One bank line pays one VRF.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vrf_out_transfer
  ON vendor_receipt_facilitation(out_transfer_id) WHERE out_transfer_id IS NOT NULL;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS is_vrf_holding boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS holder_name    text;

ALTER TABLE vrf_personal_draws
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id);

-- ── Returns ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vrf_returns (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vrf_id       uuid NOT NULL REFERENCES vendor_receipt_facilitation(id) ON DELETE RESTRICT,
  return_date  date NOT NULL,
  amount       numeric(14,2) NOT NULL CHECK (amount > 0),
  account_id   uuid REFERENCES accounts(id),
  transfer_id  uuid REFERENCES transfers(id) ON DELETE SET NULL,
  note         text,
  created_by   uuid DEFAULT auth.uid(),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vrf_returns_vrf ON vrf_returns(vrf_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vrf_returns_transfer ON vrf_returns(transfer_id) WHERE transfer_id IS NOT NULL;

ALTER TABLE vrf_returns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vrf_returns_read ON vrf_returns;
CREATE POLICY vrf_returns_read ON vrf_returns FOR SELECT
  USING (get_user_role() IN ('admin', 'executive')
    OR (get_user_role() = 'finance' AND EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_vrf_manager = true)));
DROP POLICY IF EXISTS vrf_returns_insert ON vrf_returns;
CREATE POLICY vrf_returns_insert ON vrf_returns FOR INSERT
  WITH CHECK (created_by = auth.uid() AND (get_user_role() IN ('admin', 'executive')
    OR (get_user_role() = 'finance' AND EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_vrf_manager = true))));
DROP POLICY IF EXISTS vrf_returns_update ON vrf_returns;
CREATE POLICY vrf_returns_update ON vrf_returns FOR UPDATE
  USING (get_user_role() IN ('admin', 'executive')
    OR (get_user_role() = 'finance' AND EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_vrf_manager = true)))
  WITH CHECK (get_user_role() IN ('admin', 'executive')
    OR (get_user_role() = 'finance' AND EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_vrf_manager = true)));
DROP POLICY IF EXISTS vrf_returns_delete_admin ON vrf_returns;
CREATE POLICY vrf_returns_delete_admin ON vrf_returns FOR DELETE
  USING (get_user_role() = 'admin');
REVOKE ALL ON vrf_returns FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON vrf_returns TO authenticated;

-- ── Derivation on the VRF record ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.vrf_derive()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE
  v_vat numeric; v_wht jsonb; v_base numeric; v_thr numeric;
  v_returned numeric; v_expected numeric;
BEGIN
  -- Names cannot be blanked once given.
  IF TG_OP = 'UPDATE' AND OLD.record_name IS NOT NULL AND btrim(COALESCE(NEW.record_name, '')) = '' THEN
    RAISE EXCEPTION 'A VRF needs a name';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.facilitator_name IS NOT NULL AND btrim(COALESCE(NEW.facilitator_name, '')) = '' THEN
    RAISE EXCEPTION 'A VRF needs its facilitator';
  END IF;

  IF NOT NEW.structured THEN RETURN NEW; END IF;   -- written by the old form

  IF NEW.receipt_amount IS NULL THEN RAISE EXCEPTION 'Enter the receipt amount'; END IF;
  IF NEW.trxn_date IS NULL THEN RAISE EXCEPTION 'Enter the date the money was sent'; END IF;
  IF NEW.return_account_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.return_account_id AND is_vrf_holding) THEN
    RAISE EXCEPTION 'Returned money has to go to a holding account';
  END IF;

  v_vat := (tax_rate_note('VAT', NEW.trxn_date) ->> 'standard_rate')::numeric;
  v_wht := tax_rate_note('WHT', NEW.trxn_date);

  IF NOT NEW.wht_overridden THEN
    v_base := round(NEW.receipt_amount / (1 + v_vat), 2);
    v_thr  := (v_wht ->> CASE WHEN NEW.supply_kind = 'services' THEN 'services_threshold_etb' ELSE 'goods_threshold_etb' END)::numeric;
    NEW.wht_amount := CASE WHEN v_base >= COALESCE(v_thr, 0) THEN round(v_base * (v_wht ->> 'rate')::numeric, 2) ELSE 0 END;
  ELSIF NEW.wht_amount IS NULL THEN
    RAISE EXCEPTION 'Enter the WHT, or let it be calculated';
  END IF;

  IF NEW.commission_basis IS NULL THEN RAISE EXCEPTION 'Choose how the commission is worked out'; END IF;
  IF NEW.commission_basis = 'receipt_pct' THEN
    NEW.commission_amount := round(NEW.receipt_amount * COALESCE(NEW.commission_rate, 0) / 100, 2);
  ELSIF NEW.commission_basis = 'vat_pct' THEN
    NEW.commission_amount := round(NEW.receipt_amount * v_vat / (1 + v_vat) * COALESCE(NEW.commission_rate, 0) / 100, 2);
  ELSE
    NEW.commission_rate := NULL;
    NEW.commission_amount := COALESCE(NEW.commission_amount, 0);
  END IF;

  -- The legacy figures, kept for everything that still reads them.
  NEW.amount_transferred    := NEW.receipt_amount - COALESCE(NEW.wht_amount, 0);
  NEW.net_facilitation_cost := COALESCE(NEW.commission_amount, 0) + COALESCE(NEW.wht_amount, 0);

  SELECT COALESCE(sum(amount), 0) INTO v_returned FROM vrf_returns WHERE vrf_id = NEW.id;
  NEW.money_returned := v_returned;
  v_expected := NEW.amount_transferred - COALESCE(NEW.commission_amount, 0);
  -- A bank fee of a few birr on the return is normal: 10 birr of slack.
  NEW.status := CASE
    WHEN v_returned <= 0 THEN 'open'
    WHEN v_returned >= v_expected - 10 THEN 'settled'
    ELSE 'partial' END;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.vrf_derive() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_vrf_derive ON vendor_receipt_facilitation;
CREATE TRIGGER trg_vrf_derive
  BEFORE INSERT OR UPDATE ON vendor_receipt_facilitation
  FOR EACH ROW EXECUTE FUNCTION vrf_derive();

-- A return goes to a holding account (the VRF's own, unless another is
-- given); any change to returns re-derives the VRF.
CREATE OR REPLACE FUNCTION public.vrf_returns_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.account_id IS NULL THEN
    SELECT return_account_id INTO NEW.account_id FROM vendor_receipt_facilitation WHERE id = NEW.vrf_id;
  END IF;
  IF NEW.account_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND is_vrf_holding) THEN
    RAISE EXCEPTION 'Returned money has to go to a holding account';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.vrf_returns_guard() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_vrf_returns_guard ON vrf_returns;
CREATE TRIGGER trg_vrf_returns_guard
  BEFORE INSERT OR UPDATE ON vrf_returns
  FOR EACH ROW EXECUTE FUNCTION vrf_returns_guard();

CREATE OR REPLACE FUNCTION public.vrf_returns_touch_parent()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE vendor_receipt_facilitation SET updated_at = now()
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.vrf_id ELSE NEW.vrf_id END
     OR (TG_OP = 'UPDATE' AND id = OLD.vrf_id);
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.vrf_returns_touch_parent() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_vrf_returns_touch_parent ON vrf_returns;
CREATE TRIGGER trg_vrf_returns_touch_parent
  AFTER INSERT OR UPDATE OR DELETE ON vrf_returns
  FOR EACH ROW EXECUTE FUNCTION vrf_returns_touch_parent();

-- Personal draws: from a VRF that has money back, out of its holding account.
CREATE OR REPLACE FUNCTION public.vrf_personal_draws_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE
  v_status text; v_available numeric; v_account uuid;
BEGIN
  SELECT status, return_account_id INTO v_status, v_account FROM vendor_receipt_facilitation WHERE id = NEW.vrf_id;
  IF v_status IS NULL OR v_status NOT IN ('partial', 'settled') THEN
    RAISE EXCEPTION 'Money can only be drawn from a VRF that has had money returned (this one is %)', COALESCE(v_status, 'missing');
  END IF;
  NEW.account_id := COALESCE(NEW.account_id, v_account);
  IF NEW.account_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND is_vrf_holding) THEN
    RAISE EXCEPTION 'A personal draw comes out of a holding account';
  END IF;
  SELECT fund_available INTO v_available FROM v_vrf_fund_status WHERE vrf_id = NEW.vrf_id;
  -- On an edit, the row's own old amount is already counted as drawn.
  IF TG_OP = 'UPDATE' AND OLD.vrf_id = NEW.vrf_id THEN
    v_available := v_available + OLD.amount;
  END IF;
  IF COALESCE(v_available, 0) < NEW.amount THEN
    RAISE EXCEPTION 'This VRF has only % left, cannot draw %', COALESCE(v_available, 0), NEW.amount;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── Ledger ────────────────────────────────────────────────────────────────

INSERT INTO chart_of_accounts (account_code, account_name, nature, parent_account_id, is_postable, active, cash_flow_section)
SELECT '1085', 'VRF Funds in Transit', 'Asset', p.id, true, true, 'operating'
FROM chart_of_accounts p
WHERE p.account_code = '1000'
  AND NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '1085');

UPDATE chart_of_accounts SET account_name = 'VRF Commission'
WHERE account_code = '51057' AND account_name = 'VRF';

-- Rewrites a VRF's own ledger entries from the record: money out of the bank
-- into transit, commission expensed out of transit, each return from transit
-- into its holding account. Only the current fiscal year posts, as with
-- expenses. All of a VRF's entries carry source_table 'vendor_receipt_
-- facilitation' and the VRF's id, so a rewrite replaces them whole. A posting
-- that can't be made is logged to ledger_posting_failures, never raised. A
-- return with no holding account yet stays in transit without a log line:
-- the record's own review list already asks where it went.
CREATE OR REPLACE FUNCTION public.vrf_sync_ledger(p_vrf_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v vendor_receipt_facilitation%ROWTYPE;
  r record;
  v_fy uuid; v_transit uuid; v_comm uuid; v_bank uuid; v_hold uuid; v_entry uuid; v_label text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'executive', 'finance') THEN
    RAISE EXCEPTION 'Only admin, executive or finance can post VRF entries';
  END IF;

  DELETE FROM journal_entries WHERE source_table = 'vendor_receipt_facilitation' AND source_id = p_vrf_id;
  -- A rewrite starts clean: earlier failures for this VRF are superseded.
  DELETE FROM ledger_posting_failures
  WHERE source_table = 'vendor_receipt_facilitation' AND source_id = p_vrf_id AND NOT COALESCE(resolved, false);

  SELECT * INTO v FROM vendor_receipt_facilitation WHERE id = p_vrf_id;
  IF NOT FOUND OR v.is_archived OR NOT v.structured THEN RETURN; END IF;

  SELECT id INTO v_fy FROM fiscal_periods WHERE is_current;
  SELECT id INTO v_transit FROM chart_of_accounts WHERE account_code = '1085';
  SELECT id INTO v_comm FROM chart_of_accounts WHERE account_code = '51057';
  v_label := COALESCE(v.record_name, 'VRF');

  BEGIN
    IF fiscal_period_for_date(v.trxn_date) = v_fy AND COALESCE(v.net_sent, 0) > 0 THEN
      SELECT id INTO v_bank FROM chart_of_accounts WHERE linked_account_id = v.initial_account_id;
      IF v_bank IS NULL OR v_transit IS NULL OR v_comm IS NULL THEN
        PERFORM log_posting_failure('vendor_receipt_facilitation', v.id,
          format('Cannot post %s: the account it was sent from has no ledger account', v_label));
      ELSE
        INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description, created_by)
        VALUES (v.trxn_date, 'operational', 'vendor_receipt_facilitation', v.id, 'VRF sent: ' || v_label, auth.uid())
        RETURNING id INTO v_entry;
        INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
          (v_entry, v_transit, v.net_sent, 0, 'Sent for ' || v_label),
          (v_entry, v_bank, 0, v.net_sent, 'Paid from bank');
        IF COALESCE(v.commission_amount, 0) > 0 THEN
          INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
            (v_entry, v_comm, v.commission_amount, 0, 'Commission on ' || v_label),
            (v_entry, v_transit, 0, v.commission_amount, 'Commission kept back');
        END IF;
      END IF;
    END IF;

    FOR r IN SELECT * FROM vrf_returns WHERE vrf_id = v.id ORDER BY return_date, created_at LOOP
      CONTINUE WHEN fiscal_period_for_date(r.return_date) IS DISTINCT FROM v_fy;
      CONTINUE WHEN r.account_id IS NULL;
      SELECT id INTO v_hold FROM chart_of_accounts WHERE linked_account_id = r.account_id;
      IF v_hold IS NULL OR v_transit IS NULL THEN
        PERFORM log_posting_failure('vendor_receipt_facilitation', v.id,
          format('Cannot post a return on %s: no holding account with a ledger account', v_label));
        CONTINUE;
      END IF;
      INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description, created_by)
      VALUES (r.return_date, 'operational', 'vendor_receipt_facilitation', v.id, 'VRF returned: ' || v_label, auth.uid())
      RETURNING id INTO v_entry;
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes) VALUES
        (v_entry, v_hold, r.amount, 0, 'Returned from ' || v_label),
        (v_entry, v_transit, 0, r.amount, 'Out of transit');
    END LOOP;

    SET CONSTRAINTS trg_check_journal_entry_balance IMMEDIATE;
    SET CONSTRAINTS trg_check_journal_entry_balance DEFERRED;
  EXCEPTION WHEN OTHERS THEN
    PERFORM log_posting_failure('vendor_receipt_facilitation', p_vrf_id, SQLERRM);
  END;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.vrf_sync_ledger(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vrf_sync_ledger(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.vrf_after_change()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM vrf_sync_ledger(NEW.id);
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.vrf_after_change() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_vrf_ledger ON vendor_receipt_facilitation;
CREATE TRIGGER trg_vrf_ledger
  AFTER INSERT OR UPDATE ON vendor_receipt_facilitation
  FOR EACH ROW EXECUTE FUNCTION vrf_after_change();

-- Settling no longer creates an expense.
DROP TRIGGER IF EXISTS trg_auto_create_vrf_expense ON vendor_receipt_facilitation;
DROP FUNCTION IF EXISTS public.auto_create_vrf_expense();

-- ── Views ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_vrf_fund_status
WITH (security_invoker = true) AS
SELECT
  f.id AS vrf_id,
  f.record_name,
  f.facilitator_name,
  f.status,
  f.amount_transferred,
  f.money_returned,
  f.commission_amount,
  f.return_account_id,
  COALESCE(f.amount_transferred, 0) - COALESCE(f.money_returned, 0) - COALESCE(f.commission_amount, 0) AS settlement_gap,
  ex.drawn + pr.drawn + pd.drawn AS fund_drawn,
  COALESCE(f.money_returned, 0) - (ex.drawn + pr.drawn + pd.drawn) AS fund_available,
  ex.n AS payments_count,
  ex.drawn AS company_expense_drawn,
  pr.drawn AS payroll_drawn,
  pd.drawn AS personal_drawn,
  pd.n AS personal_draw_count
FROM vendor_receipt_facilitation f
CROSS JOIN LATERAL (
  SELECT COALESCE(sum(e.amount_etb), 0) AS drawn, count(*) AS n
  FROM expenses e
  WHERE e.vrf_id = f.id AND e.payment_state = 'paid'
) ex
CROSS JOIN LATERAL (
  SELECT COALESCE(sum(ps.net_amount), 0) AS drawn
  FROM payroll p JOIN payroll_staff ps ON ps.payroll_id = p.id
  WHERE p.vrf_id = f.id AND p.payment_status = 'paid' AND NOT COALESCE(p.is_archived, false)
) pr
CROSS JOIN LATERAL (
  SELECT COALESCE(sum(d.amount), 0) AS drawn, count(*) AS n
  FROM vrf_personal_draws d
  WHERE d.vrf_id = f.id
) pd;
REVOKE ALL ON v_vrf_fund_status FROM anon;
GRANT SELECT ON v_vrf_fund_status TO authenticated;

CREATE OR REPLACE VIEW v_vrf_register
WITH (security_invoker = true) AS
SELECT
  f.id AS vrf_id,
  f.record_name,
  f.facilitator_name,
  f.status,
  f.trxn_date,
  ec.ec_year,
  ec.ec_month,
  CASE WHEN ec.ec_year IS NOT NULL THEN ec_month_name(ec.ec_month) || ' ' || ec.ec_year END AS period_label,
  fp.id AS fiscal_period_id,
  fp.label AS fiscal_year,
  COALESCE(f.receipt_amount, f.amount_transferred, 0)::numeric AS receipt_amount,
  COALESCE(f.amount_transferred, 0)::numeric AS transferred,
  COALESCE(f.wht_amount, 0)::numeric AS wht_recorded,
  COALESCE(f.commission_amount, 0)::numeric AS commission,
  COALESCE(f.money_returned, 0)::numeric AS returned,
  (COALESCE(f.receipt_amount, f.amount_transferred, 0) - COALESCE(f.money_returned, 0))::numeric AS kept_back,
  (COALESCE(f.receipt_amount, f.amount_transferred, 0) - COALESCE(f.money_returned, 0)
    - COALESCE(f.wht_amount, 0) - COALESCE(f.commission_amount, 0))::numeric AS unaccounted,
  fs.company_expense_drawn,
  fs.payroll_drawn,
  fs.personal_drawn,
  fs.fund_available AS held,
  round(COALESCE(f.receipt_amount, f.amount_transferred, 0) * COALESCE(r.rate, 0) / (1 + COALESCE(r.rate, 0)), 2) AS vat_on_receipt,
  f.net_sent::numeric AS net_sent,
  f.expected_return::numeric AS expected_return,
  f.needs_review,
  f.review_notes,
  f.structured,
  f.supply_kind,
  f.commission_basis,
  f.commission_rate::numeric AS commission_rate,
  f.wht_overridden,
  f.return_account_id,
  ra.account_name AS holding_account_name,
  f.initial_account_id,
  ia.account_name AS sent_from_account_name,
  f.out_transfer_id
FROM vendor_receipt_facilitation f
CROSS JOIN LATERAL (
  SELECT (tax_rate_note('VAT', COALESCE(f.trxn_date, CURRENT_DATE)) ->> 'standard_rate')::numeric AS rate
) r
LEFT JOIN LATERAL gregorian_to_ec(f.trxn_date) ec ON f.trxn_date IS NOT NULL
LEFT JOIN fiscal_periods fp ON f.trxn_date >= fp.start_date AND f.trxn_date <= fp.end_date
LEFT JOIN v_vrf_fund_status fs ON fs.vrf_id = f.id
LEFT JOIN accounts ra ON ra.id = f.return_account_id
LEFT JOIN accounts ia ON ia.id = f.initial_account_id
WHERE NOT COALESCE(f.is_archived, false);
REVOKE ALL ON v_vrf_register FROM PUBLIC, anon;
GRANT SELECT ON v_vrf_register TO authenticated;

-- What each holder keeps for Kuncho: returned in, less company payments and
-- payroll paid from those VRFs, less personal draws.
CREATE OR REPLACE VIEW v_vrf_holding_accounts
WITH (security_invoker = true) AS
SELECT
  a.id AS account_id,
  a.account_name,
  a.holder_name,
  COALESCE(rin.total, 0) AS returned_in,
  COALESCE(co.total, 0) AS company_spent,
  COALESCE(pd.total, 0) AS personal_drawn,
  COALESCE(rin.total, 0) - COALESCE(co.total, 0) - COALESCE(pd.total, 0) AS held,
  COALESCE(rin.n, 0) AS return_count,
  ab.balance AS account_balance
FROM accounts a
LEFT JOIN (
  SELECT r.account_id, sum(r.amount) AS total, count(*) AS n
  FROM vrf_returns r JOIN vendor_receipt_facilitation f ON f.id = r.vrf_id
  WHERE NOT f.is_archived GROUP BY r.account_id
) rin ON rin.account_id = a.id
LEFT JOIN (
  SELECT f.return_account_id AS account_id, sum(s.amount) AS total
  FROM vendor_receipt_facilitation f
  CROSS JOIN LATERAL (
    SELECT COALESCE(sum(e.amount_etb), 0) AS amount FROM expenses e WHERE e.vrf_id = f.id AND e.payment_state = 'paid'
    UNION ALL
    SELECT COALESCE(sum(ps.net_amount), 0) FROM payroll p JOIN payroll_staff ps ON ps.payroll_id = p.id
    WHERE p.vrf_id = f.id AND p.payment_status = 'paid' AND NOT COALESCE(p.is_archived, false)
  ) s
  WHERE NOT f.is_archived GROUP BY f.return_account_id
) co ON co.account_id = a.id
LEFT JOIN (
  SELECT d.account_id, sum(d.amount) AS total FROM vrf_personal_draws d GROUP BY d.account_id
) pd ON pd.account_id = a.id
LEFT JOIN v_account_balances ab ON ab.id = a.id
WHERE a.is_vrf_holding;
REVOKE ALL ON v_vrf_holding_accounts FROM PUBLIC, anon;
GRANT SELECT ON v_vrf_holding_accounts TO authenticated;

-- WHT: VRFs feed the return directly, dated by when the money was sent.
CREATE OR REPLACE VIEW v_wht_payable_by_ec_period
WITH (security_invoker = true) AS
WITH lines AS (
  SELECT tp.ec_year, tp.ec_month, e.payment_status AS paid, e.wht_amount AS wht, false AS is_vrf
  FROM expenses e
  CROSS JOIN LATERAL tax_period_for_date(COALESCE(e.total_payment_date, e.paid_date::date, e.date)) tp(ec_year, ec_month)
  WHERE COALESCE(e.wht_amount, 0) > 0
    AND COALESCE(e.total_payment_date, e.paid_date::date, e.date) IS NOT NULL
    AND NOT COALESCE(e.is_archived, false)
    AND e.vendor_receipt_facilitation_id IS NULL
    AND e.expense_type IS DISTINCT FROM 'vrf'
  UNION ALL
  SELECT tp.ec_year, tp.ec_month, true, f.wht_amount, true
  FROM vendor_receipt_facilitation f
  CROSS JOIN LATERAL tax_period_for_date(f.trxn_date) tp(ec_year, ec_month)
  WHERE f.structured AND NOT f.is_archived AND f.trxn_date IS NOT NULL AND COALESCE(f.wht_amount, 0) > 0
)
SELECT ec_year,
  ec_month,
  ec_month_name(ec_month) || ' ' || ec_year AS period_label,
  count(*) FILTER (WHERE paid) AS paid_expense_count,
  COALESCE(sum(wht) FILTER (WHERE paid), 0::numeric) AS wht_withheld,
  count(*) FILTER (WHERE NOT paid) AS pending_expense_count,
  COALESCE(sum(wht) FILTER (WHERE NOT paid), 0::numeric) AS wht_pending_unpaid,
  count(*) FILTER (WHERE is_vrf) AS vrf_count,
  COALESCE(sum(wht) FILTER (WHERE is_vrf), 0::numeric) AS vrf_wht
FROM lines
GROUP BY ec_year, ec_month;
REVOKE ALL ON v_wht_payable_by_ec_period FROM anon;
GRANT SELECT ON v_wht_payable_by_ec_period TO authenticated;

-- Account balances: a VRF's outflow counts from the VRF only when no bank
-- line is linked to it (the line already counts); returns count per return
-- entry; personal draws leave the holding account; VRF expenses never count.
CREATE OR REPLACE VIEW v_account_balances
WITH (security_invoker = true) AS
WITH latest_anchor AS (
  SELECT DISTINCT ON (bank_balance_anchors.account_id) bank_balance_anchors.account_id,
    bank_balance_anchors.as_of_date, bank_balance_anchors.balance, bank_balance_anchors.transfer_id
  FROM bank_balance_anchors
  ORDER BY bank_balance_anchors.account_id, bank_balance_anchors.as_of_date DESC
), counted_out AS (
  SELECT t.id, t.from_account_id AS account_id, t.amount
  FROM transfers t LEFT JOIN latest_anchor la_1 ON la_1.account_id = t.from_account_id
  WHERE t.from_account_id IS NOT NULL
    AND (la_1.as_of_date IS NULL OR t.date > la_1.as_of_date
         OR (t.date = la_1.as_of_date AND la_1.transfer_id IS NOT NULL AND t.id IS DISTINCT FROM la_1.transfer_id))
), counted_in AS (
  SELECT t.id, t.to_account_id AS account_id, t.amount
  FROM transfers t LEFT JOIN latest_anchor la_1 ON la_1.account_id = t.to_account_id
  WHERE t.to_account_id IS NOT NULL
    AND (la_1.as_of_date IS NULL OR t.date > la_1.as_of_date
         OR (t.date = la_1.as_of_date AND la_1.transfer_id IS NOT NULL AND t.id IS DISTINCT FROM la_1.transfer_id))
), counted_vrf_out AS (
  SELECT v.id, v.initial_account_id AS account_id, v.amount_transferred AS amount
  FROM vendor_receipt_facilitation v LEFT JOIN latest_anchor la_1 ON la_1.account_id = v.initial_account_id
  WHERE v.initial_account_id IS NOT NULL
    AND NOT v.is_archived
    AND v.out_transfer_id IS NULL
    AND (la_1.as_of_date IS NULL OR v.trxn_date > la_1.as_of_date)
), transfers_out AS (
  SELECT account_id, COALESCE(sum(amount), 0::numeric) AS total FROM counted_out GROUP BY account_id
), transfers_in AS (
  SELECT account_id, COALESCE(sum(amount), 0::numeric) AS total FROM counted_in GROUP BY account_id
), vrf_out AS (
  SELECT account_id, COALESCE(sum(amount), 0::numeric) AS total FROM counted_vrf_out GROUP BY account_id
), vrf_in AS (
  SELECT x.account_id, COALESCE(sum(x.amount), 0::numeric) AS total
  FROM (
    -- Returns recorded as entries, unless their bank line already counts.
    SELECT r.account_id, r.amount, r.return_date AS d
    FROM vrf_returns r JOIN vendor_receipt_facilitation v ON v.id = r.vrf_id
    WHERE v.structured AND NOT v.is_archived AND r.account_id IS NOT NULL AND r.transfer_id IS NULL
    UNION ALL
    -- Records still written by the old form.
    SELECT v.return_account_id, v.money_returned, v.trxn_date
    FROM vendor_receipt_facilitation v
    WHERE NOT v.structured AND NOT v.is_archived AND v.return_account_id IS NOT NULL
  ) x
  LEFT JOIN latest_anchor la_1 ON la_1.account_id = x.account_id
  WHERE la_1.as_of_date IS NULL OR x.d > la_1.as_of_date
  GROUP BY x.account_id
), sales_in AS (
  SELECT s.account_id, COALESCE(sum(s.amount), 0::numeric) AS total
  FROM sales s LEFT JOIN latest_anchor la_1 ON la_1.account_id = s.account_id
  WHERE s.account_id IS NOT NULL AND s.sales_status = 'Paid'::sale_lifecycle_status
    AND (la_1.as_of_date IS NULL OR s.date > la_1.as_of_date)
  GROUP BY s.account_id
), expenses_out AS (
  SELECT e.account_id, COALESCE(sum(e.amount_etb), 0::numeric) AS total
  FROM expenses e LEFT JOIN latest_anchor la_1 ON la_1.account_id = e.account_id
  WHERE e.account_id IS NOT NULL AND e.payment_status = true
    AND (la_1.as_of_date IS NULL OR e.date > la_1.as_of_date)
    AND e.vendor_receipt_facilitation_id IS NULL
    AND e.expense_type IS DISTINCT FROM 'vrf'
    AND NOT EXISTS (SELECT 1 FROM counted_out co WHERE co.id = e.transfer_id AND co.account_id = e.account_id)
    AND NOT EXISTS (SELECT 1 FROM counted_vrf_out cv WHERE cv.id = e.vrf_id AND cv.account_id = e.account_id)
    AND NOT EXISTS (
      SELECT 1 FROM batch_payment_expenses bpe
      JOIN batch_payments bp ON bp.id = bpe.batch_payment_id
      JOIN counted_out co ON co.id = bp.transfer_id AND co.account_id = e.account_id
      WHERE bpe.expense_id = e.id)
  GROUP BY e.account_id
), payroll_out AS (
  SELECT p.account_id, COALESCE(sum(ps.net_amount), 0::numeric) AS total
  FROM payroll p
  JOIN payroll_staff ps ON ps.payroll_id = p.id
  LEFT JOIN latest_anchor la_1 ON la_1.account_id = p.account_id
  WHERE p.account_id IS NOT NULL AND p.payment_status = 'paid'
    AND (la_1.as_of_date IS NULL OR p.end_date > la_1.as_of_date)
    AND NOT EXISTS (SELECT 1 FROM counted_out co WHERE co.id = p.transfer_id AND co.account_id = p.account_id)
    AND NOT EXISTS (SELECT 1 FROM counted_vrf_out cv WHERE cv.id = p.vrf_id AND cv.account_id = p.account_id)
  GROUP BY p.account_id
), advances_out AS (
  SELECT ca.account_used_id AS account_id, COALESCE(sum(ca.amount_advanced), 0::numeric) AS total
  FROM cash_advances ca LEFT JOIN latest_anchor la_1 ON la_1.account_id = ca.account_used_id
  WHERE ca.account_used_id IS NOT NULL
    AND ca.approval_status = 'finance_approved'::cash_advance_approval_status
    AND (la_1.as_of_date IS NULL OR ca.date_given > la_1.as_of_date)
  GROUP BY ca.account_used_id
), draws_out AS (
  SELECT d.account_id, COALESCE(sum(d.amount), 0::numeric) AS total
  FROM vrf_personal_draws d LEFT JOIN latest_anchor la_1 ON la_1.account_id = d.account_id
  WHERE d.account_id IS NOT NULL AND (la_1.as_of_date IS NULL OR d.draw_date > la_1.as_of_date)
  GROUP BY d.account_id
)
SELECT a.id,
  a.account_name,
  a.type,
  a.status,
  COALESCE(la.balance, 0::numeric) + COALESCE(si.total, 0::numeric) + COALESCE(ti.total, 0::numeric)
    + COALESCE(vi.total, 0::numeric) - COALESCE(eo.total, 0::numeric) - COALESCE(ao.total, 0::numeric)
    - COALESCE(po.total, 0::numeric) - COALESCE(vo.total, 0::numeric) - COALESCE(to2.total, 0::numeric)
    - COALESCE(dr.total, 0::numeric) AS balance,
  COALESCE(la.balance, 0::numeric) AS opening_balance,
  la.as_of_date AS opening_balance_as_of,
  COALESCE(si.total, 0::numeric) AS total_sales_in,
  COALESCE(ti.total, 0::numeric) AS total_transfers_in,
  COALESCE(vi.total, 0::numeric) AS total_vrf_returned_in,
  COALESCE(eo.total, 0::numeric) AS total_expenses_out,
  COALESCE(ao.total, 0::numeric) AS total_advances_out,
  COALESCE(po.total, 0::numeric) AS total_payroll_out,
  COALESCE(vo.total, 0::numeric) AS total_vrf_transferred_out,
  COALESCE(to2.total, 0::numeric) AS total_transfers_out,
  COALESCE(dr.total, 0::numeric) AS total_vrf_draws_out
FROM accounts a
LEFT JOIN latest_anchor la ON la.account_id = a.id
LEFT JOIN sales_in si ON si.account_id = a.id
LEFT JOIN expenses_out eo ON eo.account_id = a.id
LEFT JOIN advances_out ao ON ao.account_id = a.id
LEFT JOIN payroll_out po ON po.account_id = a.id
LEFT JOIN vrf_out vo ON vo.account_id = a.id
LEFT JOIN vrf_in vi ON vi.account_id = a.id
LEFT JOIN transfers_in ti ON ti.account_id = a.id
LEFT JOIN transfers_out to2 ON to2.account_id = a.id
LEFT JOIN draws_out dr ON dr.account_id = a.id;
REVOKE ALL ON v_account_balances FROM anon;
GRANT SELECT ON v_account_balances TO authenticated;

-- ── Convert the existing records ──────────────────────────────────────────

-- The accounts returned money already went to are holding accounts.
UPDATE accounts SET is_vrf_holding = true
WHERE id IN (SELECT DISTINCT return_account_id FROM vendor_receipt_facilitation WHERE return_account_id IS NOT NULL);

-- What each record's figures imply. The receipt amount is the VRF payment's
-- amount (the linked expense, or an unlinked VRF expense of the same date and
-- amount); WHT is taken, in order of trust, from the payment, from a transfer
-- entered after WHT, from a bank line short of the receipt, or from what the
-- return implies; commission from its rate, else as entered.
CREATE TEMP TABLE vrf_conv ON COMMIT DROP AS
WITH src AS (
  SELECT f.id, f.trxn_date, f.created_at, f.record_name, f.facilitator_name, f.return_account_id,
    f.amount_transferred AS at, f.money_returned AS mr, f.commission_rate AS cr, f.commission_amount AS ca,
    e.amount_etb AS exp_amt, e.wht_amount AS exp_wht, e.expense_code, t.id AS transfer_id, t.amount AS bank_amt
  FROM vendor_receipt_facilitation f
  LEFT JOIN LATERAL (
    SELECT x.* FROM expenses x
    WHERE x.vendor_receipt_facilitation_id = f.id
       OR (x.vendor_receipt_facilitation_id IS NULL AND x.expense_type = 'vrf'
           AND x.date = f.trxn_date AND x.amount_etb = f.amount_transferred)
    ORDER BY (x.vendor_receipt_facilitation_id = f.id) DESC NULLS LAST, x.created_at
    LIMIT 1
  ) e ON true
  LEFT JOIN transfers t ON t.id = e.transfer_id
  WHERE NOT f.is_archived AND NOT f.structured
), calc AS (
  SELECT s.*,
    COALESCE(s.exp_amt, s.at) AS receipt,
    (tax_rate_note('VAT', s.trxn_date) ->> 'standard_rate')::numeric AS vat,
    tax_rate_note('WHT', s.trxn_date) AS wn
  FROM src s
), std AS (
  SELECT c.*,
    CASE WHEN round(c.receipt / (1 + c.vat), 2) >= (c.wn ->> 'goods_threshold_etb')::numeric
         THEN round(round(c.receipt / (1 + c.vat), 2) * (c.wn ->> 'rate')::numeric, 2) ELSE 0 END AS std_wht,
    CASE WHEN COALESCE(c.cr, 0) > 0 THEN round(c.receipt * c.cr / 100, 2) ELSE COALESCE(c.ca, 0) END AS comm
  FROM calc c
)
SELECT s.id, s.receipt, s.comm, s.std_wht, s.transfer_id, s.return_account_id, s.mr, s.trxn_date,
  CASE WHEN COALESCE(s.cr, 0) > 0 THEN 'receipt_pct' ELSE 'fixed' END AS basis,
  CASE
    WHEN COALESCE(s.exp_wht, 0) > 0 THEN s.exp_wht
    WHEN s.receipt - COALESCE(s.at, s.receipt) > 1 THEN s.receipt - s.at
    WHEN s.bank_amt IS NOT NULL AND s.receipt - s.bank_amt > 100 THEN s.std_wht
    WHEN abs((s.receipt - COALESCE(s.mr, 0) - s.comm) - s.std_wht) < abs(s.receipt - COALESCE(s.mr, 0) - s.comm) THEN s.std_wht
    ELSE 0 END AS wht,
  CASE
    WHEN COALESCE(s.exp_wht, 0) > 0 THEN 'recorded'
    WHEN s.receipt - COALESCE(s.at, s.receipt) > 1 THEN 'recorded'
    WHEN s.bank_amt IS NOT NULL AND s.receipt - s.bank_amt > 100 THEN 'bank_line'
    WHEN abs((s.receipt - COALESCE(s.mr, 0) - s.comm) - s.std_wht) < abs(s.receipt - COALESCE(s.mr, 0) - s.comm) THEN 'implied'
    ELSE 'none' END AS wht_source,
  COALESCE(NULLIF(btrim(s.record_name), ''),
    'VRF-' || to_char(s.trxn_date, 'YYYYMMDD') || '-'
      || lpad(row_number() OVER (PARTITION BY s.trxn_date ORDER BY s.created_at)::text, 2, '0')) AS name,
  (s.facilitator_name IS NULL OR btrim(s.facilitator_name) = '') AS no_facilitator,
  (COALESCE(s.cr, 0) > 0 AND s.ca IS NULL) AS commission_from_rate
FROM std s;

-- One return entry per record for what came back so far, on the VRF's date.
INSERT INTO vrf_returns (vrf_id, return_date, amount, account_id, note, created_by)
SELECT c.id, c.trxn_date, c.mr, c.return_account_id,
  'Carried over from the VRF record; the date is the VRF''s date — correct it if the money came back later', auth.uid()
FROM vrf_conv c
WHERE COALESCE(c.mr, 0) > 0;

UPDATE vendor_receipt_facilitation f SET
  structured       = true,
  record_name      = c.name,
  receipt_amount   = c.receipt,
  supply_kind      = 'goods',
  wht_amount       = c.wht,
  -- A few cents apart is rounding in how the WHT was typed, not an override.
  wht_overridden   = abs(c.wht - c.std_wht) > 0.05,
  commission_basis = c.basis,
  commission_amount = CASE WHEN c.basis = 'fixed' THEN c.comm ELSE f.commission_amount END,
  out_transfer_id  = c.transfer_id,
  review_notes     = array_remove(ARRAY[
    CASE c.wht_source
      WHEN 'bank_line' THEN 'WHT worked out from the bank line — confirm it was withheld'
      WHEN 'implied'   THEN 'WHT worked out from the amount returned — confirm it was withheld'
      WHEN 'none'      THEN 'No WHT shows on this VRF — confirm none was withheld'
    END,
    CASE WHEN c.commission_from_rate THEN 'Commission was not recorded — calculated from the rate' END,
    CASE WHEN c.no_facilitator THEN 'Facilitator not recorded' END,
    CASE WHEN c.return_account_id IS NULL AND COALESCE(c.mr, 0) > 0 THEN 'Which holding account received the return?' END
  ], NULL)
FROM vrf_conv c
WHERE f.id = c.id;

-- Anything that still does not reconcile, stated in birr.
UPDATE vendor_receipt_facilitation SET review_notes = review_notes || (
    CASE WHEN money_returned > expected_return
      THEN format('%s more came back than the receipt less WHT and commission', to_char(money_returned - expected_return, 'FM999,999,990.00'))
      ELSE format('%s less came back than expected', to_char(expected_return - money_returned, 'FM999,999,990.00')) END)
WHERE structured AND abs(expected_return - money_returned) > 10;

UPDATE vendor_receipt_facilitation SET needs_review = (cardinality(review_notes) > 0) WHERE structured;

-- The VRF expenses leave the books. Their ledger postings are reversed with an
-- adjusting entry each, dated as the original, so the history stays readable.
INSERT INTO journal_entries (entry_date, entry_type, source_table, source_id, description, created_by)
SELECT je.entry_date, 'adjusting', 'expenses', je.source_id,
  'Reversed: VRF payment moved out of expenses into the VRF register', auth.uid()
FROM journal_entries je
JOIN expenses e ON e.id = je.source_id
WHERE je.source_table = 'expenses' AND je.entry_type = 'operational'
  AND (e.vendor_receipt_facilitation_id IS NOT NULL OR e.expense_type = 'vrf')
  AND NOT EXISTS (SELECT 1 FROM journal_entries r
                  WHERE r.source_table = 'expenses' AND r.source_id = je.source_id AND r.entry_type = 'adjusting');

INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
SELECT r.id, l.account_id, l.credit, l.debit, 'Reversal of: ' || COALESCE(l.notes, '')
FROM journal_entries r
JOIN journal_entries je ON je.source_table = 'expenses' AND je.source_id = r.source_id AND je.entry_type = 'operational'
JOIN journal_lines l ON l.journal_entry_id = je.id
WHERE r.source_table = 'expenses' AND r.entry_type = 'adjusting'
  AND r.description = 'Reversed: VRF payment moved out of expenses into the VRF register'
  AND NOT EXISTS (SELECT 1 FROM journal_lines x WHERE x.journal_entry_id = r.id);

UPDATE expenses SET is_archived = true
WHERE (vendor_receipt_facilitation_id IS NOT NULL OR expense_type = 'vrf') AND NOT is_archived;
