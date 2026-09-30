import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, BellRing, Check, CheckCheck, ChevronDown, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { WidgetContext, WidgetProps } from '@/lib/dashboard/types'
import { TONE_CLASSES, useWaitingOn, type WaitingItem } from '@/lib/dashboard/waiting'
import { ListSkeleton, WidgetCard } from '../WidgetCard'

// ── Deciding from the dashboard ──────────────────────────────────────────
// Two queues can be decided right here, with exactly the change their own
// page makes:
//   · finance approval — expenses.approval_status → 'finance_approved', as
//     the Payments page's Approve button (admin/finance, manager-approved
//     rows only; the database's own checks still apply);
//   · leave — leave_requests.status → approved/rejected with approved_by
//     and approved_at, as the Leave Requests page.
// Everything else (paying, matching a bank line, purchase orders with their
// approval caps) needs its page, so those rows open it.

type Decision = 'approve' | 'reject'

interface DecisionRow {
  id: string
  title: string
  subtitle: string
  amount?: string | null
  age: string
  /** Why there's no button, when there isn't one. */
  note?: string | null
  canDecide: boolean
  canReject: boolean
  to: string
}

interface QueueSource {
  fetch: (ctx: WidgetContext) => Promise<DecisionRow[]>
  decide: (id: string, d: Decision, actorId: string) => Promise<{ error: { message: string } | null }>
  done: Record<Decision, string>
  /** Page caches to refresh after a decision. */
  invalidate: string[][]
}

function ageOf(iso: string | null | undefined): string {
  if (!iso) return ''
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) {
    const hours = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000))
    return `${hours}h`
  }
  return `${days}d`
}

const leaveSource = (mine: boolean): QueueSource => ({
  fetch: async ctx => {
    let q = supabase.from('leave_requests')
      .select('id, leave_type, start_date, end_date, days, created_at, staff(employee_name)')
      .eq('status', 'pending')
      .order('created_at')
      .limit(8)
    if (mine) q = q.eq('assigned_approver_id', ctx.userId)
    const { data, error } = await q
    if (error) throw error
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((data ?? []) as any[]).map(r => ({
      id: r.id,
      title: r.staff?.employee_name ?? 'Someone',
      subtitle: [
        `${r.days ?? '?'} day${Number(r.days) === 1 ? '' : 's'} ${String(r.leave_type ?? 'leave').replace(/_/g, ' ')}`,
        [formatDate(r.start_date), r.end_date && r.end_date !== r.start_date ? formatDate(r.end_date) : null].filter(Boolean).join(' → '),
      ].join(' · '),
      age: ageOf(r.created_at),
      canDecide: true,
      canReject: true,
      to: '/leave-requests',
    }))
  },
  decide: async (id, d, actorId) => {
    const { error } = await supabase.from('leave_requests')
      .update({ status: d === 'approve' ? 'approved' : 'rejected', approved_by: actorId, approved_at: new Date().toISOString() })
      .eq('id', id)
    return { error }
  },
  done: { approve: 'Leave approved', reject: 'Leave rejected' },
  invalidate: [['leave-requests']],
})

const SOURCES: Record<string, QueueSource> = {
  'fin-approve': {
    fetch: async ctx => {
      const { data, error } = await supabase.from('v_finance_pending_approval')
        .select('id, expense_code, item_service_description, vendor_name, project_name, amount_etb, approval_status, created_at')
        .order('created_at')
        .limit(8)
      if (error) throw error
      const canAct = ctx.role === 'admin' || ctx.role === 'finance'
      return (data ?? []).map(r => ({
        id: r.id,
        title: r.item_service_description || r.vendor_name || r.expense_code || 'Expense',
        subtitle: [r.vendor_name, r.project_name, r.expense_code].filter(Boolean).join(' · '),
        amount: formatCurrency(Number(r.amount_etb ?? 0)),
        age: ageOf(r.created_at),
        canDecide: canAct && r.approval_status === 'manager_approved',
        canReject: false,
        note: r.approval_status === 'pending' ? 'Awaiting manager' : null,
        to: `/expenses/${r.id}`,
      }))
    },
    decide: async id => {
      const { error } = await supabase.from('expenses').update({ approval_status: 'finance_approved' }).eq('id', id)
      return { error }
    },
    done: { approve: 'Approved — moved to the to-pay queue', reject: '' },
    invalidate: [['v-finance-pending-approval'], ['v-to-pay-queue']],
  },
  'leave-mine': leaveSource(true),
  'hr-leave': leaveSource(false),
}

// A decision takes two presses: the first arms the button, the second acts.
// It disarms itself after a few seconds, so a stray click never decides.
function DecideButton({ label, tone, onConfirm, busy }: { label: string; tone: 'go' | 'stop'; onConfirm: () => void; busy: boolean }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 4000)
    return () => window.clearTimeout(t)
  }, [armed])
  const base = 'flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition disabled:opacity-50'
  const cls = armed
    ? tone === 'go' ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-red-600 text-white hover:bg-red-700'
    : tone === 'go' ? 'bg-slate-900 text-white hover:bg-slate-700 dark:bg-brand dark:text-brand-foreground' : 'border text-slate-500 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700'
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}
      className={`${base} ${cls}`}
      aria-label={armed ? `Confirm ${label.toLowerCase()}` : label}
    >
      {tone === 'go' ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
      {armed ? 'Confirm?' : label}
    </button>
  )
}

