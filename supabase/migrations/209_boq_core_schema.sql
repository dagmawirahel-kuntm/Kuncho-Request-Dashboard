-- ============================================================
-- BOQ foundation (PR 9a of the BOQ/Schedule/Progress/Milestones
-- series). Additive only — does not touch proformas, contracts,
-- projects, expenses, or any existing budget table. Proforma stays
-- the sales-pipeline document; a BOQ is created FROM an accepted
-- proforma at project kickoff and lives independently from then on.
--
-- Tree shape: boqs (one row per version) -> boq_items (self-
-- referential tree: Room -> Category -> optional Sub-category ->
-- line_item/lump_sum leaf). Three node types coexist:
--   section   — no price of its own, rolls up its children's totals
--   line_item — quantity x unit_rate_etb (0 if is_priced_elsewhere)
--   lump_sum  — a fixed total the user enters directly, no rate
--
-- "Priced elsewhere": a line_item can carry a real quantity (so
-- Procurement has a spec to buy against) while contributing 0 ETB to
-- the total, because its cost actually lives inside a sibling
-- lump_sum (e.g. "Meeting chairs, 12 pcs" -> FURNITURE lump sum).
-- absorbed_by_item_id is purely informational, never enforced.
-- ============================================================

SET search_path TO public;

CREATE TABLE boqs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID NOT NULL REFERENCES projects(id),
  version_number        INT NOT NULL DEFAULT 1,
  parent_boq_id         UUID REFERENCES boqs(id),
  title                 TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'internal_review', 'approved', 'superseded')),
  source_proforma_id    UUID REFERENCES proformas(id),
  owner_pm_staff_id     UUID NOT NULL REFERENCES staff(id),
  total_direct_etb      NUMERIC NOT NULL DEFAULT 0,
  total_lump_sum_etb    NUMERIC NOT NULL DEFAULT 0,
  grand_total_etb       NUMERIC NOT NULL DEFAULT 0,
  notes                 TEXT,
  approved_at           TIMESTAMPTZ,
  approved_by_staff_id  UUID REFERENCES staff(id),
  created_by_staff_id   UUID REFERENCES staff(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, version_number)
);

-- Only one approved BOQ per project at a time.
CREATE UNIQUE INDEX one_approved_boq_per_project ON boqs (project_id) WHERE status = 'approved';

CREATE INDEX idx_boqs_project ON boqs(project_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON boqs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-supersede: the moment a BOQ version becomes 'approved', any
-- other 'approved' row for the same project flips to 'superseded'.
-- SECURITY DEFINER because the row being flipped is already
-- 'approved' — the boqs UPDATE RLS policy (below) only lets
-- contributors touch draft/internal_review rows, and "approved ->
-- superseded" is explicitly a system transition, not a user action
-- (guardrail: "Status -> superseded: trigger-managed, not user").
CREATE OR REPLACE FUNCTION supersede_previous_boq_version()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved') THEN
    UPDATE boqs SET status = 'superseded', updated_at = now()
    WHERE project_id = NEW.project_id AND status = 'approved' AND id <> NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_supersede_previous_boq_version
  BEFORE INSERT OR UPDATE OF status ON boqs
  FOR EACH ROW EXECUTE FUNCTION supersede_previous_boq_version();

-- ── Items ────────────────────────────────────────────────────────
CREATE TABLE boq_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boq_id                UUID NOT NULL REFERENCES boqs(id) ON DELETE CASCADE,
  parent_item_id        UUID REFERENCES boq_items(id) ON DELETE CASCADE,
  display_order         INT NOT NULL DEFAULT 0,
  node_type             TEXT NOT NULL CHECK (node_type IN ('section', 'line_item', 'lump_sum')),
  name                  TEXT NOT NULL,
  notes                 TEXT,
  unit                  TEXT,
  quantity              NUMERIC,
  unit_rate_etb         NUMERIC,
  total_etb             NUMERIC NOT NULL DEFAULT 0,
  is_priced_elsewhere   BOOLEAN NOT NULL DEFAULT false,
  absorbed_by_item_id   UUID REFERENCES boq_items(id),
  -- Bookkeeping only, not part of the original spec's schema: set by
  -- duplicate_boq_as_new_version() to point at the item this row was
  -- copied from in the previous version. A change order's diff
  -- (boq_change_order_items) references items on the OLD version;
  -- finalize_change_order() needs this to resolve those references
  -- onto the freshly duplicated NEW version's item ids.
  source_item_id        UUID REFERENCES boq_items(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT boq_items_shape_check CHECK (
    (node_type = 'section' AND quantity IS NULL AND unit_rate_etb IS NULL)
    OR (node_type = 'line_item' AND quantity IS NOT NULL AND unit_rate_etb IS NOT NULL)
    OR (node_type = 'lump_sum' AND total_etb IS NOT NULL)
  )
);

CREATE INDEX idx_boq_items_tree ON boq_items(boq_id, parent_item_id, display_order);
CREATE INDEX idx_boq_items_type ON boq_items(boq_id, node_type);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON boq_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- A superseded BOQ's items are read-only. finalize_change_order()
-- never touches a superseded boq's items directly (it duplicates
-- into a new draft row first), so this never blocks the legitimate
-- version-bump path — only direct edits to old, closed-out versions.
CREATE OR REPLACE FUNCTION block_superseded_boq_item_edit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM boqs WHERE id = COALESCE(NEW.boq_id, OLD.boq_id);
  IF v_status = 'superseded' THEN
    RAISE EXCEPTION 'This BOQ version has been superseded and is read-only';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_block_superseded_boq_item_edit
  BEFORE INSERT OR UPDATE OR DELETE ON boq_items
  FOR EACH ROW EXECUTE FUNCTION block_superseded_boq_item_edit();

