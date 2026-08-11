-- ============================================================
-- URGENT, MINIMAL fast-track mitigation for the get_user_role()
-- NULL-bypass bug (see 213_null_role_auth_hardening.sql for the
-- full, tested fix). This migration does ONLY ONE THING: revoke
-- EXECUTE on the 32 HIGH-severity functions (SECURITY DEFINER,
-- no RLS backstop, unauthenticated-callable) from PUBLIC and anon.
--
-- No function bodies are touched here — zero logic change, zero
-- new risk of breaking existing behavior. This closes the anon
-- attack surface immediately (an anonymous caller with only the
-- project's URL + publishable/anon key can no longer invoke any of
-- these 32 functions at all, regardless of the NULL-check bug still
-- present in their bodies) while the full fix (213) gets proper
-- per-function testing on its own timeline.
--
-- Why PUBLIC and not just anon: confirmed live for a related fix
-- that these functions carry a standing grantee = 'PUBLIC' EXECUTE
-- row (CREATE FUNCTION's default). Postgres ACLs are additive across
-- a role's own grants and PUBLIC's grants — revoking only from anon
-- would not remove what anon still holds via PUBLIC.
--
-- authenticated is deliberately left untouched: every one of these
-- 32 is meant to be callable by real, logged-in staff with the
-- correct role. Revoking from authenticated would break the app for
-- legitimate users; the NULL-bypass bug only matters for callers
-- with no matching active user_profiles row (unauthenticated, or a
-- deactivated account), which by definition are not `authenticated`
-- sessions with a valid role.
--
-- Safe to apply before OR after 213 — REVOKE is idempotent
-- (re-revoking an already-revoked privilege is a silent no-op, not
-- an error), so 213 applying the same REVOKE statements again later
-- is harmless.
--
-- NOT included here: block_finance_contact_reassign_by_non_admin
-- (the other MEDIUM-severity finding). It's a trigger function
-- (RETURNS trigger) — Postgres refuses direct SQL calls to
-- trigger-returning functions regardless of EXECUTE grants ("trigger
-- functions can only be called as triggers"), so revoking EXECUTE on
-- it provides no actual protection. Its real exposure is that the
-- base table's RLS backstop (projects UPDATE, ownership-only, no
-- role check) doesn't cover the gap either — that one needs the
-- NULL-guard body fix in 213, there is no fast-track mitigation for it.
-- ============================================================

SET search_path TO public;

REVOKE EXECUTE ON FUNCTION undo_grn_fulfillment(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION revert_legacy_fulfillment(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION create_batch_payment(UUID[], UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION match_batch_to_transfer(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION match_expense_to_transfer(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION convert_opening_balances_to_journal_entry() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION close_fiscal_period(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION reopen_fiscal_period(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION close_vendor_advance(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION sign_off_stock_dispatch(UUID, UUID, NUMERIC) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION link_expense_vrf(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION confirm_expense_cash_payment(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION match_payroll_to_transfer(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION link_payroll_vrf(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION auto_match_statement_import(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION commit_statement_import(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION unarchive_all() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION retry_expense_ledger_posting(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION confirm_vendor_receipt_physical(UUID, TEXT) FROM PUBLIC, anon;
-- confirm_sales_receipt_physical (originally flagged HIGH #20) is
-- excluded: confirmed via migration 158 (DROP FUNCTION IF EXISTS
-- confirm_sales_receipt_physical(UUID, TEXT)) that it no longer
-- exists — sales_receipts was collapsed into client_attachments and
-- replaced by confirm_client_receipt_physical, which IS included below.
REVOKE EXECUTE ON FUNCTION confirm_client_receipt_physical(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION split_expense_partial_payment(UUID, NUMERIC, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION reconcile_account(UUID, DATE, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION confirm_receipt_pickup(TEXT, UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION match_line_to_payroll(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION mark_wht_receipt_prepared(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION promote_candidate_to_casual(UUID, TEXT, NUMERIC) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION match_expense_to_statement_line(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION rematch_committed_statement_lines(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION match_sale_to_transfer(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION match_sale_to_statement_line(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION retry_sale_ledger_posting(UUID) FROM PUBLIC, anon;

-- MEDIUM severity, non-trigger (the other MEDIUM finding is a
-- trigger, excluded above with explanation)
REVOKE EXECUTE ON FUNCTION refresh_exec_dashboard_now() FROM PUBLIC, anon;

-- Verify: expect ONLY authenticated, postgres, service_role for each
-- of the 32 functions above — no PUBLIC, no anon.
SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_name IN (
  'undo_grn_fulfillment', 'revert_legacy_fulfillment', 'create_batch_payment',
  'match_batch_to_transfer', 'match_expense_to_transfer', 'convert_opening_balances_to_journal_entry',
  'close_fiscal_period', 'reopen_fiscal_period', 'close_vendor_advance', 'sign_off_stock_dispatch',
  'link_expense_vrf', 'confirm_expense_cash_payment', 'match_payroll_to_transfer', 'link_payroll_vrf',
  'auto_match_statement_import', 'commit_statement_import', 'unarchive_all', 'retry_expense_ledger_posting',
  'confirm_vendor_receipt_physical', 'confirm_client_receipt_physical', 'split_expense_partial_payment',
  'reconcile_account', 'confirm_receipt_pickup', 'match_line_to_payroll', 'mark_wht_receipt_prepared',
  'promote_candidate_to_casual', 'match_expense_to_statement_line', 'rematch_committed_statement_lines',
  'match_sale_to_transfer', 'match_sale_to_statement_line', 'retry_sale_ledger_posting',
  'refresh_exec_dashboard_now'
)
ORDER BY routine_name, grantee;
