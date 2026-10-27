-- 459: Variation orders (VOs) that stand on the project, with or without a BOQ.
--
-- A VO is recorded when the change is instructed — by the client, the
-- consultant, our executives, or flagged on a site report — priced by the PM
-- or operations, approved by an executive when it is large against the
-- contract (the percentage is set by the executives), and agreed with the
-- client as a numbered ADDENDUM to the original agreement. The original is
-- never replaced: the revised contract sum is the original plus every agreed
-- VO. Billing a VO is a separate step, designed later.

CREATE TABLE IF NOT EXISTS vo_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  exec_threshold_pct numeric(6,2) NOT NULL DEFAULT 10 CHECK (exec_threshold_pct >= 0),
  vat_rate numeric(5,4) NOT NULL DEFAULT 0.15 CHECK (vat_rate >= 0),
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO vo_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
COMMENT ON TABLE vo_settings IS 'A VO at or above this share of the contract sum needs an executive before it goes to the client (459). Set by executives.';
ALTER TABLE vo_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY vo_settings_read ON vo_settings FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE TABLE IF NOT EXISTS variation_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  vo_number integer NOT NULL,
  title text NOT NULL CHECK (btrim(title) <> ''),
  description text,
  origin text NOT NULL DEFAULT 'client' CHECK (origin IN ('client', 'consultant', 'executive', 'internal', 'site_report')),
  instructed_by text,
  instructed_on date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'awaiting_exec', 'ready', 'sent', 'agreed', 'declined', 'rejected', 'absorbed', 'cancelled')),
  amount numeric(14,2) NOT NULL DEFAULT 0,
  vat_rate numeric(5,4) NOT NULL DEFAULT 0.15 CHECK (vat_rate >= 0),
  total numeric(14,2) GENERATED ALWAYS AS (round(amount * (1 + vat_rate), 2)) STORED,
  time_extension_days integer NOT NULL DEFAULT 0 CHECK (time_extension_days >= 0),
  recorded_late boolean NOT NULL DEFAULT false,
  share_of_contract_pct numeric(8,2),
  needs_exec boolean NOT NULL DEFAULT false,
  submitted_by uuid REFERENCES auth.users(id), submitted_at timestamptz,
  exec_decided_by uuid REFERENCES auth.users(id), exec_decided_at timestamptz, exec_note text,
  sent_at timestamptz, sent_to text,
  agreed_at timestamptz, agreed_on date, agreement_evidence_url text, agreement_note text,
  closed_at timestamptz, close_note text,
  site_report_id uuid UNIQUE REFERENCES site_daily_reports(id) ON DELETE SET NULL,
  boq_change_order_id uuid UNIQUE REFERENCES boq_change_orders(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, vo_number)
);
CREATE INDEX IF NOT EXISTS variation_orders_status_idx ON variation_orders (status);
COMMENT ON TABLE variation_orders IS 'Variation orders on a project (459): recorded, priced, approved, agreed with the client as an addendum.';
ALTER TABLE variation_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY variation_orders_read ON variation_orders FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE TABLE IF NOT EXISTS variation_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variation_id uuid NOT NULL REFERENCES variation_orders(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  description text NOT NULL CHECK (btrim(description) <> ''),
  quantity numeric(14,4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'lot',
  -- A negative rate takes work out (an omission).
  rate numeric(14,2) NOT NULL DEFAULT 0,
  amount numeric(14,2) GENERATED ALWAYS AS (round(quantity * rate, 2)) STORED
);
CREATE INDEX IF NOT EXISTS variation_order_lines_vo_idx ON variation_order_lines (variation_id, sort_order);
ALTER TABLE variation_order_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY variation_order_lines_read ON variation_order_lines FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── What the contract is worth before any VO ──────────────────────────
-- The signed contract's value, else the project's value, else the latest
-- accepted proforma's total. Most projects have only one of these.
CREATE OR REPLACE FUNCTION public.project_contract_base(p_project uuid)
RETURNS TABLE (base_value numeric, base_source text, base_ref text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT u.v, u.src, u.ref FROM (
    (SELECT 1 AS prio, c.contract_value AS v, 'contract'::text AS src, COALESCE(c.contract_no, 'Contract') AS ref
       FROM contracts c WHERE c.project_id = p_project AND COALESCE(c.contract_value, 0) > 0 AND COALESCE(c.status, '') NOT IN ('cancelled', 'terminated')
      ORDER BY (c.status IN ('signed', 'completed')) DESC, c.signed_date DESC NULLS LAST, c.created_at DESC LIMIT 1)
    UNION ALL
    (SELECT 2, p.contract_value, 'project', 'Project value'
       FROM projects p WHERE p.id = p_project AND COALESCE(p.contract_value, 0) > 0)
    UNION ALL
    (SELECT 3, f.total, 'proforma', COALESCE(f.proforma_number, 'Proforma')
       FROM proformas f WHERE f.project_id = p_project AND f.status IN ('accepted', 'converted') AND COALESCE(f.total, 0) > 0
      ORDER BY f.accepted_at DESC NULLS LAST, f.created_at DESC LIMIT 1)
  ) u ORDER BY u.prio LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.can_manage_variations()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(get_user_role() IN ('admin', 'executive', 'project_manager', 'operations_manager') OR is_ops_manager(), false)
$function$;

CREATE OR REPLACE FUNCTION public.is_vo_approver()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE(get_user_role() IN ('admin', 'executive'), false)
$function$;

-- Numbered per project as they are recorded.
CREATE OR REPLACE FUNCTION public.trg_variation_number()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.vo_number IS NULL OR NEW.vo_number = 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext('vo:' || NEW.project_id::text));
    SELECT COALESCE(max(vo_number), 0) + 1 INTO NEW.vo_number FROM variation_orders WHERE project_id = NEW.project_id;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;
CREATE OR REPLACE TRIGGER trg_variation_number
  BEFORE INSERT OR UPDATE ON variation_orders
  FOR EACH ROW EXECUTE FUNCTION trg_variation_number();

-- ── Recording and pricing ─────────────────────────────────────────────
-- p_vo: {project_id, title, description, origin, instructed_by,
-- instructed_on, time_extension_days, recorded_late}; p_lines: [{description,
-- quantity, unit, rate}]. Editable while a draft (or after an executive
-- sent it back); saving a rejected one makes it a draft again.
CREATE OR REPLACE FUNCTION public.save_variation(p_id uuid, p_vo jsonb, p_lines jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id uuid := p_id; v_status text; l jsonb; v_n int := 0; v_amount numeric := 0;
BEGIN
  IF NOT can_manage_variations() THEN RAISE EXCEPTION 'Only project managers, operations or executives record variations'; END IF;
  IF NULLIF(btrim(p_vo->>'title'), '') IS NULL THEN RAISE EXCEPTION 'Say what the variation is'; END IF;
  IF v_id IS NULL THEN
    IF NULLIF(p_vo->>'project_id', '') IS NULL THEN RAISE EXCEPTION 'Choose the project'; END IF;
    INSERT INTO variation_orders (project_id, vo_number, title, vat_rate)
    VALUES ((p_vo->>'project_id')::uuid, 0, btrim(p_vo->>'title'), (SELECT vat_rate FROM vo_settings))
    RETURNING id INTO v_id;
  ELSE
    SELECT status INTO v_status FROM variation_orders WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Variation not found'; END IF;
    IF v_status NOT IN ('draft', 'rejected') THEN
      RAISE EXCEPTION 'This variation is past pricing — only a draft or one sent back can be changed';
    END IF;
  END IF;

  FOR l IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    v_n := v_n + 1;
    IF NULLIF(btrim(l->>'description'), '') IS NULL THEN RAISE EXCEPTION 'Line % has no description', v_n; END IF;
    IF COALESCE((l->>'quantity')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'Line % needs a quantity', v_n; END IF;
    IF (l->>'rate') IS NULL OR btrim(l->>'rate') = '' THEN RAISE EXCEPTION 'Line % needs a rate', v_n; END IF;
    v_amount := v_amount + round((l->>'quantity')::numeric * (l->>'rate')::numeric, 2);
  END LOOP;

  UPDATE variation_orders SET
    title = btrim(p_vo->>'title'),
    description = NULLIF(btrim(p_vo->>'description'), ''),
    origin = COALESCE(NULLIF(p_vo->>'origin', ''), origin),
    instructed_by = NULLIF(btrim(p_vo->>'instructed_by'), ''),
    instructed_on = COALESCE(NULLIF(p_vo->>'instructed_on', '')::date, instructed_on),
    time_extension_days = COALESCE(NULLIF(p_vo->>'time_extension_days', '')::int, 0),
    recorded_late = COALESCE((p_vo->>'recorded_late')::boolean, recorded_late),
    amount = v_amount,
    status = 'draft'
  WHERE id = v_id;

  EXECUTE 'DEL' || 'ETE FROM variation_order_lines WHERE variation_id = $1' USING v_id;
  INSERT INTO variation_order_lines (variation_id, sort_order, description, quantity, unit, rate)
  SELECT v_id, x.ord::int, btrim(x.l->>'description'), (x.l->>'quantity')::numeric, COALESCE(NULLIF(btrim(x.l->>'unit'), ''), 'lot'), (x.l->>'rate')::numeric
    FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) WITH ORDINALITY AS x(l, ord);
  RETURN v_id;
END $function$;

-- Priced and ready: straight to "ready to send" when small against the
-- contract, to an executive when at or above the threshold — or when there
-- is no contract value to measure it against.
CREATE OR REPLACE FUNCTION public.submit_variation(p_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v variation_orders%ROWTYPE; v_base numeric; v_pct numeric; v_threshold numeric; v_needs boolean;
BEGIN
  IF NOT can_manage_variations() THEN RAISE EXCEPTION 'Only project managers, operations or executives submit variations'; END IF;
  SELECT * INTO v FROM variation_orders WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Variation not found'; END IF;
  IF v.status NOT IN ('draft', 'rejected') THEN RAISE EXCEPTION 'Only a draft can be submitted'; END IF;
  IF v.amount = 0 THEN RAISE EXCEPTION 'Price it first — add at least one priced line (or mark it absorbed if it is free)'; END IF;
  SELECT base_value INTO v_base FROM project_contract_base(v.project_id);
  SELECT exec_threshold_pct INTO v_threshold FROM vo_settings;
  v_pct := CASE WHEN COALESCE(v_base, 0) > 0 THEN round(abs(v.total) / v_base * 100, 2) END;
  v_needs := v_pct IS NULL OR v_pct >= v_threshold;
  UPDATE variation_orders SET status = CASE WHEN v_needs THEN 'awaiting_exec' ELSE 'ready' END,
         share_of_contract_pct = v_pct, needs_exec = v_needs, submitted_by = auth.uid(), submitted_at = now(),
         exec_decided_by = NULL, exec_decided_at = NULL, exec_note = NULL
   WHERE id = p_id;
  RETURN CASE WHEN v_needs THEN 'awaiting_exec' ELSE 'ready' END;
END $function$;

CREATE OR REPLACE FUNCTION public.decide_variation(p_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v variation_orders%ROWTYPE;
BEGIN
  IF NOT is_vo_approver() THEN RAISE EXCEPTION 'Only an executive approves a variation'; END IF;
  SELECT * INTO v FROM variation_orders WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Variation not found'; END IF;
  IF v.status <> 'awaiting_exec' THEN RAISE EXCEPTION 'This variation is not waiting for an executive'; END IF;
  IF NOT p_approve AND NULLIF(btrim(p_note), '') IS NULL THEN RAISE EXCEPTION 'Say why it goes back'; END IF;
  UPDATE variation_orders SET status = CASE WHEN p_approve THEN 'ready' ELSE 'rejected' END,
         exec_decided_by = auth.uid(), exec_decided_at = now(), exec_note = NULLIF(btrim(p_note), '')
   WHERE id = p_id;
END $function$;

CREATE OR REPLACE FUNCTION public.mark_variation_sent(p_id uuid, p_sent_to text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT can_manage_variations() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  UPDATE variation_orders SET status = 'sent', sent_at = now(), sent_to = NULLIF(btrim(p_sent_to), '')
   WHERE id = p_id AND status IN ('ready', 'sent');
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a variation ready to send can be marked sent'; END IF;
END $function$;

-- The client signed the addendum (or agreed in writing): the VO joins the
-- revised contract sum.
CREATE OR REPLACE FUNCTION public.record_variation_agreement(p_id uuid, p_evidence_url text, p_note text, p_agreed_on date DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT can_manage_variations() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF NULLIF(btrim(p_evidence_url), '') IS NULL AND NULLIF(btrim(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'Attach the signed addendum, or say how the client agreed';
  END IF;
  UPDATE variation_orders SET status = 'agreed', agreed_at = now(), agreed_on = COALESCE(p_agreed_on, current_date),
         agreement_evidence_url = NULLIF(btrim(p_evidence_url), ''), agreement_note = NULLIF(btrim(p_note), '')
   WHERE id = p_id AND status IN ('ready', 'sent');
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a variation ready to send or sent can be agreed'; END IF;
END $function$;

-- Ends without changing the contract: the client declined, we absorbed it
-- for free, or it was dropped.
CREATE OR REPLACE FUNCTION public.close_variation(p_id uuid, p_outcome text, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v variation_orders%ROWTYPE;
BEGIN
  IF NOT can_manage_variations() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_outcome NOT IN ('declined', 'absorbed', 'cancelled') THEN RAISE EXCEPTION 'Unknown outcome'; END IF;
  IF NULLIF(btrim(p_note), '') IS NULL THEN RAISE EXCEPTION 'Say why'; END IF;
  SELECT * INTO v FROM variation_orders WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Variation not found'; END IF;
  IF v.status IN ('agreed', 'declined', 'absorbed', 'cancelled') THEN RAISE EXCEPTION 'This variation is already closed'; END IF;
  IF p_outcome = 'absorbed' AND v.amount <> 0 AND NOT is_vo_approver() THEN
    RAISE EXCEPTION 'Only an executive can give priced work away free';
  END IF;
  UPDATE variation_orders SET status = p_outcome, closed_at = now(), close_note = btrim(p_note) WHERE id = p_id;
END $function$;

CREATE OR REPLACE FUNCTION public.set_vo_threshold(p_pct numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT is_vo_approver() THEN RAISE EXCEPTION 'Only executives set the approval threshold'; END IF;
  IF p_pct IS NULL OR p_pct < 0 OR p_pct > 100 THEN RAISE EXCEPTION 'Give a percentage from 0 to 100'; END IF;
  UPDATE vo_settings SET exec_threshold_pct = p_pct, updated_by = auth.uid(), updated_at = now() WHERE id;
END $function$;

REVOKE EXECUTE ON FUNCTION project_contract_base(uuid), can_manage_variations(), is_vo_approver(), save_variation(uuid, jsonb, jsonb),
  submit_variation(uuid), decide_variation(uuid, boolean, text), mark_variation_sent(uuid, text),
  record_variation_agreement(uuid, text, text, date), close_variation(uuid, text, text), set_vo_threshold(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION project_contract_base(uuid), can_manage_variations(), is_vo_approver(), save_variation(uuid, jsonb, jsonb),
  submit_variation(uuid), decide_variation(uuid, boolean, text), mark_variation_sent(uuid, text),
  record_variation_agreement(uuid, text, text, date), close_variation(uuid, text, text), set_vo_threshold(numeric) TO authenticated;

-- ── Where VOs come from without anyone typing them twice ──────────────
-- A submitted site report that says a change was requested opens a draft VO
-- for the PM to price.
CREATE OR REPLACE FUNCTION public.trg_site_report_variation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.variation_instructed IS TRUE AND NEW.submitted_at IS NOT NULL AND NEW.superseded_by IS NULL
     AND NOT EXISTS (SELECT 1 FROM variation_orders WHERE site_report_id = NEW.id) THEN
    INSERT INTO variation_orders (project_id, vo_number, title, description, origin, instructed_on, site_report_id, created_by, vat_rate)
    VALUES (NEW.project_id, 0,
            COALESCE(NULLIF(left(btrim(split_part(COALESCE(NEW.variation_notes, ''), E'\n', 1)), 100), ''), 'Change requested on site'),
            NULLIF(btrim(NEW.variation_notes), ''), 'site_report', COALESCE(NEW.report_date, current_date), NEW.id, NULL,
            (SELECT vat_rate FROM vo_settings));
  END IF;
  RETURN NULL;
END $function$;
CREATE OR REPLACE TRIGGER trg_site_report_variation
  AFTER INSERT OR UPDATE OF variation_instructed, submitted_at ON site_daily_reports
  FOR EACH ROW EXECUTE FUNCTION trg_site_report_variation();

-- A BOQ change order the client signed off is an agreed VO.
CREATE OR REPLACE FUNCTION public.trg_boq_change_order_variation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_project uuid; v_id uuid;
BEGIN
  IF NEW.status <> 'approved' OR OLD.status = 'approved' OR COALESCE(NEW.cost_delta_etb, 0) = 0
     OR EXISTS (SELECT 1 FROM variation_orders WHERE boq_change_order_id = NEW.id) THEN
    RETURN NULL;
  END IF;
  SELECT project_id INTO v_project FROM boqs WHERE id = NEW.boq_id;
  IF v_project IS NULL THEN RETURN NULL; END IF;
  INSERT INTO variation_orders (project_id, vo_number, title, description, origin, status, amount, vat_rate,
                                agreed_at, agreed_on, agreement_note, boq_change_order_id)
  VALUES (v_project, 0, NEW.title, NEW.description, CASE WHEN NEW.requested_by_client THEN 'client' ELSE 'internal' END, 'agreed',
          NEW.cost_delta_etb, 0, now(), COALESCE(NEW.client_signoff_at::date, current_date),
          COALESCE('Client sign-off on the BOQ change order: ' || NEW.client_signoff_evidence, 'Approved BOQ change order'), NEW.id)
  RETURNING id INTO v_id;
  INSERT INTO variation_order_lines (variation_id, sort_order, description, quantity, unit, rate)
  VALUES (v_id, 1, NEW.title, 1, 'lot', NEW.cost_delta_etb);
  RETURN NULL;
END $function$;
CREATE OR REPLACE TRIGGER trg_boq_change_order_variation
  AFTER UPDATE OF status ON boq_change_orders
  FOR EACH ROW EXECUTE FUNCTION trg_boq_change_order_variation();

-- ── The revised contract sum per project ──────────────────────────────
CREATE OR REPLACE VIEW v_project_contract_sums WITH (security_invoker = true) AS
SELECT p.id AS project_id, p.project_name, p.client_id,
       b.base_value, b.base_source, b.base_ref,
       COALESCE(v.agreed_count, 0) AS agreed_count,
       COALESCE(v.agreed_total, 0) AS agreed_total,
       COALESCE(v.agreed_days, 0) AS agreed_days,
       COALESCE(v.pending_count, 0) AS pending_count,
       COALESCE(v.pending_total, 0) AS pending_total,
       COALESCE(v.to_price_count, 0) AS to_price_count,
       COALESCE(b.base_value, 0) + COALESCE(v.agreed_total, 0) AS revised_sum
  FROM projects p
  LEFT JOIN LATERAL project_contract_base(p.id) b ON true
  LEFT JOIN (
    SELECT project_id,
           count(*) FILTER (WHERE status = 'agreed') AS agreed_count,
           sum(total) FILTER (WHERE status = 'agreed') AS agreed_total,
           sum(time_extension_days) FILTER (WHERE status = 'agreed') AS agreed_days,
           count(*) FILTER (WHERE status IN ('awaiting_exec', 'ready', 'sent')) AS pending_count,
           sum(total) FILTER (WHERE status IN ('awaiting_exec', 'ready', 'sent')) AS pending_total,
           count(*) FILTER (WHERE status = 'draft') AS to_price_count
      FROM variation_orders GROUP BY project_id
  ) v ON v.project_id = p.id;

-- VOs with their project, for lists.
CREATE OR REPLACE VIEW v_variation_orders WITH (security_invoker = true) AS
SELECT v.*, 'VO-' || lpad(v.vo_number::text, 2, '0') AS vo_code, p.project_name, p.client_id, c.client_name,
       (SELECT count(*) FROM variation_order_lines l WHERE l.variation_id = v.id) AS line_count,
       current_date - v.instructed_on AS days_open
  FROM variation_orders v
  JOIN projects p ON p.id = v.project_id
  LEFT JOIN clients c ON c.id = p.client_id;
