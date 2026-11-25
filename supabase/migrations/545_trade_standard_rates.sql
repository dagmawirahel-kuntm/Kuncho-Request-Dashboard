-- 545 — a trade has one standard day rate; more only by an approved raise
--
-- A worker's day rate was typed in per worker, so masons were on anything from
-- 300 to 1500. Now the trade carries the price (Mason 1300) on every project.
-- A worker is paid above it only through a raise request that admin or
-- operations approved; never below it.
--
--   tier2_trade_roster.day_rate         the trade's standard (NULL: no standard
--                                       yet — workers keep their own rate)
--   worker_rate_raises                  asked → approved / rejected; an approved
--                                       raise holds until it is ended
--   staff.day_rate                      kept equal to GREATEST(standard, approved
--                                       raise) by a trigger, so pay reads it as
--                                       before
--   worker_set_day_rate(staff, rate)    asks for a raise (approved at once when
--                                       admin or operations ask); for a trade
--                                       with no standard, sets it as before
--   labour_rate_raise_decide / _end     admin or operations
--   labour_trade_set_rate(trade, rate)  admin or operations

ALTER TABLE public.tier2_trade_roster
  ADD COLUMN IF NOT EXISTS day_rate numeric CHECK (day_rate IS NULL OR day_rate > 0),
  ADD COLUMN IF NOT EXISTS rate_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS rate_set_by_name text;

CREATE TABLE IF NOT EXISTS public.worker_rate_raises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  rate numeric NOT NULL CHECK (rate > 0),
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'ended')),
  requested_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  requested_by_name text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text
);
CREATE UNIQUE INDEX IF NOT EXISTS worker_rate_raises_one_pending ON public.worker_rate_raises (staff_id) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS worker_rate_raises_one_approved ON public.worker_rate_raises (staff_id) WHERE status = 'approved';
ALTER TABLE public.worker_rate_raises ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS worker_rate_raises_read ON public.worker_rate_raises;
CREATE POLICY worker_rate_raises_read ON public.worker_rate_raises FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.labour_rate_approver()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT COALESCE(get_user_role()::text IN ('admin', 'operations_manager'), false) OR COALESCE(is_ops_manager(), false);
$f$;

-- ── staff.day_rate follows the standard and the approved raise ──
CREATE OR REPLACE FUNCTION public.trg_staff_standard_rate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_std numeric; v_raise numeric;
BEGIN
  IF NEW.employment_type IS DISTINCT FROM 'tier_2_casual' OR NEW.trade_tag IS NULL THEN RETURN NEW; END IF;
  SELECT t.day_rate INTO v_std FROM tier2_trade_roster t WHERE t.trade_tag = NEW.trade_tag;
  IF v_std IS NULL THEN RETURN NEW; END IF;
  SELECT r.rate INTO v_raise FROM worker_rate_raises r WHERE r.staff_id = NEW.id AND r.status = 'approved';
  NEW.day_rate := GREATEST(v_std, COALESCE(v_raise, 0));
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS trg_staff_standard_rate ON public.staff;
CREATE TRIGGER trg_staff_standard_rate BEFORE INSERT OR UPDATE OF day_rate, trade_tag, employment_type ON public.staff
  FOR EACH ROW EXECUTE FUNCTION public.trg_staff_standard_rate();

-- A trade's standard changes only through admin or operations, and its workers follow.
CREATE OR REPLACE FUNCTION public.trg_trade_rate_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF NEW.day_rate IS DISTINCT FROM OLD.day_rate AND auth.uid() IS NOT NULL AND NOT labour_rate_approver() THEN
    RAISE EXCEPTION 'Only admin or operations change a trade''s standard rate';
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS trg_trade_rate_guard ON public.tier2_trade_roster;
CREATE TRIGGER trg_trade_rate_guard BEFORE UPDATE OF day_rate ON public.tier2_trade_roster
  FOR EACH ROW EXECUTE FUNCTION public.trg_trade_rate_guard();

CREATE OR REPLACE FUNCTION public.trg_trade_rate_follow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF NEW.day_rate IS DISTINCT FROM OLD.day_rate THEN
    UPDATE staff SET day_rate = day_rate WHERE trade_tag = NEW.trade_tag AND employment_type = 'tier_2_casual';
  END IF;
  RETURN NULL;
