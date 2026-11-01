-- 495: the day-sheet checks on labour requests and recorded work (489, 492)
-- run with the function owner's rights, like the other labour functions.
-- They read the start date and today's date, which signed-in users can't call
-- directly: once the start date was set, asking for a piece-work job failed
-- with "permission denied for function bot_today". Also points the day-rate
-- refusal at the crew request and week sheet.
ALTER FUNCTION public.trg_work_entry_day_rate_moved() SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.trg_labour_request_day_rate_moved()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_start date := (SELECT starts_on FROM labour_day_settings WHERE id);
BEGIN
  IF v_start IS NOT NULL AND NEW.payment_basis = 'per_day' AND NEW.payment_model = 'individual'
     AND COALESCE(NEW.start_date, bot_today()) >= v_start THEN
    RAISE EXCEPTION 'From %, day-rate workers are asked for in your crew request (Labour → Crew request) and recorded on the week sheet. Here: jobs by volume, a fixed price or a crew leader.',
      to_char(v_start, 'DD Mon YYYY');
  END IF;
  IF (SELECT costing_closed_at FROM projects WHERE id = NEW.project_id) IS NOT NULL THEN
    RAISE EXCEPTION 'Costing on this project is closed — no more labour can go to it';
  END IF;
  RETURN NEW;
END $f$;
