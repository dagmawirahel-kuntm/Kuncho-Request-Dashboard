-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION STATUS CHECK
--
-- Cross-checks every schema migration in supabase/migrations/ against
-- what's actually live in this database. Run this whole file in the
-- Supabase SQL editor; read the single result table it produces.
--
-- Each row is one migration's signature check: a table, column,
-- function, view, policy, or enum value that only exists if that
-- migration actually ran. "MISSING" means run that migration file now
-- (they're all idempotent — safe to re-run even if partially applied).
--
-- Not included: pure data-import/seed migrations (011, 012, 013, 014,
-- 028, 037, 038, 040, and the old fix_expense_code_dupes* ad-hoc
-- scripts) — "did it run" for those is a row-count/data question, not
-- a schema question. A short data-completeness checklist for those is
-- at the bottom of this file, commented out — uncomment to run it.
-- ═══════════════════════════════════════════════════════════════════

SELECT * FROM (

  -- 001: initial schema
  SELECT '001_initial_schema' AS migration,
    (SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='expenses'))
    AS applied

  UNION ALL SELECT '002_add_domain_roles',
    (SELECT 'procurement_officer' = ANY(enum_range(NULL::user_role)::text[]))

  UNION ALL SELECT '003_domain_role_policies',
    (SELECT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vendors' AND policyname='procurement_officer_all'))

  UNION ALL SELECT '004_enrich_relations',
    (SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='project_manager_id'))

  UNION ALL SELECT '005_general_ledger',
    (SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='categories' AND column_name='nature'))

  UNION ALL SELECT '006_expense_workflow',
    (SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='expenses' AND column_name='approval_status'))

  UNION ALL SELECT '007_approval_workflows',
    (SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='approval_status'))

  UNION ALL SELECT '008_fixes (categories.updated_at column; handle_new_user is re-checked at 048)',
    (SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='categories' AND column_name='updated_at'))

  UNION ALL SELECT '009_account_balances',
    (SELECT EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='v_account_balances'))

  UNION ALL SELECT '015_client_attachments',
    (SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='client_attachments'))

  UNION ALL SELECT '016_add_refund_status',
    (SELECT 'Refunded' = ANY(enum_range(NULL::sale_lifecycle_status)::text[]))

  UNION ALL SELECT '017_client_logo_url',
    (SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clients' AND column_name='logo_url'))

  UNION ALL SELECT '018_client_collections',
    (SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='client_attachments' AND column_name='sale_id'))

  UNION ALL SELECT '019_order_procurement_fields',
    (SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='is_new_item'))

  UNION ALL SELECT '020_order_sub_category_ref',
    (SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='sub_category_id'))

  UNION ALL SELECT '021_purchase_request_line_items',
    (SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='order_items'))

  UNION ALL SELECT '022a_stock_role_enum',
    (SELECT 'stock_manager' = ANY(enum_range(NULL::user_role)::text[]))

  UNION ALL SELECT '022b_stock_schema',
    (SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='stock_items'))

  UNION ALL SELECT '023_order_requested_by',
    (SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='requested_by_user_id'))

  UNION ALL SELECT '024_order_item_market_check',
    (SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='order_items' AND column_name='needs_market_check'))

  UNION ALL SELECT '025_vrf_fields',
    (SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vendor_receipt_facilitation' AND column_name='commission_rate'))

  UNION ALL SELECT '026_sourcing_bundles',
    (SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='sourcing_bundles'))

  UNION ALL SELECT '027_expense_type_enum',
    (SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='expenses' AND column_name='sourcing_bundle_id'))

  UNION ALL SELECT '029_stock_item_codes',
    (SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stock_items' AND column_name='item_code'))

  UNION ALL SELECT '030_stock_levels_view',
    (SELECT EXISTS (SELECT 1 FROM information_schema.views WHERE table_name='v_stock_levels'))

  UNION ALL SELECT '031_booth_return_structure_type',
    (SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stock_items' AND column_name='structure_type'))

  UNION ALL SELECT '032_stock_receipts_project_id',
    (SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stock_receipts' AND column_name='project_id'))

  UNION ALL SELECT '033_fix_categories_updated_at',
    (SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='set_categories_updated_at'))

  UNION ALL SELECT '034_vendor_profile_fields',
    (SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vendors' AND column_name='payment_terms'))

  UNION ALL SELECT '035/041_expense_receipt_fields (035 was superseded/rolled back — 041 is what matters)',
    (SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='expenses' AND column_name='receipt_url'))

  UNION ALL SELECT '036_vendor_name_unique_expense_code_unique',
    (SELECT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name='vendors' AND constraint_name='vendors_vendor_name_unique'))

  UNION ALL SELECT '039_vendor_attachments (also confirms 035''s vendor_documents was cleaned up)',
    (SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='vendor_attachments')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='vendor_documents'))

  UNION ALL SELECT '042_fix_expense_code_trigger_and_dedupe',
    (SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname='generate_expense_code'))

  UNION ALL SELECT '043_sales_pipeline',
    (SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='proformas')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales' AND column_name='invoice_number'))

  UNION ALL SELECT '044_staff_profile_fields',
    (SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='staff' AND column_name='email'))

  UNION ALL SELECT '045_report_views',
    (SELECT EXISTS (SELECT 1 FROM information_schema.views WHERE table_name='v_pl_monthly'))

  UNION ALL SELECT '046_payroll_structure',
    (SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payroll_staff' AND column_name='net_amount')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payroll' AND column_name='approval_status'))

  UNION ALL SELECT '047_sales_rls_finance',
    (SELECT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sales' AND policyname='finance_all_sales'))

  UNION ALL SELECT '048_user_management (handle_new_user hardened)',
    (SELECT pg_get_functiondef(oid) LIKE '%never trust%' FROM pg_proc WHERE proname='handle_new_user' LIMIT 1)

  UNION ALL SELECT '049_role_access_alignment',
    (SELECT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='orders' AND policyname='raa_staff_own_orders'))

  UNION ALL SELECT '050_signup_gate',
    (SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='signup_allowlist'))

  UNION ALL SELECT '051_account_status',
    (SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_profiles' AND column_name='account_status'))

  UNION ALL SELECT '052_company_calendar',
    (SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='company_events'))

  UNION ALL SELECT '053_ethiopian_pl_views',
    (SELECT EXISTS (SELECT 1 FROM information_schema.views WHERE table_name='v_pl_monthly_et'))

  UNION ALL SELECT '054_balance_sheet_asof',
    (SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname='account_balances_asof'))

  UNION ALL SELECT '055_staff_hierarchy',
    (SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='staff' AND column_name='management_level'))

  UNION ALL SELECT '056_sourcing_pipeline_fixes',
    (SELECT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='order_items' AND policyname='admin_all_order_items')
     AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_enforce_bundle_drafting_only'))

) AS checks
ORDER BY migration;

