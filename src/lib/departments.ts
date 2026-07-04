// Single source of truth for department identity across the app.
// Used by staff lists, profiles, dashboards, and the company calendar
// so a department always appears in the same color everywhere.

export interface DeptColor {
  bg: string     // solid background (avatars, accents)
  text: string   // text color on the solid background
  pill: string   // tailwind classes for pill/badge rendering
}

export const DEPT_COLORS: Record<string, DeptColor> = {
  'Office':           { bg: '#1D4ED8', text: '#fff', pill: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  'Work Shop':        { bg: '#D97706', text: '#fff', pill: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  'Field':            { bg: '#059669', text: '#fff', pill: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  'Leather Workshop': { bg: '#7C3AED', text: '#fff', pill: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
  'Site':             { bg: '#0891B2', text: '#fff', pill: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300' },
}

export const DEPARTMENTS = Object.keys(DEPT_COLORS)

export function getDeptColor(dept: string | null | undefined): DeptColor {
  return DEPT_COLORS[dept ?? ''] ?? {
    bg: '#475569', text: '#fff',
    pill: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  }
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase()
}

// Management seniority tier — independent of department, shown as a badge.
export const MANAGEMENT_LEVELS = ['upper', 'medium', 'low'] as const

export const MANAGEMENT_LEVEL_META: Record<string, { label: string; pill: string }> = {
  upper:  { label: 'Upper Management',  pill: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  medium: { label: 'Medium Management', pill: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  low:    { label: 'Low Level',         pill: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
}

export function getManagementLevelMeta(level: string | null | undefined) {
  return level ? MANAGEMENT_LEVEL_META[level] ?? null : null
}
