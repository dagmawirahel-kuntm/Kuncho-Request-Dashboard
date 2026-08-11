-- ============================================================
-- Trainer hints: a lightweight, hard-coded next-step nudge shown on
-- entity detail pages, plus a global per-user off switch. There is
-- no hint-definitions table by design (per spec) — every hint is a
-- frontend pattern match on already-loaded entity state.
--
-- The toggle itself needs a write path. user_profiles has no
-- self-service UPDATE policy at all today (only own-row SELECT, plus
-- an admin-only ALL policy) — and it shouldn't get one here, since a
-- blanket self-UPDATE policy would let any user rewrite their own
-- `role` or other sensitive columns via a direct client update, not
-- just this one column. RLS policies can't be scoped to a single
-- column. So the write path is a SECURITY DEFINER RPC that only ever
-- touches trainer_hints_enabled on the caller's own row, instead of
-- a new broad policy.
-- ============================================================

SET search_path TO public;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS trainer_hints_enabled boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION set_trainer_hints_enabled(p_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE user_profiles SET trainer_hints_enabled = p_enabled WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION set_trainer_hints_enabled(boolean) TO authenticated;

-- Verify: column present, every existing user backfilled to true.
SELECT count(*) AS total, count(*) FILTER (WHERE trainer_hints_enabled) AS enabled_count FROM user_profiles;
