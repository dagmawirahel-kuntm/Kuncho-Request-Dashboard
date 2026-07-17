-- ============================================================
-- Fiscal-period tagging: a trigger-maintained fiscal_period_id label
-- on every transactional table that carries a genuine own date,
-- confirmed live against the database (see discovery notes in the
-- accompanying report -- min/max dates, RLS state, and the fact that
-- v_project_cost_group_budget / v_project_budget_summary contain zero
-- date filtering were all verified by reading the deployed database,
-- not assumed).
--
-- This is a LABEL, not a partition or a filter baked into any
-- existing query. Nothing is moved, nothing is hidden. The Phase 1/2
-- budgeting views and project_budgets are untouched by this
-- migration -- they keep aggregating a project's entire history
-- regardless of fiscal period, exactly as before.
--
-- Deliberately excluded, and why:
--   - tax_summary.month / payroll_taxes.payroll_month are TEXT
--     "YYYY-MM" period strings (HTML <input type="month">), not a
--     real DATE column -- tagging them needs a parsing decision this
--     migration doesn't make. Left for a follow-up.
--   - batch_payments / cpo_bonds have no transaction date of their
--     own at all (only created_at, a data-entry timestamp) -- a
--     fiscal tag for either would have to come from their linked
--     expenses, not their own row.
--   - opportunities.expected_close_date is a forward-looking
--     forecast, not a completed transaction -- tagging it with a
--     fiscal period would misrepresent a pipeline estimate as a
--     dated financial record, and the forecast date routinely moves
--     as deals slip. Left untagged.
--   - budget_variations, project_budgets, cost_groups,
--     categories.cost_group_id, budget_check_mode, budget_check_log
--     are the budgeting tables -- explicitly out of scope for this
--     migration, structure and data both untouched.
--
-- Approach: a shared STABLE lookup function + one small trigger
-- function per table (rather than a generated column, which can't
-- subquery fiscal_periods directly in Postgres, or a single dynamic-
-- SQL trigger, which would be harder to audit) -- matches this repo's
-- existing per-feature trigger style (expense_code generation, budget
-- locking, sale approval transitions, etc). BEFORE INSERT OR UPDATE
-- OF <date column> only, so editing an unrelated field never
-- recomputes the tag, but correcting the date itself always does --
-- exactly the "a September 2026 correction to a June 2026 expense
-- should still tag as FY2025/26" behavior this needs.
-- ============================================================

SET search_path TO public;

CREATE OR REPLACE FUNCTION fiscal_period_for_date(d DATE)
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT id FROM fiscal_periods WHERE d BETWEEN start_date AND end_date LIMIT 1
$$;

-- ── expenses.date ─────────────────────────────────────────────────
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS fiscal_period_id UUID REFERENCES fiscal_periods(id);
CREATE INDEX IF NOT EXISTS idx_expenses_fiscal_period ON expenses(fiscal_period_id);
CREATE OR REPLACE FUNCTION set_fiscal_period_expenses()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.fiscal_period_id := fiscal_period_for_date(NEW.date); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_set_fiscal_period ON expenses;
CREATE TRIGGER trg_set_fiscal_period BEFORE INSERT OR UPDATE OF date ON expenses
  FOR EACH ROW EXECUTE FUNCTION set_fiscal_period_expenses();
UPDATE expenses SET fiscal_period_id = fiscal_period_for_date(date) WHERE fiscal_period_id IS NULL AND date IS NOT NULL;

-- ── sales.date ────────────────────────────────────────────────────
ALTER TABLE sales ADD COLUMN IF NOT EXISTS fiscal_period_id UUID REFERENCES fiscal_periods(id);
CREATE INDEX IF NOT EXISTS idx_sales_fiscal_period ON sales(fiscal_period_id);
CREATE OR REPLACE FUNCTION set_fiscal_period_sales()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.fiscal_period_id := fiscal_period_for_date(NEW.date); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_set_fiscal_period ON sales;
CREATE TRIGGER trg_set_fiscal_period BEFORE INSERT OR UPDATE OF date ON sales
  FOR EACH ROW EXECUTE FUNCTION set_fiscal_period_sales();
