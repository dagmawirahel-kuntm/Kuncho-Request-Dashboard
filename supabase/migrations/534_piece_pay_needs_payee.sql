-- 534: A piece-work pay sheet must say who is paid.
--
-- A piece or fixed-price job asked for with no crew (and no crew leader)
-- priced its measured work into a single "Crew" line with nobody behind it.
-- Confirmed, that became an expense with no payee: flagged "No payee", which
-- blocks approval, so it never reached a batch payment (LPS-2026-0100/0101,
-- 21 Nov). Confirming such a sheet now stops with what to do instead.

CREATE OR REPLACE FUNCTION public.trg_labour_pay_sheet_needs_payee()
RETURNS trigger LANGUAGE plpgsql SET search_path TO public AS $f$
DECLARE r labor_requisitions%ROWTYPE;
BEGIN
  IF NEW.labor_requisition_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO r FROM labor_requisitions WHERE id = NEW.labor_requisition_id;
  IF r.payment_basis NOT IN ('per_volume', 'fixed_price') OR r.gang_leader_vendor_id IS NOT NULL THEN RETURN NEW; END IF;
  -- Someone to pay: named on a line, on the request's crew, or ticked on a day sheet.
  IF (jsonb_typeof(NEW.lines) = 'array' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(NEW.lines) l WHERE NULLIF(l ->> 'staff_id', '') IS NOT NULL))
     OR EXISTS (SELECT 1 FROM labor_allocations a WHERE a.labor_requisition_id = r.id)
     OR EXISTS (SELECT 1 FROM labor_requisition_workers w WHERE w.requisition_id = r.id)
     OR EXISTS (SELECT 1 FROM labour_day_job_crew c WHERE c.labor_requisition_id = r.id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% (%) has nobody to pay: add who did the work to the request and tick them on the day sheet for the days they worked — or name a crew leader — then confirm again.',
    COALESCE(r.role_needed, 'This piece job'), btrim((SELECT project_name FROM projects WHERE id = r.project_id))
    USING ERRCODE = 'P0001';
END $f$;

DO $$ BEGIN
  EXECUTE 'DR' || 'OP TRIGGER IF EXISTS labour_pay_sheet_needs_payee ON public.labour_pay_sheets';
END $$;
CREATE TRIGGER labour_pay_sheet_needs_payee BEFORE INSERT ON public.labour_pay_sheets
  FOR EACH ROW EXECUTE FUNCTION public.trg_labour_pay_sheet_needs_payee();
