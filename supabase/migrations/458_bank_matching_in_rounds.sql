-- 458: Bank matching in rounds — "canceling statement due to statement timeout".
--
-- The app's database connection stops any one request after 8 seconds.
-- Importing a statement wrote its lines in under a second and then matched
-- every line in the same request: the reference, then the suggestions (run
-- twice per line), then the saved rules — about 90 ms a line, so a month of
-- CBE (214 lines) took ~20 s and the whole import was cancelled. "Auto-match"
-- on the queue, the audit panel and the sale form ran the same pass over
-- every unmatched line of the account, so they would stop the same way.
--
--   1. auto_reconcile_bank_lines_round: the same three steps, one line at a
--      time in date order, stopping once ~4 s of the request are used. It
--      returns where it stopped; the app calls it again from there until
--      nothing is left. Suggestions are worked out once per line, not twice.
--      Bank charges are synced when the last round finishes.
--   2. import_bank_statement runs the first round itself and returns where it
--      stopped, so the lines are always saved and the app carries on.
--   3. auto_reconcile_bank_lines (the old one-call form) runs one round, so
--      anything still calling it gets part of the work instead of an error.

SET search_path TO public;

-- ── 1. One round ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION auto_reconcile_bank_lines_round(
  p_import_id uuid DEFAULT NULL, p_account_id uuid DEFAULT NULL,
  p_after_date date DEFAULT NULL, p_after_no int DEFAULT NULL, p_after_line uuid DEFAULT NULL,
  p_budget_ms int DEFAULT 4000)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r record; ru record; x record; v_linked boolean; v_done int := 0; v_tried int := 0; v_more boolean := false;
  v_date date := p_after_date; v_no int := p_after_no; v_line uuid := p_after_line; v_account uuid := p_account_id;
  v_budget interval := make_interval(secs => greatest(COALESCE(p_budget_ms, 4000), 500) / 1000.0);
  s_kind text; s_target uuid; s_score int; s2_score int; i int;
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only admin or finance can reconcile bank lines';
  END IF;
  PERFORM set_config('kuncho.bank_auto', 'on', true);
  FOR r IN
    SELECT st.* FROM v_bank_line_status st
    WHERE st.reconciled_as IS NULL AND st.transfer_id IS NOT NULL
      AND (p_import_id IS NULL OR st.import_id = p_import_id)
      AND (p_account_id IS NULL OR st.account_id = p_account_id)
      AND (p_after_date IS NULL
           OR (st.value_date, st.line_no, st.line_id)
              > (p_after_date, COALESCE(p_after_no, -1), COALESCE(p_after_line, '00000000-0000-0000-0000-000000000000'::uuid)))
      AND NOT bank_period_closed(st.account_id, st.value_date)
    ORDER BY st.value_date, st.line_no, st.line_id
  LOOP
    -- Leave room under the request limit for this line and the charge sync;
    -- every round gets through at least one line.
    IF v_tried > 0 AND clock_timestamp() - statement_timestamp() > v_budget THEN v_more := true; EXIT; END IF;
    v_tried := v_tried + 1; v_date := r.value_date; v_no := r.line_no; v_line := r.line_id;

    -- 1. The reference: whatever payment (or payments) carry it.
    IF r.reference_code IS NOT NULL THEN
      BEGIN
        v_linked := bank_link_reference(r.line_id);
      EXCEPTION WHEN OTHERS THEN v_linked := false;
      END;
      IF v_linked THEN v_done := v_done + 1; CONTINUE; END IF;
    END IF;

    -- 2. A suggestion so strong nothing else comes close.
    s_kind := NULL; s_target := NULL; s_score := NULL; s2_score := NULL; i := 0;
    FOR x IN SELECT m.kind, m.target_id, m.score FROM suggest_bank_line_matches(r.line_id) m ORDER BY m.score DESC LIMIT 2 LOOP
      i := i + 1;
      IF i = 1 THEN s_kind := x.kind; s_target := x.target_id; s_score := x.score; ELSE s2_score := x.score; END IF;
    END LOOP;
    IF s_score >= 95 AND s_kind IN ('expense', 'expense_part', 'batch', 'vrf', 'sale') AND (s2_score IS NULL OR s2_score < 95) THEN
      BEGIN
        PERFORM apply_bank_line_match(r.line_id, s_kind, s_target); v_done := v_done + 1; CONTINUE;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;

    -- 3. A rule someone saved.
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
  PERFORM set_config('kuncho.bank_auto', 'off', true);

  IF NOT v_more THEN
    IF v_account IS NULL AND p_import_id IS NOT NULL THEN
      SELECT account_id INTO v_account FROM bank_statement_imports WHERE id = p_import_id;
    END IF;
    PERFORM sync_bank_line_charges(v_account, NULL);
  END IF;

  RETURN jsonb_build_object('matched', v_done, 'tried', v_tried, 'more', v_more,
    'after_date', v_date, 'after_no', v_no, 'after_line', v_line);
END $$;
REVOKE ALL ON FUNCTION auto_reconcile_bank_lines_round(uuid, uuid, date, int, uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION auto_reconcile_bank_lines_round(uuid, uuid, date, int, uuid, int) TO authenticated;

-- ── 2. The import runs the first round ──────────────────────────────────
DO $$
DECLARE
  d text;
  p text[][] := ARRAY[
    ARRAY['v_no int := 0; v_line uuid;',
          'v_no int := 0; v_line uuid; v_round jsonb;'],
    ARRAY['v_matched := auto_reconcile_bank_lines(v_import, NULL);',
          'v_round := auto_reconcile_bank_lines_round(v_import, NULL); v_matched := (v_round->>''matched'')::int;'],
    ARRAY['''auto_reconciled'', v_matched + v_paired);',
          '''auto_reconciled'', v_matched + v_paired, ''matching'', v_round);']];
  i int;
BEGIN
  d := pg_get_functiondef('import_bank_statement(uuid,text,text,numeric,numeric,jsonb,boolean)'::regprocedure);
  IF position('v_round' IN d) > 0 THEN RETURN; END IF;  -- already done
  FOR i IN 1 .. array_length(p, 1) LOOP
    IF position(p[i][1] IN d) = 0 THEN
      RAISE EXCEPTION 'import_bank_statement: "%" not found; patch by hand', p[i][1];
    END IF;
    d := replace(d, p[i][1], p[i][2]);
  END LOOP;
  EXECUTE d;
END $$;

-- ── 3. The old one-call form: one round ─────────────────────────────────
CREATE OR REPLACE FUNCTION auto_reconcile_bank_lines(p_import_id uuid DEFAULT NULL, p_account_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN (auto_reconcile_bank_lines_round(p_import_id, p_account_id)->>'matched')::int;
END $$;
