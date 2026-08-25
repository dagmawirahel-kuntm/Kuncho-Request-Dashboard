-- Procurement reported the PR-item picker on the new-sourcing-bundle
-- page (SourcingBundleFormPage) only shows urgency and the PR code —
-- never the project. Root cause confirmed live: procurement_officer
-- has broad SELECT on `orders` (raa_orders_select) but no SELECT
-- policy on `projects` at all. The picker's query embeds
-- orders.projects(project_name); PostgREST silently returns null for
-- an embedded relation the requester's RLS denies (no error), so the
-- project badge (SourcingBundleFormPage.tsx ~line 685,
-- `{order.projects && (...)}`) never renders for this role even though
-- the code to show it was already there.
--
-- Fix: give procurement_officer read access to projects, matching the
-- existing unconditional-role-read pattern already used for
-- stock_manager (stock_manager_read_projects) and logistics_officer.

SET search_path TO public;

CREATE POLICY procurement_officer_read_projects ON projects
  FOR SELECT
  USING (get_user_role() = 'procurement_officer');
