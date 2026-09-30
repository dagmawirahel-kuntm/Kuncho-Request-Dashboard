-- 383 — Opening balances, suggested from the app's own data
--
-- The ledger started empty on 1 Hamle 2018 (8 Jul 2026): no bank balances,
-- no assets, nothing owed either way — so the CBE account shows −9.1M.
-- The Opening Balances tab already takes figures and posts them once
-- (convert_opening_balances_to_journal_entry, 106). This fills it with what
-- the app itself knows, for finance to check, change and then post:
--
--   bank and cash     each account's balance on 7 Jul 2026 from its statements
--                     (account_balances_asof) — only where none is entered yet
--   fixed assets      cost to 1610, depreciation to 7 Jul 2026 to 1690
--   last year's bills optional: requests from 2025/26 never marked paid,
--                     per vendor, to 2010 — many may have been dropped, so
--                     they come in only when finance asks
--   the difference    to 3090 Opening balance equity
--
-- Suggested rows are marked; running it again replaces them and keeps what
-- finance typed. Opening rows can now name a vendor, client or staff member,
-- so a control account's opening balance lands in its sub-ledger.

SET search_path TO public;

ALTER TABLE opening_balances
  ADD COLUMN IF NOT EXISTS party_type text,
  ADD COLUMN IF NOT EXISTS party_id   uuid,
  ADD COLUMN IF NOT EXISTS suggested  boolean NOT NULL DEFAULT false;
ALTER TABLE opening_balances DROP CONSTRAINT IF EXISTS opening_balances_party_chk;
ALTER TABLE opening_balances ADD CONSTRAINT opening_balances_party_chk
  CHECK ((party_type IS NULL AND party_id IS NULL) OR (party_type IN ('vendor', 'client', 'staff') AND party_id IS NOT NULL));

