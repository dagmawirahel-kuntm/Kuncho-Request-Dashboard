import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency } from '@/lib/utils'
import { Pill } from '@/components/record/Record'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { UnverifiedVendorFlag } from '@/components/vendors/UnverifiedVendorFlag'
import { WithholdingModal } from '@/components/shared/WithholdingModal'
import type { ExpensePaymentMethod, ToPayQueueRow } from '@/types/database'
import { PAYMENT_METHODS, ageLabel, ageTone, toSend, usePayerAndAccountOptions, useRefreshPayments } from '@/lib/payments'
import { CreateBatchModal, PartialSplitModal, RecordAdvanceModal, WhtCell } from './PaymentModals'
import { AlertTriangle, CheckCircle2, HandCoins, Layers, Search, Send, X } from 'lucide-react'
import { useRefreshTaxImpact, useTaxImpact, type ImpactItem } from '@/lib/taxImpact'
import { TaxTag } from '@/components/tax/TaxTag'
import { TaxImpactCountdown, TaxImpactEscalations } from '@/components/tax/TaxImpactBanners'

// To pay: everything finance has approved, oldest first, split by how it is
// paid — on delivery (select and send together) or in advance (each one
// recorded on its own, because it waits on a GRN to close).

type Sort = 'oldest' | 'largest' | 'impact'

