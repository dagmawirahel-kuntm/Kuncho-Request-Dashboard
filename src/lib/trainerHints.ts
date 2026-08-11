// ── Trainer hints: hard-coded next-step / backfill nudges ──────────────────
//
// No DB hint layer, no workflow engine — every hint here is a plain
// pattern match on entity state already loaded by the host page. Adding a
// hint means adding a branch below, nothing else.
//
// A few of the spec's hint names don't map 1:1 onto this codebase's real
// schema/UI. Where that happened, the adaptation is noted inline:
//   - ProjectStage has no 'Initiation' value; 'business_development' (the
//     earliest stage) stands in for it, 'design_approvals' for 'Design'.
//   - Proformas have no opportunity_id column, so the opportunity→proforma
//     check below matches on client_id instead (same fallback the spec
//     itself prescribes for the proforma→contract check).
//   - Proformas have no per-record detail page anywhere in the app (only a
//     flat list and a client-scoped create flow) — the two hints that would
//     live on a proforma's own page aren't wired to anything in this PR,
//     since there's nowhere to put them without inventing a page the ticket
//     didn't ask for.
//   - This codebase's procurement pipeline has no "vendor quotes" entity —
//     an Order's items go straight from pending to sourced. The PR-level
//     hints below are adapted to that shape (items sourced vs. not, then a
//     PO bundling them) rather than a quotes step that doesn't exist.
//   - A SourcingBundle's own expense_id *is* the vendor invoice/expense in
//     this codebase, and the "to-pay queue" is a live view driven by
//     expense state — there's no separate "log invoice" / "move to queue"
//     step to hint about, so those two hints fold into the expense-state
//     hints instead.

export type TrainerHintVariant = 'next_step' | 'backfill'

export interface TrainerHint {
  variant: TrainerHintVariant
  code: string
  message: string
  why: string
  actionLabel: string
  actionRoute: string
}

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

// ── Per-entity input shapes ─────────────────────────────────────────────
// Deliberately narrow — each host page passes only what it already has
// loaded (extending its existing fetch where a related-entity check is
// needed), never triggers a fetch of its own.

export interface ClientHintInput {
  entityType: 'client'
  id: string
  hasOpportunities: boolean
  hasProjects: boolean
}

export interface OpportunityHintInput {
  entityType: 'opportunity'
  id: string
  clientId: string | null
  stage: string
  hasProforma: boolean
}

export interface ContractHintInput {
  entityType: 'contract'
  id: string
  clientId: string
  status: string
  projectId: string | null
}

export interface ProjectHintInput {
  entityType: 'project'
  id: string
  clientId: string | null
  stage: string | null
  createdAt: string
  hasContract: boolean
  contractHasOpportunity: boolean
}

export interface PurchaseRequestHintInput {
  entityType: 'purchase_request'
  id: string
  approvalStatus: string | null
  hasItems: boolean
  hasPendingItems: boolean
  allItemsResolved: boolean
  hasBundle: boolean
}

export interface PurchaseOrderHintInput {
  entityType: 'purchase_order'
  id: string
  status: string
  orderedAt: string | null
  hasGrn: boolean
  hasExpense: boolean
}

export interface ExpenseHintInput {
  entityType: 'expense'
  id: string
  approvalStatus: string | null
  accountId: string | null
  hasUnresolvedLedgerFailure: boolean
  isFinanceUser: boolean
}

export type HintInput =
  | ClientHintInput
  | OpportunityHintInput
  | ContractHintInput
  | ProjectHintInput
  | PurchaseRequestHintInput
  | PurchaseOrderHintInput
  | ExpenseHintInput

