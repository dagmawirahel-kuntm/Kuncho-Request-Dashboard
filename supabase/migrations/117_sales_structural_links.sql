-- ============================================================
-- Sales structural links + current-FY lifecycle/approval discipline.
--
-- Confirmed real state before this migration: 125 sales rows, 100%
-- have client_id + invoice_number, 0% have project_id, 0% have
-- proforma_id set via a real FK (the column existed but was never
-- constrained), all 125 sit at approval_status='finance_approved'
-- with zero named finance_approved_by/manager_approved_by (identical
-- gap to the one already closed on expenses in 097/098 — these rows
-- were set by direct INSERT during an import, which never ran
-- through enforce_sale_approval_transitions() since that trigger is
-- UPDATE-only and only fires on an actual status change).
--
-- Everything here is current-fiscal-year-forward only. The 125
-- legacy rows keep their nulls and their jump-straight-to-Paid
-- pattern permanently — nothing here backfills project_id,
-- contract linkage, or approver identity onto them, even where a
-- plausible guess exists. sales.fiscal_period_id already exists and
-- is trigger-maintained (088), so "current FY" is a lookup, not new
-- machinery.
-- ============================================================

SET search_path TO public;

-- ── 1. is_project_funded: distinguishes "should carry a project_id"
-- from "legitimately ad-hoc" so the missing-link count below is a
-- real signal, not every null conflated together. Defaults true
-- since project-funded work is described as the large majority of
-- the business — data entry unchecks the box for the ad-hoc
-- exception rather than checking one for the common case. Existing
-- rows read as true under Postgres's no-rewrite ADD COLUMN DEFAULT,
-- which is harmless: the "missing" signal (built in the frontend,
-- matching the existing unassigned-staff pattern) is current-FY-only,
-- so none of the 125 legacy rows ever enter that count regardless of
-- what this column reads as for them.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS is_project_funded BOOLEAN NOT NULL DEFAULT true;

-- ── 2. sales.proforma_id never actually had a foreign key — the
-- column was added as a bare UUID in 043 while proforma_items.proforma_id
-- in the very same migration did get one. The conversion flow already
-- copies client/amount onto the sale correctly in application code
-- (ProformaInvoicePage.tsx), this just makes the link real at the DB
-- level too, so an invalid proforma_id becomes impossible rather than
-- silently allowed.
DO $$ BEGIN
  ALTER TABLE sales ADD CONSTRAINT sales_proforma_id_fkey
    FOREIGN KEY (proforma_id) REFERENCES proformas(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 3. contracts.opportunity_id: optional link so a deal that went
-- through the full pipeline (opportunity -> contract -> sale) traces
-- end to end the moment someone actually uses it. Doesn't force the
-- pipeline into use for deals that don't originate as a logged
-- opportunity (most won't, today).
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS opportunity_id UUID REFERENCES opportunities(id);
CREATE INDEX IF NOT EXISTS idx_contracts_opportunity ON contracts(opportunity_id);

-- ── 4. projects.contract_value derived from its linked contract,
-- not hand-duplicated. A project can only ever be fed by one
-- contract's worth of syncing at a time (if more than one contract
-- somehow points at the same project, whichever is written last
-- wins — not handled specially, not expected to happen in practice).
--
-- Direct edits to projects.contract_value are blocked once ANY
-- contract links to that project — pg_trigger_depth() = 1 is how the
-- block distinguishes a human's direct UPDATE (depth 1) from the
-- sync trigger's own cascaded UPDATE (depth 2, fired from inside the
-- contracts trigger) without needing a session flag. Once the last
-- linked contract is deleted, the field reverts to freely editable —
-- consistent with "read-only only while a contract exists," not
-- permanently locked by history.
CREATE OR REPLACE FUNCTION sync_project_contract_value()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.project_id IS NOT NULL THEN
    UPDATE projects SET contract_value = NEW.contract_value WHERE id = NEW.project_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_project_contract_value ON contracts;
CREATE TRIGGER trg_sync_project_contract_value
  AFTER INSERT OR UPDATE OF contract_value, project_id ON contracts
  FOR EACH ROW EXECUTE FUNCTION sync_project_contract_value();

CREATE OR REPLACE FUNCTION block_manual_contract_value_edit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.contract_value IS DISTINCT FROM OLD.contract_value
     AND pg_trigger_depth() = 1
     AND EXISTS (SELECT 1 FROM contracts WHERE project_id = NEW.id) THEN
    RAISE EXCEPTION 'This project''s contract value is derived from its linked contract — edit the contract instead of the project directly';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_manual_contract_value_edit ON projects;
