-- 519 — approve the terms, not every ask
--
-- 144 labour requests were decided and 2 refused; a decision usually took 12
-- minutes, and 17 waited more than two days. Most asks set nothing new. One
-- in six asked for work already approved, at the same rate or lower, for a
-- modest amount and with nobody new to hire.
--
-- Those are approved by the system when they are sent. A person still
-- approves whatever sets a term: a rate higher than any approved for that
-- work, a first time for the work, a fixed price, an amount above the limit,
-- someone new to hire, or more people on the standing crew than before.
--
--   labour_request_terms(req)          inside the terms or not, and why
--   labour_request_auto_approve(req)   approve it if it is
--   labour_crew_auto_approve(id)       the same for the standing crew

CREATE TABLE IF NOT EXISTS public.labour_terms_settings (
  id              boolean PRIMARY KEY DEFAULT true CHECK (id),
  auto_approve    boolean NOT NULL DEFAULT true,
  limit_etb       numeric NOT NULL DEFAULT 50000 CHECK (limit_etb >= 0),
  lookback_days   integer NOT NULL DEFAULT 180 CHECK (lookback_days BETWEEN 30 AND 730),
  updated_at      timestamptz,
  updated_by      uuid,
  updated_by_name text
);
INSERT INTO public.labour_terms_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.labour_terms_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'labour_terms_settings' AND policyname = 'labour_terms_read') THEN
    CREATE POLICY labour_terms_read ON public.labour_terms_settings FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
