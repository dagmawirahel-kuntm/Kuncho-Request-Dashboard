-- ============================================================
-- BOQ foundation (PR 9a) — change orders + multi-tier approval.
-- Additive only. Depends on 209 (boqs/boq_items) and 210 (views,
-- specifically v_boq_tree, reused by duplicate_boq_as_new_version).
--
-- SECURITY DEFINER deviation from the literal spec ("All RPCs
-- SECURITY INVOKER"), per an explicit user decision (AskUserQuestion,
-- "SECURITY DEFINER for the finalize step only (recommended)"):
--   INVOKER : submit_boq_change_order, reject_change_order
--   DEFINER : pm_approve_change_order, finance_approve_change_order,
--             exec_approve_change_order, record_client_signoff,
--             duplicate_boq_as_new_version, finalize_change_order
-- Reason: a Finance/Exec approver's click must ultimately create and
-- approve a new BOQ version, which is normally PM/admin-only per the
-- boqs RLS policy. Each DEFINER function re-checks get_user_role()
-- and the change order's current status itself before doing anything
-- privileged, and get_user_role() reads the real caller's identity
-- (auth.uid()-based), not the definer's — so this does not weaken
-- the actual role gate, it only lets the gate be enforced in the
-- function body instead of in RLS. duplicate_boq_as_new_version and
-- finalize_change_order are internal-only helpers: EXECUTE is
-- revoked from PUBLIC/authenticated below, so they are reachable
-- only as nested calls from the other DEFINER functions (a nested
-- call's EXECUTE privilege check runs against the definer's owning
-- role, not the original caller's session role).
-- ============================================================

SET search_path TO public;

CREATE TABLE boq_change_orders (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boq_id                  UUID NOT NULL REFERENCES boqs(id),
  resulting_boq_id        UUID REFERENCES boqs(id),
  title                   TEXT NOT NULL,
  description             TEXT,
  requested_by_client     BOOLEAN NOT NULL DEFAULT true,
  cost_delta_etb          NUMERIC NOT NULL,
  approval_level_required TEXT NOT NULL DEFAULT 'pm_only' CHECK (approval_level_required IN ('pm_only', 'pm_finance', 'pm_finance_exec')),
  status                  TEXT NOT NULL DEFAULT 'pending_pm' CHECK (status IN ('pending_pm', 'pending_finance', 'pending_exec', 'pending_client_signoff', 'approved', 'rejected', 'withdrawn')),
  pm_reviewed_by          UUID REFERENCES staff(id),
  pm_reviewed_at          TIMESTAMPTZ,
  finance_reviewed_by     UUID REFERENCES staff(id),
  finance_reviewed_at     TIMESTAMPTZ,
  exec_reviewed_by        UUID REFERENCES staff(id),
  exec_reviewed_at        TIMESTAMPTZ,
  client_signoff_at       TIMESTAMPTZ,
  client_signoff_evidence TEXT,
  rejection_reason        TEXT,
  created_by_staff_id     UUID REFERENCES staff(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_boq_change_orders_boq ON boq_change_orders(boq_id);
CREATE INDEX idx_boq_change_orders_status ON boq_change_orders(status);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON boq_change_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Approval-tier routing, fixed by delta size at submission time:
--   <=50,000       -> pm_only         (finalizes right after PM approval)
--   50,001-500,000 -> pm_finance      (finalizes right after Finance approval)
--   >500,000       -> pm_finance_exec (Finance -> Exec -> client sign-off)
-- Client sign-off is required ONLY for the top tier — re-read the
-- Part 10 acceptance walkthroughs closely: the 30,000 example stops
-- at "only PM sees it," the 200,000 example stops at "moves to
-- Finance queue," and only the 1,200,000 example continues through
-- Exec to client sign-off. This trigger encodes that reading.
CREATE OR REPLACE FUNCTION set_boq_co_approval_level()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF abs(NEW.cost_delta_etb) <= 50000 THEN
    NEW.approval_level_required := 'pm_only';
  ELSIF abs(NEW.cost_delta_etb) <= 500000 THEN
    NEW.approval_level_required := 'pm_finance';
  ELSE
    NEW.approval_level_required := 'pm_finance_exec';
  END IF;
  NEW.status := 'pending_pm';
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_boq_co_approval_level
  BEFORE INSERT ON boq_change_orders
  FOR EACH ROW EXECUTE FUNCTION set_boq_co_approval_level();

-- ── Change order items (the diff) ───────────────────────────────
CREATE TABLE boq_change_order_items (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  change_order_id          UUID NOT NULL REFERENCES boq_change_orders(id) ON DELETE CASCADE,
  action                   TEXT NOT NULL CHECK (action IN ('add', 'modify', 'remove')),
  existing_item_id         UUID REFERENCES boq_items(id),
  parent_item_id           UUID REFERENCES boq_items(id),
  new_name                 TEXT,
  new_unit                 TEXT,
  new_quantity             NUMERIC,
  new_unit_rate_etb        NUMERIC,
  new_notes                TEXT,
  new_node_type            TEXT CHECK (new_node_type IS NULL OR new_node_type IN ('section', 'line_item', 'lump_sum')),
  new_display_order        INT,
  new_is_priced_elsewhere  BOOLEAN,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT boq_co_items_add_needs_parent CHECK (action <> 'add' OR parent_item_id IS NOT NULL),
  CONSTRAINT boq_co_items_existing_needs_id CHECK (action = 'add' OR existing_item_id IS NOT NULL)
);

CREATE INDEX idx_boq_co_items_co ON boq_change_order_items(change_order_id);

-- ── RLS ──────────────────────────────────────────────────────────
ALTER TABLE boq_change_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE boq_change_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY boq_change_orders_select ON boq_change_orders FOR SELECT TO authenticated
  USING (get_user_role() IN ('admin', 'executive', 'finance', 'project_manager', 'operations_manager', 'design', 'procurement_officer'));

-- Originators only (PM/Ops/Design/admin). submit_boq_change_order is
-- SECURITY INVOKER, so this is the real gate on who can open a CO.
CREATE POLICY boq_change_orders_insert ON boq_change_orders FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('admin', 'project_manager', 'operations_manager', 'design'));

-- No general UPDATE policy: every forward-progress transition
-- (pm/finance/exec approve, client sign-off, finalize) runs through
-- a SECURITY DEFINER RPC, which bypasses RLS by design and does its
-- own status/role checks. This policy exists only to let
-- reject_change_order (SECURITY INVOKER) work, and it is scoped
-- tightly: reject is only reachable by the correct stage's approver,
-- from a pending status, into 'rejected' — nothing else.
CREATE POLICY boq_change_orders_reject ON boq_change_orders FOR UPDATE TO authenticated
  USING (
    (status = 'pending_pm' AND get_user_role() IN ('admin', 'project_manager'))
    OR (status = 'pending_finance' AND get_user_role() IN ('admin', 'finance'))
    OR (status = 'pending_exec' AND get_user_role() IN ('admin', 'executive'))
    OR (status = 'pending_client_signoff' AND get_user_role() IN ('admin', 'project_manager'))
  )
  WITH CHECK (status = 'rejected');

CREATE POLICY boq_co_items_select ON boq_change_order_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM boq_change_orders co WHERE co.id = boq_change_order_items.change_order_id
    AND get_user_role() IN ('admin', 'executive', 'finance', 'project_manager', 'operations_manager', 'design', 'procurement_officer')));

