-- 330 — The sales journey: one deal from lead to final payment
--
-- How Kuncho sells: most work comes by word of mouth and trusted associates,
-- tenders are bid with a CPO, and finance keeps the record, collecting what
-- the executives or whoever brought the sale tell them. Clients pay an
-- advance, progress and final payment; none has asked for retention.
--
-- 1. Finance can create and edit opportunities and contracts (it keeps the
--    record; until now only sales, admin and executive could).
-- 2. Opportunities move through fixed stages — lead, qualified, site visit,
--    quoted, negotiating, won, lost — each change kept in
--    opportunity_stage_history. Each records where it came from (word of
--    mouth, associate, repeat client, tender, other), who brought it
--    (a staff member and/or the associate's name) and, when lost, why.
--    A deal is won with a client; a tender links its CPO bid bond
--    (cpo_bonds.opportunity_id, which already exists).
-- 3. A proforma belongs to its opportunity.
-- 4. A contract's payment plan is advance / progress / final
--    (create_contract_payment_plan), retention 0 unless set. The advance is
--    due on signing, so it can be marked due without BOQ progress.
-- 5. Client files: the app uploads to a 'client-documents' bucket that did
--    not exist, so every upload failed and client_attachments is empty. The
--    bucket is created (private) with storage rules matching the table's,
--    and a file can be filed against its opportunity and contract.
-- 6. Projects: is_internal marks cost buckets (Salaries, Taxes, Workshop…)
--    that have no client. Every other project is linked to its client — from
--    the sales, contracts and proformas that name both, then by the names
--    confirmed on 2026-09-25. A project a contract points at takes the
--    contract's client.

SET search_path TO public;

-- ── 1. Finance keeps the record ─────────────────────────────────────────
DROP POLICY IF EXISTS opportunities_write ON opportunities;
CREATE POLICY opportunities_write ON opportunities FOR ALL
  USING (get_user_role() = ANY (ARRAY['sales', 'admin', 'executive', 'finance']::user_role[]))
  WITH CHECK (get_user_role() = ANY (ARRAY['sales', 'admin', 'executive', 'finance']::user_role[]));

DROP POLICY IF EXISTS contracts_write ON contracts;
CREATE POLICY contracts_write ON contracts FOR ALL
  USING (get_user_role() = ANY (ARRAY['sales', 'admin', 'executive', 'finance']::user_role[]))
  WITH CHECK (get_user_role() = ANY (ARRAY['sales', 'admin', 'executive', 'finance']::user_role[]));

-- ── 2. Opportunity stages, source, who brought it ───────────────────────
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS brought_by_staff_id uuid REFERENCES staff(id),
  ADD COLUMN IF NOT EXISTS referrer_name text,
  ADD COLUMN IF NOT EXISTS lost_reason text,
  ADD COLUMN IF NOT EXISTS stage_changed_at timestamptz;

UPDATE opportunities SET stage = 'lead' WHERE stage IS NULL OR stage NOT IN ('lead', 'qualified', 'site_visit', 'quoted', 'negotiating', 'won', 'lost');
UPDATE opportunities SET stage_changed_at = COALESCE(stage_changed_at, updated_at, created_at);

ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_stage_check;
ALTER TABLE opportunities ADD CONSTRAINT opportunities_stage_check
  CHECK (stage IN ('lead', 'qualified', 'site_visit', 'quoted', 'negotiating', 'won', 'lost'));
ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_source_check;
ALTER TABLE opportunities ADD CONSTRAINT opportunities_source_check
  CHECK (source IS NULL OR source IN ('word_of_mouth', 'associate', 'repeat_client', 'tender', 'other'));
CREATE INDEX IF NOT EXISTS idx_opportunities_stage ON opportunities(stage);

CREATE TABLE IF NOT EXISTS opportunity_stage_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  from_stage     text,
  to_stage       text NOT NULL,
  changed_by     uuid REFERENCES user_profiles(id),
  changed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_opp_stage_history_opp ON opportunity_stage_history(opportunity_id, changed_at);
ALTER TABLE opportunity_stage_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS opp_stage_history_read ON opportunity_stage_history;
CREATE POLICY opp_stage_history_read ON opportunity_stage_history FOR SELECT
  USING (auth.uid() IS NOT NULL);
-- Written by the trigger below, as the person moving the deal; append-only.
DROP POLICY IF EXISTS opp_stage_history_insert ON opportunity_stage_history;
CREATE POLICY opp_stage_history_insert ON opportunity_stage_history FOR INSERT
  WITH CHECK (get_user_role() = ANY (ARRAY['sales', 'admin', 'executive', 'finance']::user_role[])
              AND changed_by = auth.uid());
REVOKE ALL ON opportunity_stage_history FROM anon;
GRANT SELECT, INSERT ON opportunity_stage_history TO authenticated;

-- What a stage needs, checked when the deal moves (the four existing
-- records keep what they have).
CREATE OR REPLACE FUNCTION public.opportunity_stage_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.stage IS NOT DISTINCT FROM OLD.stage THEN
    RETURN NEW;
  END IF;
  IF NEW.stage = 'won' AND NEW.client_id IS NULL THEN
    RAISE EXCEPTION 'A won deal needs its client — add the client first';
  END IF;
  IF NEW.stage = 'lost' AND btrim(COALESCE(NEW.lost_reason, '')) = '' THEN
    RAISE EXCEPTION 'Say why the deal was lost';
  END IF;
  NEW.stage_changed_at := now();
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.opportunity_stage_guard() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS trg_opportunity_stage_guard ON opportunities;
CREATE TRIGGER trg_opportunity_stage_guard BEFORE INSERT OR UPDATE OF stage ON opportunities
  FOR EACH ROW EXECUTE FUNCTION opportunity_stage_guard();

CREATE OR REPLACE FUNCTION public.opportunity_stage_log()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO opportunity_stage_history (opportunity_id, from_stage, to_stage, changed_by)
    VALUES (NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.stage END, NEW.stage, auth.uid());
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.opportunity_stage_log() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS trg_opportunity_stage_log ON opportunities;
CREATE TRIGGER trg_opportunity_stage_log AFTER INSERT OR UPDATE OF stage ON opportunities
  FOR EACH ROW EXECUTE FUNCTION opportunity_stage_log();

-- The existing deals start their history at their current stage.
INSERT INTO opportunity_stage_history (opportunity_id, from_stage, to_stage, changed_at)
SELECT o.id, NULL, o.stage, COALESCE(o.updated_at, o.created_at)
FROM opportunities o
WHERE NOT EXISTS (SELECT 1 FROM opportunity_stage_history h WHERE h.opportunity_id = o.id);

-- ── 3. A proforma belongs to its opportunity ────────────────────────────
ALTER TABLE proformas ADD COLUMN IF NOT EXISTS opportunity_id uuid REFERENCES opportunities(id);
CREATE INDEX IF NOT EXISTS idx_proformas_opportunity ON proformas(opportunity_id);

-- ── 4. Payment plan: advance / progress / final ─────────────────────────
ALTER TABLE contracts ALTER COLUMN retention_percent SET DEFAULT 0;
UPDATE contracts SET retention_percent = 0 WHERE retention_percent IS NULL;

ALTER TABLE payment_milestones ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'other';
ALTER TABLE payment_milestones DROP CONSTRAINT IF EXISTS payment_milestones_kind_check;
ALTER TABLE payment_milestones ADD CONSTRAINT payment_milestones_kind_check
  CHECK (kind IN ('advance', 'progress', 'final', 'other'));

-- Invoker: the caller's own milestone rights (admin, PM, finance) apply.
CREATE OR REPLACE FUNCTION public.create_contract_payment_plan(
  p_contract_id uuid, p_advance_pct numeric, p_progress_pct numeric, p_final_pct numeric)
RETURNS void LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE c record; v_seq int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Only finance or admin can set a contract''s payment plan';
  END IF;
  SELECT * INTO c FROM contracts WHERE id = p_contract_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contract not found'; END IF;
  IF c.project_id IS NULL THEN RAISE EXCEPTION 'Link the contract to its project first'; END IF;
  IF EXISTS (SELECT 1 FROM payment_milestones WHERE contract_id = p_contract_id) THEN
    RAISE EXCEPTION 'This contract already has a payment plan';
  END IF;
  IF COALESCE(p_advance_pct, 0) < 0 OR COALESCE(p_progress_pct, 0) < 0 OR COALESCE(p_final_pct, 0) < 0 THEN
    RAISE EXCEPTION 'Percentages cannot be negative';
  END IF;
  IF round(COALESCE(p_advance_pct, 0) + COALESCE(p_progress_pct, 0) + COALESCE(p_final_pct, 0), 2) <> 100 THEN
    RAISE EXCEPTION 'Advance, progress and final must add up to 100%% (they add up to %)',
      (COALESCE(p_advance_pct, 0) + COALESCE(p_progress_pct, 0) + COALESCE(p_final_pct, 0))::text || '%';
  END IF;

  IF COALESCE(p_advance_pct, 0) > 0 THEN
    v_seq := v_seq + 1;
    INSERT INTO payment_milestones (contract_id, project_id, sequence_number, title, percent_of_contract_value, kind, created_by_staff_id)
    VALUES (p_contract_id, c.project_id, v_seq, 'Advance payment', p_advance_pct, 'advance', current_staff_id());
  END IF;
  IF COALESCE(p_progress_pct, 0) > 0 THEN
    v_seq := v_seq + 1;
    INSERT INTO payment_milestones (contract_id, project_id, sequence_number, title, percent_of_contract_value, kind, created_by_staff_id)
    VALUES (p_contract_id, c.project_id, v_seq, 'Progress payment', p_progress_pct, 'progress', current_staff_id());
  END IF;
  IF COALESCE(p_final_pct, 0) > 0 THEN
    v_seq := v_seq + 1;
    INSERT INTO payment_milestones (contract_id, project_id, sequence_number, title, percent_of_contract_value, kind, created_by_staff_id)
    VALUES (p_contract_id, c.project_id, v_seq, 'Final payment', p_final_pct, 'final', current_staff_id());
  END IF;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.create_contract_payment_plan(uuid, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_contract_payment_plan(uuid, numeric, numeric, numeric) TO authenticated;

-- The advance is due on signing: finance (or admin, or the PM) marks it due
-- once the contract is signed, with no BOQ progress behind it. Every other
-- milestone keeps the BOQ gate.
CREATE OR REPLACE FUNCTION public.mark_milestone_progress_met(p_milestone_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_m          payment_milestones%ROWTYPE;
  v_pm_staff   UUID;
  v_caller     UUID;
  v_role       user_role;
  v_linked     INT;
  v_incomplete INT;
  v_detail     TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_m FROM payment_milestones WHERE id = p_milestone_id;
  IF v_m.id IS NULL THEN
    RAISE EXCEPTION 'Payment milestone % not found', p_milestone_id;
  END IF;

  SELECT project_manager_id INTO v_pm_staff FROM projects WHERE id = v_m.project_id;
  v_caller := current_staff_id();
  v_role   := get_user_role();

  IF v_m.status <> 'pending' THEN
    RAISE EXCEPTION 'Milestone is at status %; progress can only be marked from pending', v_m.status;
  END IF;

  IF v_m.kind = 'advance' THEN
    IF NOT (COALESCE(v_role IN ('admin', 'finance'), false) OR (v_caller IS NOT NULL AND v_caller = v_pm_staff)) THEN
      RAISE EXCEPTION 'Only finance, the project''s PM or an admin can mark the advance due';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM contracts WHERE id = v_m.contract_id AND status IN ('signed', 'active', 'completed')) THEN
      RAISE EXCEPTION 'The advance falls due when the contract is signed — mark the contract signed first';
    END IF;
    UPDATE payment_milestones
    SET status = 'progress_met', progress_met_at = now(), progress_met_by_staff_id = v_caller
    WHERE id = p_milestone_id;
    RETURN;
  END IF;

  IF NOT (
    COALESCE(v_role = 'admin', false)
    OR (v_caller IS NOT NULL AND v_caller = v_pm_staff)
  ) THEN
    RAISE EXCEPTION 'Only the project''s PM or an admin can mark a milestone''s progress as met';
  END IF;

  SELECT count(*) INTO v_linked
  FROM payment_milestone_boq_items WHERE payment_milestone_id = p_milestone_id;

  IF v_linked = 0 THEN
    RAISE EXCEPTION 'This milestone has no BOQ items linked -- link the scope that defines its completion before marking progress met';
  END IF;

  SELECT count(*) INTO v_incomplete
  FROM payment_milestone_boq_items pmbi
  LEFT JOIN v_boq_item_physical_progress p ON p.item_id = pmbi.boq_item_id
  WHERE pmbi.payment_milestone_id = p_milestone_id
    AND COALESCE(p.progress_pct, -1) < 100;

  IF v_incomplete > 0 THEN
    SELECT string_agg(format('%s (%s)', COALESCE(p.name, 'unknown item'),
                             COALESCE(p.progress_pct::text || '%', 'no progress data')), '; ')
      INTO v_detail
    FROM payment_milestone_boq_items pmbi
    LEFT JOIN v_boq_item_physical_progress p ON p.item_id = pmbi.boq_item_id
    WHERE pmbi.payment_milestone_id = p_milestone_id
      AND COALESCE(p.progress_pct, -1) < 100;

    RAISE EXCEPTION 'Cannot mark progress met: % of % linked BOQ item(s) are not at 100%%. Outstanding: %',
      v_incomplete, v_linked, v_detail;
  END IF;

  UPDATE payment_milestones
  SET status = 'progress_met', progress_met_at = now(), progress_met_by_staff_id = v_caller
  WHERE id = p_milestone_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.mark_milestone_progress_met(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_milestone_progress_met(uuid) TO authenticated;

-- ── 5. Client files ─────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('client-documents', 'client-documents', false, 26214400)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS client_docs_select ON storage.objects;
CREATE POLICY client_docs_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'client-documents'
         AND get_user_role() = ANY (ARRAY['admin', 'executive', 'finance', 'sales', 'project_manager']::user_role[]));
DROP POLICY IF EXISTS client_docs_insert ON storage.objects;
CREATE POLICY client_docs_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'client-documents'
              AND get_user_role() = ANY (ARRAY['admin', 'executive', 'finance', 'sales', 'project_manager']::user_role[]));
DROP POLICY IF EXISTS client_docs_delete ON storage.objects;
CREATE POLICY client_docs_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'client-documents'
         AND get_user_role() = ANY (ARRAY['admin', 'executive', 'finance']::user_role[]));