UPDATE sales SET fiscal_period_id = fiscal_period_for_date(date) WHERE fiscal_period_id IS NULL AND date IS NOT NULL;

-- ── payroll.start_date (the period start; payroll runs span a date
-- range, start_date is the more meaningful "which FY does this run
-- belong to" anchor than end_date) ───────────────────────────────
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS fiscal_period_id UUID REFERENCES fiscal_periods(id);
CREATE INDEX IF NOT EXISTS idx_payroll_fiscal_period ON payroll(fiscal_period_id);
CREATE OR REPLACE FUNCTION set_fiscal_period_payroll()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.fiscal_period_id := fiscal_period_for_date(NEW.start_date); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_set_fiscal_period ON payroll;
CREATE TRIGGER trg_set_fiscal_period BEFORE INSERT OR UPDATE OF start_date ON payroll
  FOR EACH ROW EXECUTE FUNCTION set_fiscal_period_payroll();
UPDATE payroll SET fiscal_period_id = fiscal_period_for_date(start_date) WHERE fiscal_period_id IS NULL AND start_date IS NOT NULL;

-- ── timesheet.date ────────────────────────────────────────────────
ALTER TABLE timesheet ADD COLUMN IF NOT EXISTS fiscal_period_id UUID REFERENCES fiscal_periods(id);
CREATE INDEX IF NOT EXISTS idx_timesheet_fiscal_period ON timesheet(fiscal_period_id);
CREATE OR REPLACE FUNCTION set_fiscal_period_timesheet()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.fiscal_period_id := fiscal_period_for_date(NEW.date); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_set_fiscal_period ON timesheet;
CREATE TRIGGER trg_set_fiscal_period BEFORE INSERT OR UPDATE OF date ON timesheet
  FOR EACH ROW EXECUTE FUNCTION set_fiscal_period_timesheet();
UPDATE timesheet SET fiscal_period_id = fiscal_period_for_date(date) WHERE fiscal_period_id IS NULL AND date IS NOT NULL;

-- ── transfers.date ────────────────────────────────────────────────
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS fiscal_period_id UUID REFERENCES fiscal_periods(id);
CREATE INDEX IF NOT EXISTS idx_transfers_fiscal_period ON transfers(fiscal_period_id);
CREATE OR REPLACE FUNCTION set_fiscal_period_transfers()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.fiscal_period_id := fiscal_period_for_date(NEW.date); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_set_fiscal_period ON transfers;
CREATE TRIGGER trg_set_fiscal_period BEFORE INSERT OR UPDATE OF date ON transfers
  FOR EACH ROW EXECUTE FUNCTION set_fiscal_period_transfers();
UPDATE transfers SET fiscal_period_id = fiscal_period_for_date(date) WHERE fiscal_period_id IS NULL AND date IS NOT NULL;

-- ── cash_advances.date_given ──────────────────────────────────────
ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS fiscal_period_id UUID REFERENCES fiscal_periods(id);
CREATE INDEX IF NOT EXISTS idx_cash_advances_fiscal_period ON cash_advances(fiscal_period_id);
CREATE OR REPLACE FUNCTION set_fiscal_period_cash_advances()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.fiscal_period_id := fiscal_period_for_date(NEW.date_given); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_set_fiscal_period ON cash_advances;
CREATE TRIGGER trg_set_fiscal_period BEFORE INSERT OR UPDATE OF date_given ON cash_advances
  FOR EACH ROW EXECUTE FUNCTION set_fiscal_period_cash_advances();
UPDATE cash_advances SET fiscal_period_id = fiscal_period_for_date(date_given) WHERE fiscal_period_id IS NULL AND date_given IS NOT NULL;

-- ── transportation_requests.requested_date ───────────────────────
ALTER TABLE transportation_requests ADD COLUMN IF NOT EXISTS fiscal_period_id UUID REFERENCES fiscal_periods(id);
CREATE INDEX IF NOT EXISTS idx_transportation_requests_fiscal_period ON transportation_requests(fiscal_period_id);
CREATE OR REPLACE FUNCTION set_fiscal_period_transportation_requests()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.fiscal_period_id := fiscal_period_for_date(NEW.requested_date); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_set_fiscal_period ON transportation_requests;
CREATE TRIGGER trg_set_fiscal_period BEFORE INSERT OR UPDATE OF requested_date ON transportation_requests
  FOR EACH ROW EXECUTE FUNCTION set_fiscal_period_transportation_requests();
UPDATE transportation_requests SET fiscal_period_id = fiscal_period_for_date(requested_date) WHERE fiscal_period_id IS NULL AND requested_date IS NOT NULL;

-- ── orders.order_date ─────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fiscal_period_id UUID REFERENCES fiscal_periods(id);
CREATE INDEX IF NOT EXISTS idx_orders_fiscal_period ON orders(fiscal_period_id);
CREATE OR REPLACE FUNCTION set_fiscal_period_orders()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.fiscal_period_id := fiscal_period_for_date(NEW.order_date); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_set_fiscal_period ON orders;
CREATE TRIGGER trg_set_fiscal_period BEFORE INSERT OR UPDATE OF order_date ON orders
  FOR EACH ROW EXECUTE FUNCTION set_fiscal_period_orders();
UPDATE orders SET fiscal_period_id = fiscal_period_for_date(order_date) WHERE fiscal_period_id IS NULL AND order_date IS NOT NULL;

-- ── emergency_payroll_summary.payment_date ───────────────────────
ALTER TABLE emergency_payroll_summary ADD COLUMN IF NOT EXISTS fiscal_period_id UUID REFERENCES fiscal_periods(id);
CREATE INDEX IF NOT EXISTS idx_emergency_payroll_summary_fiscal_period ON emergency_payroll_summary(fiscal_period_id);
CREATE OR REPLACE FUNCTION set_fiscal_period_emergency_payroll_summary()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.fiscal_period_id := fiscal_period_for_date(NEW.payment_date); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_set_fiscal_period ON emergency_payroll_summary;
CREATE TRIGGER trg_set_fiscal_period BEFORE INSERT OR UPDATE OF payment_date ON emergency_payroll_summary
  FOR EACH ROW EXECUTE FUNCTION set_fiscal_period_emergency_payroll_summary();
UPDATE emergency_payroll_summary SET fiscal_period_id = fiscal_period_for_date(payment_date) WHERE fiscal_period_id IS NULL AND payment_date IS NOT NULL;

-- ── contracts.signed_date (nullable -- a draft contract has none yet;
-- fiscal_period_id simply stays NULL until it's signed) ─────────────
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS fiscal_period_id UUID REFERENCES fiscal_periods(id);
CREATE INDEX IF NOT EXISTS idx_contracts_fiscal_period ON contracts(fiscal_period_id);
CREATE OR REPLACE FUNCTION set_fiscal_period_contracts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.fiscal_period_id := fiscal_period_for_date(NEW.signed_date); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_set_fiscal_period ON contracts;
CREATE TRIGGER trg_set_fiscal_period BEFORE INSERT OR UPDATE OF signed_date ON contracts
  FOR EACH ROW EXECUTE FUNCTION set_fiscal_period_contracts();
UPDATE contracts SET fiscal_period_id = fiscal_period_for_date(signed_date) WHERE fiscal_period_id IS NULL AND signed_date IS NOT NULL;

-- ── leave_requests.start_date ─────────────────────────────────────
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS fiscal_period_id UUID REFERENCES fiscal_periods(id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_fiscal_period ON leave_requests(fiscal_period_id);
CREATE OR REPLACE FUNCTION set_fiscal_period_leave_requests()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.fiscal_period_id := fiscal_period_for_date(NEW.start_date); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_set_fiscal_period ON leave_requests;
CREATE TRIGGER trg_set_fiscal_period BEFORE INSERT OR UPDATE OF start_date ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION set_fiscal_period_leave_requests();
UPDATE leave_requests SET fiscal_period_id = fiscal_period_for_date(start_date) WHERE fiscal_period_id IS NULL AND start_date IS NOT NULL;

-- ── performance_reviews.review_date (nullable) ───────────────────
ALTER TABLE performance_reviews ADD COLUMN IF NOT EXISTS fiscal_period_id UUID REFERENCES fiscal_periods(id);
CREATE INDEX IF NOT EXISTS idx_performance_reviews_fiscal_period ON performance_reviews(fiscal_period_id);
CREATE OR REPLACE FUNCTION set_fiscal_period_performance_reviews()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.fiscal_period_id := fiscal_period_for_date(NEW.review_date); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_set_fiscal_period ON performance_reviews;
CREATE TRIGGER trg_set_fiscal_period BEFORE INSERT OR UPDATE OF review_date ON performance_reviews
  FOR EACH ROW EXECUTE FUNCTION set_fiscal_period_performance_reviews();
UPDATE performance_reviews SET fiscal_period_id = fiscal_period_for_date(review_date) WHERE fiscal_period_id IS NULL AND review_date IS NOT NULL;

-- ── disciplinary_records.incident_date ────────────────────────────
ALTER TABLE disciplinary_records ADD COLUMN IF NOT EXISTS fiscal_period_id UUID REFERENCES fiscal_periods(id);
CREATE INDEX IF NOT EXISTS idx_disciplinary_records_fiscal_period ON disciplinary_records(fiscal_period_id);
CREATE OR REPLACE FUNCTION set_fiscal_period_disciplinary_records()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.fiscal_period_id := fiscal_period_for_date(NEW.incident_date); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_set_fiscal_period ON disciplinary_records;
CREATE TRIGGER trg_set_fiscal_period BEFORE INSERT OR UPDATE OF incident_date ON disciplinary_records
  FOR EACH ROW EXECUTE FUNCTION set_fiscal_period_disciplinary_records();
UPDATE disciplinary_records SET fiscal_period_id = fiscal_period_for_date(incident_date) WHERE fiscal_period_id IS NULL AND incident_date IS NOT NULL;

-- ── hse_incidents.incident_date ───────────────────────────────────
ALTER TABLE hse_incidents ADD COLUMN IF NOT EXISTS fiscal_period_id UUID REFERENCES fiscal_periods(id);
CREATE INDEX IF NOT EXISTS idx_hse_incidents_fiscal_period ON hse_incidents(fiscal_period_id);
CREATE OR REPLACE FUNCTION set_fiscal_period_hse_incidents()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.fiscal_period_id := fiscal_period_for_date(NEW.incident_date); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_set_fiscal_period ON hse_incidents;
CREATE TRIGGER trg_set_fiscal_period BEFORE INSERT OR UPDATE OF incident_date ON hse_incidents
  FOR EACH ROW EXECUTE FUNCTION set_fiscal_period_hse_incidents();
UPDATE hse_incidents SET fiscal_period_id = fiscal_period_for_date(incident_date) WHERE fiscal_period_id IS NULL AND incident_date IS NOT NULL;

-- ── hse_inductions.induction_date ─────────────────────────────────
ALTER TABLE hse_inductions ADD COLUMN IF NOT EXISTS fiscal_period_id UUID REFERENCES fiscal_periods(id);
CREATE INDEX IF NOT EXISTS idx_hse_inductions_fiscal_period ON hse_inductions(fiscal_period_id);
CREATE OR REPLACE FUNCTION set_fiscal_period_hse_inductions()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.fiscal_period_id := fiscal_period_for_date(NEW.induction_date); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_set_fiscal_period ON hse_inductions;
CREATE TRIGGER trg_set_fiscal_period BEFORE INSERT OR UPDATE OF induction_date ON hse_inductions
  FOR EACH ROW EXECUTE FUNCTION set_fiscal_period_hse_inductions();
UPDATE hse_inductions SET fiscal_period_id = fiscal_period_for_date(induction_date) WHERE fiscal_period_id IS NULL AND induction_date IS NOT NULL;

-- ============================================================
-- Verify: per-table spot check -- tagged vs untagged-but-dated (should
-- be 0 untagged-but-dated for every table unless its date falls
-- outside the seeded fiscal_periods range) -- plus a distribution by
-- fiscal period label to eyeball against the known date ranges.
-- ============================================================
SELECT 'expenses' AS t, count(*) FILTER (WHERE fiscal_period_id IS NOT NULL) AS tagged,
       count(*) FILTER (WHERE fiscal_period_id IS NULL AND date IS NOT NULL) AS untagged_but_dated FROM expenses
UNION ALL
SELECT 'sales', count(*) FILTER (WHERE fiscal_period_id IS NOT NULL), count(*) FILTER (WHERE fiscal_period_id IS NULL AND date IS NOT NULL) FROM sales
UNION ALL
SELECT 'payroll', count(*) FILTER (WHERE fiscal_period_id IS NOT NULL), count(*) FILTER (WHERE fiscal_period_id IS NULL AND start_date IS NOT NULL) FROM payroll
UNION ALL
SELECT 'timesheet', count(*) FILTER (WHERE fiscal_period_id IS NOT NULL), count(*) FILTER (WHERE fiscal_period_id IS NULL AND date IS NOT NULL) FROM timesheet
UNION ALL
SELECT 'transfers', count(*) FILTER (WHERE fiscal_period_id IS NOT NULL), count(*) FILTER (WHERE fiscal_period_id IS NULL AND date IS NOT NULL) FROM transfers
UNION ALL
SELECT 'cash_advances', count(*) FILTER (WHERE fiscal_period_id IS NOT NULL), count(*) FILTER (WHERE fiscal_period_id IS NULL AND date_given IS NOT NULL) FROM cash_advances
UNION ALL
SELECT 'transportation_requests', count(*) FILTER (WHERE fiscal_period_id IS NOT NULL), count(*) FILTER (WHERE fiscal_period_id IS NULL AND requested_date IS NOT NULL) FROM transportation_requests
UNION ALL
SELECT 'orders', count(*) FILTER (WHERE fiscal_period_id IS NOT NULL), count(*) FILTER (WHERE fiscal_period_id IS NULL AND order_date IS NOT NULL) FROM orders
UNION ALL
SELECT 'emergency_payroll_summary', count(*) FILTER (WHERE fiscal_period_id IS NOT NULL), count(*) FILTER (WHERE fiscal_period_id IS NULL AND payment_date IS NOT NULL) FROM emergency_payroll_summary
UNION ALL
SELECT 'contracts', count(*) FILTER (WHERE fiscal_period_id IS NOT NULL), count(*) FILTER (WHERE fiscal_period_id IS NULL AND signed_date IS NOT NULL) FROM contracts
UNION ALL
SELECT 'leave_requests', count(*) FILTER (WHERE fiscal_period_id IS NOT NULL), count(*) FILTER (WHERE fiscal_period_id IS NULL AND start_date IS NOT NULL) FROM leave_requests
UNION ALL
SELECT 'performance_reviews', count(*) FILTER (WHERE fiscal_period_id IS NOT NULL), count(*) FILTER (WHERE fiscal_period_id IS NULL AND review_date IS NOT NULL) FROM performance_reviews
UNION ALL
SELECT 'disciplinary_records', count(*) FILTER (WHERE fiscal_period_id IS NOT NULL), count(*) FILTER (WHERE fiscal_period_id IS NULL AND incident_date IS NOT NULL) FROM disciplinary_records
UNION ALL
SELECT 'hse_incidents', count(*) FILTER (WHERE fiscal_period_id IS NOT NULL), count(*) FILTER (WHERE fiscal_period_id IS NULL AND incident_date IS NOT NULL) FROM hse_incidents
UNION ALL
SELECT 'hse_inductions', count(*) FILTER (WHERE fiscal_period_id IS NOT NULL), count(*) FILTER (WHERE fiscal_period_id IS NULL AND induction_date IS NOT NULL) FROM hse_inductions;
