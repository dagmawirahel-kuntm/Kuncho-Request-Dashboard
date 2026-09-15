-- PR 9d group (a): payment_milestones core schema + RLS + amount-computation
-- triggers. Contract-value-based payment milestones, phase-gated by BOQ
-- physical progress (PR 9c).
--
-- WHT/retention formula — confirmed with the user against the existing
-- client-side convention (migration 201, contracts.wht_deduction_mode) and
-- the sales-side implementation in ClientDetailPage.tsx's saleWht():
--
--   gross_amount_etb       = contracts.contract_value * percent_of_contract_value / 100
--   retention_withheld_etb = gross_amount_etb * COALESCE(contracts.retention_percent, 0) / 100
--   wht base/qualification depends on contracts.wht_deduction_mode:
--     'per_payment' (default): base = this milestone's own gross_amount_etb;
--       qualifies when base >= 20,000 ETB (matches saleWht's per_payment
--       branch: `qualifies: base >= WHT_THRESHOLD`, note >=).
--     'final_only': only the milestone with the highest sequence_number for
--       the contract qualifies — mirrors is_final_payment on sales, since
--       milestones have no equivalent flag; base = contracts.contract_value
--       (the full contract, not this milestone's share); qualifies when
--       base > 20,000 ETB (matches saleWht's final_only branch, note
--       strictly >, not >= — a real, deliberate discrepancy between the
--       two branches in the existing code, preserved here for fidelity).
--     All non-qualifying milestones get wht_withheld_etb = 0.
--   wht_withheld_etb = qualifies ? round(base * rate_pct / 100, 2) : 0
--     where rate_pct = COALESCE(contracts.wht_rate, 3) -- percent, e.g. 3 = 3%.
--
--   IMPORTANT unit note, confirmed with the user: contracts.wht_rate is
--   entered and documented everywhere (ContractFormPage's "e.g. 3" input,
--   generateContractDocument's "${wht_rate}%" text, the column's own
--   COMMENT) as a percentage number, so this divides by 100. One existing
--   line, ClientDetailPage.tsx's `saleWht`-consuming `base * rate` bank-
--   matching estimate, uses `rate` as a raw multiplier with no /100 --
--   that appears to be a pre-existing unit bug (harmless there because it's
--   only a "does this bank line look like a plausible match" estimate, not
--   a posted amount), left untouched here as it's outside this PR's scope.
--   Not flagged as a migration TODO because fixing it would need its own
--   verification pass against real contracts with an explicit wht_rate.
--
--   net_payable_etb = gross_amount_etb - retention_withheld_etb - wht_withheld_etb
--
-- Amounts recompute (via recompute_all_contract_milestone_amounts, set-based
-- across every milestone of the contract, not just the one that changed --
-- necessary because which milestone is "last" for final_only purposes shifts
-- whenever a milestone is added, removed, or reordered) whenever:
--   - a milestone's percent_of_contract_value or sequence_number changes,
--     or a milestone is inserted/deleted, or
--   - the contract's contract_value, wht_rate, retention_percent, or
--     wht_deduction_mode changes.
-- Both triggers are AFTER triggers that only ever touch the four computed
-- columns, so neither can re-trigger itself or the other.

SET search_path TO public;

-- ── 1) payment_milestones ─────────────────────────────────────────────────
CREATE TABLE payment_milestones (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id                 UUID NOT NULL REFERENCES contracts(id),
  project_id                  UUID NOT NULL REFERENCES projects(id),
  sequence_number             INT NOT NULL,
  title                       TEXT NOT NULL,
  percent_of_contract_value   NUMERIC NOT NULL CHECK (percent_of_contract_value > 0 AND percent_of_contract_value <= 100),
  gross_amount_etb            NUMERIC NOT NULL DEFAULT 0,
  retention_withheld_etb      NUMERIC NOT NULL DEFAULT 0,
  wht_withheld_etb            NUMERIC NOT NULL DEFAULT 0,
  net_payable_etb             NUMERIC NOT NULL DEFAULT 0,
  status                      TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'progress_met', 'invoiced', 'payment_confirmed')),
  progress_met_at             TIMESTAMPTZ,
  progress_met_by_staff_id    UUID REFERENCES staff(id),
  invoiced_at                 TIMESTAMPTZ,
  invoiced_by_staff_id        UUID REFERENCES staff(id),
  invoice_document_url        TEXT,
  payment_confirmed_at        TIMESTAMPTZ,
  payment_confirmed_by_staff_id UUID REFERENCES staff(id),
  amount_received_etb         NUMERIC,
  payment_note                TEXT,
  created_by_staff_id         UUID REFERENCES staff(id),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, sequence_number)
);