CREATE OR REPLACE FUNCTION public.suggest_opening_balances(p_last_year_unpaid boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_start date;
  v_asof  date;
  v_dr    numeric;
  v_cr    numeric;
  a       fixed_assets%ROWTYPE;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT COALESCE(get_user_role() IN ('admin', 'finance'), false) THEN
    RAISE EXCEPTION 'Only finance can set opening balances';
  END IF;
  IF EXISTS (SELECT 1 FROM journal_entries WHERE entry_type = 'opening_balance') THEN
    RAISE EXCEPTION 'The opening balances are already posted — change them with an adjusting entry instead';
  END IF;
  SELECT start_date INTO v_start FROM fiscal_periods WHERE is_current;
  v_asof := v_start - 1;

  DELETE FROM opening_balances WHERE suggested OR chart_of_accounts_id = coa_id('opening_equity');

  -- Bank and cash, from the statements.
  INSERT INTO opening_balances (chart_of_accounts_id, amount, side, source, suggested, notes)
  SELECT c.id, abs(b.balance), CASE WHEN b.balance >= 0 THEN 'debit' ELSE 'credit' END,
         'Bank balance on ' || to_char(v_asof, 'DD Mon YYYY') || ' from its statements', true,
         'Suggested (383): account_balances_asof'
    FROM account_balances_asof(v_asof) b
    JOIN chart_of_accounts c ON c.linked_account_id = b.id
   WHERE round(COALESCE(b.balance, 0), 2) <> 0
     AND NOT EXISTS (SELECT 1 FROM opening_balances ob WHERE ob.chart_of_accounts_id = c.id);

  -- Fixed assets bought before the year: cost, and what has been used up.
  FOR a IN SELECT * FROM fixed_assets WHERE COALESCE(is_active, true) AND disposal_date IS NULL
             AND purchase_date < v_start AND COALESCE(purchase_cost_etb, 0) > 0 LOOP
    INSERT INTO opening_balances (chart_of_accounts_id, amount, side, source, suggested, notes)
    VALUES (coa_id('ppe'), a.purchase_cost_etb, 'debit', 'Fixed asset ' || a.asset_code || ' ' || a.asset_name || ' at cost', true, 'Suggested (383)');
    IF asset_depreciation_to(a, v_asof) > 0 THEN
      INSERT INTO opening_balances (chart_of_accounts_id, amount, side, source, suggested, notes)
      VALUES (coa_id('acc_depreciation'), asset_depreciation_to(a, v_asof), 'credit',
              'Depreciation on ' || a.asset_code || ' to ' || to_char(v_asof, 'DD Mon YYYY'), true, 'Suggested (383)');
    END IF;
  END LOOP;

  -- Last year's requests never marked paid, per vendor — only when asked.
  IF p_last_year_unpaid THEN
    INSERT INTO opening_balances (chart_of_accounts_id, amount, side, source, suggested, notes, party_type, party_id)
    SELECT coa_id('ap'), sum(e.amount_etb), 'credit',
           'Unpaid from 2025/26: ' || count(*) || ' request' || CASE WHEN count(*) = 1 THEN '' ELSE 's' END
             || COALESCE(' — ' || ledger_party_name('vendor', e.vendor_id), ' — no vendor named'),
           true, 'Suggested (383): expenses_fy2025_26_frozen, payment_status false',
           CASE WHEN e.vendor_id IS NOT NULL THEN 'vendor' END, e.vendor_id
      FROM expenses_fy2025_26_frozen e
     WHERE NOT COALESCE(e.payment_status, false) AND COALESCE(e.amount_etb, 0) > 0
       AND e.approval_status::text <> 'rejected'
     GROUP BY e.vendor_id;
  END IF;

  -- The difference is opening equity.
  SELECT COALESCE(sum(amount) FILTER (WHERE side = 'debit'), 0), COALESCE(sum(amount) FILTER (WHERE side = 'credit'), 0)
    INTO v_dr, v_cr FROM opening_balances;
  IF v_dr <> v_cr THEN
    INSERT INTO opening_balances (chart_of_accounts_id, amount, side, source, suggested, notes)
    VALUES (coa_id('opening_equity'), abs(v_dr - v_cr), CASE WHEN v_dr > v_cr THEN 'credit' ELSE 'debit' END,
            'The difference: what the company was worth on ' || to_char(v_asof, 'DD Mon YYYY') || ', by these figures', true,
            'Balances the opening entry; replace with retained earnings and capital from the audited accounts when you have them');
  END IF;

  RETURN jsonb_build_object(
    'rows', (SELECT count(*) FROM opening_balances),
    'debits', (SELECT sum(amount) FROM opening_balances WHERE side = 'debit'),
    'credits', (SELECT sum(amount) FROM opening_balances WHERE side = 'credit'),
    'last_year_unpaid', (SELECT jsonb_build_object('requests', count(*), 'amount', sum(amount_etb))
                           FROM expenses_fy2025_26_frozen WHERE NOT COALESCE(payment_status, false) AND COALESCE(amount_etb, 0) > 0
                            AND approval_status::text <> 'rejected'));
END $function$;
REVOKE EXECUTE ON FUNCTION suggest_opening_balances(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION suggest_opening_balances(boolean) TO authenticated;

-- Posting carries who each opening row is for into the sub-ledgers.
DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('convert_opening_balances_to_journal_entry'::regproc);
  d := replace(d, 'INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes)
    VALUES (
      v_entry_id, v_ob.chart_of_accounts_id,',
    'INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, notes, party_type, party_id)
    VALUES (
      v_entry_id, v_ob.chart_of_accounts_id,');
  d := replace(d, '      v_ob.source
    );', '      v_ob.source, v_ob.party_type, v_ob.party_id
    );');
  d := replace(d, '''Opening balance from ERCA filing''', '''Opening balances''');
  IF d NOT LIKE '%v_ob.party_type, v_ob.party_id%' THEN
    RAISE EXCEPTION 'convert_opening_balances_to_journal_entry did not take the change';
  END IF;
  EXECUTE d;
END $$;

-- The suggestion, ready for finance to review (not posted).
SELECT suggest_opening_balances(false);
