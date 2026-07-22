-- ============================================================
-- Auto-create correctly-typed, prefilled expenses from each existing
-- gate, instead of relying on a person to manually create and
-- correctly type them. Confirmed real state before this migration
-- (research against the actual frontend/schema, not assumed):
--
--   • PO/GRN:      manual "Create Expense" link + prefill in
--                  ExpenseFormPage; expense_type WAS already set to
--                  'purchase_order' correctly, but expenses.
--                  sourcing_bundle_id was NEVER written (only the
--                  reverse sourcing_bundles.expense_id was) — a real,
--                  pre-existing gap, since 110's GRN-gating/advance
--                  logic keys off that column. Fixed as a side effect
--                  of making this automatic.
--   • Subcontract: no expense creation existed at all — a person had
--                  to open a blank expense form and manually pick the
--                  engagement from a plain dropdown, with zero prefill
--                  and no 'subcontract' enum value to even select
--                  (saved as 'general' unless manually reclassified).
--   • CPO bond:    expenses.cpo_bond_id has existed since migration 027
--                  but is never read or written anywhere — CPO bonds
--                  and expenses are only linked today via a manual
--                  reverse dropdown (related_expense_id) on the bond
--                  form, pointing at an already-separately-created
--                  expense.
--   • Maintenance: a manual "Create Expense" button already existed
--                  (VehicleMaintenancePage, shown when
--                  status='completed' AND actual_cost IS NOT NULL AND
--                  expense_id IS NULL) but never set expense_type or
--                  vehicle_id on the expense it created.
--   • Penalty:     vehicle_penalties has no expense_id column and no
--                  expense-creation path of any kind today.
--   • VRF:         vendor_receipt_facilitation.status reaching
--                  'settled' triggers nothing — a person has to
--                  manually click through to a pre-filled (but
--                  otherwise inert) expense form.
--
-- Each trigger below is guarded so it only ever creates ONE expense
-- per source row (checked via the relevant back-reference/FK), so
-- re-running this migration, or a row's status oscillating, can't
-- produce duplicates. All new expenses land in the normal
-- approval_status default (pending) — auto-creation confirms the
-- underlying request happened, it does not auto-approve payment.
-- ============================================================

SET search_path TO public;

-- ── 0. vehicle_penalties needs an expense_id back-reference (didn't
-- exist before — penalties had no expense-linkage path at all) ──────
ALTER TABLE vehicle_penalties ADD COLUMN IF NOT EXISTS expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL;

-- ── 1. Materials (GRN recorded) → purchase_order ────────────────────
-- Same AFTER INSERT ON goods_received_notes event as the existing
-- mark_bundle_fulfilled_on_grn (063) — a companion trigger, not a
-- replacement. Guarded on sourcing_bundles.expense_id so a bundle that
-- somehow already has one (e.g. from before this migration, or a
-- second partial GRN) is never double-billed.
CREATE OR REPLACE FUNCTION auto_create_purchase_order_expense()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bundle          sourcing_bundles%ROWTYPE;
  v_total           NUMERIC;
  v_item_names      TEXT;
  v_project_id      UUID;
  v_project_count   INT;
  v_expense_id      UUID;
BEGIN
  SELECT * INTO v_bundle FROM sourcing_bundles WHERE id = NEW.sourcing_bundle_id;
  IF v_bundle.expense_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(COALESCE(sbi.quantity_actual, 0) * COALESCE(sbi.unit_price_actual, 0)), 0)
  INTO v_total
  FROM sourcing_bundle_items sbi WHERE sbi.bundle_id = v_bundle.id;

  SELECT string_agg(DISTINCT oi.item_name, ', ')
  INTO v_item_names
  FROM sourcing_bundle_items sbi
  JOIN order_items oi ON oi.id = sbi.order_item_id
  WHERE sbi.bundle_id = v_bundle.id;

  -- Only set project_id when every line item traces to the same
  -- project — same single-project rule the existing manual prefill
  -- used (ExpenseFormPage), rather than guessing on a mixed-project PO.
  SELECT count(*) INTO v_project_count FROM (
    SELECT DISTINCT o.project_id
    FROM sourcing_bundle_items sbi
    JOIN order_items oi ON oi.id = sbi.order_item_id
    JOIN orders o ON o.id = oi.order_id
    WHERE sbi.bundle_id = v_bundle.id AND o.project_id IS NOT NULL
  ) distinct_projects;

  IF v_project_count = 1 THEN
    SELECT o.project_id INTO v_project_id
    FROM sourcing_bundle_items sbi
    JOIN order_items oi ON oi.id = sbi.order_item_id
    JOIN orders o ON o.id = oi.order_id
    WHERE sbi.bundle_id = v_bundle.id AND o.project_id IS NOT NULL
    LIMIT 1;
  ELSE
    v_project_id := NULL;
  END IF;

  INSERT INTO expenses (
    item_service_description, amount_etb, date, expense_type,
    vendor_id, vendors_name, project_id, sourcing_bundle_id, requested
  ) VALUES (
    'PO ' || v_bundle.bundle_code || COALESCE(' — ' || v_item_names, ''),
    v_total, CURRENT_DATE, 'purchase_order',
    v_bundle.vendor_id, CASE WHEN v_bundle.vendor_id IS NULL THEN v_bundle.vendor_name END,
    v_project_id, v_bundle.id, true
  ) RETURNING id INTO v_expense_id;

  UPDATE sourcing_bundles SET expense_id = v_expense_id WHERE id = v_bundle.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_create_po_expense ON goods_received_notes;
