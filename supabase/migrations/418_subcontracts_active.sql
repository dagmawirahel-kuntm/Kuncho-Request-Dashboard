-- 418 — Subcontracts as live work, not paperwork after the fact
--
-- Five engagements exist. All five were entered the day the work was done
-- and are already 100% complete — the page is filled in to unlock a payment,
-- not used to run the job. Meanwhile printing, signage, light boxes and
-- fibreglass work go through as ordinary purchases or "due payments"
-- (ETB 1.6M to one printer with no project and no scope on record), and no
-- subcontractor has ever been rated.
--
--   subcontract_progress_updates  dated progress notes; each sets the
--                                 engagement's % complete and moves an
--                                 agreed job to in progress
--   engagement status trigger     agreeing a job stamps who agreed it, when
--   certificate guard             no certifying past the agreed amount, and
--                                 no second identical certificate within two
--                                 minutes (a double click pays twice: every
--                                 certificate raises its own payment request)
--   v_subcontract_board           per engagement: certified, requested, paid,
--                                 work done but not certified, overdue, days
--                                 since the last update, rated or not, and the
--                                 next step in one word
--   v_subcontract_candidates      payments in the last six months that look
--                                 like subcontracted work but have no
--                                 engagement (printing, signage, fabrication,
--                                 install, a vendor already subcontracted)
--   subcontract_candidate_dismissals  "not a subcontract" — hides one

SET search_path TO public;