-- Items are written only by submit_boq_change_order (INVOKER), in
-- the same transaction as the parent CO insert, while it is still
-- pending_pm. No UPDATE/DELETE policy — the diff is immutable once
-- submitted; finalize_change_order (DEFINER) only reads it.
CREATE POLICY boq_co_items_insert ON boq_change_order_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM boq_change_orders co WHERE co.id = boq_change_order_items.change_order_id
    AND co.status = 'pending_pm'
    AND get_user_role() IN ('admin', 'project_manager', 'operations_manager', 'design')));

-- ── RPCs ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION submit_boq_change_order(
  p_boq_id UUID,
  p_title TEXT,
  p_description TEXT,
  p_requested_by_client BOOLEAN,
  p_cost_delta_etb NUMERIC,
  p_items JSONB
)
RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_boq boqs%ROWTYPE;
  v_co_id UUID;
BEGIN
  IF get_user_role() NOT IN ('admin', 'project_manager', 'operations_manager', 'design') THEN
    RAISE EXCEPTION 'Not authorized to submit a change order';
  END IF;

  SELECT * INTO v_boq FROM boqs WHERE id = p_boq_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOQ not found';
  END IF;
  IF v_boq.status <> 'approved' THEN
    RAISE EXCEPTION 'Change orders can only be submitted against an approved BOQ';
  END IF;

  INSERT INTO boq_change_orders (boq_id, title, description, requested_by_client, cost_delta_etb, created_by_staff_id)
  VALUES (p_boq_id, p_title, p_description, COALESCE(p_requested_by_client, true), p_cost_delta_etb, current_staff_id())
  RETURNING id INTO v_co_id;

  INSERT INTO boq_change_order_items (
    change_order_id, action, existing_item_id, parent_item_id, new_name, new_unit,
    new_quantity, new_unit_rate_etb, new_notes, new_node_type, new_display_order, new_is_priced_elsewhere
  )
  SELECT
    v_co_id, x.action, x.existing_item_id, x.parent_item_id, x.new_name, x.new_unit,
    x.new_quantity, x.new_unit_rate_etb, x.new_notes, x.new_node_type, x.new_display_order, x.new_is_priced_elsewhere
  FROM jsonb_to_recordset(COALESCE(p_items, '[]'::jsonb)) AS x(
    action TEXT, existing_item_id UUID, parent_item_id UUID, new_name TEXT, new_unit TEXT,
    new_quantity NUMERIC, new_unit_rate_etb NUMERIC, new_notes TEXT, new_node_type TEXT,
    new_display_order INT, new_is_priced_elsewhere BOOLEAN
  );

  RETURN v_co_id;
