-- The Log Attendance page and the Work Order crew panel need to show
-- Tier 2 casual-worker badges (employment_type + trade_tag + codenames)
-- for crew members, but project_manager/operations_manager/site-foreman
-- callers have no RLS read access to `staff` at all (see v_staff_directory's
-- original comment). Embedding staff(...) on work_order_crew for those
-- roles silently returns null rows instead of erroring, so names and Tier 2
-- badges never rendered. v_staff_directory already solves this for
-- employee_name elsewhere (WorkOrderDetailPage, WorkOrdersPage,
-- WorkshopViewPage) — extend it with the same non-sensitive Tier 2 display
-- fields so Log Attendance and the crew panel can do the same fallback.
CREATE OR REPLACE VIEW public.v_staff_directory AS
SELECT id, employee_name, role, staff_type, department_id, sub_team,
       phone_number, photo_url, reports_to_id, status,
       employment_type, trade_tag, codename_amharic, codename_english
FROM public.staff;