CREATE TRIGGER trg_auto_create_po_expense
  AFTER INSERT ON goods_received_notes
  FOR EACH ROW EXECUTE FUNCTION auto_create_purchase_order_expense();

-- ── 2. Subcontract completion certificate → subcontract ─────────────
-- One expense PER certificate (not per engagement) — an engagement can
-- be certified progressively, and each certificate is its own payable
-- amount. NEW.subcontractor_engagement_id will pass 095's own
-- require_subcontract_certificate trigger unconditionally here, since
-- the certificate this fires from already exists by definition.
CREATE OR REPLACE FUNCTION auto_create_subcontract_expense()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_engagement subcontractor_engagements%ROWTYPE;
BEGIN
  SELECT * INTO v_engagement FROM subcontractor_engagements WHERE id = NEW.engagement_id;

  INSERT INTO expenses (
    item_service_description, amount_etb, date, expense_type,
    vendor_id, project_id, subcontractor_engagement_id, requested
  ) VALUES (
    'Subcontract certificate — ' || COALESCE(v_engagement.scope_of_work, 'engagement ' || v_engagement.id::text),
    NEW.certified_amount, CURRENT_DATE, 'subcontract',
    v_engagement.vendor_id, v_engagement.project_id, v_engagement.id, true
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_create_subcontract_expense ON subcontractor_completion_certificates;
CREATE TRIGGER trg_auto_create_subcontract_expense
  AFTER INSERT ON subcontractor_completion_certificates
  FOR EACH ROW EXECUTE FUNCTION auto_create_subcontract_expense();

-- ── 3. CPO bond approved (Finance moves it to Active) → cpo_bond ────
-- "Approved" = bond_status transitions to 'Active' (Finance has
-- processed the request from Sales/BD's 'requested' state) — the
-- natural point a real payable amount exists. Guarded on
-- expenses.cpo_bond_id, which migration 027 added but nothing has
-- ever written to until now.
CREATE OR REPLACE FUNCTION auto_create_cpo_bond_expense()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.bond_status = 'Active' AND OLD.bond_status IS DISTINCT FROM 'Active'
     AND NOT EXISTS (SELECT 1 FROM expenses WHERE cpo_bond_id = NEW.id) THEN
    INSERT INTO expenses (
      item_service_description, amount_etb, date, expense_type,
      vendor_id, account_id, cpo_bond_id, project_name, requested
    ) VALUES (
      'CPO Bond ' || COALESCE(NEW.bond_id_ref, NEW.id::text),
      NEW.total_bond_amount, CURRENT_DATE, 'cpo_bond',
      NEW.vendor_id, NEW.paid_from_id, NEW.id, NEW.project, true
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_create_cpo_bond_expense ON cpo_bonds;
CREATE TRIGGER trg_auto_create_cpo_bond_expense
  AFTER UPDATE OF bond_status ON cpo_bonds
  FOR EACH ROW EXECUTE FUNCTION auto_create_cpo_bond_expense();

-- ── 4. Fleet maintenance completed → maintenance ────────────────────
-- Replaces VehicleMaintenancePage's manual "Create Expense" button
-- (same trigger condition it used: status='completed' AND actual_cost
-- IS NOT NULL AND no expense yet) — this version additionally sets
-- expense_type='maintenance' and vehicle_id, which the manual button
-- never did.
CREATE OR REPLACE FUNCTION auto_create_maintenance_expense()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vehicle_name TEXT;
  v_category_id  UUID;
  v_expense_id   UUID;
BEGIN
  IF NEW.status = 'completed' AND NEW.actual_cost IS NOT NULL AND NEW.expense_id IS NULL THEN
    SELECT name INTO v_vehicle_name FROM vehicles WHERE id = NEW.vehicle_id;
    SELECT id INTO v_category_id FROM categories WHERE category_name = 'Transportation';

    INSERT INTO expenses (
      item_service_description, amount_etb, date, expense_type,
      category_id, vehicle_id, requested
    ) VALUES (
      'Vehicle maintenance — ' || COALESCE(v_vehicle_name, 'vehicle') || ': ' || NEW.issue_description,
      NEW.actual_cost, COALESCE(NEW.completed_at::date, CURRENT_DATE), 'maintenance',
      v_category_id, NEW.vehicle_id, true
    ) RETURNING id INTO v_expense_id;

    NEW.expense_id := v_expense_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_create_maintenance_expense ON vehicle_maintenance_requests;
CREATE TRIGGER trg_auto_create_maintenance_expense
  BEFORE UPDATE OF status, actual_cost ON vehicle_maintenance_requests
  FOR EACH ROW EXECUTE FUNCTION auto_create_maintenance_expense();

-- ── 5. Fleet penalty recorded → maintenance ──────────────────────────
-- Per spec §1, penalties share the 'maintenance' expense_type with
-- maintenance requests (no separate 'penalty' enum value). Penalties
-- have no approval workflow (see 122/VehiclePenaltiesPage: "tracked
-- here only, no tax/expense treatment applied yet") — recording one at
-- all is the event; this is the first time a penalty gets any expense
-- treatment.
CREATE OR REPLACE FUNCTION auto_create_penalty_expense()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vehicle_name TEXT;
  v_category_id  UUID;
  v_expense_id   UUID;
BEGIN
  SELECT name INTO v_vehicle_name FROM vehicles WHERE id = NEW.vehicle_id;
  SELECT id INTO v_category_id FROM categories WHERE category_name = 'Transportation';

  INSERT INTO expenses (
    item_service_description, amount_etb, date, expense_type,
    category_id, vehicle_id, requested
  ) VALUES (
    'Vehicle penalty — ' || COALESCE(v_vehicle_name, 'vehicle') || COALESCE(': ' || NEW.reason, ''),
    NEW.amount, NEW.penalty_date, 'maintenance',
    v_category_id, NEW.vehicle_id, true
  ) RETURNING id INTO v_expense_id;

  NEW.expense_id := v_expense_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_create_penalty_expense ON vehicle_penalties;
CREATE TRIGGER trg_auto_create_penalty_expense
  BEFORE INSERT ON vehicle_penalties
  FOR EACH ROW EXECUTE FUNCTION auto_create_penalty_expense();

-- ── 6. VRF settled → vrf ─────────────────────────────────────────────
-- Automates the exact prefill ExpenseFormPage already applies manually
-- via ?vrf_id= query param — same fields, just fired the moment status
-- reaches 'settled' instead of waiting for a person to click through.
CREATE OR REPLACE FUNCTION auto_create_vrf_expense()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'settled' AND OLD.status IS DISTINCT FROM 'settled'
     AND NOT EXISTS (SELECT 1 FROM expenses WHERE vendor_receipt_facilitation_id = NEW.id) THEN
    INSERT INTO expenses (
      item_service_description, amount_etb, date, expense_type,
      account_id, vendors_name, vendor_receipt_facilitation_id, requested
    ) VALUES (
      COALESCE(NEW.record_name, 'VRF settlement'),
      NEW.amount_transferred, COALESCE(NEW.trxn_date, CURRENT_DATE), 'vrf',
      NEW.initial_account_id, NEW.facilitator_name, NEW.id, true
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_create_vrf_expense ON vendor_receipt_facilitation;
CREATE TRIGGER trg_auto_create_vrf_expense
  AFTER UPDATE OF status ON vendor_receipt_facilitation
  FOR EACH ROW EXECUTE FUNCTION auto_create_vrf_expense();

-- Verify: all six triggers present
SELECT tgname FROM pg_trigger
WHERE tgname IN (
  'trg_auto_create_po_expense', 'trg_auto_create_subcontract_expense',
  'trg_auto_create_cpo_bond_expense', 'trg_auto_create_maintenance_expense',
  'trg_auto_create_penalty_expense', 'trg_auto_create_vrf_expense'
)
ORDER BY tgname;
