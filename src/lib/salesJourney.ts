import type { OpportunitySource, OpportunityStage } from '@/types/database'

/** A deal's stages, in order (migration 330). */
export const STAGES: { value: OpportunityStage; label: string; cls: string }[] = [
  { value: 'lead',        label: 'Lead',        cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
  { value: 'qualified',   label: 'Qualified',   cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
  { value: 'site_visit',  label: 'Site visit',  cls: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300' },
  { value: 'quoted',      label: 'Quoted',      cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  { value: 'negotiating', label: 'Negotiating', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  { value: 'won',         label: 'Won',         cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  { value: 'lost',        label: 'Lost',        cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
]
export const STAGE_BY_VALUE = Object.fromEntries(STAGES.map(s => [s.value, s])) as Record<OpportunityStage, (typeof STAGES)[number]>
/** Stages still in play — the pipeline. */
export const OPEN_STAGES: OpportunityStage[] = ['lead', 'qualified', 'site_visit', 'quoted', 'negotiating']

export const SOURCES: { value: OpportunitySource; label: string }[] = [
  { value: 'word_of_mouth', label: 'Word of mouth' },
  { value: 'associate',     label: 'Business associate' },
  { value: 'repeat_client', label: 'Repeat client' },
  { value: 'tender',        label: 'Tender' },
  { value: 'other',         label: 'Other' },
]
export const SOURCE_LABEL = Object.fromEntries(SOURCES.map(s => [s.value, s.label])) as Record<OpportunitySource, string>

/** The usual contract payment plan: advance, progress, final. */
export const DEFAULT_PLAN = { advance: 30, progress: 60, final: 10 }