export function resolveHint(input: HintInput): TrainerHint | null {
  switch (input.entityType) {
    case 'client': {
      if (!input.hasOpportunities && !input.hasProjects) {
        return {
          variant: 'next_step',
          code: 'client.no_opportunity',
          message: 'This client has no opportunities on record. Log the first one to start tracking sales.',
          why: 'Opportunities are the entry point of the sales pipeline — nothing here shows up in pipeline reporting until one exists.',
          actionLabel: 'Create Opportunity',
          actionRoute: `/opportunities/new?client_id=${input.id}`,
        }
      }
      if (!input.hasOpportunities && input.hasProjects) {
        return {
          variant: 'backfill',
          code: 'client.projects_without_opportunities',
          message: 'This client has projects but no opportunities recorded. Add historical opportunities to complete the sales history.',
          why: 'Projects exist for this client, so a sale clearly happened — logging the opportunity backfills the pipeline history for reporting.',
          actionLabel: 'Create Opportunity',
          actionRoute: `/opportunities/new?client_id=${input.id}`,
        }
      }
      return null
    }

    case 'opportunity': {
      if (input.stage === 'qualified' && !input.hasProforma) {
        return {
          variant: 'next_step',
          code: 'opportunity.qualified_no_proforma',
          message: 'Prepare a proforma for this opportunity.',
          why: 'This opportunity is qualified — a proforma gives the client pricing to react to before the deal can move further.',
          actionLabel: 'Create Proforma',
          actionRoute: input.clientId ? `/clients/${input.clientId}/proforma` : '/clients',
        }
      }
      return null
    }

    case 'contract': {
      if (input.status === 'signed' && !input.projectId) {
        return {
          variant: 'next_step',
          code: 'contract.signed_no_project',
          message: 'Create the project for this signed contract.',
          why: "The contract is signed but has no project yet — work can't be tracked, budgeted, or billed against it until one exists.",
          actionLabel: 'Create Project',
          actionRoute: '/projects/new',
        }
      }
      return null
    }

    case 'project': {
      // Forward hints beat backfill hints on the same entity (guardrail),
      // so the ready-to-advance check runs before either backfill check.
      const days = daysSince(input.createdAt)
      if (input.stage === 'business_development' && input.hasContract && days != null && days > 7) {
        return {
          variant: 'next_step',
          code: 'project.initiation_ready_for_design',
          message: 'Move this project into Design & Approvals to begin work.',
          why: "This project has a signed contract and has sat in Business Development for over a week — it's ready to advance.",
          actionLabel: 'Open Stage Panel',
          actionRoute: `/projects/${input.id}#stage`,
        }
      }
      if (!input.hasContract) {
        return {
          variant: 'backfill',
          code: 'project.no_contract_link',
          message: 'This project has no contract on file. Link an existing contract or create one for reporting continuity.',
          why: 'Projects without a linked contract break the sales-to-delivery trail used in reporting.',
          actionLabel: 'Create Contract',
          actionRoute: input.clientId ? `/contracts/new?client_id=${input.clientId}` : '/contracts',
        }
      }
      // Suppressed when the no-contract hint above already fired.
      if (!input.contractHasOpportunity) {
        return {
          variant: 'backfill',
          code: 'project.no_opportunity_link',
          message: "No upstream opportunity recorded for this project's contract. Link one if it existed to complete the sales history.",
          why: 'The contract behind this project has no opportunity tied to it — that\'s a gap in the sales pipeline history.',
          actionLabel: 'Create Opportunity',
          actionRoute: input.clientId ? `/opportunities/new?client_id=${input.clientId}` : '/opportunities',
        }
      }
      return null
    }

    case 'purchase_request': {
      if (input.approvalStatus === 'rejected') return null
      if (input.hasItems && input.hasPendingItems) {
        return {
          variant: 'next_step',
          code: 'purchase_request.approved_items_not_sourced',
          message: "Source vendors for this purchase request's items.",
          why: 'Items on this request are still unsourced — mark each one sourced once a vendor and price are settled.',
          actionLabel: 'Open Purchase Request',
          actionRoute: `/purchase-requests/${input.id}`,
        }
      }
      if (input.hasItems && input.allItemsResolved && !input.hasBundle) {
        return {
          variant: 'next_step',
          code: 'purchase_request.sourced_no_po',
          message: 'Generate a purchase order for the sourced items.',
          why: 'Every item on this request has been sourced, but no purchase order bundles them yet.',
          actionLabel: 'Create Purchase Order',
          actionRoute: '/sourcing/new',
        }
      }
      return null
    }

    case 'purchase_order': {
      if (input.status === 'ordered' && !input.hasGrn) {
        const days = daysSince(input.orderedAt)
        if (days != null && days > 7) {
          return {
            variant: 'next_step',
            code: 'po.issued_no_grn',
            message: 'Confirm receipt of materials for this PO (GRN).',
            why: 'This PO was ordered over a week ago with nothing logged as received yet.',
            actionLabel: 'Log GRN',
            actionRoute: `/sourcing/${input.id}/grn/new`,
          }
        }
      }
      if (input.hasGrn && !input.hasExpense) {
        return {
          variant: 'next_step',
          code: 'po.delivered_no_invoice',
          message: 'Log the vendor invoice for this delivered PO.',
          why: 'Materials were received but no vendor invoice/expense has been logged against this PO yet.',
          actionLabel: 'Open Purchase Order',
          actionRoute: `/sourcing/${input.id}`,
        }
      }
      return null
    }

    case 'expense': {
      // Ledger failure beats every other expense hint (guardrail).
      if (input.hasUnresolvedLedgerFailure) {
        return {
          variant: 'next_step',
          code: 'expense.paid_no_ledger',
          message: 'This payment failed to post to the ledger — resolve to keep books consistent.',
          why: 'The payment went through but the journal entry failed (most likely a missing account or category mapping) — the ledger and this expense are now out of sync.',
          actionLabel: 'View in Ledger',
          actionRoute: '/finance/ledger?tab=failures',
        }
      }
      if (input.approvalStatus === 'pending') {
        return {
          variant: 'next_step',
          code: 'expense.draft',
          message: 'Submit this expense for manager approval.',
          why: 'Nothing downstream acts on an expense until it clears manager approval.',
          actionLabel: 'Open Expense',
          actionRoute: `/expenses/${input.id}/edit`,
        }
      }
      if (input.approvalStatus === 'manager_approved') {
        if (!input.isFinanceUser) return null
        return {
          variant: 'next_step',
          code: 'expense.manager_approved_not_finance_approved',
          message: 'Finance to review and approve this expense.',
          why: 'Manager approval is in — finance sign-off is the last gate before this can be scheduled for payment.',
          actionLabel: 'Open in Finance Queue',
          actionRoute: '/finance/payments',
        }
      }
      if (input.approvalStatus === 'finance_approved' && !input.accountId) {
        return {
          variant: 'next_step',
          code: 'expense.finance_approved_no_account',
          message: 'Assign a cash account and confirm payment.',
          why: "Finance has approved this expense but no payment account is set yet — it can't be marked paid without one.",
          actionLabel: 'Assign Cash Account',
          actionRoute: `/expenses/${input.id}/edit`,
        }
      }
      return null
    }

    default:
      return null
  }
}

// ── Session-scoped dismissal ────────────────────────────────────────────

const DISMISS_STORAGE_KEY = 'trainer_dismissed_hints'

function readDismissed(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DISMISS_STORAGE_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

export function dismissHintKey(entityType: string, entityId: string, hintCode: string): string {
  return `${entityType}:${entityId}:${hintCode}`
}

export function isHintDismissed(entityType: string, entityId: string, hintCode: string): boolean {
  return readDismissed().has(dismissHintKey(entityType, entityId, hintCode))
}

export function dismissHint(entityType: string, entityId: string, hintCode: string): void {
  const dismissed = readDismissed()
  dismissed.add(dismissHintKey(entityType, entityId, hintCode))
  try {
    sessionStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify([...dismissed]))
  } catch {
    // sessionStorage unavailable (private mode, etc.) — dismissal just won't persist this tab
  }
}
