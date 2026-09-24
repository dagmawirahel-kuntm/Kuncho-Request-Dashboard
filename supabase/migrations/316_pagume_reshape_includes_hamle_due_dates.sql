-- Fix to set_pagume_attachment() (315): Hamle's due dates move too.
--
-- 315 reshaped Nehase and Meskerem and left Hamle alone, on the reasoning
-- that Hamle's due date depends only on when Nehase STARTS -- which never
-- moves. That holds for "day N of the following period" rules (Schedule A,
-- pension) but not for "end of the following period" rules (VAT, WHT):
-- those depend on where Nehase ENDS, which is exactly what the Pagume
-- choice changes. Found by checking the filings after applying FY2026/27's
-- choice: Hamle 2018 VAT and WHT still showed 5 Sep 2026 when Nehase now
-- ends on 10 Sep.
--
-- Hamle's due date is recomputed only while it is still a draft, so a
-- due date the tax officer set by hand on a submitted return is never
-- overwritten. Its period bounds are not touched (they never change).

SET search_path TO public;

CREATE OR REPLACE FUNCTION set_pagume_attachment(p_fiscal_period_id uuid, p_attaches_to text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fy        fiscal_periods%ROWTYPE;
  v_y         int;
  v_blocking  text;
  v_f         tax_filings%ROWTYPE;
  v_b         record;
  v_removed   int := 0;
  v_reshaped  int := 0;
  v_redated   int := 0;
  v_rule      jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (is_tax_officer() OR COALESCE(get_user_role() = 'admin', false)) THEN
    RAISE EXCEPTION 'Only the tax officer or an admin can change where Pagume is declared';
  END IF;
  IF p_attaches_to NOT IN ('nehase', 'meskerem') THEN
    RAISE EXCEPTION 'Pagume attaches to nehase or meskerem, not %', p_attaches_to;
  END IF;

  SELECT * INTO v_fy FROM fiscal_periods WHERE id = p_fiscal_period_id;
  IF v_fy.id IS NULL THEN
    RAISE EXCEPTION 'Fiscal period % not found', p_fiscal_period_id;
  END IF;

  SELECT g.ec_year INTO v_y FROM gregorian_to_ec(v_fy.start_date) g;

  SELECT string_agg(DISTINCT f.schedule_code || ' ' || f.period_label || ' (' || f.status || ')', ', ')
    INTO v_blocking
  FROM tax_filings f
  WHERE (f.fiscal_period_id = v_fy.id OR f.period_start_greg BETWEEN v_fy.start_date AND v_fy.end_date)
    AND ((f.period_ec_year = v_y AND f.period_ec_month IN (12, 13)) OR (f.period_ec_year = v_y + 1 AND f.period_ec_month = 1))
    AND (f.status <> 'draft'
         OR (f.period_ec_month = 13 AND (f.declared_amount IS NOT NULL OR f.paid_amount IS NOT NULL
             OR f.government_reference_no IS NOT NULL OR f.notes IS NOT NULL
             OR EXISTS (SELECT 1 FROM tax_filing_documents d WHERE d.tax_filing_id = f.id))));
  IF v_blocking IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot move Pagume: these returns are past draft or hold entries — %', v_blocking;
  END IF;

  UPDATE fiscal_periods SET pagume_attaches_to = p_attaches_to WHERE id = v_fy.id;

  FOR v_f IN
    SELECT * FROM tax_filings f
    WHERE (f.fiscal_period_id = v_fy.id OR f.period_start_greg BETWEEN v_fy.start_date AND v_fy.end_date)
      AND f.period_ec_year = v_y AND f.period_ec_month = 13
  LOOP
    INSERT INTO tax_filing_deletions (deleted_filing_snapshot, schedule_code, period_label, reason, deleted_by)
    VALUES (to_jsonb(v_f) || jsonb_build_object('documents', '[]'::jsonb), v_f.schedule_code, v_f.period_label,
            'Pagume ' || v_y || ' folded into ' || CASE p_attaches_to WHEN 'nehase' THEN 'Nehase ' || v_y ELSE 'Meskerem ' || (v_y + 1) END
            || ' by the ' || v_fy.label || ' Pagume setting', auth.uid());
    DELETE FROM tax_filings WHERE id = v_f.id;
    v_removed := v_removed + 1;
  END LOOP;

  -- Nehase Y and Meskerem Y+1: new bounds and due dates.
  FOR v_f IN
    SELECT * FROM tax_filings f
    WHERE (f.fiscal_period_id = v_fy.id OR f.period_start_greg BETWEEN v_fy.start_date AND v_fy.end_date)
      AND ((f.period_ec_year = v_y AND f.period_ec_month = 12) OR (f.period_ec_year = v_y + 1 AND f.period_ec_month = 1))
  LOOP
    SELECT * INTO v_b FROM tax_period_bounds(v_f.period_ec_year, v_f.period_ec_month);
    SELECT default_due_rule INTO v_rule FROM tax_schedules WHERE id = v_f.tax_schedule_id;
    UPDATE tax_filings
    SET period_start_greg = v_b.start_greg,
        period_end_greg   = v_b.end_greg,
        due_date_greg     = tax_filing_due_date(v_rule, v_f.period_ec_year, v_f.period_ec_month, v_fy.end_date),
        updated_at        = now()
    WHERE id = v_f.id;
    v_reshaped := v_reshaped + 1;
  END LOOP;

  -- Hamle Y: due date only (an end-of-following-period rule ends with Nehase).
  FOR v_f IN
    SELECT * FROM tax_filings f
    WHERE (f.fiscal_period_id = v_fy.id OR f.period_start_greg BETWEEN v_fy.start_date AND v_fy.end_date)
      AND f.period_ec_year = v_y AND f.period_ec_month = 11 AND f.status = 'draft'
  LOOP
    SELECT default_due_rule INTO v_rule FROM tax_schedules WHERE id = v_f.tax_schedule_id;
    UPDATE tax_filings
    SET due_date_greg = tax_filing_due_date(v_rule, v_f.period_ec_year, v_f.period_ec_month, v_fy.end_date),
        updated_at    = now()
    WHERE id = v_f.id;
    v_redated := v_redated + 1;
  END LOOP;

  RETURN jsonb_build_object('fiscal_year', v_fy.label, 'pagume_attaches_to', p_attaches_to,
                            'pagume_filings_removed', v_removed, 'filings_reshaped', v_reshaped,
                            'hamle_due_dates_recomputed', v_redated);
END;
$$;
REVOKE EXECUTE ON FUNCTION set_pagume_attachment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_pagume_attachment(uuid, text) TO authenticated;