ALTER TABLE client_attachments
  ADD COLUMN IF NOT EXISTS opportunity_id uuid REFERENCES opportunities(id),
  ADD COLUMN IF NOT EXISTS contract_id uuid REFERENCES contracts(id);
CREATE INDEX IF NOT EXISTS idx_client_attachments_opportunity ON client_attachments(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_client_attachments_contract ON client_attachments(contract_id);

-- ── 6. Projects and their clients ───────────────────────────────────────
ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;

-- A contract's project takes the contract's client when it has none.
CREATE OR REPLACE FUNCTION public.sync_project_contract_value()
RETURNS trigger LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.project_id IS NOT NULL THEN
    UPDATE projects
    SET contract_value = NEW.contract_value,
        client_id = COALESCE(client_id, NEW.client_id)
    WHERE id = NEW.project_id;
  END IF;
  RETURN NEW;
END;
$function$;

-- From the records that name both a project and a client.
WITH src AS (
  SELECT project_id, client_id FROM contracts WHERE project_id IS NOT NULL
  UNION ALL SELECT project_id, client_id FROM sales WHERE project_id IS NOT NULL AND client_id IS NOT NULL
  UNION ALL SELECT project_id, client_id FROM sales_fy2025_26_frozen WHERE project_id IS NOT NULL AND client_id IS NOT NULL
  UNION ALL SELECT project_id, client_id FROM proformas WHERE project_id IS NOT NULL AND client_id IS NOT NULL
), one AS (
  SELECT project_id, min(client_id::text)::uuid AS client_id FROM src GROUP BY project_id HAVING count(DISTINCT client_id) = 1
)
UPDATE projects p SET client_id = one.client_id FROM one WHERE p.id = one.project_id AND p.client_id IS NULL;

-- By name, as confirmed on 2026-09-25. Matched on the names, not ids.
WITH m(pattern, client) AS (VALUES
  ('jotun%', 'JOTUN ETHIOPIA PAINT MANUFACTURING PLC'),
  ('zemen%', 'ZEMEN BANK S.C'),
  ('msc', 'MEDITERRANEAN SHIPPING ETHIOPIA PLC'),
  ('prana%', 'Prana Events PLC'),
  ('flawless%', 'FLAWLESS INTERNATIONAL BUSINESS PLC'),
  ('ethio telecom%', 'ETHIO TELECOM'),
  ('tenaw flowers', 'TENAW FLOWERS'),
  ('midroc%', 'Midroc Ethiopia'),
  ('jr %', 'JR PETROLEUM PLC'),
  ('jerr hq', 'JERR PLC'),
  ('hpp', 'HPP EXHIBITION SERVICE PLC'),
  ('ethel', 'ETHEL ADVERTISING & COMMUNICATION'),
  ('fabb tables', 'FABB PARTNERS PLC'),
  ('anbesa bank', 'ANBESSA BANK'),
  ('wafa (aaicc)', 'WAFA MARKETING AND PROMOTION'),
  ('statistical sovereignty summit', 'Ethiopian Statistical Services'),
  ('interior design work for aih', 'ABAY INVESTMENT HOLDING GROUP'),
  ('hortiflora 2026', 'EHPEA'),
  ('temesgen garden', 'TEMESGEN KAFYALEW'),
  ('elmi coca cola', 'ELIMI OLINDO CONSTRUCTION PLC'),
  ('mesob%', 'OFFICE OF THE PRIME MINISTER')
)
UPDATE projects p SET client_id = c.id
FROM m JOIN clients c ON lower(btrim(c.client_name)) = lower(m.client)
WHERE lower(btrim(p.project_name)) LIKE m.pattern AND p.client_id IS NULL;

-- Cost buckets and internal work have no client.
UPDATE projects SET is_internal = true
WHERE client_id IS NULL AND lower(btrim(project_name)) IN (
  'admin related expense', 'cart for agg purchases', 'company stock', 'loan installments',
  'office expenses', 'office materials', 'penalty', 'personal related', 'salaries', 'taxes',
  'workshop', 'workshop maintenance', 'workshop ppe', 'workshop samples',
  'leather product samples', 'afcs (sample)', 'test', 'test 2', 'new project', 'new office project');
