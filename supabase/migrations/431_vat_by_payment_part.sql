-- Taxes follow the payment of each part (payments in parts, migration 430).
--
-- A bill paid in parts was invisible to the VAT position until its last part
-- was paid, and then counted whole, in the month of its receipt or bill
-- date. The forecasts counted an approved bill's whole VAT as "claimed when
-- paid", though only its due part would go out this month. Withholding was
-- dated by the bill's final payment, though with "a share from each part"
-- every part withholds when it is paid.
--
-- Now, for a bill in parts:
--   input VAT     each paid part is its own row in v_input_vat_tracker, with
--                 its share of the bill's VAT (part ÷ bill), declared in the
--                 tax month the part was paid (a declare-month override the
--                 tax officer set on the bill still wins). The VAT position,
--                 the return, the goal levers and the PO goal effect all read
--                 that tracker, so the paid part counts for its month and the
--                 rest for the months it is paid in
--   the books     each part's input VAT is moved out of cost on its own date
--   forecasts     "VAT on approved bills paid this month", the payment-queue
--                 T-tags and the levers count only the parts due by the end of
--                 the month (sent, due now, dated by then, or delivered by
--                 then), not the whole bill
--   WHT           withheld on each paid part, in the month it was paid
-- A bill paid in one go is unchanged.

-- ── What of a bill falls to be paid by a date ──────────────────────────────
CREATE OR REPLACE FUNCTION expense_due_base(e expenses, p_by date)
RETURNS numeric LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN NOT COALESCE(e.in_parts, false) THEN COALESCE(e.amount_etb, 0)
    ELSE COALESCE((
      SELECT sum(p.amount_etb) FROM expense_payments p
       WHERE p.expense_id = e.id
         AND (p.state = 'sent'
              OR (p.state = 'planned' AND (
                    p.due_on = 'now'
                 OR (p.due_on = 'date' AND (p.due_date IS NULL OR p.due_date <= p_by))
                 OR (p.due_on = 'delivery' AND expense_parts_grn_date(e.id) + COALESCE(p.due_days, 0) <= p_by))))), 0)
  END
$$;
COMMENT ON FUNCTION expense_due_base(expenses, date) IS
  'The part of a bill expected to be paid by p_by: the whole bill when paid in one go; for a bill in parts, its sent parts and the planned parts due by then (migration 431)';