-- Sets a row's OWN total_etb before it's written — no extra UPDATE,
-- so no redundant trigger re-fire. lump_sum's total_etb is exactly
-- whatever the caller supplied (validated NOT NULL by the CHECK
-- constraint above); section starts at whatever's given (0 on a
-- fresh insert with no children yet) and gets corrected by the
-- rollup trigger below the moment it has children.
CREATE OR REPLACE FUNCTION set_boq_item_own_total()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.node_type = 'line_item' THEN
    NEW.total_etb := CASE WHEN NEW.is_priced_elsewhere THEN 0 ELSE COALESCE(NEW.quantity, 0) * COALESCE(NEW.unit_rate_etb, 0) END;
  ELSIF NEW.node_type = 'section' THEN
    NEW.total_etb := COALESCE(NEW.total_etb, 0);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_boq_item_own_total
  BEFORE INSERT OR UPDATE ON boq_items
  FOR EACH ROW EXECUTE FUNCTION set_boq_item_own_total();

-- Rolls a changed leaf's total up through every ancestor, then
-- refreshes the owning boq's three total columns. Guarded by
-- pg_trigger_depth() so the ancestor UPDATEs issued here (which
-- re-fire this same trigger for each ancestor row) don't redo the
-- walk a second time — the depth-1 invocation's WHILE loop already
-- covers the whole chain in one pass.
CREATE OR REPLACE FUNCTION recalc_boq_grand_totals(p_boq_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_direct NUMERIC;
  v_lump   NUMERIC;
BEGIN
  SELECT COALESCE(SUM(total_etb), 0) INTO v_direct FROM boq_items WHERE boq_id = p_boq_id AND node_type = 'line_item';
  SELECT COALESCE(SUM(total_etb), 0) INTO v_lump FROM boq_items WHERE boq_id = p_boq_id AND node_type = 'lump_sum';
  UPDATE boqs SET total_direct_etb = v_direct, total_lump_sum_etb = v_lump, grand_total_etb = v_direct + v_lump, updated_at = now()
  WHERE id = p_boq_id;
END;
$$;

CREATE OR REPLACE FUNCTION recalc_boq_totals_trigger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_current UUID;
  v_sum     NUMERIC;
  v_boq_id  UUID;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_current := OLD.parent_item_id;
    v_boq_id := OLD.boq_id;
  ELSE
    v_current := NEW.parent_item_id;
    v_boq_id := NEW.boq_id;
  END IF;

  WHILE v_current IS NOT NULL LOOP
    SELECT COALESCE(SUM(total_etb), 0) INTO v_sum FROM boq_items WHERE parent_item_id = v_current;
    UPDATE boq_items SET total_etb = v_sum, updated_at = now() WHERE id = v_current;
    SELECT parent_item_id INTO v_current FROM boq_items WHERE id = v_current;
  END LOOP;

  IF TG_OP = 'UPDATE' AND OLD.parent_item_id IS DISTINCT FROM NEW.parent_item_id AND OLD.parent_item_id IS NOT NULL THEN
    v_current := OLD.parent_item_id;
    WHILE v_current IS NOT NULL LOOP
      SELECT COALESCE(SUM(total_etb), 0) INTO v_sum FROM boq_items WHERE parent_item_id = v_current;
      UPDATE boq_items SET total_etb = v_sum, updated_at = now() WHERE id = v_current;
      SELECT parent_item_id INTO v_current FROM boq_items WHERE id = v_current;
    END LOOP;
  END IF;

  PERFORM recalc_boq_grand_totals(v_boq_id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_recalculate_boq_totals
  AFTER INSERT OR UPDATE OR DELETE ON boq_items
  FOR EACH ROW EXECUTE FUNCTION recalc_boq_totals_trigger();

-- Rejects any parent_item_id change that would create a cycle.
CREATE OR REPLACE FUNCTION prevent_boq_item_cycles()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_current UUID;
BEGIN
  IF NEW.parent_item_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_item_id = NEW.id THEN
    RAISE EXCEPTION 'A BOQ item cannot be its own parent';
  END IF;
  v_current := NEW.parent_item_id;
  WHILE v_current IS NOT NULL LOOP
    IF v_current = NEW.id THEN
      RAISE EXCEPTION 'This change would create a cycle in the BOQ item tree';
    END IF;
    SELECT parent_item_id INTO v_current FROM boq_items WHERE id = v_current;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_boq_item_cycles
  BEFORE INSERT OR UPDATE OF parent_item_id ON boq_items
  FOR EACH ROW
  WHEN (NEW.parent_item_id IS NOT NULL)
  EXECUTE FUNCTION prevent_boq_item_cycles();

-- ── RLS ──────────────────────────────────────────────────────────
-- "PM, Ops, Design, Finance, Procurement" reads as a role-based check
-- (project_manager, operations_manager, design, finance,
-- procurement_officer) rather than staff.department_id/head_staff_id
-- lookups — this codebase's access control is role-based everywhere
-- else (get_user_role()), and department head_staff_id is only
-- populated for half the departments, so it isn't a reliable gate.
ALTER TABLE boqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE boq_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY boqs_select ON boqs FOR SELECT TO authenticated
  USING (get_user_role() IN ('admin', 'executive', 'finance', 'project_manager', 'operations_manager', 'design', 'procurement_officer'));

CREATE POLICY boqs_insert ON boqs FOR INSERT TO authenticated
  WITH CHECK (status IN ('draft', 'internal_review') AND get_user_role() IN ('admin', 'project_manager', 'operations_manager', 'design', 'finance', 'procurement_officer'));

CREATE POLICY boqs_update ON boqs FOR UPDATE TO authenticated
  USING (status IN ('draft', 'internal_review') AND get_user_role() IN ('admin', 'project_manager', 'operations_manager', 'design', 'finance', 'procurement_officer'))
  WITH CHECK (
    (status <> 'approved' AND get_user_role() IN ('admin', 'project_manager', 'operations_manager', 'design', 'finance', 'procurement_officer'))
    OR (status = 'approved' AND get_user_role() IN ('admin', 'project_manager'))
  );

CREATE POLICY boq_items_select ON boq_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM boqs b WHERE b.id = boq_items.boq_id
    AND get_user_role() IN ('admin', 'executive', 'finance', 'project_manager', 'operations_manager', 'design', 'procurement_officer')));

CREATE POLICY boq_items_write ON boq_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM boqs b WHERE b.id = boq_items.boq_id AND b.status IN ('draft', 'internal_review')
    AND get_user_role() IN ('admin', 'project_manager', 'operations_manager', 'design', 'finance', 'procurement_officer')))
  WITH CHECK (EXISTS (SELECT 1 FROM boqs b WHERE b.id = boq_items.boq_id AND b.status IN ('draft', 'internal_review')
    AND get_user_role() IN ('admin', 'project_manager', 'operations_manager', 'design', 'finance', 'procurement_officer')));

-- Verify.
SELECT tablename FROM pg_tables WHERE tablename IN ('boqs', 'boq_items');
