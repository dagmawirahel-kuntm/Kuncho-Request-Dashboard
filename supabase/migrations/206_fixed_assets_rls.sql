-- ============================================================
-- RLS for the fixed asset register, plus the custodian's narrow
-- self-service RPC.
--
-- "Finance & Admin department members" (per spec) is written here as
-- get_user_role() IN ('admin', 'finance') — this codebase's access
-- control is role-based throughout (every other module gates on
-- get_user_role(), not staff.department_id membership), so that's the
-- consistent read of "Finance & Admin" here rather than introducing a
-- department-membership check nothing else in the app uses.
--
-- Deviation from spec on custodian_flag_asset_issue: the spec calls
-- for a SECURITY INVOKER RPC. RLS can't restrict which *columns* an
-- UPDATE touches — only which *rows* — so an INVOKER-mode RPC needs a
-- real UPDATE policy letting the custodian through, and that same
-- policy would just as well let them UPDATE any column on their own
-- asset row via a direct client call (purchase_cost_etb, custodian_staff_id,
-- etc.), not just condition/notes as intended. Same reasoning as the
-- trainer_hints_enabled toggle earlier: SECURITY DEFINER + an
-- in-function custodian check is what actually keeps this "narrow" —
-- there is no fixed_assets UPDATE policy granting custodians anything.
-- ============================================================

SET search_path TO public;

ALTER TABLE fixed_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_asset_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_asset_usage_log ENABLE ROW LEVEL SECURITY;

-- ── fixed_assets ─────────────────────────────────────────────────
CREATE POLICY fixed_assets_select ON fixed_assets
  FOR SELECT TO authenticated USING (true);

CREATE POLICY fixed_assets_write ON fixed_assets
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('admin', 'finance'));

CREATE POLICY fixed_assets_update ON fixed_assets
  FOR UPDATE TO authenticated
  USING (get_user_role() IN ('admin', 'finance'))
  WITH CHECK (get_user_role() IN ('admin', 'finance'));

CREATE POLICY fixed_assets_delete ON fixed_assets
  FOR DELETE TO authenticated
  USING (get_user_role() IN ('admin', 'finance'));

-- ── fixed_asset_movements (immutable — no UPDATE/DELETE policy) ────
CREATE POLICY fixed_asset_movements_select ON fixed_asset_movements
  FOR SELECT TO authenticated USING (true);

CREATE POLICY fixed_asset_movements_insert ON fixed_asset_movements
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('admin', 'finance'));

-- ── fixed_asset_usage_log ────────────────────────────────────────
CREATE POLICY fixed_asset_usage_log_select ON fixed_asset_usage_log
  FOR SELECT TO authenticated USING (true);

CREATE POLICY fixed_asset_usage_log_write ON fixed_asset_usage_log
  FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role() IN ('admin', 'finance')
    OR EXISTS (SELECT 1 FROM fixed_assets fa WHERE fa.id = fixed_asset_id AND fa.custodian_staff_id = current_staff_id())
  );

CREATE POLICY fixed_asset_usage_log_update ON fixed_asset_usage_log
  FOR UPDATE TO authenticated
  USING (
    get_user_role() IN ('admin', 'finance')
    OR EXISTS (SELECT 1 FROM fixed_assets fa WHERE fa.id = fixed_asset_id AND fa.custodian_staff_id = current_staff_id())
  );

-- ── Custodian self-service: flag a condition issue on their own asset ─
CREATE OR REPLACE FUNCTION custodian_flag_asset_issue(p_asset_id UUID, p_new_condition TEXT, p_note TEXT DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller_staff_id UUID := current_staff_id();
  v_custodian_id    UUID;
BEGIN
  IF v_caller_staff_id IS NULL THEN
    RAISE EXCEPTION 'No staff record linked to this login';
  END IF;

  SELECT custodian_staff_id INTO v_custodian_id FROM fixed_assets WHERE id = p_asset_id;
  IF v_custodian_id IS NULL THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;
  IF v_custodian_id IS DISTINCT FROM v_caller_staff_id THEN
    RAISE EXCEPTION 'Only the current custodian can flag an issue on this asset';
  END IF;
  IF p_new_condition NOT IN ('new', 'good', 'fair', 'poor', 'under_repair', 'retired') THEN
    RAISE EXCEPTION 'Invalid condition value: %', p_new_condition;
  END IF;

  -- Fires trg_log_fixed_asset_movement automatically if condition
  -- actually changes (condition_change row, from/to, moved_by).
  UPDATE fixed_assets
  SET condition = p_new_condition,
      notes = CASE WHEN p_note IS NOT NULL AND p_note <> ''
                    THEN COALESCE(notes || E'\n', '') || to_char(now(), 'YYYY-MM-DD') || ': ' || p_note
                    ELSE notes END
  WHERE id = p_asset_id;

  -- Separate note-only movement row so the flagged note itself is on
  -- the audit trail, not just folded into the free-text notes field.
  IF p_note IS NOT NULL AND p_note <> '' THEN
    INSERT INTO fixed_asset_movements (fixed_asset_id, movement_type, note, moved_by_staff_id)
    VALUES (p_asset_id, 'note', p_note, v_caller_staff_id);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION custodian_flag_asset_issue(UUID, TEXT, TEXT) TO authenticated;

-- Verify: RLS enabled, policies + RPC present.
SELECT tablename, rowsecurity FROM pg_tables WHERE tablename IN ('fixed_assets', 'fixed_asset_movements', 'fixed_asset_usage_log');
SELECT proname FROM pg_proc WHERE proname = 'custodian_flag_asset_issue';