-- ── Input VAT: one row per paid part ───────────────────────────────────────
CREATE OR REPLACE VIEW v_input_vat_tracker WITH (security_invoker = true) AS
 WITH src AS (
         -- A bill paid in one go: one row, once it is paid.
         SELECT e.id AS expense_id, NULL::uuid AS part_id, NULL::integer AS part_no, NULL::integer AS part_count,
            e.amount_etb AS amount, 1::numeric AS share, NULL::date AS part_paid_date
           FROM expenses e
          WHERE e.payment_status = true AND NOT e.in_parts
        UNION ALL
         -- A bill paid in parts: each paid part, with its share of the bill,
         -- in the month it was paid.
         SELECT p.expense_id, p.id, pos.part_no, pos.part_count,
            p.amount_etb, p.amount_etb / NULLIF(expense_parts_payable(e), 0), p.paid_date
           FROM expense_payments p
           JOIN expenses e ON e.id = p.expense_id
           CROSS JOIN LATERAL expense_part_position(p.id) pos
          WHERE p.state = 'paid' AND e.in_parts
        ), base AS (
         SELECT e.id AS expense_id,
            e.expense_code,
            e.date AS expense_date,
            s.amount::numeric(12,2) AS amount_etb,
            e.amount_etb AS bill_amount,
            s.share,
            s.part_id, s.part_no, s.part_count,
            e.vendor_id,
            v.vendor_name,
            v.tin AS vendor_tin,
            e.project_id,
            p.project_name,
            e.receipt_url,
            vr.id AS receipt_id,
            vr.status AS receipt_status,
            vr.vat_amount AS receipt_vat,
            vr.document_url AS receipt_document,
            CASE WHEN s.part_id IS NULL THEN COALESCE(vr.receipt_date, e.date)
                 ELSE COALESCE(s.part_paid_date, e.date) END AS anchor_date,
            i.vat_applicable,
            i.declare_ec_year,
            i.declare_ec_month,
            i.copy_status AS copy_status_set,
            i.vat_amount AS vat_amount_set,
            i.notes
           FROM src s
             JOIN expenses e ON e.id = s.expense_id
             LEFT JOIN vendors v ON v.id = e.vendor_id
             LEFT JOIN projects p ON p.id = e.project_id
             LEFT JOIN input_vat_items i ON i.expense_id = e.id
             LEFT JOIN LATERAL ( SELECT r_1.id, r_1.status, r_1.vat_amount, r_1.document_url, r_1.receipt_date
                   FROM vendor_receipts r_1
                  WHERE r_1.expense_id = e.id
                  ORDER BY (r_1.status = 'tax_reviewed'::text) DESC, r_1.created_at DESC
                 LIMIT 1) vr ON true
          WHERE NOT COALESCE(e.is_archived, false) AND e.date >= financials_cutover_date()
            AND e.vendor_receipt_facilitation_id IS NULL AND e.expense_type IS DISTINCT FROM 'vrf'::expense_category
        ), r AS (
         SELECT b_1.*,
            (COALESCE(b_1.vat_applicable, true) AND COALESCE((b_1.receipt_status = 'tax_reviewed'::text), false)) AS is_claimable
           FROM base b_1
        )
 SELECT b.expense_id,
    b.expense_code,
    b.expense_date,
    b.amount_etb,
    b.vendor_id,
    b.vendor_name,
    b.vendor_tin,
    b.project_id,
    b.project_name,
    b.vat_applicable,
    b.anchor_date,
    dp.ec_year AS default_ec_year,
    dp.ec_month AS default_ec_month,
    COALESCE(b.declare_ec_year, dp.ec_year) AS declare_ec_year,
    COALESCE(b.declare_ec_month, dp.ec_month) AS declare_ec_month,
    ((ec_month_name(COALESCE(b.declare_ec_month, dp.ec_month)) || ' '::text) || COALESCE(b.declare_ec_year, dp.ec_year)) AS declare_period_label,
    (b.declare_ec_year IS NOT NULL) AS declare_overridden,
    -- The bill's VAT (entered, from its receipt, or estimated), times this
    -- row's share of the bill: all of it for a bill paid in one go.
    round(b.share * COALESCE(b.vat_amount_set, b.receipt_vat, round(((b.bill_amount * rt.rate) / ((1)::numeric + rt.rate)), 2)), 2) AS vat_amount,
        CASE
            WHEN (b.vat_amount_set IS NOT NULL) THEN 'entered'::text
            WHEN (b.receipt_vat IS NOT NULL) THEN 'receipt'::text
            ELSE 'estimated'::text
        END AS vat_source,
    b.receipt_id,
    b.receipt_status,
    COALESCE(b.copy_status_set,
        CASE
            WHEN ((b.receipt_document IS NOT NULL) OR (b.receipt_url IS NOT NULL)) THEN 'uploaded'::text
            ELSE 'not_uploaded'::text
        END) AS copy_status,
    (b.copy_status_set IS NOT NULL) AS copy_status_set,
    b.is_claimable AS claimable,
    b.notes,
        CASE
            WHEN (b.vat_applicable = false) THEN 'not_vat'::text
            WHEN b.is_claimable THEN 'claimed'::text
            WHEN (b.receipt_status = ANY (ARRAY['pending_verification'::text, 'verified'::text])) THEN 'in_review'::text
            WHEN (b.receipt_status = 'rejected'::text) THEN 'rejected'::text
            WHEN (b.vat_applicable = true) THEN 'needs_receipt'::text
            ELSE 'unflagged'::text
        END AS stage,
    b.part_id,
    b.part_no,
    b.part_count
   FROM ((r b
     CROSS JOIN LATERAL tax_period_for_date(b.anchor_date) dp(ec_year, ec_month))
     CROSS JOIN LATERAL ( SELECT ((tax_rate_note('VAT'::text, b.anchor_date) ->> 'standard_rate'::text))::numeric AS rate) rt);

