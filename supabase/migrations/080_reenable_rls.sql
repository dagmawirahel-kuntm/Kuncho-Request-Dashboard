-- ============================================================
-- Re-enable Row Level Security on the 24 core tables.
--
-- The Supabase advisor flagged these as having RLS disabled in
-- production. Checked the full tracked migration history (001-079):
-- migration 001 turns RLS on for exactly these 24 tables, and no
-- later migration ever turns it back off. So this was switched off
-- out-of-band (directly via the SQL editor or dashboard), not by
-- anything in this repo — with RLS off, any authenticated (or even
-- anon, depending on grants) API caller can read/write every one of
-- these tables directly via PostgREST, completely bypassing the
-- app's role checks.
--
-- Before running this, cross-referenced the existing policies (set
-- by 001/007/043/047/049) against what the router/UI actually let
-- each role reach. Found and fixed one real mismatch: manager could
-- navigate to New/Edit/Delete on accounts, transfers, sales (new),
-- clients, tax_summary, batch_payments, and vendor_receipt_facilitation,
-- but RLS only ever granted manager SELECT there (+ a broad sales
-- UPDATE for approvals) — a deliberate design per migration 049's
-- "Managers can read the money screens they help govern" comment,
-- not an oversight. The router/UI companion change (same commit)
-- narrows those write paths to admin/finance so nothing that was
-- silently no-op-ing under disabled RLS starts throwing errors.
--
-- No new policies needed here — the existing set already matches
-- the now-narrowed UI. This migration only flips RLS back on.
-- ============================================================

SET search_path TO public;

ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_allocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE transportation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_payroll_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_receipt_facilitation ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE cpo_bonds ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_taxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheet ENABLE ROW LEVEL SECURITY;

-- Verify: should return 24 rows, all rowsecurity = true
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN (
  'staff','projects','locations','vendors','categories','sub_categories',
  'accounts','clients','products','expenses','orders','purchase_allocation',
  'transportation_requests','transfers','sales','payroll',
  'emergency_payroll_summary','cash_advances','vendor_receipt_facilitation',
  'tax_summary','cpo_bonds','payroll_taxes','batch_payments','timesheet'
)
ORDER BY relname;
