-- ============================================================
-- Rent payment requests — the missing gate. Every other cost type
-- already has a request -> approval -> typed-expense path (materials'
-- stock-check, fleet's maintenance/penalty request, CPO's bid
-- request, subcontract's engagement). Rent had a record (properties)
-- but no gate: property_rent expenses were only ever created by
-- someone manually opening a blank-ish expense form. This closes that
-- gap with the same shape as every other auto-creation trigger (136).
--
-- Per user decision: the "rent is due" prompt is NOT a persisted
-- draft row — the status list given (pending/approved/rejected/paid)
-- has no 'draft' value, and adding one would widen it beyond what was
-- specified. Instead it's a computed, ephemeral suggestion (the
-- frontend works out which property's next period is due within 14
-- days and has no existing request for it yet) — nothing is written
-- to this table until a person actually confirms it, at which point
-- the row is created directly as 'pending'. This still satisfies
-- "never an already-pending row appearing on its own": no row exists
-- until a human act creates it.
--
-- Per user decision: one approval tier (Finance-equivalent), same
-- named-approver-required bar as everywhere else — no multi-tier
-- chain. RLS write access is admin/operations_manager/finance, per
-- explicit confirmation in the spec's own guardrails section.
--
-- The resulting expense still goes through the NORMAL expense
-- approval chain (manager_approved -> finance_approved) before it can
-- be paid — same as every other auto-created typed expense (136's own
-- comment: "confirms the underlying request happened, it does not
-- auto-approve payment"). rent_payment_requests.status='approved'
-- means "Finance signed off on raising this as a payable expense",
-- not "this expense is approved for payment" — those are two
-- different approvals at two different points in the pipeline,
-- consistent with how every other gate in this system already works.
--
-- status='paid' is a one-directional mirror of the linked expense's
-- own payment_state reaching 'paid' — same "mirrors, never reverse"
-- discipline as expenses.payment_status itself (098).
-- ============================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS rent_payment_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   UUID NOT NULL REFERENCES properties(id),
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  amount        NUMERIC(12,2) NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
  requested_by  UUID REFERENCES user_profiles(id),
  approved_by   UUID REFERENCES user_profiles(id),
  approved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rent_payment_requests_property_period ON rent_payment_requests(property_id, period_end DESC);

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS rent_payment_request_id UUID REFERENCES rent_payment_requests(id) ON DELETE SET NULL;

ALTER TABLE rent_payment_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rent_payment_requests_read" ON rent_payment_requests;
CREATE POLICY "rent_payment_requests_read" ON rent_payment_requests FOR SELECT
  USING (get_user_role() IN ('admin', 'manager', 'finance', 'operations_manager'));

DROP POLICY IF EXISTS "rent_payment_requests_manage" ON rent_payment_requests;
CREATE POLICY "rent_payment_requests_manage" ON rent_payment_requests FOR ALL
  USING (get_user_role() IN ('admin', 'operations_manager', 'finance'))
  WITH CHECK (get_user_role() IN ('admin', 'operations_manager', 'finance'));

GRANT SELECT, INSERT, UPDATE, DELETE ON rent_payment_requests TO authenticated;

-- Stamp a real approver identity the moment status reaches 'approved'
-- — mirrors 046's own approval-stamping pattern for payroll.
CREATE OR REPLACE FUNCTION stamp_rent_payment_request_approval()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    NEW.approved_by := auth.uid();
    NEW.approved_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_rent_payment_request_approval ON rent_payment_requests;
CREATE TRIGGER trg_stamp_rent_payment_request_approval
  BEFORE UPDATE OF status ON rent_payment_requests
  FOR EACH ROW EXECUTE FUNCTION stamp_rent_payment_request_approval();

-- Auto-create the typed expense on approval — guarded so re-running
-- or a status oscillating back and forth can't double-bill.
CREATE OR REPLACE FUNCTION auto_create_rent_expense()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_property properties%ROWTYPE;
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved'
     AND NOT EXISTS (SELECT 1 FROM expenses WHERE rent_payment_request_id = NEW.id) THEN
    SELECT * INTO v_property FROM properties WHERE id = NEW.property_id;

    INSERT INTO expenses (
      item_service_description, amount_etb, date, expense_type,
      vendor_id, property_id, rent_payment_request_id, requested
    ) VALUES (
      'Rent - ' || v_property.property_name || ' (' || NEW.period_start || ' to ' || NEW.period_end || ')',
      NEW.amount, NEW.period_start, 'property_rent',
      v_property.landlord_vendor_id, NEW.property_id, NEW.id, true
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_create_rent_expense ON rent_payment_requests;
CREATE TRIGGER trg_auto_create_rent_expense
  AFTER UPDATE OF status ON rent_payment_requests
  FOR EACH ROW EXECUTE FUNCTION auto_create_rent_expense();

-- One-directional mirror: once the linked expense is actually paid,
-- reflect that back on the request — never the reverse.
CREATE OR REPLACE FUNCTION sync_rent_payment_request_paid()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.payment_state = 'paid' AND OLD.payment_state IS DISTINCT FROM 'paid' AND NEW.rent_payment_request_id IS NOT NULL THEN
    UPDATE rent_payment_requests SET status = 'paid' WHERE id = NEW.rent_payment_request_id AND status <> 'paid';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_rent_payment_request_paid ON expenses;
CREATE TRIGGER trg_sync_rent_payment_request_paid
  AFTER UPDATE OF payment_state ON expenses
  FOR EACH ROW EXECUTE FUNCTION sync_rent_payment_request_paid();

-- Verify
SELECT tablename FROM pg_tables WHERE tablename = 'rent_payment_requests';
SELECT column_name FROM information_schema.columns WHERE table_name = 'expenses' AND column_name = 'rent_payment_request_id';
SELECT tgname FROM pg_trigger WHERE tgname IN ('trg_stamp_rent_payment_request_approval', 'trg_auto_create_rent_expense', 'trg_sync_rent_payment_request_paid') ORDER BY tgname;