END;
$$;

-- Internal helper: copies a BOQ + its full item tree into a fresh
-- draft v(n+1). source_item_id on each new item points back at the
-- OLD item it was copied from, so finalize_change_order can resolve
-- a change order's item references (written against the OLD version)
-- onto the new version's ids.
CREATE OR REPLACE FUNCTION duplicate_boq_as_new_version(p_boq_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old boqs%ROWTYPE;
  v_new_id UUID;
  v_next_version INT;
  v_id_map JSONB := '{}'::jsonb;
  r RECORD;
  v_new_item_id UUID;
  v_new_parent_id UUID;
BEGIN
  SELECT * INTO v_old FROM boqs WHERE id = p_boq_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOQ not found';
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next_version FROM boqs WHERE project_id = v_old.project_id;

  INSERT INTO boqs (project_id, version_number, parent_boq_id, title, status, source_proforma_id, owner_pm_staff_id, notes, created_by_staff_id)
  VALUES (v_old.project_id, v_next_version, v_old.id, v_old.title, 'draft', v_old.source_proforma_id, v_old.owner_pm_staff_id, v_old.notes, current_staff_id())
  RETURNING id INTO v_new_id;

  FOR r IN SELECT * FROM v_boq_tree(p_boq_id) ORDER BY depth, sort_path LOOP
    v_new_parent_id := NULL;
    IF r.parent_item_id IS NOT NULL THEN
      v_new_parent_id := (v_id_map ->> r.parent_item_id::text)::uuid;
    END IF;

    INSERT INTO boq_items (
      boq_id, parent_item_id, display_order, node_type, name, notes, unit, quantity,
      unit_rate_etb, total_etb, is_priced_elsewhere, source_item_id
    )
    VALUES (
      v_new_id, v_new_parent_id, r.display_order, r.node_type, r.name, r.notes, r.unit, r.quantity,
      r.unit_rate_etb, CASE WHEN r.node_type = 'lump_sum' THEN r.total_etb ELSE 0 END, r.is_priced_elsewhere, r.id
    )
    RETURNING id INTO v_new_item_id;

    v_id_map := v_id_map || jsonb_build_object(r.id::text, v_new_item_id::text);
  END LOOP;

  -- Second pass: remap absorbed_by_item_id now that the id map is complete.
  UPDATE boq_items ni
  SET absorbed_by_item_id = (v_id_map ->> oi.absorbed_by_item_id::text)::uuid
  FROM boq_items oi
  WHERE ni.source_item_id = oi.id
    AND ni.boq_id = v_new_id
    AND oi.absorbed_by_item_id IS NOT NULL;

  PERFORM recalc_boq_grand_totals(v_new_id);

  RETURN v_new_id;
END;
$$;

-- Internal helper: applies a change order's item diff onto a freshly
-- duplicated BOQ version and approves it. Idempotent — a change
-- order that already has resulting_boq_id just returns it.
CREATE OR REPLACE FUNCTION finalize_change_order(p_change_order_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_co boq_change_orders%ROWTYPE;
  v_new_boq_id UUID;
  v_item RECORD;
  v_new_parent_id UUID;
  v_new_existing_id UUID;
  v_node_type TEXT;
BEGIN
  SELECT * INTO v_co FROM boq_change_orders WHERE id = p_change_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Change order not found';
  END IF;
  IF v_co.resulting_boq_id IS NOT NULL THEN
    RETURN v_co.resulting_boq_id;
  END IF;

  v_new_boq_id := duplicate_boq_as_new_version(v_co.boq_id);

  FOR v_item IN SELECT * FROM boq_change_order_items WHERE change_order_id = p_change_order_id LOOP
    IF v_item.action = 'add' THEN
      SELECT id INTO v_new_parent_id FROM boq_items WHERE boq_id = v_new_boq_id AND source_item_id = v_item.parent_item_id;
      IF v_new_parent_id IS NULL THEN
        RAISE EXCEPTION 'Change order references a parent item that no longer exists on the current BOQ version';
      END IF;

      v_node_type := COALESCE(v_item.new_node_type, 'line_item');

      -- lump_sum adds route new_unit_rate_etb straight into total_etb
      -- (a lump sum has no rate of its own — the field is reused as
      -- "the amount" in the diff payload, same convention as 'modify' below).
      INSERT INTO boq_items (boq_id, parent_item_id, display_order, node_type, name, notes, unit, quantity, unit_rate_etb, total_etb, is_priced_elsewhere)
      VALUES (
        v_new_boq_id, v_new_parent_id, COALESCE(v_item.new_display_order, 0), v_node_type, v_item.new_name, v_item.new_notes,
        CASE WHEN v_node_type = 'line_item' THEN v_item.new_unit ELSE NULL END,
        CASE WHEN v_node_type = 'line_item' THEN v_item.new_quantity ELSE NULL END,
        CASE WHEN v_node_type = 'line_item' THEN v_item.new_unit_rate_etb ELSE NULL END,
        CASE WHEN v_node_type = 'lump_sum' THEN COALESCE(v_item.new_unit_rate_etb, 0) ELSE 0 END,
        COALESCE(v_item.new_is_priced_elsewhere, false)
      );

    ELSIF v_item.action = 'modify' THEN
      SELECT id, node_type INTO v_new_existing_id, v_node_type FROM boq_items WHERE boq_id = v_new_boq_id AND source_item_id = v_item.existing_item_id;
      IF v_new_existing_id IS NULL THEN
        RAISE EXCEPTION 'Change order references an item that no longer exists on the current BOQ version';
      END IF;

      -- node_type changes are not supported via modify (scoping
      -- decision — not in the original spec). A lump_sum's amount is
      -- changed by putting the new total in new_unit_rate_etb, same
      -- field-reuse convention as the 'add' branch above.
      UPDATE boq_items SET
        name = COALESCE(v_item.new_name, name),
        unit = CASE WHEN v_node_type = 'line_item' THEN COALESCE(v_item.new_unit, unit) ELSE unit END,
        quantity = CASE WHEN v_node_type = 'line_item' THEN COALESCE(v_item.new_quantity, quantity) ELSE quantity END,
        unit_rate_etb = CASE WHEN v_node_type = 'line_item' THEN COALESCE(v_item.new_unit_rate_etb, unit_rate_etb) ELSE unit_rate_etb END,
        total_etb = CASE WHEN v_node_type = 'lump_sum' THEN COALESCE(v_item.new_unit_rate_etb, total_etb) ELSE total_etb END,
        notes = COALESCE(v_item.new_notes, notes),
        is_priced_elsewhere = COALESCE(v_item.new_is_priced_elsewhere, is_priced_elsewhere),
        display_order = COALESCE(v_item.new_display_order, display_order)
      WHERE id = v_new_existing_id;

    ELSIF v_item.action = 'remove' THEN
      SELECT id INTO v_new_existing_id FROM boq_items WHERE boq_id = v_new_boq_id AND source_item_id = v_item.existing_item_id;
      IF v_new_existing_id IS NULL THEN
        RAISE EXCEPTION 'Change order references an item that no longer exists on the current BOQ version';
      END IF;

      DELETE FROM boq_items WHERE id = v_new_existing_id;
    END IF;
  END LOOP;

  PERFORM recalc_boq_grand_totals(v_new_boq_id);

  -- trg_supersede_previous_boq_version (migration 209) flips the old
  -- approved version to 'superseded' automatically on this UPDATE.
  -- Guardrail: this deliberately does NOT touch projects/contracts —
  -- contract value stays a separate Finance decision even when the
  -- BOQ grand total changes.
  UPDATE boqs SET status = 'approved', approved_at = now(), approved_by_staff_id = current_staff_id(), updated_at = now()
  WHERE id = v_new_boq_id;

  UPDATE boq_change_orders SET resulting_boq_id = v_new_boq_id, status = 'approved', updated_at = now()
  WHERE id = p_change_order_id;

  RETURN v_new_boq_id;
END;
$$;

CREATE OR REPLACE FUNCTION pm_approve_change_order(p_change_order_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_co boq_change_orders%ROWTYPE;
BEGIN
  IF get_user_role() NOT IN ('admin', 'project_manager') THEN
    RAISE EXCEPTION 'Not authorized to approve as PM';
  END IF;

  SELECT * INTO v_co FROM boq_change_orders WHERE id = p_change_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Change order not found';
  END IF;
  IF v_co.status <> 'pending_pm' THEN
    RAISE EXCEPTION 'Change order is not awaiting PM approval';
  END IF;

  UPDATE boq_change_orders SET pm_reviewed_by = current_staff_id(), pm_reviewed_at = now(), updated_at = now()
  WHERE id = p_change_order_id;

  IF v_co.approval_level_required = 'pm_only' THEN
    PERFORM finalize_change_order(p_change_order_id);
    RETURN 'approved_and_finalized';
  ELSE
    UPDATE boq_change_orders SET status = 'pending_finance', updated_at = now() WHERE id = p_change_order_id;
    RETURN 'advanced_to_finance';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION finance_approve_change_order(p_change_order_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_co boq_change_orders%ROWTYPE;
BEGIN
  IF get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Not authorized to approve as Finance';
  END IF;

  SELECT * INTO v_co FROM boq_change_orders WHERE id = p_change_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Change order not found';
  END IF;
  IF v_co.status <> 'pending_finance' THEN
    RAISE EXCEPTION 'Change order is not awaiting Finance approval';
  END IF;

  UPDATE boq_change_orders SET finance_reviewed_by = current_staff_id(), finance_reviewed_at = now(), updated_at = now()
  WHERE id = p_change_order_id;

  IF v_co.approval_level_required = 'pm_finance' THEN
    PERFORM finalize_change_order(p_change_order_id);
    RETURN 'approved_and_finalized';
  ELSE
    UPDATE boq_change_orders SET status = 'pending_exec', updated_at = now() WHERE id = p_change_order_id;
    RETURN 'advanced_to_exec';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION exec_approve_change_order(p_change_order_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_co boq_change_orders%ROWTYPE;
BEGIN
  IF get_user_role() NOT IN ('admin', 'executive') THEN
    RAISE EXCEPTION 'Not authorized to approve as Executive';
  END IF;

  SELECT * INTO v_co FROM boq_change_orders WHERE id = p_change_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Change order not found';
  END IF;
  IF v_co.status <> 'pending_exec' THEN
    RAISE EXCEPTION 'Change order is not awaiting Executive approval';
  END IF;

  -- pending_exec only ever occurs on the pm_finance_exec tier, which
  -- always requires client sign-off next — no branch needed here.
  UPDATE boq_change_orders SET exec_reviewed_by = current_staff_id(), exec_reviewed_at = now(),
    status = 'pending_client_signoff', updated_at = now()
  WHERE id = p_change_order_id;

  RETURN 'advanced_to_client_signoff';
END;
$$;

CREATE OR REPLACE FUNCTION record_client_signoff(p_change_order_id UUID, p_evidence TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_co boq_change_orders%ROWTYPE;
BEGIN
  IF get_user_role() NOT IN ('admin', 'project_manager') THEN
    RAISE EXCEPTION 'Not authorized to record client sign-off';
  END IF;

  SELECT * INTO v_co FROM boq_change_orders WHERE id = p_change_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Change order not found';
  END IF;
  IF v_co.status <> 'pending_client_signoff' THEN
    RAISE EXCEPTION 'Change order is not awaiting client sign-off';
  END IF;
  IF p_evidence IS NULL OR btrim(p_evidence) = '' THEN
    RAISE EXCEPTION 'Sign-off evidence is required';
  END IF;

  UPDATE boq_change_orders SET client_signoff_at = now(), client_signoff_evidence = p_evidence, updated_at = now()
  WHERE id = p_change_order_id;

  PERFORM finalize_change_order(p_change_order_id);
  RETURN 'approved_and_finalized';
END;
$$;

-- SECURITY INVOKER: relies on the boq_change_orders_reject RLS
-- policy above to actually gate who can flip which row to rejected;
-- the checks here are redundant-by-design belt-and-suspenders that
-- also produce a clear error message instead of a silent RLS 0-row UPDATE.
CREATE OR REPLACE FUNCTION reject_change_order(p_change_order_id UUID, p_reason TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_co boq_change_orders%ROWTYPE;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A rejection reason is required';
  END IF;

  SELECT * INTO v_co FROM boq_change_orders WHERE id = p_change_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Change order not found';
  END IF;

  IF v_co.status = 'pending_pm' AND get_user_role() NOT IN ('admin', 'project_manager') THEN
    RAISE EXCEPTION 'Not authorized to reject at this stage';
  ELSIF v_co.status = 'pending_finance' AND get_user_role() NOT IN ('admin', 'finance') THEN
    RAISE EXCEPTION 'Not authorized to reject at this stage';
  ELSIF v_co.status = 'pending_exec' AND get_user_role() NOT IN ('admin', 'executive') THEN
    RAISE EXCEPTION 'Not authorized to reject at this stage';
  ELSIF v_co.status = 'pending_client_signoff' AND get_user_role() NOT IN ('admin', 'project_manager') THEN
    RAISE EXCEPTION 'Not authorized to reject at this stage';
  ELSIF v_co.status NOT IN ('pending_pm', 'pending_finance', 'pending_exec', 'pending_client_signoff') THEN
    RAISE EXCEPTION 'This change order is no longer pending';
  END IF;

  UPDATE boq_change_orders SET status = 'rejected', rejection_reason = p_reason, updated_at = now()
  WHERE id = p_change_order_id;

  RETURN 'rejected';
END;
$$;

-- ── Grants ───────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION submit_boq_change_order(UUID, TEXT, TEXT, BOOLEAN, NUMERIC, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION pm_approve_change_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION finance_approve_change_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION exec_approve_change_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION record_client_signoff(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION reject_change_order(UUID, TEXT) TO authenticated;

-- Internal-only: never callable directly by a client, only reachable
-- as a nested call from the DEFINER functions above.
REVOKE EXECUTE ON FUNCTION duplicate_boq_as_new_version(UUID) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION finalize_change_order(UUID) FROM PUBLIC, authenticated;

-- ── Amend v_boq_current_per_project to add has_active_change_order ─
CREATE OR REPLACE VIEW v_boq_current_per_project
WITH (security_invoker = true) AS
SELECT
  b.id                AS boq_id,
  b.project_id,
  b.version_number,
  b.title,
  b.status,
  b.grand_total_etb,
  b.total_direct_etb,
  b.total_lump_sum_etb,
  b.owner_pm_staff_id,
  b.approved_at,
  b.approved_by_staff_id,
  b.source_proforma_id,
  b.created_at,
  b.updated_at,
  EXISTS (
    SELECT 1 FROM boq_change_orders co
    WHERE co.boq_id = b.id AND co.status NOT IN ('approved', 'rejected', 'withdrawn')
  ) AS has_active_change_order
FROM boqs b
WHERE b.status = 'approved';

-- Verify.
SELECT tablename FROM pg_tables WHERE tablename IN ('boq_change_orders', 'boq_change_order_items');