CREATE INDEX idx_payment_milestones_contract ON payment_milestones(contract_id);
CREATE INDEX idx_payment_milestones_project ON payment_milestones(project_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON payment_milestones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 2) payment_milestone_boq_items (junction; same pattern as PR 9b's
--       schedule_task_boq_items) ────────────────────────────────────────────
CREATE TABLE payment_milestone_boq_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_milestone_id  UUID NOT NULL REFERENCES payment_milestones(id) ON DELETE CASCADE,
  boq_item_id           UUID NOT NULL REFERENCES boq_items(id),
  UNIQUE (payment_milestone_id, boq_item_id)
);

CREATE INDEX idx_payment_milestone_boq_items_milestone ON payment_milestone_boq_items(payment_milestone_id);
CREATE INDEX idx_payment_milestone_boq_items_boq_item ON payment_milestone_boq_items(boq_item_id);

-- ── 3) milestone_gate_overrides (audit log; same spirit as PR 9b's
--       schedule_baseline_resets) ──────────────────────────────────────────
CREATE TABLE milestone_gate_overrides (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_task_id        UUID NOT NULL REFERENCES schedule_tasks(id),
  blocking_milestone_id   UUID NOT NULL REFERENCES payment_milestones(id),
  reason                  TEXT NOT NULL,
  overridden_by_staff_id  UUID NOT NULL REFERENCES staff(id),
  overridden_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_milestone_gate_overrides_task ON milestone_gate_overrides(schedule_task_id);

-- ── 4) Amount computation ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION recompute_all_contract_milestone_amounts(p_contract_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_contract_value numeric;
  v_wht_rate_pct   numeric;
  v_retention_pct  numeric;
  v_wht_mode       text;
  v_max_seq        int;
BEGIN
  SELECT contract_value, COALESCE(wht_rate, 3), COALESCE(retention_percent, 0), wht_deduction_mode
    INTO v_contract_value, v_wht_rate_pct, v_retention_pct, v_wht_mode
  FROM contracts WHERE id = p_contract_id;

  IF v_contract_value IS NULL THEN
    -- Contract has no value yet (still being drafted) -- nothing to
    -- compute against; zero out rather than compute off a NULL base.
    UPDATE payment_milestones
    SET gross_amount_etb = 0, retention_withheld_etb = 0, wht_withheld_etb = 0, net_payable_etb = 0
    WHERE contract_id = p_contract_id;
    RETURN;
  END IF;

  SELECT max(sequence_number) INTO v_max_seq FROM payment_milestones WHERE contract_id = p_contract_id;

  WITH calc AS (
    SELECT
      pm.id,
      round(v_contract_value * pm.percent_of_contract_value / 100, 2) AS gross,
      round(v_contract_value * pm.percent_of_contract_value / 100 * v_retention_pct / 100, 2) AS retention,
      CASE
        WHEN v_wht_mode = 'final_only' AND pm.sequence_number = v_max_seq AND v_contract_value > 20000
          THEN round(v_contract_value * v_wht_rate_pct / 100, 2)
        WHEN v_wht_mode <> 'final_only'
             AND round(v_contract_value * pm.percent_of_contract_value / 100, 2) >= 20000
          THEN round(round(v_contract_value * pm.percent_of_contract_value / 100, 2) * v_wht_rate_pct / 100, 2)
        ELSE 0
      END AS wht
    FROM payment_milestones pm
    WHERE pm.contract_id = p_contract_id
  )
  UPDATE payment_milestones pm
  SET gross_amount_etb = calc.gross,
      retention_withheld_etb = calc.retention,
      wht_withheld_etb = calc.wht,
      net_payable_etb = calc.gross - calc.retention - calc.wht
  FROM calc
  WHERE pm.id = calc.id;
END;
$$;

CREATE OR REPLACE FUNCTION trg_recompute_milestones_from_milestone_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM recompute_all_contract_milestone_amounts(COALESCE(NEW.contract_id, OLD.contract_id));
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_payment_milestones_recompute
  AFTER INSERT OR DELETE OR UPDATE OF percent_of_contract_value, sequence_number
  ON payment_milestones
  FOR EACH ROW EXECUTE FUNCTION trg_recompute_milestones_from_milestone_change();

CREATE OR REPLACE FUNCTION trg_recompute_milestones_from_contract_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM recompute_all_contract_milestone_amounts(NEW.id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_contracts_recompute_milestones
  AFTER UPDATE OF contract_value, wht_rate, retention_percent, wht_deduction_mode
  ON contracts
  FOR EACH ROW EXECUTE FUNCTION trg_recompute_milestones_from_contract_change();

-- ── 5) Milestone plan balance check (soft; frontend queries this to warn,
--       never blocks) ───────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_contract_milestone_plan_totals AS
SELECT
  contract_id,
  count(*) AS milestone_count,
  round(sum(percent_of_contract_value), 2) AS sum_percent_of_contract_value,
  abs(sum(percent_of_contract_value) - 100) <= 0.5 AS is_balanced
FROM payment_milestones
GROUP BY contract_id;

-- ── 6) RLS ────────────────────────────────────────────────────────────────
ALTER TABLE payment_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_milestone_boq_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE milestone_gate_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_milestones_select ON payment_milestones FOR SELECT TO authenticated
  USING (get_user_role() IN ('admin', 'executive', 'finance', 'project_manager'));

