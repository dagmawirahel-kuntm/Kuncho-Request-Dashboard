-- ============================================================
-- Category -> cost group mapping, from the confirmed operations
-- mapping doc (65 categories) plus the four flagged decisions:
--   Printing -> Subcontract (outsourced)
--   Morale -> Materials (kept as typed — a wood material, not staff welfare)
--   Fuel -> Transport (fleet/delivery)
--   Government Expense -> left unmapped (mixes company tax and
--     project permits; mapping it now would corrupt Actuals — revisit
--     once it's split)
--
-- The following are DELIBERATELY left unmapped (cost_group_id stays
-- NULL, same as any gap — they roll into the Unallocated bucket on
-- the workspace, which is correct: they aren't project costs at all).
-- Nothing to do for these, just documenting why they're absent below:
--   VRF (vendor-receipt facilitation flow, not a cost)
--   Government Expense (mixed company/project — see above)
--   Personal withdraws (owner drawings — balance sheet)
--   Loan (financing — balance sheet)
--   Inventory (stock float until consumed)
--   PPE (capital asset — nature=Asset, capitalized not expensed)
--   CPO, Bonds (guarantees — balance sheet)
--   Salary Advances (staff advance float)
--   Refund (contra/reversal)
--   FX (forex/facilitation adjustment)
--   Multiple, Miscellaneous (unclassified mixed buckets)
--
-- Match by category_name, case/whitespace-insensitive. Only touches
-- rows that are still unmapped, so safe to re-run.
-- ============================================================

SET search_path TO public;

-- ── Pre-existing data repair, discovered by this migration ─────────────
-- categories.nature has had a CHECK constraint since migration 005
-- (Asset/Liability/Equity/Revenue/Expense) added NOT VALID — which
-- skips validating rows that already existed at the time, but still
-- fully enforces on any future UPDATE to that row, regardless of which
-- column changes. Some categories (e.g. "Cement" carrying nature =
-- 'BLDMAT') already had invalid values sitting there undetected; the
-- cost_group_id UPDATE below is the first UPDATE to touch some of
-- these rows since the constraint was added, so it surfaces now.
--
-- Reset to NULL rather than guessing a replacement — every reporting
-- view already built on top of `nature` (P&L, Balance Sheet, migration
-- 064) treats NULL the same as 'Expense' via COALESCE(c.nature,
-- 'Expense'), which is the correct behavior for an ordinary purchase
-- category anyway. NULL is honest about "this was never validly set,"
-- rather than fabricating a specific classification.
SELECT category_name, nature AS invalid_nature_being_cleared
FROM categories
WHERE nature IS NOT NULL AND nature NOT IN ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense');

UPDATE categories
SET nature = NULL
WHERE nature IS NOT NULL AND nature NOT IN ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense');

WITH mapping(category_name, group_name) AS (
  VALUES
    -- Materials
    ('Building Materials', 'Materials'),
    ('Cement', 'Materials'),
    ('Granite', 'Materials'),
    ('Ceramic', 'Materials'),
    ('Putty', 'Materials'),
    ('Nail', 'Materials'),
    ('Punta', 'Materials'),
    ('Screw', 'Materials'),
    ('Sand Paper', 'Materials'),
    ('Gypsum', 'Materials'),
    ('Steel', 'Materials'),
    ('Wood', 'Materials'),
    ('UV Wood', 'Materials'),
    ('Veneer', 'Materials'),
    ('MDF', 'Materials'),
    ('Chupped', 'Materials'),
    ('WPC', 'Materials'),
    ('Foam', 'Materials'),
    ('Plastic', 'Materials'),
    ('Deck', 'Materials'),
    ('Paints', 'Materials'),
    ('Aluminum', 'Materials'),
    ('Glass', 'Materials'),
    ('Components', 'Materials'),
    ('Tap', 'Materials'),
    ('Sanitary Material', 'Materials'),
    ('Electrical Materials', 'Materials'),
    ('Leather Materials', 'Materials'),
    ('Morale', 'Materials'),

    -- Labor
    ('Labor', 'Labor'),

    -- Subcontract
    ('Sub Contrcators', 'Subcontract'),
    ('Machinery Rental', 'Subcontract'),
    ('Equipment Rental', 'Subcontract'),
    ('Other Services', 'Subcontract'),
    ('Printing', 'Subcontract'),

    -- Transport
    ('Transportation', 'Transport'),
    ('Fuel', 'Transport'),

    -- Overhead
    ('Salary', 'Overhead'),
    ('Office Transportation', 'Overhead'),
    ('Marketing Expense', 'Overhead'),
    ('Entertainment Expense', 'Overhead'),
    ('Penalty', 'Overhead'),
    ('Property Rent', 'Overhead'),
    ('Office Utility', 'Overhead'),
    ('Office Expenses', 'Overhead'),
    ('Office Inventory', 'Overhead'),
    ('First Aid Materials', 'Overhead'),
    ('Insurance', 'Overhead'),
    ('Workshop Overhead', 'Overhead'),
    ('Tools', 'Overhead'),
    ('Petty', 'Overhead')
)
UPDATE categories c
SET cost_group_id = g.id
FROM mapping m
JOIN cost_groups g ON g.name = m.group_name
WHERE c.cost_group_id IS NULL
  AND lower(trim(c.category_name)) = lower(trim(m.category_name));

-- Verify: full state after applying the mapping. Anything still
-- showing a NULL cost_group here that ISN'T in the deliberate-exclude
-- list above is a real gap — either a name that didn't match exactly
-- (check for typos/whitespace against the VALUES list) or a category
-- the mapping doc didn't cover.
SELECT
  c.category_name,
  c.parent_type,
  c.nature,
  g.name AS cost_group
FROM categories c
LEFT JOIN cost_groups g ON g.id = c.cost_group_id
ORDER BY (g.name IS NULL) DESC, g.sort_order NULLS LAST, c.category_name;

SELECT
  count(*) FILTER (WHERE cost_group_id IS NOT NULL) AS mapped,
  count(*) FILTER (WHERE cost_group_id IS NULL)      AS unmapped_falls_to_unallocated,
  count(*)                                            AS total_categories
FROM categories;
