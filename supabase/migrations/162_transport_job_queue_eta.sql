-- ============================================================
-- Per-vehicle queue ETA for transportation job orders.
--
-- expected_delivery_date already exists (a calendar date the requester
-- picks — "when do we need this by") but nothing computes when a
-- vehicle will actually be free to start the NEXT job. Only own_fleet
-- jobs compete for that: a specific vehicle_id is a single shared
-- resource that can run one job at a time; hired and ride-hailing jobs
-- use third-party/on-demand capacity and were never in contention for
-- anything of ours, so they are excluded from the queue entirely.
--
-- expected_duration_minutes is new and separate from
-- expected_delivery_date on purpose — a due date and "how long this
-- ties up the vehicle" are different facts, and conflating them would
-- have broken whatever already reads expected_delivery_date.
--
-- The queue is a simple chained estimate, not a live GPS ETA: for each
-- vehicle, active jobs (requested/assigned/in_progress) are ordered by
-- creation time; the first job's estimated start is NOW(), its
-- estimated finish is start + duration, and the next job's estimated
-- start is that finish — cascading down the line. This is exactly
-- "current time plus expected delivery time" for the job at the front
-- of the queue, and an estimate of when each job behind it gets picked
-- up.
--
-- A job with no duration set breaks the chain rather than being
-- treated as instantaneous (duration 0): silently assuming zero would
-- make every job behind it in the queue look like it starts sooner
-- than it will. estimated_start/estimated_finish are NULL for that job
-- and everything queued behind it on the same vehicle, and the UI says
-- so rather than showing a number that looks precise but isn't.
-- ============================================================

SET search_path TO public;

ALTER TABLE transportation_requests ADD COLUMN IF NOT EXISTS expected_duration_minutes INTEGER CHECK (expected_duration_minutes > 0);

COMMENT ON COLUMN transportation_requests.expected_duration_minutes IS
  'How long this job is expected to occupy the vehicle, in minutes. Feeds the per-vehicle queue ETA (v_transport_vehicle_queue) — distinct from expected_delivery_date, which is the requester''s target date, not a duration.';

CREATE OR REPLACE VIEW v_transport_vehicle_queue
WITH (security_invoker = true) AS
WITH active_jobs AS (
  SELECT
    tr.id, tr.vehicle_id, tr.request_name, tr.job_type, tr.job_status,
    tr.expected_duration_minutes, tr.created_at, tr.priority,
    ROW_NUMBER() OVER (PARTITION BY tr.vehicle_id ORDER BY tr.created_at) AS queue_position
  FROM transportation_requests tr
  WHERE tr.transport_mode = 'own_fleet'
    AND tr.vehicle_id IS NOT NULL
    AND tr.job_status IN ('requested', 'assigned', 'in_progress')
),
chained AS (
  SELECT
    *,
    -- bool_and over the window: false the moment any prior job in this
    -- vehicle's queue (including this one) has no duration, so a gap
    -- poisons every estimate behind it rather than silently zeroing it.
    bool_and(expected_duration_minutes IS NOT NULL) OVER (
      PARTITION BY vehicle_id ORDER BY queue_position
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS chain_intact,
    SUM(COALESCE(expected_duration_minutes, 0)) OVER (
      PARTITION BY vehicle_id ORDER BY queue_position
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ) AS minutes_ahead
  FROM active_jobs
)
SELECT
  c.id, c.vehicle_id, v.name AS vehicle_name, c.request_name, c.job_type, c.job_status,
  c.priority, c.queue_position, c.expected_duration_minutes,
  CASE WHEN c.chain_intact THEN NOW() + (COALESCE(c.minutes_ahead, 0) || ' minutes')::interval END AS estimated_start,
  CASE WHEN c.chain_intact AND c.expected_duration_minutes IS NOT NULL
    THEN NOW() + ((COALESCE(c.minutes_ahead, 0) + c.expected_duration_minutes) || ' minutes')::interval
  END AS estimated_finish,
  c.chain_intact
FROM chained c
JOIN vehicles v ON v.id = c.vehicle_id
ORDER BY c.vehicle_id, c.queue_position;

GRANT SELECT ON v_transport_vehicle_queue TO authenticated;

-- ── Verify ──────────────────────────────────────────────────────────
SELECT count(*) AS new_col_expect_1 FROM information_schema.columns
WHERE table_name='transportation_requests' AND column_name='expected_duration_minutes';

-- Empty is expected today: no active own_fleet job currently has a
-- duration set, so there's nothing to chain yet.
SELECT * FROM v_transport_vehicle_queue;
