-- Direct-to-site material receipts (booked as consumed, never touches
-- warehouse stock) and WO progress tracking, plus the Daily Site Report
-- views that surface both.

-- ── site_material_receipts ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS site_material_receipts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  work_order_id         uuid REFERENCES work_orders(id) ON DELETE SET NULL,
  purchase_order_id     uuid REFERENCES orders(id) ON DELETE SET NULL,
  item_description      text NOT NULL,
  stock_item_id         uuid REFERENCES stock_items(id) ON DELETE SET NULL,
  quantity              numeric NOT NULL CHECK (quantity > 0),
  unit                  text NOT NULL,
  received_by_staff_id  uuid NOT NULL REFERENCES staff(id) ON DELETE SET NULL,
  received_at           timestamptz NOT NULL DEFAULT now(),
  vendor_id             uuid REFERENCES vendors(id) ON DELETE SET NULL,
  photo_evidence        jsonb,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smr_project ON site_material_receipts (project_id);
CREATE INDEX IF NOT EXISTS idx_smr_wo ON site_material_receipts (work_order_id);

COMMENT ON TABLE site_material_receipts IS
  'Materials delivered directly to site. Booked as consumed against the project/WO — no GRN-into-stock step, stock_items quantities are never touched. purchase_order_id supports Finance reconciliation against a PO when one exists.';

ALTER TABLE site_material_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS smr_read ON site_material_receipts;
CREATE POLICY smr_read ON site_material_receipts FOR SELECT
  USING (
    get_user_role() IN ('admin', 'executive', 'procurement_officer')
    OR manages_project(project_id)
    OR is_site_foreman_for_project(project_id)
  );

DROP POLICY IF EXISTS smr_insert ON site_material_receipts;
CREATE POLICY smr_insert ON site_material_receipts FOR INSERT
  WITH CHECK (
    get_user_role() IN ('admin', 'executive')
    OR is_site_foreman_for_project(project_id)
  );

DROP POLICY IF EXISTS smr_manage ON site_material_receipts;
CREATE POLICY smr_manage ON site_material_receipts FOR ALL
  USING (get_user_role() IN ('admin', 'executive'))
  WITH CHECK (get_user_role() IN ('admin', 'executive'));

-- ── wo_progress_updates + work_orders.current_progress_pct ──────────
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS current_progress_pct numeric NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_progress_pct_chk') THEN
    ALTER TABLE work_orders ADD CONSTRAINT work_orders_progress_pct_chk
      CHECK (current_progress_pct BETWEEN 0 AND 100);
  END IF;
END $$;

COMMENT ON COLUMN work_orders.current_progress_pct IS
  'Manual foreman/PM input via wo_progress_updates until BOQ physical-progress automation (9c) lands. Maintained by trg_wo_progress_update_pct — do not write directly.';

CREATE TABLE IF NOT EXISTS wo_progress_updates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id         uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  progress_pct          numeric NOT NULL CHECK (progress_pct BETWEEN 0 AND 100),
  note                  text,
  photos                jsonb,
  updated_by_staff_id   uuid NOT NULL REFERENCES staff(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wo_progress_wo ON wo_progress_updates (work_order_id, created_at);

-- SECURITY DEFINER: work_orders_manage's role list (admin/executive/
-- operations_manager/project_manager) predates migration 155's PM
-- scoping — a PM assigned via projects.project_manager_id but not
-- literally holding the bare 'project_manager' login role can INSERT
-- here (via manages_project(), granted in this migration's own RLS
-- below) yet would fail RLS updating work_orders directly.
CREATE OR REPLACE FUNCTION public.sync_wo_progress_pct()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  UPDATE work_orders SET current_progress_pct = NEW.progress_pct, updated_at = now()
   WHERE id = NEW.work_order_id;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_wo_progress_update_pct ON wo_progress_updates;
CREATE TRIGGER trg_wo_progress_update_pct
  AFTER INSERT ON wo_progress_updates
  FOR EACH ROW EXECUTE FUNCTION public.sync_wo_progress_pct();

ALTER TABLE wo_progress_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wo_progress_read ON wo_progress_updates;
CREATE POLICY wo_progress_read ON wo_progress_updates FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS wo_progress_insert ON wo_progress_updates;
CREATE POLICY wo_progress_insert ON wo_progress_updates FOR INSERT
  WITH CHECK (
    get_user_role() IN ('admin', 'executive')
    OR EXISTS (
      SELECT 1 FROM work_orders wo WHERE wo.id = wo_progress_updates.work_order_id
        AND (manages_project(wo.project_id) OR is_site_foreman_for_project(wo.project_id))
    )
  );

-- ── Daily Site Report views ───────────────────────────────────────────
-- Headcount now reads wo_attendance_log directly (item 24): this both
-- matches the WO-owned attendance system and, as a side effect, fixes a
-- live bug found during this migration — the old view read only
-- `timesheet`, but Tier 2 presence marked on the (now-folded-in)
-- AttendancePage.tsx grid only ever wrote to timesheet_attendance, so
-- Tier 2 headcount never actually reached the Daily Site Report despite
-- a code comment claiming otherwise.
CREATE OR REPLACE VIEW v_site_report_headcount
WITH (security_invoker = true) AS
SELECT
  wal.project_id,
  wal.log_date AS report_date,
  COUNT(*) FILTER (WHERE s.employment_type IS DISTINCT FROM 'tier_2_casual') AS tier1_headcount,
  COUNT(*) FILTER (WHERE s.employment_type = 'tier_2_casual') AS tier2_headcount,
  COUNT(*) AS total_headcount
FROM wo_attendance_log wal
JOIN staff s ON s.id = wal.staff_id
GROUP BY wal.project_id, wal.log_date;

GRANT SELECT ON v_site_report_headcount TO authenticated;

-- Materials: UNION the existing stock_issues (warehouse-issued) source
-- with the new site_material_receipts (direct-to-site) source. Column
-- order is preserved exactly from the original definition — CREATE OR
-- REPLACE VIEW can only append new output columns, never reorder or
-- rename existing ones — with `source` appended at the end.
CREATE OR REPLACE VIEW v_site_report_materials
WITH (security_invoker = true) AS
SELECT
  si.project_id, si.issued_date AS report_date, si.id AS stock_issue_id,
  si.stock_item_id, sit.item_name, si.quantity, sit.unit AS uom, si.notes, si.issued_by_staff_id,
  'issued'::text AS source
FROM stock_issues si
LEFT JOIN stock_items sit ON sit.id = si.stock_item_id
WHERE si.project_id IS NOT NULL AND si.issued_date IS NOT NULL
UNION ALL
SELECT
  smr.project_id, smr.received_at::date AS report_date, smr.id AS stock_issue_id,
  smr.stock_item_id, COALESCE(sit2.item_name, smr.item_description) AS item_name,
  smr.quantity::numeric(10,2), COALESCE(sit2.unit, smr.unit) AS uom, smr.notes, smr.received_by_staff_id AS issued_by_staff_id,
  'received'::text AS source
FROM site_material_receipts smr
LEFT JOIN stock_items sit2 ON sit2.id = smr.stock_item_id
WHERE smr.project_id IS NOT NULL;

GRANT SELECT ON v_site_report_materials TO authenticated;