-- ── The books: each part's input VAT on its own date ───────────────────────
CREATE OR REPLACE FUNCTION sync_expense_input_vat(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e       expenses%ROWTYPE;
  v_vat   numeric;
  v_cost  uuid;
  v_lines jsonb := '[]'::jsonb;
  q       record;
BEGIN
  SELECT * INTO e FROM expenses WHERE id = p_id;
  SELECT l.account_id INTO v_cost
    FROM journal_entries je JOIN journal_lines l ON l.journal_entry_id = je.id
    JOIN chart_of_accounts c ON c.id = l.account_id AND c.nature = 'Expense'
   WHERE je.source_id = p_id AND je.source_table IN ('expense_accrual', 'expenses') AND l.debit > 0
   ORDER BY je.created_at DESC LIMIT 1;
  IF v_cost IS NULL THEN
    SELECT l.account_id INTO v_cost
      FROM expense_payments q2 JOIN journal_entries je ON je.source_table = 'expense_payments' AND je.source_id = q2.id
      JOIN journal_lines l ON l.journal_entry_id = je.id
      JOIN chart_of_accounts c ON c.id = l.account_id AND c.nature = 'Expense'
     WHERE q2.expense_id = p_id AND l.debit > 0
     ORDER BY je.created_at DESC LIMIT 1;
  END IF;

  -- A bill paid in parts: one entry per part, dated when the part was paid.
  -- Every part is synced, so a part no longer paid has its entry reversed.
  FOR q IN SELECT p.id, p.paid_date FROM expense_payments p WHERE p.expense_id = p_id LOOP
    v_lines := '[]'::jsonb;
    SELECT t.vat_amount INTO v_vat FROM v_input_vat_tracker t WHERE t.part_id = q.id AND t.claimable;
    IF e.id IS NOT NULL AND COALESCE(e.in_parts, false) AND COALESCE(v_vat, 0) > 0 AND v_cost IS NOT NULL
       AND in_current_fy(COALESCE(q.paid_date, e.date)) THEN
      v_lines := jsonb_build_array(ledger_line(coa_id('input_vat'), v_vat, 'Input VAT on a tax-reviewed receipt (part payment)', e.project_id))
              || expense_cost_lines(e, v_cost, -v_vat, 'VAT is reclaimable, not a cost');
    END IF;
    PERFORM ledger_sync('expense_input_vat', q.id, COALESCE(q.paid_date, e.date, CURRENT_DATE),
                        'Input VAT: ' || COALESCE(e.expense_code, p_id::text) || ' (part payment)', v_lines, 'adjusting');
  END LOOP;

  -- A bill paid in one go: one entry for the bill (none while in parts).
  v_lines := '[]'::jsonb;
  v_vat := NULL;
  SELECT t.vat_amount INTO v_vat FROM v_input_vat_tracker t WHERE t.expense_id = p_id AND t.part_id IS NULL AND t.claimable;
  IF e.id IS NOT NULL AND NOT COALESCE(e.in_parts, false) AND COALESCE(v_vat, 0) > 0 AND v_cost IS NOT NULL AND in_current_fy(e.date) THEN
    v_lines := jsonb_build_array(ledger_line(coa_id('input_vat'), v_vat, 'Input VAT on a tax-reviewed receipt', e.project_id))
            || expense_cost_lines(e, v_cost, -v_vat, 'VAT is reclaimable, not a cost');
  END IF;
  PERFORM ledger_sync('expense_input_vat', p_id, COALESCE(e.date, CURRENT_DATE),
                      'Input VAT: ' || COALESCE(e.expense_code, p_id::text), v_lines, 'adjusting');
EXCEPTION WHEN OTHERS THEN
  PERFORM log_posting_failure('expenses', p_id, 'Input VAT: ' || SQLERRM);
END $$;

-- A part paid (or no longer paid) moves its input VAT.
CREATE OR REPLACE FUNCTION trg_expense_part_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e expenses%ROWTYPE; v_req uuid; v_pos record;
BEGIN
  PERFORM expense_part_post(NEW.id);
  -- Cancelling happens only while a plan is replaced, which refreshes once
  -- the new parts are in.
  IF TG_OP = 'UPDATE' AND NEW.state IS DISTINCT FROM OLD.state AND NEW.state <> 'cancelled' THEN
    PERFORM expense_parts_refresh(NEW.expense_id);
    IF NEW.state = 'paid' OR OLD.state = 'paid' THEN
      PERFORM sync_expense_input_vat(NEW.expense_id);
    END IF;
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
  ELSIF TG_OP = 'UPDATE' AND NEW.state = 'paid' AND NEW.paid_date IS DISTINCT FROM OLD.paid_date THEN
    PERFORM sync_expense_input_vat(NEW.expense_id);
  END IF;
  RETURN NULL;
END $$;

-- ── WHT: withheld on each paid part, in its month ──────────────────────────
CREATE OR REPLACE VIEW v_wht_payable_by_ec_period WITH (security_invoker = true) AS
 WITH lines AS (
         SELECT tp.ec_year,
            tp.ec_month,
            e.payment_status AS paid,
            e.wht_amount AS wht,
            false AS is_vrf
           FROM (expenses e
             CROSS JOIN LATERAL tax_period_for_date(COALESCE(e.total_payment_date, (e.paid_date)::date, e.date)) tp(ec_year, ec_month))
          WHERE ((COALESCE(e.wht_amount, (0)::numeric) > (0)::numeric) AND (COALESCE(e.total_payment_date, (e.paid_date)::date, e.date) IS NOT NULL) AND (NOT COALESCE(e.is_archived, false)) AND (e.vendor_receipt_facilitation_id IS NULL) AND (e.expense_type IS DISTINCT FROM 'vrf'::expense_category))
            AND NOT e.in_parts
        UNION ALL
         -- A bill paid in parts: each part's withholding, when it is paid
         -- (a part not paid yet is still pending, on the bill's date).
         SELECT tp.ec_year,
            tp.ec_month,
            q.state = 'paid',
            q.wht_etb,
            false
           FROM expense_payments q
             JOIN expenses e ON e.id = q.expense_id
             CROSS JOIN LATERAL tax_period_for_date(CASE WHEN q.state = 'paid' THEN q.paid_date ELSE e.date END) tp(ec_year, ec_month)
          WHERE e.in_parts AND q.state <> 'cancelled' AND q.wht_etb > 0
            AND NOT COALESCE(e.is_archived, false) AND e.vendor_receipt_facilitation_id IS NULL
            AND e.expense_type IS DISTINCT FROM 'vrf'::expense_category
            AND CASE WHEN q.state = 'paid' THEN q.paid_date ELSE e.date END IS NOT NULL
        UNION ALL
         SELECT tp.ec_year,
            tp.ec_month,
            true,
            f.wht_amount,
            true
           FROM (vendor_receipt_facilitation f
             CROSS JOIN LATERAL tax_period_for_date(COALESCE(f.sent_date, f.trxn_date)) tp(ec_year, ec_month))
          WHERE (f.structured AND (NOT f.is_archived) AND (f.payment_state = 'sent'::text) AND (COALESCE(f.sent_date, f.trxn_date) IS NOT NULL) AND (COALESCE(f.wht_amount, (0)::numeric) > (0)::numeric))
        )
 SELECT ec_year,
    ec_month,
    ((ec_month_name(ec_month) || ' '::text) || ec_year) AS period_label,
    count(*) FILTER (WHERE paid) AS paid_expense_count,
    COALESCE(sum(wht) FILTER (WHERE paid), (0)::numeric) AS wht_withheld,
    count(*) FILTER (WHERE (NOT paid)) AS pending_expense_count,
    COALESCE(sum(wht) FILTER (WHERE (NOT paid)), (0)::numeric) AS wht_pending_unpaid,
    count(*) FILTER (WHERE is_vrf) AS vrf_count,
    COALESCE(sum(wht) FILTER (WHERE is_vrf), (0)::numeric) AS vrf_wht
   FROM lines
  GROUP BY ec_year, ec_month;

-- ── Forecasts: only the parts due this month ───────────────────────────────
-- These functions are long and otherwise unchanged, so each is patched in
-- place; every patch must match exactly once or the migration stops.
DO $patch$
DECLARE
  v_def text; v_new text; v_n int; rec record;
BEGIN
  FOR rec IN SELECT * FROM (VALUES
    -- tax_plan_compute: VAT on approved bills paid this month
    ('tax_plan_compute(integer,integer,jsonb)',
     $re$SELECT\s+e\.amount_etb\s+AS\s+amt,\s+CASE$re$,
     $rp$SELECT expense_due_base(e, v_e) AS amt, CASE$rp$),
    -- tax_plan_compute: WHT still to withhold excludes what paid parts withheld
    ('tax_plan_compute(integer,integer,jsonb)',
     $re$SELECT\s+e\.payment_status\s+AS\s+paid,\s+COALESCE\(e\.wht_amount,\s*0\)\s+AS\s+wht,$re$,
     $rp$SELECT e.payment_status AS paid, COALESCE(e.wht_amount, 0) - CASE WHEN e.in_parts THEN (SELECT COALESCE(sum(q.wht_etb), 0) FROM expense_payments q WHERE q.expense_id = e.id AND q.state = 'paid') ELSE 0 END AS wht,$rp$),
    -- tax_impact_compute: a bill's T-tag weighs what is due this month
    ('tax_impact_compute()',
     $re$COALESCE\(e\.amount_etb,\s*0\)\s+AS\s+amount,$re$,
     $rp$expense_due_base(e, b.end_greg) AS amount,$rp$),
    -- tax_plan_levers: bring delivered purchases forward
    ('tax_plan_levers(integer,integer,jsonb)',
     $re$sum\(round\(e\.amount_etb\s+\*\s+v_r$re$,
     $rp$sum(round(expense_due_base(e, v_e) * v_r$rp$),
    -- tax_vat_goal: switch suppliers on what is still to pay
    ('tax_vat_goal(integer,integer,numeric)',
     $re$sum\(e\.amount_etb\)$re$,
     $rp$sum(expense_due_base(e, (SELECT tb.end_greg FROM tax_period_bounds(p_ec_year, p_ec_month) tb)))$rp$),
    -- tax_po_goal_effect: tracked (paid) parts plus the rest, the due part
    -- of it "pay" this month and the remainder "later"
    ('tax_po_goal_effect(integer,integer)',
     $re$ex\s+AS\s+\(\s*SELECT\s+e\.sourcing_bundle_id\s+AS\s+po_id.*?WHERE\s+NOT\s+COALESCE\(e\.is_archived,\s*false\)\s*\),\s*rest\s+AS$re$,
     $rp$ex AS (
    SELECT e.sourcing_bundle_id AS po_id, COALESCE(t.amount_etb, 0) AS amt,
           CASE WHEN ivi.vat_applicable = false THEN 'none'
                WHEN ivi.vat_applicable OR e.receipt_is_vat OR po.vtype = 'Supplier with VAT' THEN 'vat'
                WHEN po.vtype IN ('Supplier with no receipt', 'Supplier with TOT', 'Individual', 'Labor Broker', 'Staff', 'Refundee', 'Government', 'Facilitation') THEN 'none'
                ELSE 'unknown' END AS cls,
           t.vat_amount AS vat,
           CASE WHEN (t.declare_ec_year, t.declare_ec_month) = (y, m) AND COALESCE(t.claimable, false) THEN 'counted'
                WHEN (t.declare_ec_year, t.declare_ec_month) = (y, m) THEN 'receipt'
                ELSE 'later' END AS stage
      FROM expenses e JOIN po ON po.id = e.sourcing_bundle_id
      LEFT JOIN input_vat_items ivi ON ivi.expense_id = e.id
      JOIN v_input_vat_tracker t ON t.expense_id = e.id
     WHERE NOT COALESCE(e.is_archived, false)
    UNION ALL
    SELECT e.sourcing_bundle_id, u.amt,
           CASE WHEN ivi.vat_applicable = false THEN 'none'
                WHEN ivi.vat_applicable OR e.receipt_is_vat OR po.vtype = 'Supplier with VAT' THEN 'vat'
                WHEN po.vtype IN ('Supplier with no receipt', 'Supplier with TOT', 'Individual', 'Labor Broker', 'Staff', 'Refundee', 'Government', 'Facilitation') THEN 'none'
                ELSE 'unknown' END,
           round(u.amt * r / (1 + r), 2),
           CASE WHEN COALESCE(e.payment_status, false) OR u.later THEN 'later'
                WHEN e.payment_state IN ('approved_to_pay', 'sent', 'advance') THEN CASE WHEN v_current THEN 'pay' ELSE 'later' END
                ELSE 'raise' END
      FROM expenses e JOIN po ON po.id = e.sourcing_bundle_id
      LEFT JOIN input_vat_items ivi ON ivi.expense_id = e.id
      CROSS JOIN LATERAL (SELECT GREATEST(COALESCE(e.amount_etb, 0)
                                 - COALESCE((SELECT sum(t2.amount_etb) FROM v_input_vat_tracker t2 WHERE t2.expense_id = e.id), 0), 0) AS rest,
                                 CASE WHEN e.in_parts THEN expense_due_base(e, (SELECT tb.end_greg FROM tax_period_bounds(y, m) tb)) END AS due) d
      CROSS JOIN LATERAL (VALUES (false, CASE WHEN d.due IS NULL THEN d.rest ELSE LEAST(d.due, d.rest) END),
                                 (true,  CASE WHEN d.due IS NULL THEN 0 ELSE d.rest - LEAST(d.due, d.rest) END)) u(later, amt)
     WHERE NOT COALESCE(e.is_archived, false) AND u.amt > 0.5
  ), rest AS$rp$)
  ) AS t(fn, re, rp)
  LOOP
    v_def := pg_get_functiondef(('public.' || rec.fn)::regprocedure);
    SELECT count(*) INTO v_n FROM regexp_matches(v_def, rec.re, 'g');
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'Patch for % matched % times, expected once: %', rec.fn, v_n, rec.re;
    END IF;
    v_new := regexp_replace(v_def, rec.re, rec.rp);
    EXECUTE v_new;
  END LOOP;
END $patch$;
