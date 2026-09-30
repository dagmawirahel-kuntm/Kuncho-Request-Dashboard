-- 381 — Dashboard progress: "cleared today" and the clear-queue streak
--
-- The dashboard counts what's waiting on a person (approvals, payments,
-- bank lines…). Each time it loads that count it reports it here, and gets
-- back how the day is going:
--
--   waiting  what's waiting now
--   cleared  how much the count has come down today — every drop between
--            one look and the next adds to it; new work arriving doesn't
--            take it away. Work cleared by a colleague counts too: it's the
--            queue's progress, not a personal score.
--   streak   working days in a row on which the queue reached zero. Days
--            with no dashboard visit (weekends, leave) are skipped, not
--            breaks; today counts once it reaches zero.
--
-- Days are Addis Ababa days. The count comes from the person's own
-- browser, so this is encouragement, not a performance record — nothing
-- else reads it.

SET search_path TO public;

CREATE TABLE IF NOT EXISTS dashboard_progress (
  user_id      uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  day          date NOT NULL,
  waiting      int  NOT NULL DEFAULT 0 CHECK (waiting >= 0),
  cleared      int  NOT NULL DEFAULT 0 CHECK (cleared >= 0),
  reached_zero boolean NOT NULL DEFAULT false,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

ALTER TABLE dashboard_progress ENABLE ROW LEVEL SECURITY;

-- Read your own; writes go through record_dashboard_progress().
DROP POLICY IF EXISTS dashboard_progress_own ON dashboard_progress;
CREATE POLICY dashboard_progress_own ON dashboard_progress FOR SELECT
  USING (user_id = auth.uid());

REVOKE ALL ON dashboard_progress FROM anon;
GRANT SELECT ON dashboard_progress TO authenticated;

CREATE OR REPLACE FUNCTION public.record_dashboard_progress(p_waiting int)
RETURNS TABLE (waiting int, cleared int, streak int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
#variable_conflict use_column
DECLARE
  v_uid    uuid := auth.uid();
  v_day    date := (now() AT TIME ZONE 'Africa/Addis_Ababa')::date;
  v_now    int  := LEAST(GREATEST(COALESCE(p_waiting, 0), 0), 100000);
  v_row    dashboard_progress%ROWTYPE;
  v_streak int := 0;
  r        record;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  INSERT INTO dashboard_progress AS p (user_id, day, waiting, cleared, reached_zero)
  VALUES (v_uid, v_day, v_now, 0, v_now = 0)
  ON CONFLICT (user_id, day) DO UPDATE
     SET cleared      = p.cleared + GREATEST(p.waiting - EXCLUDED.waiting, 0),
         waiting      = EXCLUDED.waiting,
         reached_zero = p.reached_zero OR EXCLUDED.waiting = 0,
         updated_at   = now()
  RETURNING * INTO v_row;

  -- Count back from today (or yesterday, while today isn't clear yet).
  FOR r IN
    SELECT dp.day, dp.reached_zero FROM dashboard_progress dp
     WHERE dp.user_id = v_uid AND dp.day <= v_day
     ORDER BY dp.day DESC
     LIMIT 400
  LOOP
    IF r.day = v_day AND NOT r.reached_zero THEN CONTINUE; END IF;
    EXIT WHEN NOT r.reached_zero;
    v_streak := v_streak + 1;
  END LOOP;

  RETURN QUERY SELECT v_row.waiting, v_row.cleared, v_streak;
END $function$;

REVOKE EXECUTE ON FUNCTION record_dashboard_progress(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION record_dashboard_progress(int) TO authenticated;