CREATE POLICY payment_milestones_insert ON payment_milestones FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('admin', 'project_manager', 'finance'));

-- Direct writes can only touch the plan while it's still 'pending', and can
-- never themselves move status off 'pending' -- that's the pipeline RPCs'
-- job (group b), which are SECURITY DEFINER and so bypass this policy.
-- Without the WITH CHECK's own status='pending' clause, a PM/Finance user
-- could otherwise raw-UPDATE straight to 'payment_confirmed' and skip every
-- verification the RPCs perform.
CREATE POLICY payment_milestones_update ON payment_milestones FOR UPDATE TO authenticated
  USING (status = 'pending' AND get_user_role() IN ('admin', 'project_manager', 'finance'))
  WITH CHECK (status = 'pending' AND get_user_role() IN ('admin', 'project_manager', 'finance'));

CREATE POLICY payment_milestone_boq_items_select ON payment_milestone_boq_items FOR SELECT TO authenticated
  USING (get_user_role() IN ('admin', 'executive', 'finance', 'project_manager'));

CREATE POLICY payment_milestone_boq_items_insert ON payment_milestone_boq_items FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role() IN ('admin', 'project_manager', 'finance')
    AND EXISTS (SELECT 1 FROM payment_milestones pm
      WHERE pm.id = payment_milestone_boq_items.payment_milestone_id AND pm.status = 'pending')
  );

CREATE POLICY payment_milestone_boq_items_delete ON payment_milestone_boq_items FOR DELETE TO authenticated
  USING (
    get_user_role() IN ('admin', 'project_manager', 'finance')
    AND EXISTS (SELECT 1 FROM payment_milestones pm
      WHERE pm.id = payment_milestone_boq_items.payment_milestone_id AND pm.status = 'pending')
  );

CREATE POLICY milestone_gate_overrides_select ON milestone_gate_overrides FOR SELECT TO authenticated
  USING (get_user_role() IN ('admin', 'executive', 'finance', 'project_manager'));
-- No write policy -- milestone_gate_overrides writes go through the
-- create_work_order_from_task override path only (group c).

-- Verify.
SELECT tablename, policyname, cmd FROM pg_policies
WHERE tablename IN ('payment_milestones', 'payment_milestone_boq_items', 'milestone_gate_overrides')
ORDER BY tablename, cmd;