END $f$;
DROP TRIGGER IF EXISTS trg_trade_rate_follow ON public.tier2_trade_roster;
CREATE TRIGGER trg_trade_rate_follow AFTER UPDATE OF day_rate ON public.tier2_trade_roster
  FOR EACH ROW EXECUTE FUNCTION public.trg_trade_rate_follow();

-- ── Set a trade's standard ──
CREATE OR REPLACE FUNCTION public.labour_trade_set_rate(p_trade text, p_rate numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF NOT labour_rate_approver() THEN RAISE EXCEPTION 'Only admin or operations change a trade''s standard rate'; END IF;
  IF p_rate IS NOT NULL AND p_rate <= 0 THEN RAISE EXCEPTION 'A day rate is more than 0'; END IF;
  UPDATE tier2_trade_roster SET day_rate = p_rate, rate_set_at = now(),
         rate_set_by_name = (SELECT full_name FROM user_profiles WHERE id = auth.uid())
   WHERE trade_tag = p_trade;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trade not found'; END IF;
END $f$;

-- ── A worker's rate: a raise request, or (no standard) set as before ──
DROP FUNCTION IF EXISTS public.worker_set_day_rate(uuid, numeric);
CREATE OR REPLACE FUNCTION public.worker_set_day_rate(p_staff uuid, p_rate numeric, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  s staff%ROWTYPE; v_std numeric; v_id uuid;
  v_name text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF COALESCE(p_rate, 0) <= 0 THEN RAISE EXCEPTION 'A day rate is more than 0'; END IF;
  SELECT * INTO s FROM staff WHERE id = p_staff AND employment_type = 'tier_2_casual';
  IF s.id IS NULL THEN RAISE EXCEPTION 'Casual worker not found'; END IF;
  SELECT t.day_rate INTO v_std FROM tier2_trade_roster t WHERE t.trade_tag = s.trade_tag;

  IF v_std IS NULL THEN
    IF COALESCE(get_user_role()::text, '') NOT IN ('admin', 'hr_officer') AND NOT labour_rate_approver() THEN
      RAISE EXCEPTION 'HR or operations set the day rate of a trade with no standard rate';
    END IF;
    UPDATE staff SET day_rate = p_rate, updated_at = now() WHERE id = p_staff;
    RETURN jsonb_build_object('status', 'set', 'rate', p_rate);
  END IF;

  IF p_rate <= v_std THEN
    -- Back to the standard: only by ending an approved raise.
    IF NOT labour_rate_approver() THEN RAISE EXCEPTION '% is the standard for %s — a worker isn''t paid below it', v_std, s.trade_tag; END IF;
    UPDATE worker_rate_raises SET status = 'ended', decided_by = auth.uid(), decided_by_name = v_name, decided_at = now(),
           decision_note = COALESCE(NULLIF(btrim(p_reason), ''), 'Back to the standard rate')
     WHERE staff_id = p_staff AND status = 'approved';
    UPDATE worker_rate_raises SET status = 'rejected', decided_by = auth.uid(), decided_by_name = v_name, decided_at = now(),
           decision_note = 'Back to the standard rate'
     WHERE staff_id = p_staff AND status = 'pending';
    UPDATE staff SET day_rate = day_rate WHERE id = p_staff;
    RETURN jsonb_build_object('status', 'standard', 'rate', v_std);
  END IF;

  -- Above the standard: a raise request, approved at once when admin or operations ask.
  UPDATE worker_rate_raises SET status = 'rejected', decided_by = auth.uid(), decided_by_name = v_name, decided_at = now(),
         decision_note = 'Replaced by a new request'
   WHERE staff_id = p_staff AND status = 'pending';
  INSERT INTO worker_rate_raises (staff_id, rate, reason, requested_by, requested_by_name)
  VALUES (p_staff, p_rate, NULLIF(btrim(p_reason), ''), auth.uid(), v_name) RETURNING id INTO v_id;
  IF labour_rate_approver() THEN
    PERFORM labour_rate_raise_decide(v_id, true, NULL);
    RETURN jsonb_build_object('status', 'approved', 'rate', p_rate, 'id', v_id);
  END IF;
  RETURN jsonb_build_object('status', 'requested', 'rate', p_rate, 'standard', v_std, 'id', v_id);
END $f$;

CREATE OR REPLACE FUNCTION public.labour_rate_raise_decide(p_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE r worker_rate_raises%ROWTYPE; v_name text := (SELECT full_name FROM user_profiles WHERE id = auth.uid());
BEGIN
  IF NOT labour_rate_approver() THEN RAISE EXCEPTION 'Only admin or operations approve a raise'; END IF;
  SELECT * INTO r FROM worker_rate_raises WHERE id = p_id FOR UPDATE;
  IF r.id IS NULL OR r.status <> 'pending' THEN RAISE EXCEPTION 'This request is already decided — refresh'; END IF;
  IF NOT p_approve AND NULLIF(btrim(p_note), '') IS NULL THEN RAISE EXCEPTION 'Say why the raise is refused'; END IF;
  IF p_approve THEN
    UPDATE worker_rate_raises SET status = 'ended', decided_by = auth.uid(), decided_by_name = v_name, decided_at = now(),
           decision_note = 'Replaced by a new raise'
     WHERE staff_id = r.staff_id AND status = 'approved';
  END IF;
  UPDATE worker_rate_raises SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         decided_by = auth.uid(), decided_by_name = v_name, decided_at = now(), decision_note = NULLIF(btrim(p_note), '')
   WHERE id = p_id;
  UPDATE staff SET day_rate = day_rate WHERE id = r.staff_id;
END $f$;

CREATE OR REPLACE FUNCTION public.labour_rate_raise_end(p_id uuid, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE r worker_rate_raises%ROWTYPE;
BEGIN
  IF NOT labour_rate_approver() THEN RAISE EXCEPTION 'Only admin or operations end a raise'; END IF;
  UPDATE worker_rate_raises SET status = 'ended', decided_by = auth.uid(),
         decided_by_name = (SELECT full_name FROM user_profiles WHERE id = auth.uid()), decided_at = now(),
         decision_note = COALESCE(NULLIF(btrim(p_note), ''), 'Back to the standard rate')
   WHERE id = p_id AND status = 'approved' RETURNING * INTO r;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Raise not found — refresh'; END IF;
  UPDATE staff SET day_rate = day_rate WHERE id = r.staff_id;
END $f$;

-- ── Starting standards: the rate most workers of the trade are on ──
CREATE TEMP TABLE start_rates (trade text PRIMARY KEY, rate numeric) ON COMMIT DROP;
INSERT INTO start_rates VALUES ('mason', 1300), ('laborer', 800), ('cleaner', 700), ('chiseler', 1300);

-- First, workers on more than their trade's standard keep it, as a raise already approved.
INSERT INTO public.worker_rate_raises (staff_id, rate, reason, status, requested_by_name, decided_by_name, decided_at)
SELECT s.id, s.day_rate, 'Their rate before standard rates', 'approved', 'Kuncho', 'Kept when standard rates started (545)', now()
  FROM public.staff s JOIN start_rates v ON v.trade = s.trade_tag
 WHERE s.employment_type = 'tier_2_casual' AND s.day_rate > v.rate
   AND NOT EXISTS (SELECT 1 FROM public.worker_rate_raises r WHERE r.staff_id = s.id AND r.status = 'approved');

-- Then the standards; their workers follow (standard, or their raise).
UPDATE public.tier2_trade_roster t SET day_rate = v.rate, rate_set_at = now(), rate_set_by_name = 'Set from the usual rate (545)'
  FROM start_rates v WHERE t.trade_tag = v.trade;

REVOKE EXECUTE ON FUNCTION public.labour_rate_approver() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trg_staff_standard_rate() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_trade_rate_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_trade_rate_follow() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.labour_trade_set_rate(text, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.worker_set_day_rate(uuid, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.labour_rate_raise_decide(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.labour_rate_raise_end(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_rate_approver() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.labour_trade_set_rate(text, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.worker_set_day_rate(uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.labour_rate_raise_decide(uuid, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.labour_rate_raise_end(uuid, text) TO authenticated, service_role;
