-- 257 — Sub-Ledger subsidiary view for the Ledger & Journal page
--
-- Background:
--   The auto-posting engine posts each paid purchase-order expense to the GL
--   as ONE debit line, against the single category resolve_expense_category()
--   picked (migration 154). When a PO's items span more than one parent
--   category, that function collapses the whole amount into the literal
--   "Multiple" control account — the per-item sub-category detail is captured
--   at Purchase-Request time (order_items.sub_category_id) but never reaches
--   the books.
--
--   This view is a read-only SUBSIDIARY LEDGER: it reconstructs the true
--   per-sub-ledger (sub_category) breakdown behind each posted PO expense by
--   allocating the posted amount across the bundle's lines, proportional to
--   each line's value. It does not change any posting — it lets the GL keep
--   its single control-account entry while exposing the detail that rolls up
--   to it, and flags how much of each sub-ledger is currently buried inside
--   the "Multiple" bucket.
--
-- Scope: only expenses that actually posted to the ledger (have a journal
--   entry), so the subsidiary totals reconcile to the GL control accounts.

CREATE OR REPLACE VIEW public.v_sub_ledger_balances
WITH (security_invoker = true) AS
WITH bundle_lines AS (
  SELECT sbi.bundle_id,
         oi.sub_category_id,
         SUM(COALESCE(sbi.quantity_actual, 0) * COALESCE(sbi.unit_price_actual, 0)) AS line_value
  FROM sourcing_bundle_items sbi
  JOIN order_items oi ON oi.id = sbi.order_item_id
  GROUP BY sbi.bundle_id, oi.sub_category_id
),
bundle_totals AS (
  SELECT bundle_id, SUM(line_value) AS bundle_value
  FROM bundle_lines
  GROUP BY bundle_id
),
alloc AS (
  SELECT
    je.id                AS journal_entry_id,
    je.fiscal_period_id,
    e.category_id        AS posted_category_id,
    bl.sub_category_id,
    -- Proportional allocation of the actually-posted amount. Using the posted
    -- amount (not the bundle estimate) keeps every sub-ledger summing back to
    -- the expense that hit the ledger, even when the paid figure differs from
    -- the bundle's estimate (advance payments, post-GRN adjustments, etc.).
    CASE WHEN bt.bundle_value > 0
         THEN e.amount_etb * (bl.line_value / bt.bundle_value)
         ELSE 0 END       AS allocated_amount
  FROM expenses e
  JOIN journal_entries je
    ON je.source_table = 'expenses' AND je.source_id = e.id
  JOIN bundle_totals bt ON bt.bundle_id = e.sourcing_bundle_id
  JOIN bundle_lines bl  ON bl.bundle_id = e.sourcing_bundle_id
  WHERE e.expense_type = 'purchase_order'
    AND e.sourcing_bundle_id IS NOT NULL
)
SELECT
  a.fiscal_period_id,
  fp.label                                    AS fiscal_period_label,
  sc.parent_category_id                       AS parent_category_id,
  COALESCE(pc.category_name, 'Unclassified')  AS parent_category,
  a.sub_category_id,
  COALESCE(sc.item_name, '(unassigned)')      AS sub_ledger,
  SUM(a.allocated_amount)                     AS amount,
  -- Portion of this sub-ledger currently posted to the "Multiple" control
  -- account — i.e. detail the GL cannot see without this view.
  COALESCE(SUM(a.allocated_amount) FILTER (WHERE mc.category_name = 'Multiple'), 0) AS hidden_in_multiple,
  COUNT(DISTINCT a.journal_entry_id)          AS entry_count
FROM alloc a
LEFT JOIN fiscal_periods fp ON fp.id = a.fiscal_period_id
LEFT JOIN categories mc     ON mc.id = a.posted_category_id
LEFT JOIN sub_categories sc ON sc.id = a.sub_category_id
LEFT JOIN categories pc     ON pc.id = sc.parent_category_id
GROUP BY a.fiscal_period_id, fp.label, sc.parent_category_id, pc.category_name, a.sub_category_id, sc.item_name
HAVING SUM(a.allocated_amount) <> 0;

COMMENT ON VIEW public.v_sub_ledger_balances IS
  'Subsidiary ledger: posted purchase-order expenses allocated across their sub_categories (sub-ledgers) by bundle line value, grouped by the sub-ledger''s true parent GL category, per fiscal period. Read-only; reconciles to the posted GL control accounts and surfaces detail collapsed into the "Multiple" bucket.';