export default function ToPayTab({ rows, loading, canAct }: { rows: ToPayQueueRow[]; loading: boolean; canAct: boolean }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const refreshPayments = useRefreshPayments()
  // Tax impact (migration 423): the same T-tags as the approval queue and the PO list.
  const { data: impact, byId: impactById, allowed: impactAllowed } = useTaxImpact()
  const refreshImpact = useRefreshTaxImpact()
  const refresh = () => { refreshPayments(); if (impactAllowed) void refreshImpact() }
  const { payerOptions, accountOptions } = usePayerAndAccountOptions()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('oldest')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [payerId, setPayerId] = useState<string | null>(null)
  const [method, setMethod] = useState<ExpensePaymentMethod>('transfer')
  const [sending, setSending] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [advancing, setAdvancing] = useState<ToPayQueueRow | null>(null)
  const [splitting, setSplitting] = useState<ToPayQueueRow | null>(null)
  const [whtRow, setWhtRow] = useState<ToPayQueueRow | null>(null)

  const needle = q.trim().toLowerCase()
  const shown = useMemo(() => {
    const f = rows.filter(r => !needle || `${r.vendor_name ?? ''} ${r.item_service_description ?? ''} ${r.expense_code ?? ''} ${r.project_name ?? ''}`.toLowerCase().includes(needle))
    const rankOf = (id: string) => impactById.get(id)?.rank ?? Number.MAX_SAFE_INTEGER
    return sort === 'largest' ? [...f].sort((a, b) => toSend(b) - toSend(a))
      : sort === 'impact' ? [...f].sort((a, b) => rankOf(a.id) - rankOf(b.id))
      : f
  }, [rows, needle, sort, impactById])
  const onDelivery = shown.filter(r => r.payment_pattern !== 'pay_in_advance')
  const inAdvance = shown.filter(r => r.payment_pattern === 'pay_in_advance')
  const picked = rows.filter(r => selected.has(r.id))
  const pickedTotal = picked.reduce((s, r) => s + toSend(r), 0)
  const selfApproved = payerId ? picked.filter(r => r.finance_approved_by === payerId) : []

  const toggle = (id: string) => setSelected(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allPicked = onDelivery.length > 0 && onDelivery.every(r => selected.has(r.id))
  const toggleAll = () => setSelected(allPicked ? new Set() : new Set(onDelivery.map(r => r.id)))

  async function markSent() {
    if (!payerId) { toast('Pick who is sending the payment', 'error'); return }
    if (selfApproved.length) { toast('The payer approved some of these — someone else must send them', 'error'); return }
    setSending(true)
    const { error } = await supabase.from('expenses')
      .update({ payment_state: 'sent', disbursed_by: payerId, payment_method: method })
      .in('id', [...selected])
    setSending(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`${selected.size} marked as sent — confirm each against the bank statement`, 'success')
    setSelected(new Set())
    refresh()
  }

  if (loading) return <p className="py-12 text-center text-sm text-slate-400">Loading…</p>
  if (!rows.length) return <p className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Nothing approved is waiting to be paid.</p>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search payee, code, project…"
            className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div className="flex rounded-lg border p-0.5 text-xs dark:border-slate-600">
          {([['oldest', 'Oldest first'], ['largest', 'Largest first'], ...(impact ? [['impact', 'Tax impact']] as const : [])] as [Sort, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setSort(k)} className={`rounded-md px-2.5 py-1 font-medium ${sort === k ? 'bg-brand text-white' : 'text-slate-500'}`}>{l}</button>
          ))}
        </div>
      </div>

      {impact && (
        <>
          <TaxImpactCountdown data={impact} queue="pay" />
          <TaxImpactEscalations data={impact} queue="pay" />
        </>
      )}

      <Group
        title="Pay on delivery" note="Select several and send them together, or put them in one batch wire."
        total={onDelivery.reduce((s, r) => s + toSend(r), 0)} count={onDelivery.length}
        header={canAct && onDelivery.length > 0 ? <input type="checkbox" checked={allPicked} onChange={toggleAll} className="h-4 w-4 rounded border-slate-300 text-brand" title="Select all" /> : null}>
        {onDelivery.map(r => (
          <Row key={r.id} r={r} impact={impactById.get(r.id)} period={impact?.period.label} canAct={canAct} picked={selected.has(r.id)} onPick={() => toggle(r.id)}
            onWht={() => setWhtRow(r)} onSplit={() => setSplitting(r)} />
        ))}
      </Group>

      {inAdvance.length > 0 && (
        <Group
          title="Pay in advance" note="Paid before the goods arrive. Each is recorded on its own and closes when its GRN is in."
          total={inAdvance.reduce((s, r) => s + toSend(r), 0)} count={inAdvance.length}>
          {inAdvance.map(r => (
            <Row key={r.id} r={r} impact={impactById.get(r.id)} period={impact?.period.label} canAct={canAct} onWht={() => setWhtRow(r)}
              action={canAct ? (
                <button onClick={() => setAdvancing(r)} className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700">
                  <HandCoins className="h-3 w-3" /> Pay advance
                </button>
              ) : null} />
          ))}
        </Group>
      )}

      {/* The action bar follows the selection, held at the bottom of the
          content area while the list scrolls under it. */}
      {canAct && selected.size > 0 && (
        <div className="sticky bottom-2 z-30 rounded-xl border bg-white/95 px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.12)] backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-2">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{selected.size} selected · {formatCurrency(pickedTotal)}</p>
              {selfApproved.length > 0
                ? <p className="flex items-center gap-1 text-xs text-red-600"><AlertTriangle className="h-3 w-3" /> The payer approved {selfApproved.length} of these — pick someone else</p>
                : <p className="text-xs text-slate-500">Who sends it, and how?</p>}
            </div>
            <div className="w-52"><SearchableSelect value={payerId} onChange={setPayerId} options={payerOptions} placeholder="Who is paying?" /></div>
            <select value={method} onChange={e => setMethod(e.target.value as ExpensePaymentMethod)}
              className="w-44 rounded-md border px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
              {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <button onClick={markSent} disabled={sending || !payerId || selfApproved.length > 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              <Send className="h-4 w-4" /> {sending ? 'Sending…' : 'Mark as sent'}
            </button>
            <button onClick={() => setBatchOpen(true)} disabled={!payerId || selfApproved.length > 0}
              title={!payerId ? 'Pick the payer first' : undefined}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200">
              <Layers className="h-4 w-4" /> One batch wire
            </button>
            <button onClick={() => setSelected(new Set())} className="ml-auto rounded p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" title="Clear selection"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      {splitting && (
        <PartialSplitModal row={splitting} defaultPayerId={payerId} payerOptions={payerOptions} onClose={() => setSplitting(null)}
          onDone={() => { setSplitting(null); refresh(); toast('Part paid — the rest stays in the queue', 'success') }} />
      )}
      {whtRow && (
        <WithholdingModal expense={whtRow} onClose={() => setWhtRow(null)}
          onSaved={() => { setWhtRow(null); toast('Withholding recorded — the amount to send is updated', 'success'); refresh() }} />
      )}
      {batchOpen && payerId && (
        <CreateBatchModal rows={picked} payerId={payerId} payerName={payerOptions.find(p => p.id === payerId)?.label ?? null}
          defaultMethod={method === 'cash' ? 'cash' : 'batch_wire'} accountOptions={accountOptions}
          onClose={() => setBatchOpen(false)}
          onCreated={batchId => {
            setBatchOpen(false); setSelected(new Set())
            toast('Batch created — it’s now Sent', 'success'); refresh()
            qc.invalidateQueries({ queryKey: ['batch-payments'] })
            navigate(`/batch-payments/${batchId}`)
          }}
          onError={msg => toast(msg, 'error')} />
      )}
      {advancing && (
        <RecordAdvanceModal row={advancing} defaultPayerId={payerId} defaultMethod={method} payerOptions={payerOptions} accountOptions={accountOptions}
          onClose={() => setAdvancing(null)}
          onDone={() => { setAdvancing(null); toast('Advance paid — it closes when the GRN is recorded', 'success'); refresh() }}
          onError={msg => toast(msg, 'error')} />
      )}
    </div>
  )
}

function Group({ title, note, total, count, header, children }: {
  title: string; note: string; total: number; count: number; header?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-center gap-3 border-b px-4 py-2.5 dark:border-slate-700">
        {header}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title} <span className="font-normal text-slate-400">· {count}</span></h3>
          <p className="hidden text-[11px] text-slate-500 sm:block">{note}</p>
        </div>
        <span className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(total)}</span>
      </div>
      {count === 0 ? <p className="px-4 py-6 text-center text-sm text-slate-400">Nothing here.</p> : <ul className="divide-y dark:divide-slate-700">{children}</ul>}
    </section>
  )
}

function Row({ r, impact, period, canAct, picked, onPick, onWht, onSplit, action }: {
  r: ToPayQueueRow; impact?: ImpactItem; period?: string; canAct: boolean; picked?: boolean; onPick?: () => void; onWht: () => void; onSplit?: () => void; action?: React.ReactNode
}) {
  const send = toSend(r)
  const gross = Number(r.amount_etb ?? 0)
  return (
    <li className={`flex items-start gap-3 px-4 py-3 ${picked ? 'bg-brand/5' : ''}`}>
      {canAct && onPick && <input type="checkbox" checked={!!picked} onChange={onPick} className="mt-1 h-4 w-4 rounded border-slate-300 text-brand" />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <TaxTag item={impact} periodLabel={period} />
          <Link to={`/expenses/${r.id}`} className="truncate font-medium text-slate-800 hover:text-brand hover:underline dark:text-slate-100">
            {r.vendor_name ?? r.item_service_description ?? r.expense_code}
          </Link>
          <UnverifiedVendorFlag vendorId={r.vendor_id} compact />
        </div>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {r.expense_code}{r.project_name ? ` · ${r.project_name}` : ''}{r.cost_group_name ? ` · ${r.cost_group_name}` : ''}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <WhtCell row={r} canAct={canAct} onEdit={onWht} />
          {Number(r.credit_applied_etb ?? 0) > 0 && <Pill tone="green">−{formatCurrency(r.credit_applied_etb)} credit</Pill>}
          {canAct && onSplit && <button onClick={onSplit} className="text-[11px] font-medium text-brand hover:underline">Pay part</button>}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(send)}</p>
        {Math.abs(gross - send) > 0.5 && <p className="text-[10px] tabular-nums text-slate-400">of {formatCurrency(gross)}</p>}
        <div className="mt-1 flex items-center justify-end gap-1.5">
          <Pill tone={ageTone(r.days_since_approval)} title="Days since it was approved">{ageLabel(r.days_since_approval)}</Pill>
          {action}
        </div>
      </div>
    </li>
  )
}
