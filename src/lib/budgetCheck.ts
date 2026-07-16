import { supabase } from './supabase'
import { formatCurrency } from './utils'
import type { BudgetCheckOutcome, BudgetCheckSource } from '@/types/database'

// Phase 2 point-of-spend check — warn-only. Reused by the PR and PO
// forms so the logic (and the "when does this even apply" judgment
// call) exists in exactly one place. Never blocks a submission today;
// no enforcing path exists yet — see budget_check_mode (074) and
// budget_check_log (077).
const SAFETY_MARGIN_PCT = 0.05

export interface BudgetCheckResult {
  outcome: BudgetCheckOutcome
  message: string | null
  costGroupName: string | null
  remainingBefore: number | null
  budgetedAmount: number | null
}

function unavailable(costGroupName: string | null = null, remainingBefore: number | null = null): BudgetCheckResult {
  return { outcome: 'unavailable', message: null, costGroupName, remainingBefore, budgetedAmount: null }
}

/**
 * Checks a requested spend of `requestedAmount` against a project's
 * cost-group budget. Returns 'unavailable' (never blocks) when:
 *  - there's no project or cost group to check against
 *  - the category maps to Unallocated (costGroupId is null)
 *  - the project has no locked budget baseline yet
 *  - the cost group is Labor (provisional — see Phase 1's handling)
 */
export async function checkProjectBudget(
  projectId: string | null,
  costGroupId: string | null,
  requestedAmount: number,
): Promise<BudgetCheckResult> {
  if (!projectId || !requestedAmount || requestedAmount <= 0) return unavailable()
  if (!costGroupId) return unavailable('Unallocated')

  const [{ data: summary }, { data: group }] = await Promise.all([
    supabase.from('v_project_budget_summary').select('budget_baseline_locked_at').eq('project_id', projectId).maybeSingle(),
    supabase.from('v_project_cost_group_budget').select('cost_group_name, budgeted_amount, remaining_amount, is_provisional')
      .eq('project_id', projectId).eq('cost_group_id', costGroupId).maybeSingle(),
  ])

  if (!summary?.budget_baseline_locked_at || !group) return unavailable(group?.cost_group_name ?? null, group?.remaining_amount ?? null)
  if (group.is_provisional) return unavailable(group.cost_group_name, group.remaining_amount)

  const remainingAfter = group.remaining_amount - requestedAmount
  const marginFloor = group.budgeted_amount * SAFETY_MARGIN_PCT

  if (remainingAfter < 0) {
    return {
      outcome: 'block',
      message: `This exceeds the approved budget for ${group.cost_group_name}. Raise a variation order or contact finance.`,
      costGroupName: group.cost_group_name,
      remainingBefore: group.remaining_amount,
      budgetedAmount: group.budgeted_amount,
    }
  }
  if (remainingAfter < marginFloor) {
    return {
      outcome: 'warn',
      message: `Close to the approved budget for ${group.cost_group_name} — ${formatCurrency(remainingAfter)} would remain.`,
      costGroupName: group.cost_group_name,
      remainingBefore: group.remaining_amount,
      budgetedAmount: group.budgeted_amount,
    }
  }
  return {
    outcome: 'allow',
    message: null,
    costGroupName: group.cost_group_name,
    remainingBefore: group.remaining_amount,
    budgetedAmount: group.budgeted_amount,
  }
}

export async function logBudgetCheck(params: {
  source: BudgetCheckSource
  sourceRef?: string | null
  projectId: string | null
  costGroupId: string | null
  requestedAmount: number
  result: BudgetCheckResult
  userId?: string | null
}) {
  // Best-effort — a logging failure should never block the real PR/PO submit
  try {
    await supabase.from('budget_check_log').insert([{
      source: params.source,
      source_ref: params.sourceRef ?? null,
      project_id: params.projectId,
      cost_group_id: params.costGroupId,
      requested_amount: params.requestedAmount,
      remaining_before: params.result.remainingBefore,
      outcome: params.result.outcome,
      mode: 'warn_only',
      created_by: params.userId ?? null,
    }])
  } catch {
    // swallow — audit logging is advisory, never load-bearing
  }
}