END $$;
GRANT SELECT ON public.labour_terms_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.set_labour_terms(p_auto boolean, p_limit numeric DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF NOT (COALESCE(get_user_role()::text IN ('admin', 'operations_manager'), false) OR is_ops_manager()) THEN
    RAISE EXCEPTION 'Only admin or operations can change what is approved automatically';
  END IF;
  IF p_limit IS NOT NULL AND p_limit < 0 THEN RAISE EXCEPTION 'The limit can''t be negative'; END IF;
  UPDATE labour_terms_settings SET auto_approve = COALESCE(p_auto, auto_approve), limit_etb = COALESCE(p_limit, limit_etb),
         updated_at = now(), updated_by = auth.uid(), updated_by_name = (SELECT full_name FROM user_profiles WHERE id = auth.uid())
   WHERE id;
END $f$;
REVOKE EXECUTE ON FUNCTION public.set_labour_terms(boolean, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_labour_terms(boolean, numeric) TO authenticated;

-- Is this request inside terms already approved? With the reason either way,
-- in words that finish "approved automatically: ..." or "waits for approval
-- because ...".
CREATE OR REPLACE FUNCTION public.labour_request_terms(p_req uuid)
RETURNS TABLE(ok boolean, why text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  r labor_requisitions%ROWTYPE; s labour_terms_settings%ROWTYPE;
  v_est numeric; v_work text; v_rate numeric; v_prev numeric; v_when date; v_per text;
BEGIN
  SELECT * INTO r FROM labor_requisitions WHERE id = p_req;
  SELECT * INTO s FROM labour_terms_settings WHERE id;
  IF r.id IS NULL THEN RETURN QUERY SELECT false, 'the request was not found'; RETURN; END IF;
  IF NOT COALESCE(s.auto_approve, false) THEN RETURN QUERY SELECT false, 'every request is approved by a person'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM labor_requisition_candidates lc WHERE lc.requisition_id = p_req AND lc.promoted_staff_id IS NULL) THEN
    RETURN QUERY SELECT false, 'it names someone new to hire'; RETURN;
  END IF;
  IF r.payment_basis = 'fixed_price' THEN RETURN QUERY SELECT false, 'a fixed price is a new price each time'; RETURN; END IF;

  v_rate := CASE WHEN r.payment_basis = 'per_volume' THEN r.unit_rate ELSE r.estimated_day_rate END;
  v_per := CASE WHEN r.payment_basis = 'per_volume' THEN COALESCE(NULLIF(btrim(r.volume_unit), ''), 'unit') ELSE 'day' END;
  v_est := CASE WHEN r.payment_basis = 'per_volume' THEN r.unit_rate * r.estimated_total_volume
                ELSE r.estimated_day_rate * r.estimated_days * GREATEST(COALESCE(r.headcount, 1), 1) END;
  IF v_est IS NULL OR v_rate IS NULL THEN RETURN QUERY SELECT false, 'it has no rate or no length to estimate from'; RETURN; END IF;
  IF v_est > s.limit_etb THEN
    RETURN QUERY SELECT false, 'about ' || notify_etb(v_est) || ' is above the ' || notify_etb(s.limit_etb) || ' limit'; RETURN;
  END IF;

  -- The highest rate approved for the same work, paid the same way, lately.
  v_work := COALESCE(r.trade_tag::text, lower(btrim(r.role_needed)));
  SELECT x.rate, x.approved_at::date INTO v_prev, v_when
    FROM (SELECT CASE WHEN p.payment_basis = 'per_volume' THEN p.unit_rate ELSE p.estimated_day_rate END AS rate, p.approved_at
            FROM labor_requisitions p
           WHERE p.status = 'approved' AND p.id <> r.id AND p.payment_basis = r.payment_basis
             AND p.approved_at > now() - make_interval(days => s.lookback_days)
             AND COALESCE(p.trade_tag::text, lower(btrim(p.role_needed))) = v_work
             AND (r.payment_basis <> 'per_volume'
                  OR lower(btrim(COALESCE(p.volume_unit, ''))) = lower(btrim(COALESCE(r.volume_unit, ''))))) x
   WHERE x.rate IS NOT NULL ORDER BY x.rate DESC, x.approved_at DESC LIMIT 1;
  IF v_prev IS NULL THEN RETURN QUERY SELECT false, 'this work has not been approved at a rate before'; RETURN; END IF;
  IF v_rate > v_prev THEN
    RETURN QUERY SELECT false, notify_etb(v_rate) || ' a ' || v_per || ' is more than the ' || notify_etb(v_prev) || ' approved for this work before'; RETURN;
  END IF;
  RETURN QUERY SELECT true, notify_etb(v_rate) || ' a ' || v_per || ' is no more than the ' || notify_etb(v_prev) || ' approved on '
                            || to_char(v_when, 'DD Mon') || ', about ' || notify_etb(v_est) || ' is under the limit, and nobody new is hired';
END $f$;
REVOKE EXECUTE ON FUNCTION public.labour_request_terms(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_request_terms(uuid) TO authenticated;

-- The system may approve the one request it has just checked. Nobody signed
-- in can: the flag is only read when no one is.
CREATE OR REPLACE FUNCTION public.enforce_labor_req_approval_authority()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE v_role user_role;
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    IF auth.uid() IS NULL AND COALESCE(current_setting('kuncho.labour_terms_ok', true), '') = NEW.id::text THEN
      NEW.approved_by := NULL;
      NEW.approved_at := now();
      RETURN NEW;
    END IF;
    v_role := public.get_user_role();
    IF v_role IS NULL OR (v_role NOT IN ('admin', 'hr_officer', 'operations_manager') AND NOT is_ops_manager()) THEN
      RAISE EXCEPTION 'Only the operations manager, HR or admin may approve a labour request';
    END IF;
    NEW.approved_by := auth.uid();
    NEW.approved_at := now();
  END IF;
  RETURN NEW;
END $function$;

-- Called when a request has been sent, with its people added: approve it if
-- it is inside the terms. The approval is made as the system (nobody signed
-- in, signed "Kuncho (automatic)"), so the record does not say the person
-- asking approved their own request. If anything about approving fails, the
-- request simply stays waiting for a person.
CREATE OR REPLACE FUNCTION public.labour_request_auto_approve(p_req uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE r labor_requisitions%ROWTYPE; t record; v_claims text; v_sub text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  SELECT * INTO r FROM labor_requisitions WHERE id = p_req FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT (r.requested_by = auth.uid() OR manages_project(r.project_id)
          OR COALESCE(get_user_role()::text IN ('admin', 'operations_manager', 'hr_officer'), false) OR is_ops_manager()) THEN
    RAISE EXCEPTION 'This is not your request';
  END IF;
  IF r.status <> 'pending' THEN RETURN jsonb_build_object('approved', false, 'why', 'it is not waiting for approval'); END IF;
  SELECT x.ok, x.why INTO t FROM labour_request_terms(p_req) x;
  IF NOT t.ok THEN RETURN jsonb_build_object('approved', false, 'why', t.why); END IF;

  v_claims := current_setting('request.jwt.claims', true);
  v_sub := current_setting('request.jwt.claim.sub', true);
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('kuncho.bot_name', 'Kuncho (automatic)', true);
    PERFORM set_config('kuncho.labour_terms_ok', p_req::text, true);
    UPDATE labor_requisitions SET status = 'approved', decision_note = 'Approved automatically: ' || t.why WHERE id = p_req;
    PERFORM set_config('kuncho.labour_terms_ok', '', true);
    PERFORM set_config('kuncho.bot_name', '', true);
    PERFORM set_config('request.jwt.claim.sub', COALESCE(v_sub, ''), true);
    PERFORM set_config('request.jwt.claims', COALESCE(v_claims, ''), true);
  EXCEPTION WHEN OTHERS THEN
    -- Everything set inside this block is undone with it.
    RETURN jsonb_build_object('approved', false, 'why', 'it could not be approved automatically (' || SQLERRM || ')');
  END;
  RETURN jsonb_build_object('approved', true, 'why', t.why);
END $f$;
REVOKE EXECUTE ON FUNCTION public.labour_request_auto_approve(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_request_auto_approve(uuid) TO authenticated;

-- The standing crew: a change that asks for no more people of any trade than
-- the crew approved before it needs no approval. Fewer people, other days or
-- another end date are the site manager's to decide.
CREATE OR REPLACE FUNCTION public.labour_crew_auto_approve(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE r labour_day_requests%ROWTYPE; v_prev uuid; v_more text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  SELECT * INTO r FROM labour_day_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT labour_day_can_run(r.pm_staff_id) THEN RAISE EXCEPTION 'This is not your crew'; END IF;
  IF r.status <> 'submitted' THEN RETURN jsonb_build_object('approved', false, 'why', 'it is not waiting for approval'); END IF;
  IF NOT COALESCE((SELECT auto_approve FROM labour_terms_settings WHERE id), false) THEN
    RETURN jsonb_build_object('approved', false, 'why', 'every request is approved by a person');
  END IF;
  IF r.work_date <= bot_today() THEN RETURN jsonb_build_object('approved', false, 'why', 'its first day has already started'); END IF;
  SELECT p.id INTO v_prev FROM labour_day_requests p
   WHERE p.pm_staff_id = r.pm_staff_id AND p.status = 'approved' AND p.id <> r.id AND p.work_date <= r.work_date
     AND EXISTS (SELECT 1 FROM labour_day_request_lines l WHERE l.request_id = p.id)
   ORDER BY p.work_date DESC, p.decided_at DESC NULLS LAST LIMIT 1;
  IF v_prev IS NULL THEN RETURN jsonb_build_object('approved', false, 'why', 'no crew has been approved for you before'); END IF;
  SELECT string_agg(l.trade_tag::text || ': ' || l.headcount || ' (' || COALESCE(o.headcount, 0) || ' approved)', ', ') INTO v_more
    FROM labour_day_request_lines l
    LEFT JOIN labour_day_request_lines o ON o.request_id = v_prev AND o.trade_tag IS NOT DISTINCT FROM l.trade_tag
   WHERE l.request_id = r.id AND l.headcount > COALESCE(o.headcount, 0);
  IF v_more IS NOT NULL THEN RETURN jsonb_build_object('approved', false, 'why', 'it asks for more people than the crew approved before: ' || v_more); END IF;
  UPDATE labour_day_requests SET status = 'approved', decided_by = NULL, decided_by_name = 'Kuncho (automatic)', decided_at = now(),
         decision_note = 'Approved automatically: no more people than the crew already approved', updated_at = now()
   WHERE id = r.id;
  RETURN jsonb_build_object('approved', true, 'why', 'it asks for no more people than the crew already approved');
END $f$;
REVOKE EXECUTE ON FUNCTION public.labour_crew_auto_approve(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_crew_auto_approve(uuid) TO authenticated;
