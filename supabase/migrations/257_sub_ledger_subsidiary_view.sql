-- 257 — Sub-Ledger subsidiary view for the Ledger & Journal page
--
-- Background:
--   The auto-posting engine posts each paid purchase-order expense to the GL
--   as ONE debit line, against the single category resolve_expense_category()
--   picked (migration 154). When a PO's items span more than one parent
--   category, that function collapses the whole amount into the literal
--   "Multiple" control account. Separately, even a single-category PO can be
--   posted to the wrong category if the PR-time classification it was based
--   on doesn't match what was actually delivered.
--
--   goods_received_note_items.category_id (migration 159/253) already
--   captures the REAL category for each line item, tagged by whoever
--   physically received the goods — but that field was never read by
--   anything accounting-related; it's effectively write-only.
--
--   This view is a read-only SUBSIDIARY LEDGER: it reconstructs the true
--   per-category breakdown behind each posted PO expense by allocating the
--   posted amount across the bundle's GRN lines, proportional to each GRN
--   line's accepted value (quantity_accepted × unit_price_actual) — and
--   compares that real category against whatever the GL actually posted.
--   It does not change any posting — it lets the GL keep its single
--   control-account entry while exposing what it should have been, and
--   flags every amount where posted != real (the "Multiple" collapse and
--   plain misclassifications alike).
--
-- Scope: only expenses that actually posted to the ledger (have a journal
--   entry) with GRN lines recorded, so the subsidiary totals reconcile to
--   the GL control accounts.

CREATE OR REPLACE VIEW public.v_sub_ledger_balances
WITH (security_invoker = true) AS
WITH grn_lines AS (
  SELECT gn.sourcing_bundle_id,
         gni.category_id AS real_category_id,
         SUM(COALESCE(gni.quantity_accepted, 0) * COALESCE(sbi.unit_price_actual, 0)) AS line_value
  FROM goods_received_note_items gni
  JOIN goods_received_notes gn  ON gn.id = gni.grn_id
  JOIN sourcing_bundle_items sbi ON sbi.id = gni.sourcing_bundle_item_id
  GROUP BY gn.sourcing_bundle_id, gni.category_id
),
bundle_totals AS (
  SELECT sourcing_bundle_id, SUM(line_value) AS bundle_value
  FROM grn_lines
  GROUP BY sourcing_bundle_id
),
alloc AS (
  SELECT
    je.id                AS journal_entry_id,
    je.fiscal_period_id,
    e.category_id        AS posted_category_id,
    gl.real_category_id,
    -- Proportional allocation of the actually-posted amount across the
    -- categories the receiver tagged on the GRN, weighted by each line's
    -- accepted value. Using the posted amount (not the GRN/bundle total)
    -- keeps every real category summing back to the expense that hit the
    -- ledger, even when the paid figure differs from the received value.
    CASE WHEN bt.bundle_value > 0
         THEN e.amount_etb * (gl.line_value / bt.bundle_value)
         ELSE 0 END       AS allocated_amount
  FROM expenses e
  JOIN journal_entries je
    ON je.source_table = 'expenses' AND je.source_id = e.id
  JOIN bundle_totals bt ON bt.sourcing_bundle_id = e.sourcing_bundle_id
  JOIN grn_lines gl     ON gl.sourcing_bundle_id = e.sourcing_bundle_id
  WHERE e.expense_type = 'purchase_order'
    AND e.sourcing_bundle_id IS NOT NULL
)
SELECT
  a.fiscal_period_id,
  fp.label                                      AS fiscal_period_label,
  a.real_category_id,
  COALESCE(rc.category_name, 'Unclassified')    AS real_category,
  a.posted_category_id,
  COALESCE(pc.category_name, '(uncategorized)') AS posted_category,
  SUM(a.allocated_amount)                       AS amount,
  -- Portion of this real category that was posted to a DIFFERENT GL
  -- category (including the "Multiple" collapse and plain single-category
  -- misclassifications alike) — the detail the GL cannot see on its own.
  COALESCE(SUM(a.allocated_amount) FILTER (WHERE a.real_category_id IS DISTINCT FROM a.posted_category_id), 0) AS misclassified_amount,
  COUNT(DISTINCT a.journal_entry_id)            AS entry_count
FROM alloc a
LEFT JOIN fiscal_periods fp ON fp.id = a.fiscal_period_id
LEFT JOIN categories rc     ON rc.id = a.real_category_id
LEFT JOIN categories pc     ON pc.id = a.posted_category_id
GROUP BY a.fiscal_period_id, fp.label, a.real_category_id, rc.category_name, a.posted_category_id, pc.category_name
HAVING SUM(a.allocated_amount) <> 0;

COMMENT ON VIEW public.v_sub_ledger_balances IS
  'Subsidiary ledger: posted purchase-order expenses allocated by their GRN-line categories (the category the receiver actually tagged each item with, at goods_received_note_items.category_id), grouped by real vs. posted GL category per fiscal period. Flags amounts where the posted GL category differs from what the goods were actually received as (covers the "Multiple" collapse and single-category misclassifications alike). Read-only; reconciles to the posted GL control accounts.';
