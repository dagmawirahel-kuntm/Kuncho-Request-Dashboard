-- ============================================================
-- Schedule foundation (PR 9b of the BOQ/Schedule/Progress/Milestones
-- series), migration group (a) of 4. Builds on PR 9a (boqs,
-- boq_items — live and security-hardened as of 212-215). Additive
-- only; does not touch any boq* table.
--
-- Two deliberate deviations from the literal prompt, both flagged to
-- the user before this migration was written:
--
--   1. The three working-day calendar functions (is_working_day,
--      add_working_days, working_days_between — "Part 2" / item 44
--      group (b) in the prompt) are included HERE, not in the next
--      migration. sync_task_dates_and_duration's body calls them, so
--      group (b)'s functions have to exist before group (a)'s own
--      trigger can be created and verified. The dependency chain
--      that never was.
--
--   2. All four new tables get ENABLE ROW LEVEL SECURITY with ZERO
--      policies attached, even though the prompt's item 44 scopes
--      actual RLS policy authorship to group (c). This project's
--      default privileges auto-grant anon full arwdDxtm (select,
--      insert, update, delete, ...) on every new public-schema table
--      at creation time — confirmed via pg_default_acl before writing
--      this file. Without RLS enabled now, these four tables would
--      sit fully open (not just readable — writable) to unauthenticated
--      callers for the entire pause between this migration and group
--      (c). RLS-enabled-with-no-policies denies all access to every
--      non-owner role, so the tables are inert and safe to sit through
--      the pause; the actual policy bodies still land in group (c),
--      exactly where the prompt put them.
--
-- Convention adopted for duration math (not stated explicitly in the
-- prompt, so documented here for review): both current_start_date and
-- current_end_date are INCLUSIVE working days that count toward
-- duration — i.e. a 1-day task starts and ends on the same date, and
-- add_working_days(start, N) returns the Nth working day counting
-- start itself as day 1 (if start isn't a working day, it advances to
-- the first one first). working_days_between is its inverse: the
-- working-day count from start to end, both inclusive. This is the
-- standard construction-scheduling convention (matches MS
-- Project/Primavera semantics). Flag if a different convention was
-- intended.
-- ============================================================

SET search_path TO public;

-- ── schedules ────────────────────────────────────────────────────
CREATE TABLE schedules (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                  UUID NOT NULL REFERENCES projects(id),
  boq_id                      UUID REFERENCES boqs(id),
  title                       TEXT NOT NULL,
  status                      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'completed')),
  non_working_weekdays        INT[] NOT NULL DEFAULT '{0}',
  owner_pm_staff_id           UUID NOT NULL REFERENCES staff(id),
  baseline_locked_at          TIMESTAMPTZ,
  baseline_locked_by_staff_id UUID REFERENCES staff(id),
  created_by_staff_id         UUID REFERENCES staff(id),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active (non-completed) schedule per project at a time — same
-- partial-unique-index pattern as PR 9a's one_approved_boq_per_project.
CREATE UNIQUE INDEX one_active_schedule_per_project ON schedules (project_id) WHERE status <> 'completed';

