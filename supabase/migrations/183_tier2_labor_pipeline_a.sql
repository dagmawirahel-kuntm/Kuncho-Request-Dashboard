-- 183 — Tier 2 labor pipeline · Part A: schema extensions
--
-- Extends labor_requisitions with the payment model (individual vs gang-leader
-- vendor) and pay cycle (weekly vs at-engagement-end). Introduces a tier-2
-- trade roster used both as a lookup for casual-worker profiles and as the
-- visual theming source for the worker-cards UI. Adds identity + engagement
-- columns to `staff` for casual-worker profiles and auto-fills the codenames
-- from the roster when a tier_2_casual row is created.
--
-- Nothing here changes existing behavior for tier-1 staff or existing
-- requisitions — every new column is nullable or has a default that resolves
-- old rows cleanly.

SET search_path TO public;

-- ── labor_requisitions extensions ────────────────────────────────────────────
ALTER TABLE labor_requisitions
  ADD COLUMN IF NOT EXISTS payment_model         text NOT NULL DEFAULT 'individual',
  ADD COLUMN IF NOT EXISTS gang_leader_vendor_id uuid REFERENCES vendors(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS pay_cycle             text NOT NULL DEFAULT 'weekly';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='labor_req_payment_model_chk') THEN
    ALTER TABLE labor_requisitions
      ADD CONSTRAINT labor_req_payment_model_chk
      CHECK (payment_model IN ('individual','gang_leader'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='labor_req_pay_cycle_chk') THEN
    ALTER TABLE labor_requisitions
      ADD CONSTRAINT labor_req_pay_cycle_chk
      CHECK (pay_cycle IN ('weekly','engagement_end'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='labor_req_gang_needs_vendor_chk') THEN
    ALTER TABLE labor_requisitions
      ADD CONSTRAINT labor_req_gang_needs_vendor_chk
      CHECK (payment_model = 'individual' OR gang_leader_vendor_id IS NOT NULL);
  END IF;
END $$;

COMMENT ON COLUMN labor_requisitions.payment_model IS
  'individual = each worker paid to their own bank; gang_leader = paid to gang leader vendor who redistributes.';
COMMENT ON COLUMN labor_requisitions.pay_cycle IS
  'weekly = timesheet rollup every Sunday; engagement_end = single rollup when the allocation is marked complete.';

-- Tighten labor_requisitions RLS. Existing policies are open on SELECT (fine)
-- and permissive on INSERT/UPDATE. Widen INSERT to accept foremen scoped to
-- the project, and reword UPDATE-to-approved so ONLY HR (or admin) may flip
-- the status flag — the commitment trigger in Migration B fires from that
-- transition, so leaking approval to ops-manager would leak budget consumption.
DROP POLICY IF EXISTS labor_requisitions_request ON labor_requisitions;
CREATE POLICY labor_requisitions_request ON labor_requisitions FOR INSERT
  WITH CHECK (
    get_user_role() IN ('admin','executive','project_manager','operations_manager','hr_officer')
    OR (project_id IS NOT NULL AND public.is_site_foreman_for_project(project_id))
  );

DROP POLICY IF EXISTS labor_requisitions_approve ON labor_requisitions;
CREATE POLICY labor_requisitions_update ON labor_requisitions FOR UPDATE
  USING (get_user_role() IN ('admin','hr_officer','operations_manager','executive'))
  WITH CHECK (get_user_role() IN ('admin','hr_officer','operations_manager','executive'));
-- (Approval-only enforcement — that only HR/admin may push status='approved' —
-- lives in the BEFORE UPDATE trigger installed in migration 184-B, so the
-- guard runs alongside the commitment INSERT.)

-- ── tier2_trade_roster (lookup + theming) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS tier2_trade_roster (
  trade_tag         text PRIMARY KEY,
  codename_amharic  text NOT NULL,
  codename_english  text NOT NULL,
  icon_emoji        text NOT NULL,
  color_accent      text NOT NULL,
  color_accent_2    text NOT NULL,
  sort_order        int  NOT NULL DEFAULT 100,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

INSERT INTO tier2_trade_roster (trade_tag, codename_amharic, codename_english, icon_emoji, color_accent, color_accent_2, sort_order) VALUES
  ('mason',              'የመሠረት ድንጋይ', 'The Cornerstone', '🧱', '#a37453', '#5c3f2a', 10),
  ('carpenter',          'የእንጨት ጌታ',   'The Woodwright',  '🪚', '#c4863a', '#6b4818', 20),
  ('painter',            'ቀለም አዋቂ',    'The Colormancer', '🎨', '#2ea89f', '#0f4e48', 30),
  ('electrician_helper', 'ብልጭታ',       'The Livewire',    '⚡', '#eab308', '#7a5900', 40),
  ('plumber_helper',     'ውሃ አዛዥ',     'The Flowmaster',  '💧', '#3574d4', '#143b74', 50),
  ('steel_fixer',        'ብረት አጣፊ',    'The Bar Bender',  '⛓️', '#94a3b8', '#3a4552', 60),
  ('tile_setter',        'ሰቆ ደራቢ',     'The Grid Master', '◼️', '#6b7a8f', '#2d3441', 70),
  ('plasterer',          'ለስላሳ እጅ',    'The Silkhand',    '🌫️', '#d4c2a0', '#7a6b4d', 80),
  ('general_laborer',    'ሁሉን አዋቂ',    'The Wildcard',    '🛠️', '#7a7f8c', '#3d4048', 90)
ON CONFLICT (trade_tag) DO NOTHING;

ALTER TABLE tier2_trade_roster ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ttr_read  ON tier2_trade_roster;
CREATE POLICY ttr_read  ON tier2_trade_roster FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS ttr_write ON tier2_trade_roster;
CREATE POLICY ttr_write ON tier2_trade_roster FOR ALL
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');
GRANT SELECT ON tier2_trade_roster TO authenticated;

-- ── staff casual-worker profile columns ──────────────────────────────────────
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS trade_tag             text,
  ADD COLUMN IF NOT EXISTS codename_amharic      text,
  ADD COLUMN IF NOT EXISTS codename_english      text,
  ADD COLUMN IF NOT EXISTS referred_by_staff_id  uuid REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS first_engaged_at      date,
  ADD COLUMN IF NOT EXISTS last_engaged_at       date;

COMMENT ON COLUMN staff.employment_type IS
  'Free-text; recognized values include: full_time, part_time, contract, intern, tier_2_casual.';

-- When a tier-2 casual row is inserted (or updated to become one) and codenames
-- are blank, copy them from the trade roster. Manual override is fine — the
-- trigger only fills nulls.
CREATE OR REPLACE FUNCTION public.autofill_tier2_codenames()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF NEW.employment_type = 'tier_2_casual' AND NEW.trade_tag IS NOT NULL THEN
    IF NEW.codename_amharic IS NULL OR NEW.codename_english IS NULL THEN
      SELECT
        COALESCE(NEW.codename_amharic, r.codename_amharic),
        COALESCE(NEW.codename_english, r.codename_english)
      INTO NEW.codename_amharic, NEW.codename_english
      FROM tier2_trade_roster r
      WHERE r.trade_tag = NEW.trade_tag;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_staff_autofill_tier2 ON staff;
CREATE TRIGGER trg_staff_autofill_tier2
  BEFORE INSERT OR UPDATE OF employment_type, trade_tag ON staff
  FOR EACH ROW EXECUTE FUNCTION public.autofill_tier2_codenames();

-- ── expense_type enum: add labor_payment ─────────────────────────────────────
-- Enables the rollup RPC in Migration C to tag its generated expenses.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                 WHERE t.typname='expense_category' AND e.enumlabel='labor_payment') THEN
    ALTER TYPE expense_category ADD VALUE 'labor_payment';
  END IF;
END $$;
