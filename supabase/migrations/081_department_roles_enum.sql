-- ============================================================
-- Add four role enum values for the departments introduced by the
-- ops manual's department list (§3.2) that don't yet have a role:
-- Design, Business Development/Sales, HSE, and an Operations Manager
-- over Operations/Construction.
--
-- This migration ONLY adds enum values — nothing else. Postgres
-- (still true on PG17) won't let a value added by ALTER TYPE ... ADD
-- VALUE be referenced (in a policy, default, cast, or comparison) in
-- the same transaction that added it. The Supabase SQL editor runs
-- each pasted migration as one transaction, so every later migration
-- that uses these roles (082+) must be pasted and run separately,
-- after this one has committed on its own.
--
-- Additive only: enum values can't be removed or reordered in
-- Postgres, so this never touches the 9 existing roles (admin,
-- manager, finance, staff, procurement_officer, hr_officer,
-- project_manager, stock_manager, logistics_officer). Nobody is
-- forced off their current role — re-tagging specific people to one
-- of these new roles is a later data step (UPDATE user_profiles),
-- not a schema change.
--
-- Department -> role map (referenced across migrations 082-086):
--   Design                      -> design
--   Operations/Construction     -> operations_manager, project_manager, stock_manager, logistics_officer
--     (Workshop/Production staff fold into Operations/Construction —
--     confirmed: no separate Workshop department; see migration 082)
--   Procurement & Logistics     -> procurement_officer, logistics_officer
--   Finance & Admin             -> finance, admin
--   Business Development/Sales  -> sales
--   HR & People                 -> hr_officer
--   HSE                         -> hse_officer
-- ============================================================

SET search_path TO public;

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'design';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'sales';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'hse_officer';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'operations_manager';

-- Verify: should list 13 roles total (9 existing + these 4)
SELECT enumlabel FROM pg_enum WHERE enumtypid = 'user_role'::regtype ORDER BY enumsortorder;
