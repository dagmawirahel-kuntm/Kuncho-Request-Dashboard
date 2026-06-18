-- ═══════════════════════════════════════════════════════════════
-- Add domain-specific roles: procurement_officer, hr_officer, project_manager
-- ═══════════════════════════════════════════════════════════════

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'procurement_officer';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'hr_officer';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'project_manager';