function QueueDecisions({ ctx, item, canAct }: { ctx: WidgetContext; item: WaitingItem; canAct: boolean }) {
  const source = SOURCES[item.id]
  const { toast } = useToast()
  const { user } = useAuth()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ['dash', 'decisions', item.id, ctx.userId],
    queryFn: () => source.fetch(ctx),
    staleTime: 30_000,
  })

  async function decide(row: DecisionRow, d: Decision) {
    if (!user) return
    setBusy(row.id)
    const { error: err } = await source.decide(row.id, d, user.id)
    setBusy(null)
    if (err) { toast(err.message, 'error'); return }
    toast(source.done[d], 'success')
    qc.invalidateQueries({ queryKey: ['dash'] })
    for (const key of source.invalidate) qc.invalidateQueries({ queryKey: key })
  }

  if (isLoading) return <ListSkeleton rows={2} />
  if (error) return <p className="px-3 py-3 text-xs text-red-500">{(error as Error).message}</p>
  if (rows.length === 0) return <p className="px-3 py-3 text-xs text-slate-400">Nothing left here.</p>

  return (
    <ul className="space-y-1.5 px-1 pb-2 pt-1">
      {rows.map(r => (
        <li key={r.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 dark:bg-slate-900/40">
          <Link to={r.to} className="min-w-0 flex-1 hover:underline">
            <span className="block truncate text-sm text-slate-800 dark:text-slate-100">{r.title}</span>
            <span className="block truncate text-[11px] text-slate-400">{r.subtitle}</span>
          </Link>
          {r.amount && <span className="hidden shrink-0 text-xs font-semibold tabular-nums text-slate-700 sm:block dark:text-slate-200">{r.amount}</span>}
          {r.age && <span className="shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-300">{r.age}</span>}
          {canAct && r.canDecide ? (
            <>
              {r.canReject && <DecideButton label="Reject" tone="stop" busy={busy === r.id} onConfirm={() => decide(r, 'reject')} />}
              <DecideButton label="Approve" tone="go" busy={busy === r.id} onConfirm={() => decide(r, 'approve')} />
            </>
          ) : r.note ? (
            <span className="shrink-0 text-[11px] text-slate-400">{r.note}</span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

// ── Needs you now ─────────────────────────────────────────────────────────
// Everything that needs this person's decision or action, from every module
// they work in: one row per queue, with its count and a way in. Queues that
// can be decided here open into their items.
export function WaitingOnYou({ ctx }: WidgetProps) {
  const { items, total, isLoading } = useWaitingOn(ctx)
  const { user } = useAuth()
  // Deciding is for your own dashboard; an admin arranging someone else's
  // sees what they'd see, without acting as them.
  const canAct = !!user && user.id === ctx.userId
  const firstDecidable = items.find(i => SOURCES[i.id])?.id ?? null
  const [open, setOpen] = useState<string | null | undefined>(undefined)
  const openId = open === undefined ? firstDecidable : open

  return (
    <WidgetCard title="Needs you now" icon={BellRing} count={total}>
      {isLoading ? <ListSkeleton rows={3} />
        : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <span className="rounded-full bg-emerald-50 p-2.5 text-emerald-500 dark:bg-emerald-900/25"><CheckCheck className="h-5 w-5" /></span>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">You're all caught up</p>
            <p className="text-xs text-slate-400">Nothing is waiting on you right now.</p>
          </div>
        ) : (
          <ul className="space-y-2 px-3 pb-3">
            {items.map(i => {
              const tone = TONE_CLASSES[i.tone]
              const decidable = !!SOURCES[i.id]
              const expanded = decidable && openId === i.id
              return (
                <li key={i.id} className={`rounded-xl border transition dark:border-slate-700 ${expanded ? 'border-slate-300 shadow-sm dark:border-slate-500' : 'hover:border-slate-300 dark:hover:border-slate-500'}`}>
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <span className={`h-8 w-1 shrink-0 rounded-full ${tone.bar}`} />
                    <span className={`rounded-lg p-1.5 ${tone.chip}`}><i.icon className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100">{i.title}</span>
                    <span className="shrink-0 text-lg font-bold tabular-nums text-slate-800 dark:text-slate-100">{i.n}</span>
                    {decidable ? (
                      <button
                        type="button"
                        onClick={() => setOpen(expanded ? null : i.id)}
                        aria-expanded={expanded}
                        className="flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        {expanded ? 'Hide' : 'Review'} <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                      </button>
                    ) : (
                      <Link to={i.to} className="flex shrink-0 items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 dark:bg-brand dark:text-brand-foreground">
                        Open <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                  {expanded && (
                    <div className="border-t px-2 dark:border-slate-700">
                      <QueueDecisions ctx={ctx} item={i} canAct={canAct} />
                      <Link to={i.to} className="mb-2 ml-1 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
                        Open the full list <ArrowRight className="h-3 w-3" />
                      </Link>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
    </WidgetCard>
  )
}
