-- ═══════════════════════════════════════════════════════════════
-- General Ledger / Sub Ledger polish
--
-- Categories become "General Ledgers" and sub_categories become
-- "Sub Ledgers". Each general ledger is classified by its
-- accounting nature, rooted in the equation
--   Assets = Liabilities + Owner's Equity.
-- Revenue and Expense are the income-statement components that
-- ultimately flow into Owner's Equity, kept distinct here so
-- purchase costs can be traced back to a clear ledger nature.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE categories RENAME COLUMN category_type TO nature;

-- NOT VALID: enforced for new/updated rows only, so existing rows
-- with legacy free-text values (e.g. "Other") aren't rejected.
ALTER TABLE categories ADD CONSTRAINT categories_nature_check
  CHECK (nature IN ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense')) NOT VALID;
