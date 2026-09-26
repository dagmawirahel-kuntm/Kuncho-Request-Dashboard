import type { UserRole } from '@/types/database'

// Explicit role landings take priority over department resolution —
// these are roles with their own composed view, independent of which
// department row they happen to be tagged with (Operations &
// Construction's own role split predates department-based routing
// entirely, and stays exactly as it was). admin is deliberately absent
// here (falls through to /dashboard, which renders the exempt-only
// GeneralDashboard for them — spec §0.4).
export const ROLE_LANDING: Partial<Record<UserRole, string>> = {
  finance: '/finance/payments',
  procurement_officer: '/procurement',
  project_manager: '/pm-view',
  operations_manager: '/ops-manager-view',
  stock_manager: '/stock-manager-view',
  logistics_officer: '/logistics-view',
  design: '/design-view',
  sales: '/sales-view',
  hr_officer: '/hr-view',
  hse_officer: '/hse-view',
  staff: '/my-home',
}

// Department name -> landing route, used as a fallback for any role
// NOT in ROLE_LANDING (e.g. 'executive', or a future role not yet given
// its own entry) — resolves via the department the person's staff
// record is actually assigned to (spec §1: "resolve the user's
// department, and role for Operations & Construction specifically").
export const DEPARTMENT_LANDING: Record<string, string> = {
  'Design': '/design-view',
  'Operations/Construction': '/ops-manager-view',
  'Procurement & Logistics': '/procurement',
  'Finance & Admin': '/finance/payments',
  'Business Development/Sales': '/sales-view',
  'HR & People': '/hr-view',
  'HSE': '/hse-view',
}

/** Every page a person can land on after signing in — where the seasonal
 *  greeting is shown, and nowhere else. */
export const LANDING_PATHS: ReadonlySet<string> = new Set([
  '/home',
  '/dashboard',
  ...Object.values(ROLE_LANDING).filter((p): p is string => !!p),
  ...Object.values(DEPARTMENT_LANDING),
])