CREATE INDEX idx_schedules_project ON schedules(project_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
-- No policies yet — deliberately inert until group (c). See header note.

-- ── calendar_holidays ────────────────────────────────────────────
CREATE TABLE calendar_holidays (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date           DATE NOT NULL,
  name                   TEXT NOT NULL,
  applies_to_project_id  UUID REFERENCES projects(id),
  created_by_staff_id    UUID REFERENCES staff(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (holiday_date, applies_to_project_id)
);

CREATE INDEX idx_calendar_holidays_date ON calendar_holidays(holiday_date);

ALTER TABLE calendar_holidays ENABLE ROW LEVEL SECURITY;
-- No policies yet — deliberately inert until group (c). See header note.

-- ── schedule_tasks ───────────────────────────────────────────────
CREATE TABLE schedule_tasks (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id             UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  parent_task_id          UUID REFERENCES schedule_tasks(id) ON DELETE CASCADE,
  predecessor_task_id     UUID REFERENCES schedule_tasks(id),
  lag_days                INT NOT NULL DEFAULT 0,
  display_order           INT NOT NULL,
  title                   TEXT NOT NULL,
  notes                   TEXT,
  planned_start_date      DATE,
  planned_end_date        DATE,
  planned_duration_days   INT,
  current_start_date      DATE NOT NULL,
  current_end_date        DATE NOT NULL,
  current_duration_days   INT NOT NULL CHECK (current_duration_days > 0),
  actual_start_date       DATE,
  actual_end_date         DATE,
  status                  TEXT NOT NULL DEFAULT 'not_started'
                            CHECK (status IN ('not_started', 'in_progress', 'completed', 'blocked', 'on_hold')),
  auto_cascade            BOOLEAN NOT NULL DEFAULT true,
  created_by_staff_id     UUID REFERENCES staff(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_schedule_tasks_schedule ON schedule_tasks(schedule_id, display_order);
CREATE INDEX idx_schedule_tasks_parent ON schedule_tasks(parent_task_id);
CREATE INDEX idx_schedule_tasks_predecessor ON schedule_tasks(predecessor_task_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON schedule_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE schedule_tasks ENABLE ROW LEVEL SECURITY;
-- No policies yet — deliberately inert until group (c). See header note.

-- ── schedule_task_boq_items ──────────────────────────────────────
CREATE TABLE schedule_task_boq_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_task_id    UUID NOT NULL REFERENCES schedule_tasks(id) ON DELETE CASCADE,
  boq_item_id         UUID NOT NULL REFERENCES boq_items(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (schedule_task_id, boq_item_id)
);

CREATE INDEX idx_schedule_task_boq_items_task ON schedule_task_boq_items(schedule_task_id);
CREATE INDEX idx_schedule_task_boq_items_item ON schedule_task_boq_items(boq_item_id);

ALTER TABLE schedule_task_boq_items ENABLE ROW LEVEL SECURITY;
-- No policies yet — deliberately inert until group (c). See header note.

-- ════════════════════════════════════════════════════════════════
-- Working-day calendar math (prompt's "Part 2" / item 44 group (b) —
-- pulled forward; see header note #1)
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION is_working_day(p_date DATE, p_schedule_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_non_working INT[];
  v_project_id  UUID;
  v_dow         INT;
BEGIN
  SELECT non_working_weekdays, project_id INTO v_non_working, v_project_id
  FROM schedules WHERE id = p_schedule_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Schedule % not found', p_schedule_id;
  END IF;

  v_dow := EXTRACT(DOW FROM p_date)::INT;
  IF v_dow = ANY(v_non_working) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM calendar_holidays
    WHERE holiday_date = p_date
      AND (applies_to_project_id IS NULL OR applies_to_project_id = v_project_id)
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

-- Inclusive convention: returns the Nth working day counting
-- p_start_date itself as day 1 (advancing to the first working day
-- first, if p_start_date isn't one). p_num_days must be >= 1 — every
-- schedule_tasks row has current_duration_days > 0 by CHECK constraint,
-- so this is never called with a non-positive value from that trigger.
CREATE OR REPLACE FUNCTION add_working_days(p_start_date DATE, p_num_days INT, p_schedule_id UUID)
RETURNS DATE LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_date      DATE := p_start_date;
  v_remaining INT;
BEGIN
  IF p_num_days IS NULL OR p_num_days < 1 THEN
    RAISE EXCEPTION 'add_working_days requires p_num_days >= 1, got %', p_num_days;
  END IF;

  WHILE NOT is_working_day(v_date, p_schedule_id) LOOP
    v_date := v_date + 1;
  END LOOP;

  v_remaining := p_num_days - 1;
  WHILE v_remaining > 0 LOOP
    v_date := v_date + 1;
    IF is_working_day(v_date, p_schedule_id) THEN
      v_remaining := v_remaining - 1;
    END IF;
  END LOOP;

  RETURN v_date;
END;
$$;

-- Inverse of add_working_days: working-day count from p_start_date to
-- p_end_date, both inclusive.
CREATE OR REPLACE FUNCTION working_days_between(p_start_date DATE, p_end_date DATE, p_schedule_id UUID)
RETURNS INT LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_date  DATE := p_start_date;
  v_count INT := 0;
BEGIN
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'working_days_between: end date (%) is before start date (%)', p_end_date, p_start_date;
  END IF;

  WHILE v_date <= p_end_date LOOP
    IF is_working_day(v_date, p_schedule_id) THEN
      v_count := v_count + 1;
    END IF;
    v_date := v_date + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ════════════════════════════════════════════════════════════════
-- Sync trigger: keeps current_end_date and current_duration_days
-- consistent with each other and with current_start_date, whichever
-- one the caller actually edited.
-- ════════════════════════════════════════════════════════════════

-- On INSERT, current_duration_days is authoritative — current_end_date
-- is always (re)derived from current_start_date + current_duration_days,
-- regardless of what was submitted. On UPDATE, whichever of
-- current_duration_days / current_end_date actually changed wins; if
-- current_start_date changes alone (neither of those two touched),
-- current_duration_days is preserved and current_end_date is
-- recomputed from it — this is exactly what the future cascade
-- trigger (group (b)) depends on when it pushes a successor's start
-- date forward without altering its planned duration. If both
-- current_duration_days and current_end_date change in the same
-- UPDATE, current_end_date wins (duration is re-derived from it) —
-- documented precedence, not an unstated default.
--
-- Depth guard: at nested trigger depth (pg_trigger_depth() > 1) this
-- is a no-op. The only source of nested UPDATEs on this table is the
-- future cascade trigger (group (b)), which sets current_start_date
-- and current_end_date explicitly and consistently itself — this
-- trigger re-deriving on top of that would be redundant at best and
-- could fight the cascade's own computation at worst.
CREATE OR REPLACE FUNCTION sync_task_dates_and_duration()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.current_end_date := add_working_days(NEW.current_start_date, NEW.current_duration_days, NEW.schedule_id);
    RETURN NEW;
  END IF;

  IF NEW.current_end_date IS DISTINCT FROM OLD.current_end_date THEN
    NEW.current_duration_days := working_days_between(NEW.current_start_date, NEW.current_end_date, NEW.schedule_id);
  ELSIF NEW.current_duration_days IS DISTINCT FROM OLD.current_duration_days THEN
    NEW.current_end_date := add_working_days(NEW.current_start_date, NEW.current_duration_days, NEW.schedule_id);
  ELSIF NEW.current_start_date IS DISTINCT FROM OLD.current_start_date THEN
    NEW.current_end_date := add_working_days(NEW.current_start_date, NEW.current_duration_days, NEW.schedule_id);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_task_dates_and_duration
  BEFORE INSERT OR UPDATE ON schedule_tasks
  FOR EACH ROW EXECUTE FUNCTION sync_task_dates_and_duration();

-- ════════════════════════════════════════════════════════════════
-- Cycle prevention on predecessor_task_id — same walk-the-chain
-- pattern as PR 9a's prevent_boq_item_cycles.
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION prevent_predecessor_cycles()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_current UUID;
BEGIN
  IF NEW.predecessor_task_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.predecessor_task_id = NEW.id THEN
    RAISE EXCEPTION 'A schedule task cannot be its own predecessor';
  END IF;
  v_current := NEW.predecessor_task_id;
  WHILE v_current IS NOT NULL LOOP
    IF v_current = NEW.id THEN
      RAISE EXCEPTION 'This change would create a cycle in the task dependency chain';
    END IF;
    SELECT predecessor_task_id INTO v_current FROM schedule_tasks WHERE id = v_current;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_predecessor_cycles
  BEFORE INSERT OR UPDATE OF predecessor_task_id ON schedule_tasks
  FOR EACH ROW
  WHEN (NEW.predecessor_task_id IS NOT NULL)
  EXECUTE FUNCTION prevent_predecessor_cycles();

-- Verify.
SELECT tablename FROM pg_tables WHERE tablename IN ('schedules', 'calendar_holidays', 'schedule_tasks', 'schedule_task_boq_items');