-- ═══════════════════════════════════════════════════════════════════
-- Data-only migrations (uncomment the block you want to spot-check —
-- these confirm DATA is present, not schema; row counts are the
-- migration's actual descriptions, adjust if your data has changed
-- since):
-- ═══════════════════════════════════════════════════════════════════

-- 011: 20 placeholder bank accounts
-- SELECT count(*) AS inactive_bank_slots FROM accounts WHERE status = 'inactive';

-- 012 + 013 (+ "013 ... 2"): bank statement imports (transfers)
-- SELECT count(*) AS transfer_rows FROM transfers;
-- SELECT EXISTS (SELECT 1 FROM transfers WHERE transfer_id_code = 'AWB-IMPORT-SENTINEL') AS awash_import_ran;

-- 014: bank_ref backfill (1035 records)
-- SELECT count(*) AS expenses_with_bank_ref FROM expenses WHERE bank_ref IS NOT NULL;

-- 028: stock catalog seed
-- SELECT count(*) AS stock_items FROM stock_items;

-- 037: vendor seed from Airtable
-- SELECT count(*) AS vendors FROM vendors;

-- 038: expense seed from Airtable (2,710 rows expected)
-- SELECT count(*) AS total_expenses FROM expenses;

-- 040: vendor_id backfill on pre-existing expenses
-- SELECT count(*) AS expenses_with_vendor FROM expenses WHERE vendor_id IS NOT NULL;

-- fix_expense_code_dupes* (superseded by 042's trigger fix): confirm
-- no duplicate expense codes remain
-- SELECT expense_code, count(*) FROM expenses WHERE expense_code IS NOT NULL
--   GROUP BY expense_code HAVING count(*) > 1;
