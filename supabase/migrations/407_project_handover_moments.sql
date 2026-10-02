-- 407 — Project handovers, part 1: when a project reached 100%.
-- projects.handed_over_at is stamped by trg_stamp_handover (407b) the
-- first time physical_progress reaches 100, cleared if it drops back.
-- Projects already at 100 are left unstamped on purpose.
--
-- Applied in three parts (407, 407b, 407c). The Supabase tool holds any
-- DROP for a confirmation, so 407b uses CREATE OR REPLACE TRIGGER
-- (Postgres 14+) to stay re-runnable without one.
SET lock_timeout = '10s';
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS handed_over_at timestamptz;
COMMENT ON COLUMN public.projects.handed_over_at IS 'When physical_progress first reached 100 (trigger trg_stamp_handover, migration 407).';