CREATE TRIGGER trg_block_manual_contract_value_edit
  BEFORE UPDATE OF contract_value ON projects
  FOR EACH ROW EXECUTE FUNCTION block_manual_contract_value_edit();

-- ── 5. Current-FY sales discipline: named approver + no backward
-- lifecycle movement. Mirrors the expenses fix (097/098) in spirit —
-- a status label isn't a decision until a name is behind it — but
-- sales has no payment_state column to gate on like expenses does,
-- so this gates approval_status/sales_status directly. Runs
-- alongside enforce_sale_approval_transitions() (007) rather than
-- replacing it: that trigger already stamps *_approved_by correctly
-- for anyone who goes through the real approve button (BEFORE UPDATE,
-- fires on an actual status change); this trigger is the safety net
-- for what that one can't see — a direct INSERT or a bulk
-- UPDATE ... SET approval_status = 'finance_approved' that skips the
-- transition path entirely, which is exactly how all 125 legacy rows
-- ended up unapproved-in-substance despite the label.
--
-- Lifecycle progression is enforced as "no backward movement," not
-- as "must pass through every state" — Draft -> Paid directly, or an
-- INSERT straight into Paid, both remain fully legal for a genuinely
-- immediate sale. What's blocked is a current-FY sale un-becoming
-- less final than it already was (Paid -> Draft, Invoiced -> Draft,
-- Paid -> Invoiced), and any change once Cancelled or Refunded — both
-- terminal.
CREATE OR REPLACE FUNCTION sale_lifecycle_rank(s sale_lifecycle_status)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE s
    WHEN 'Draft'    THEN 1
    WHEN 'Invoiced' THEN 2
    WHEN 'Paid'     THEN 3
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION enforce_sale_lifecycle_and_approval()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current_fy UUID;
  v_row_fy     UUID;
  v_is_current BOOLEAN;
BEGIN
  SELECT id INTO v_current_fy FROM fiscal_periods WHERE is_current;
  v_row_fy := fiscal_period_for_date(NEW.date);
  v_is_current := (v_row_fy IS NOT NULL AND v_row_fy = v_current_fy);

  IF NOT v_is_current THEN
    RETURN NEW;
  END IF;

  IF NEW.approval_status = 'manager_approved' AND NEW.manager_approved_by IS NULL THEN
    RAISE EXCEPTION 'A current fiscal year sale needs a real manager approver (manager_approved_by) before it can reach manager_approved';
  END IF;
  IF NEW.approval_status = 'finance_approved' AND NEW.finance_approved_by IS NULL THEN
    RAISE EXCEPTION 'A current fiscal year sale needs a real finance approver (finance_approved_by) before it can reach finance_approved';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.sales_status IS DISTINCT FROM OLD.sales_status AND OLD.sales_status IS NOT NULL THEN
    IF OLD.sales_status IN ('Cancelled', 'Refunded') THEN
      RAISE EXCEPTION 'Cannot change status once a current fiscal year sale is % — that is a terminal state', OLD.sales_status;
    END IF;
    IF NEW.sales_status NOT IN ('Cancelled', 'Refunded')
       AND sale_lifecycle_rank(NEW.sales_status) < sale_lifecycle_rank(OLD.sales_status) THEN
      RAISE EXCEPTION 'A current fiscal year sale cannot move backward from % to %', OLD.sales_status, NEW.sales_status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_sale_lifecycle_and_approval ON sales;
CREATE TRIGGER trg_enforce_sale_lifecycle_and_approval
  BEFORE INSERT OR UPDATE OF approval_status, sales_status, manager_approved_by, finance_approved_by ON sales
  FOR EACH ROW EXECUTE FUNCTION enforce_sale_lifecycle_and_approval();

-- Verify: columns, constraints, functions, triggers all present.
SELECT column_name, data_type, column_default FROM information_schema.columns
  WHERE table_name = 'sales' AND column_name = 'is_project_funded';
SELECT conname FROM pg_constraint WHERE conname = 'sales_proforma_id_fkey';
SELECT column_name FROM information_schema.columns WHERE table_name = 'contracts' AND column_name = 'opportunity_id';
SELECT proname FROM pg_proc WHERE proname IN (
  'sync_project_contract_value', 'block_manual_contract_value_edit',
  'sale_lifecycle_rank', 'enforce_sale_lifecycle_and_approval'
);
SELECT tgname FROM pg_trigger WHERE tgname IN (
  'trg_sync_project_contract_value', 'trg_block_manual_contract_value_edit',
  'trg_enforce_sale_lifecycle_and_approval'
);
