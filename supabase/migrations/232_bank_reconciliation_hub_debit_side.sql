-- Debit-side of making the bank statement import the reconciliation
-- centre (part 1 of 2; the credit-side income classification follows).
--
-- Two read views:
--
-- 1. v_awaiting_bank_confirmation — every sent bank-method payment
--    (transfer/CPO/cheque) that has no matched bank line yet, at ANY
--    age. The Payments dashboard only surfaced the last 7 days, so a
--    statement imported a week or two after payment could never reach
--    the older sent payments waiting on it. Confirmed live: 13 are
--    waiting, the oldest from a month ago.
--
-- 2. v_account_statement_summary — per account, when it was last
--    imported and how many committed statement lines are still
--    unmatched. Feeds the cash board so each account becomes a live
--    "go reconcile me" cue instead of just a balance.

SET search_path TO public;

CREATE OR REPLACE VIEW public.v_awaiting_bank_confirmation AS
 SELECT e.id,
    e.expense_code,
    e.item_service_description,
    e.vendor_id,
    v.vendor_name,
    e.amount_etb,
    e.net_payable,
    e.payment_method,
    e.account_id,
    a.account_name,
    e.payment_state_changed_at,
    EXTRACT(day FROM now() - e.payment_state_changed_at) AS days_waiting,
    bpe.batch_payment_id
   FROM expenses e
     LEFT JOIN vendors v ON v.id = e.vendor_id
     LEFT JOIN accounts a ON a.id = e.account_id
     LEFT JOIN batch_payment_expenses bpe ON bpe.expense_id = e.id
  WHERE e.payment_state = 'sent'
    AND e.payment_method IN ('transfer', 'cpo', 'cheque')
    AND e.transfer_id IS NULL;

CREATE OR REPLACE VIEW public.v_account_statement_summary AS
 SELECT a.id AS account_id,
    max(bsi.committed_at) AS last_import_at,
    count(bsl.id) AS committed_lines,
    count(bsl.id) FILTER (WHERE bsl.match_status = 'unmatched') AS unmatched_lines,
    count(bsl.id) FILTER (WHERE bsl.match_status IN ('matched_expense', 'matched_sale', 'manual')) AS matched_lines
   FROM accounts a
     LEFT JOIN bank_statement_imports bsi ON bsi.account_id = a.id AND bsi.committed_at IS NOT NULL
     LEFT JOIN bank_statement_lines bsl ON bsl.import_id = bsi.id AND bsl.transfer_id IS NOT NULL
  GROUP BY a.id;

GRANT SELECT ON public.v_awaiting_bank_confirmation TO authenticated;
GRANT SELECT ON public.v_account_statement_summary TO authenticated;