-- Where an engagement was recorded from a payment made outside the page
-- (see the last section).
ALTER TABLE subcontractor_engagements ADD COLUMN IF NOT EXISTS recorded_from_expense_id uuid REFERENCES expenses(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS subcontractor_engagements_recorded_from ON subcontractor_engagements (recorded_from_expense_id) WHERE recorded_from_expense_id IS NOT NULL;

-- ── Progress updates ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subcontract_progress_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid NOT NULL REFERENCES subcontractor_engagements(id) ON DELETE CASCADE,
  percent numeric NOT NULL CHECK (percent >= 0 AND percent <= 100),
  note text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subcontract_progress_updates_eng ON subcontract_progress_updates (engagement_id, created_at DESC);
ALTER TABLE subcontract_progress_updates ENABLE ROW LEVEL SECURITY;
CREATE POLICY subcontract_progress_read ON subcontract_progress_updates FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY subcontract_progress_write ON subcontract_progress_updates FOR INSERT
  WITH CHECK (get_user_role() = ANY (ARRAY['admin'::user_role, 'executive'::user_role, 'project_manager'::user_role, 'procurement_officer'::user_role]));
GRANT SELECT, INSERT ON subcontract_progress_updates TO authenticated;

CREATE OR REPLACE FUNCTION subcontract_progress_apply() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  UPDATE subcontractor_engagements
     SET percent_complete = NEW.percent,
         status = CASE WHEN status IN ('drafting', 'agreed') AND NEW.percent > 0 THEN 'in_progress' ELSE status END,
         start_date = COALESCE(start_date, NEW.created_at::date)
   WHERE id = NEW.engagement_id;
  RETURN NEW;
END $fn$;
CREATE TRIGGER trg_subcontract_progress_apply AFTER INSERT ON subcontract_progress_updates
  FOR EACH ROW EXECUTE FUNCTION subcontract_progress_apply();

-- ── Who agreed it ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION subcontract_stamp_agreed() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
  IF NEW.status IN ('agreed', 'in_progress', 'completed') AND NEW.approved_at IS NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    NEW.approved_by := auth.uid();
    NEW.approved_at := now();
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER trg_subcontract_stamp_agreed BEFORE INSERT OR UPDATE ON subcontractor_engagements
  FOR EACH ROW EXECUTE FUNCTION subcontract_stamp_agreed();

-- ── Certificate guard ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION subcontract_certificate_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_agreed numeric; v_so_far numeric;
BEGIN
  IF NEW.certified_amount IS NULL OR NEW.certified_amount <= 0 THEN
    RAISE EXCEPTION 'Certify an amount above zero';
  END IF;
  SELECT agreed_amount INTO v_agreed FROM subcontractor_engagements WHERE id = NEW.engagement_id;
  SELECT COALESCE(sum(certified_amount), 0) INTO v_so_far FROM subcontractor_completion_certificates WHERE engagement_id = NEW.engagement_id;
  IF v_agreed IS NOT NULL AND v_so_far + NEW.certified_amount > v_agreed + 0.5 THEN
    RAISE EXCEPTION 'That takes the certified total to % — more than the agreed %. If the scope grew, raise the agreed amount on the engagement first.',
      to_char(v_so_far + NEW.certified_amount, 'FM999,999,999.00'), to_char(v_agreed, 'FM999,999,999.00');
  END IF;
  IF EXISTS (SELECT 1 FROM subcontractor_completion_certificates
              WHERE engagement_id = NEW.engagement_id AND certified_amount = NEW.certified_amount
                AND created_at > now() - interval '2 minutes') THEN
    RAISE EXCEPTION 'The same certificate was recorded a moment ago — each one raises a payment request, so it was not added twice';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER trg_subcontract_certificate_guard BEFORE INSERT ON subcontractor_completion_certificates
  FOR EACH ROW EXECUTE FUNCTION subcontract_certificate_guard();

-- ── The board ──────────────────────────────────────────────────────────
-- Whether an engagement has been rated. Ratings themselves are visible only
-- to HR, executives and the project's PM; whether one exists is not secret,
-- and without this everyone else would be told to rate a rated job.
CREATE OR REPLACE FUNCTION subcontract_rated_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT DISTINCT subcontract_id FROM competency_ratings WHERE subcontract_id IS NOT NULL
$fn$;
REVOKE ALL ON FUNCTION subcontract_rated_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION subcontract_rated_ids() TO authenticated;

CREATE OR REPLACE VIEW v_subcontract_board WITH (security_invoker = true) AS
WITH c AS (
  SELECT engagement_id, sum(certified_amount) AS certified, count(*) AS certs, max(certified_at) AS last_cert_at
    FROM subcontractor_completion_certificates GROUP BY engagement_id),
x AS (
  -- its payment requests, or the payment it was recorded from
  SELECT e.id AS engagement_id,
         sum(ex.amount_etb) FILTER (WHERE ex.approval_status::text <> 'rejected') AS requested,
         sum(ex.amount_etb) FILTER (WHERE ex.approval_status::text <> 'rejected' AND ex.payment_state IN ('paid', 'sent')) AS paid
    FROM subcontractor_engagements e
    JOIN expenses ex ON ex.subcontractor_engagement_id = e.id OR ex.id = e.recorded_from_expense_id
   GROUP BY e.id),
u AS (
  SELECT engagement_id, max(created_at) AS last_update_at, count(*) AS updates
    FROM subcontract_progress_updates GROUP BY engagement_id),
r AS (SELECT subcontract_rated_ids() AS subcontract_id),
b AS (
  SELECT e.id, e.vendor_id, v.vendor_name, v.phone_contact AS vendor_phone, e.project_id, p.project_name,
         e.scope_of_work, e.agreed_amount, e.status::text AS status, e.start_date, e.target_completion_date,
         COALESCE(e.percent_complete, 0) AS percent_complete, e.approved_at, e.created_at, e.notes,
         COALESCE(c.certified, 0) AS certified, COALESCE(c.certs, 0) AS certs, c.last_cert_at,
         COALESCE(x.requested, 0) AS requested, COALESCE(x.paid, 0) AS paid,
         GREATEST(round(e.agreed_amount * COALESCE(e.percent_complete, 0) / 100.0 - COALESCE(c.certified, 0)), 0) AS uncertified_work,
         GREATEST(e.agreed_amount - COALESCE(c.certified, 0), 0) AS left_to_certify,
         (e.target_completion_date < current_date AND e.status::text IN ('drafting', 'agreed', 'in_progress')) AS overdue,
         CASE WHEN e.target_completion_date < current_date AND e.status::text IN ('drafting', 'agreed', 'in_progress')
              THEN current_date - e.target_completion_date END AS days_late,
         COALESCE(u.last_update_at, e.updated_at) AS last_update_at, COALESCE(u.updates, 0) AS updates,
         (current_date - COALESCE(u.last_update_at, e.updated_at)::date) AS days_since_update,
         (r.subcontract_id IS NOT NULL) AS rated
    FROM subcontractor_engagements e
    LEFT JOIN vendors v ON v.id = e.vendor_id
    LEFT JOIN projects p ON p.id = e.project_id
    LEFT JOIN c ON c.engagement_id = e.id
    LEFT JOIN x ON x.engagement_id = e.id
    LEFT JOIN u ON u.engagement_id = e.id
    LEFT JOIN r ON r.subcontract_id = e.id)
SELECT b.*,
       CASE
         WHEN status = 'terminated' THEN NULL
         WHEN status = 'drafting' THEN 'agree'
         WHEN overdue THEN 'overdue'
         WHEN uncertified_work >= GREATEST(agreed_amount * 0.05, 1) THEN 'certify'
         WHEN status = 'agreed' AND COALESCE(start_date, current_date) <= current_date THEN 'start'
         WHEN status = 'in_progress' AND percent_complete >= 100 THEN 'complete'
         WHEN status = 'in_progress' AND days_since_update >= 7 THEN 'update'
         WHEN status = 'completed' AND left_to_certify > 0.5 THEN 'certify'
         WHEN status = 'completed' AND NOT rated THEN 'rate'
       END AS next_step
  FROM b;
GRANT SELECT ON v_subcontract_board TO authenticated;

-- ── Work paid outside the page ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subcontract_candidate_dismissals (
  expense_id uuid PRIMARY KEY REFERENCES expenses(id) ON DELETE CASCADE,
  reason text,
  dismissed_by uuid DEFAULT auth.uid(),
  dismissed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE subcontract_candidate_dismissals ENABLE ROW LEVEL SECURITY;
CREATE POLICY subcontract_dismissals_read ON subcontract_candidate_dismissals FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY subcontract_dismissals_write ON subcontract_candidate_dismissals FOR ALL
  USING (get_user_role() = ANY (ARRAY['admin'::user_role, 'executive'::user_role, 'project_manager'::user_role, 'procurement_officer'::user_role]))
  WITH CHECK (get_user_role() = ANY (ARRAY['admin'::user_role, 'executive'::user_role, 'project_manager'::user_role, 'procurement_officer'::user_role]));
GRANT SELECT, INSERT, DELETE ON subcontract_candidate_dismissals TO authenticated;

CREATE OR REPLACE VIEW v_subcontract_candidates WITH (security_invoker = true) AS
WITH prior AS (SELECT DISTINCT vendor_id FROM subcontractor_engagements WHERE vendor_id IS NOT NULL),
ex AS (
  SELECT x.id AS expense_id, x.expense_code, x.date, x.amount_etb, x.expense_type::text AS expense_type,
         x.approval_status::text AS approval_status, x.payment_state,
         x.vendor_id, v.vendor_name, x.project_id, p.project_name,
         COALESCE(NULLIF(trim(x.description_of_item), ''), x.item_service_description) AS description,
         lower(COALESCE(x.description_of_item, '') || ' ' || COALESCE(x.item_service_description, '')) AS d,
         lower(COALESCE(v.vendor_name, '')) AS vn,
         (x.vendor_id IN (SELECT vendor_id FROM prior)) AS subcontracted_before
    FROM expenses x
    LEFT JOIN vendors v ON v.id = x.vendor_id
    LEFT JOIN projects p ON p.id = x.project_id
   WHERE x.subcontractor_engagement_id IS NULL
     AND x.approval_status::text <> 'rejected'
     AND x.amount_etb >= 5000
     AND x.date >= current_date - 180
     AND x.expense_type::text NOT IN ('labor_payment', 'fuel', 'property_rent', 'transportation', 'vrf')
     AND NOT EXISTS (SELECT 1 FROM subcontract_candidate_dismissals dm WHERE dm.expense_id = x.id)
     AND NOT EXISTS (SELECT 1 FROM subcontractor_engagements se WHERE se.recorded_from_expense_id = x.id))
SELECT expense_id, expense_code, date, amount_etb, expense_type, approval_status, payment_state,
       vendor_id, vendor_name, project_id, project_name, description, subcontracted_before,
       CASE
         WHEN subcontracted_before THEN 'Vendor already subcontracted'
         WHEN d ~ '(uv print|printing|print\M|sticker|banner|branding)' OR vn ~ '(print|advert|branding)' THEN 'Printing and branding'
         WHEN d ~ '(light ?box|logo with light|signage|sign board)' OR vn ~ '\msign' THEN 'Signage and light boxes'
         WHEN d ~ '(fabricat|welding|fiber ?glass|fibre ?glass|cnc cut|laser cut)' OR vn ~ '(fabricat|engineering|metal works)' THEN 'Fabrication'
         WHEN d ~ '(install|assembl|supply and install|supply & install|workmanship|labou?r and material)' THEN 'Supply and install'
         WHEN d ~ '(upholster|veneer sticking|sticking service|service charge)' OR vn ~ '(furniture|workshop)' THEN 'Workshop services'
       END AS looks_like
  FROM ex
 WHERE NOT (d ~ '(ride|fuel|payroll|vrf|finger ?print|mastish)')
   AND (subcontracted_before
     OR d ~ '(uv print|printing|print\M|sticker|banner|branding|light ?box|logo with light|signage|sign board|fabricat|welding|fiber ?glass|fibre ?glass|cnc cut|laser cut|install|assembl|workmanship|labou?r and material|upholster|veneer sticking|sticking service|service charge)'
     OR vn ~ '(print|advert|branding|\msign|fabricat|engineering|metal works|furniture|workshop)');
GRANT SELECT ON v_subcontract_candidates TO authenticated;

-- ── Recording a job that was paid outside the page ─────────────────────
-- The engagement points at the payment rather than the other way round:
-- the payment is approved (often paid), and re-touching it would re-run the
-- expense, ledger and approval triggers. The matching certificate is added
-- without raising a second payment request.

CREATE OR REPLACE FUNCTION auto_create_subcontract_expense()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_engagement subcontractor_engagements%ROWTYPE;
BEGIN
  -- Already paid (adopt_subcontract_expense): no second payment request.
  IF current_setting('kuncho.subcontract_already_paid', true) = 'on' THEN RETURN NEW; END IF;
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
$fn$;

CREATE OR REPLACE FUNCTION adopt_subcontract_expense(p_expense uuid, p_scope text, p_project uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE x expenses%ROWTYPE; v_id uuid; v_project uuid;
BEGIN
  IF NOT (get_user_role() = ANY (ARRAY['admin'::user_role, 'executive'::user_role, 'project_manager'::user_role, 'procurement_officer'::user_role])) THEN
    RAISE EXCEPTION 'Only admin, executive, project managers or procurement may record subcontracts';
  END IF;
  SELECT * INTO x FROM expenses WHERE id = p_expense;
  IF x.id IS NULL THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF x.subcontractor_engagement_id IS NOT NULL OR EXISTS (SELECT 1 FROM subcontractor_engagements WHERE recorded_from_expense_id = p_expense) THEN
    RAISE EXCEPTION 'That payment is already on an engagement';
  END IF;
  IF x.vendor_id IS NULL THEN RAISE EXCEPTION 'The payment has no vendor — set the vendor on it first'; END IF;
  IF COALESCE(trim(p_scope), '') = '' THEN RAISE EXCEPTION 'Say what the work was'; END IF;
  v_project := COALESCE(p_project, x.project_id);
  IF v_project IS NULL THEN RAISE EXCEPTION 'Which project was the work for?'; END IF;

  INSERT INTO subcontractor_engagements (vendor_id, project_id, scope_of_work, agreed_amount, start_date, target_completion_date,
                                         percent_complete, status, notes, recorded_from_expense_id)
  VALUES (x.vendor_id, v_project, trim(p_scope), x.amount_etb, x.date, x.date, 100, 'completed',
          'Recorded after it was paid — ' || COALESCE(x.expense_code, 'payment') || ' of ' || to_char(x.date, 'DD Mon YYYY'), p_expense)
  RETURNING id INTO v_id;

  PERFORM set_config('kuncho.subcontract_already_paid', 'on', true);
  INSERT INTO subcontractor_completion_certificates (engagement_id, certified_amount, percent_of_scope_at_cert, certified_by, notes)
  VALUES (v_id, x.amount_etb, 100, auth.uid(), 'Paid as ' || COALESCE(x.expense_code, 'a payment') || ' before it was recorded here');
  PERFORM set_config('kuncho.subcontract_already_paid', 'off', true);
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION adopt_subcontract_expense(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION adopt_subcontract_expense(uuid, text, uuid) TO authenticated;
