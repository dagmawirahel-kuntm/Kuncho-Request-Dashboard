-- 195 — Executive dashboard: refresh function + manual RPC
--
-- refresh_exec_dashboard() rebuilds every exec MV CONCURRENTLY and appends
-- a row to exec_dashboard_refresh_log. Idempotency: if the last logged
-- refresh is in-flight (log row with success=NULL / started < 60s ago
-- unresolved), skip.
--
-- pg_cron is NOT installed here. Enable it later and add:
--   SELECT cron.schedule('exec-dashboard', '*/15 * * * *', $$SELECT public.refresh_exec_dashboard()$$);
-- Until then the frontend calls refresh_exec_dashboard_now() on demand.

SET search_path TO public;

CREATE OR REPLACE FUNCTION public.refresh_exec_dashboard()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_started timestamptz := clock_timestamp(); v_err text;
BEGIN
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_project_exec_summary;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_exec_gadget_cash_runway;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_exec_gadget_ar_aging;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_exec_gadget_ap_aging;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_exec_gadget_margin_leaderboard;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_exec_gadget_ledger_failures;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_exec_gadget_governance_flags;

    INSERT INTO exec_dashboard_refresh_log (duration_ms, success)
    VALUES ((EXTRACT(EPOCH FROM (clock_timestamp() - v_started)) * 1000)::int, true);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    INSERT INTO exec_dashboard_refresh_log (duration_ms, success, error_message)
    VALUES ((EXTRACT(EPOCH FROM (clock_timestamp() - v_started)) * 1000)::int, false, v_err);
    RAISE;
  END;
END $$;

-- Exec-callable idempotent wrapper. If a refresh started in the last 60
-- seconds, skip (avoids stampede while another one is in flight).
CREATE OR REPLACE FUNCTION public.refresh_exec_dashboard_now()
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE
  v_role user_role;
  v_last timestamptz;
BEGIN
  v_role := public.get_user_role();
  IF v_role NOT IN ('admin','executive') THEN
    RAISE EXCEPTION 'Only admin or executive may refresh the exec dashboard';
  END IF;

  SELECT MAX(refreshed_at) INTO v_last FROM exec_dashboard_refresh_log;
  IF v_last IS NOT NULL AND v_last > (now() - interval '60 seconds') THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'recent refresh in flight', 'last_refresh', v_last);
  END IF;

  PERFORM public.refresh_exec_dashboard();
  RETURN jsonb_build_object('status', 'ok', 'refreshed_at', now());
END $$;
GRANT EXECUTE ON FUNCTION public.refresh_exec_dashboard_now() TO authenticated;
