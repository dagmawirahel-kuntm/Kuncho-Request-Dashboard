// One scale for every skills screen. Scores are 1–5 against a job
// description's responsibilities; 3 is the line where a responsibility
// counts as met (v_staff_skill_level, migration 398).

export const SCORE_WORDS: Record<number, string> = {
  1: 'Learning',
  2: 'Needs supervision',
  3: 'Works on their own',
  4: 'Strong',
  5: 'Can teach others',
}

export const MET_SCORE = 3

export type SkillLevel = 'Advanced' | 'Intermediate' | 'Beginner'

export const SKILL_LEVEL_TONE: Record<SkillLevel, string> = {
  Advanced: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  Intermediate: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  Beginner: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
}

export const SKILL_LEVEL_HINT: Record<SkillLevel, string> = {
  Advanced: 'Every responsibility at 3 or more',
  Intermediate: 'All the basics at 3 or more',
  Beginner: 'Some basics still below 3',
}

export interface SkillLevelRow {
  staff_id: string
  job_description_id: string
  role_name: string
  foundational_checked: number
  foundational_total: number
  differentiator_checked: number
  differentiator_total: number
  skill_level: SkillLevel
  avg_score: number | null
  rated_count: number
  total_count: number
  last_rated_at: string | null
  is_main_role: boolean
}

// Guess a job description from what the staff record already says.
// Only a suggestion for HR to accept; matched on the JD's exact name.
const JD_HINTS: [RegExp, string][] = [
  [/ass(\.|istant)?\s*carpenter|installer|assembl/i, 'FF&E Site Installer / Assembly Technician'],
  [/carpenter|cabinet|cnc|chisel|wood/i, 'FF&E Carpenter / Cabinet Maker (Woodwork)'],
  [/leather|upholster/i, 'Custom Upholsterer'],
  [/paint|finish|spray/i, 'Furniture Finisher / Spray Painter'],
  [/weld|metal|fabricat/i, 'FF&E Metal Fabricator / Welder'],
  [/purchas|procure/i, 'Procurement Officer'],
  [/logistic/i, 'Logistics Officer'],
  [/stock|store ?keep|resources control/i, 'Stock Manager'],
  [/financ|account|cashier/i, 'Finance Officer'],
  [/design/i, 'Designer'],
  [/sales|business dev/i, 'Business Development'],
  [/project manager/i, 'Project Manager'],
  [/\bhr\b|human res/i, 'HR Officer'],
  [/\bhse\b|safety/i, 'HSE Officer'],
]

export function suggestJobDescription(
  person: { role?: string | null; staff_type?: string | null; trade_tag?: string | null },
  jds: { id: string; role_name: string }[],
): { id: string; role_name: string } | null {
  const text = [person.role, person.trade_tag, person.staff_type].filter(Boolean).join(' ')
  if (!text) return null
  for (const [re, name] of JD_HINTS) {
    if (re.test(text)) return jds.find(j => j.role_name === name) ?? null
  }
  return null
}
