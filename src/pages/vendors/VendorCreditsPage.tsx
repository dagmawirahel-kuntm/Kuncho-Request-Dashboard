import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { VendorCreditRow, OpenVendorAdvanceRow } from '@/types/database'
import { Tag, X, CheckCircle2 } from 'lucide-react'

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-hidden">
      <div className="px-4 py-3 border-b dark:border-slate-700">
        <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h2>
        {sub && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{sub}</p>}
      </div>
      {children}
    </div>
  )
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-8 text-center text-sm text-slate-400 dark:text-slate-500">{children}</div>
}

const STATUS_STYLE: Record<VendorCreditRow['status'], string> = {
  open: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  partially_applied: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  closed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
}
const STATUS_LABEL: Record<VendorCreditRow['status'], string> = {
  open: 'Open',
  partially_applied: 'Partially applied',
  closed: 'Fully applied',
}

export default function VendorCreditsPage() {
  const { role } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const canAct = role === 'admin' || role === 'executive' || role === 'finance'
  const [showClosed, setShowClosed] = useState(false)
  const [applying, setApplying] = useState<VendorCreditRow | null>(null)

  const { data: credits = [], isLoading } = useQuery({
    queryKey: ['v-vendor-credits'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_vendor_credits').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as VendorCreditRow[]
    },
  })

  const rows = showClosed ? credits : credits.filter(c => c.status !== 'closed')
  const totalOpen = credits.reduce((s, c) => s + (c.status !== 'closed' ? c.remaining_amount_etb : 0), 0)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Vendor Credits</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Discounts a vendor owes back — recorded against an open advance, applied later to a future order with the same vendor.
        </p>
      </div>

      <Section
        title="Credits"
        sub={`${formatCurrency(totalOpen)} currently unclaimed across all vendors · recorded from the Payments page's "Credit" action on an open advance`}
      >
        <div className="flex items-center justify-end px-4 py-2 border-b dark:border-slate-700">
          <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} className="rounded border-slate-300 text-brand focus:ring-brand" />
            Show fully applied
          </label>
        </div>
        {isLoading ? (
          <Empty>Loading…</Empty>
        ) : rows.length === 0 ? (
          <Empty>{showClosed ? 'No vendor credits on record.' : 'Nothing open — every recorded credit has been fully applied.'}</Empty>
        ) : (
          <div className="divide-y dark:divide-slate-700">
            {rows.map(c => (
              <div key={c.id} className="px-4 py-3 space-y-1.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-slate-800 dark:text-slate-100">{c.vendor_name ?? '—'}</span>
                      <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${STATUS_STYLE[c.status]}`}>{STATUS_LABEL[c.status]}</span>
                      {c.source_bundle_code && (
                        <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-500 dark:text-slate-400">from {c.source_bundle_code}</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{c.reason}</p>
                    {c.notes && <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{c.notes}</p>}
                    <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Recorded {formatDate(c.created_at)}</p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(c.remaining_amount_etb)}</div>
                    <div className="text-xs text-slate-400 dark:text-slate-500">of {formatCurrency(c.amount_etb)} remaining</div>
                    {canAct && c.status !== 'closed' && (
                      <button
                        onClick={() => setApplying(c)}
                        className="mt-1.5 flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 ml-auto"
                      >
                        <Tag className="h-3 w-3" /> Apply to Order
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {applying && (
        <ApplyVendorCreditModal
          credit={applying}
          onClose={() => setApplying(null)}
          onApplied={() => {
            setApplying(null)
            toast('Vendor credit applied', 'success')
            qc.invalidateQueries({ queryKey: ['v-vendor-credits'] })
            qc.invalidateQueries({ queryKey: ['v-open-vendor-advances'] })
          }}
          onError={msg => toast(msg, 'error')}
        />
      )}
    </div>
  )
}

function ApplyVendorCreditModal({
  credit, onClose, onApplied, onError,
}: {
  credit: VendorCreditRow
  onClose: () => void
  onApplied: () => void
  onError: (msg: string) => void
}) {
  const [targetId, setTargetId] = useState<string | null>(null)
  const [amount, setAmount] = useState(String(credit.remaining_amount_etb))
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: openAdvances = [] } = useQuery({
    queryKey: ['v-open-vendor-advances'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_open_vendor_advances').select('*')
      if (error) throw error
      return data as OpenVendorAdvanceRow[]
    },
  })

  const targetOptions = useMemo(
    () => openAdvances
      .filter(a => a.vendor_id === credit.vendor_id && a.id !== credit.source_expense_id)
      .map(a => ({ id: a.id, label: `${a.bundle_code ?? a.expense_code ?? a.id} — ${formatCurrency(a.amount_etb ?? 0)}`, sub: a.item_service_description ?? undefined })),
    [openAdvances, credit]
  )
  const target = openAdvances.find(a => a.id === targetId)
  const parsedAmount = parseFloat(amount) || 0
  const remainingAfter = target ? (target.amount_etb ?? 0) - parsedAmount : null
  const valid = !!targetId && parsedAmount > 0 && parsedAmount <= credit.remaining_amount_etb && remainingAfter != null && remainingAfter > 0

  async function handleApply() {
    if (!valid || !targetId) return
    setSaving(true)
    const { error } = await supabase.rpc('apply_vendor_credit', {
      p_vendor_credit_id: credit.id,
      p_target_expense_id: targetId,
      p_amount_etb: parsedAmount,
      p_notes: notes.trim() || null,
    })
    setSaving(false)
    if (error) { onError(error.message); return }
    onApplied()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b dark:border-slate-700 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-100">Apply Vendor Credit</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {credit.vendor_name} has <b className="text-slate-700 dark:text-slate-200">{formatCurrency(credit.remaining_amount_etb)}</b> in open credit.
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Apply to which open advance? *</label>
            {targetOptions.length === 0 ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">No other open advance for this vendor yet — create one, then come back to apply the credit.</p>
            ) : (
              <SearchableSelect value={targetId} onChange={setTargetId} options={targetOptions} placeholder="Select an open advance…" />
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Amount to Apply (ETB) *</label>
            <input
              type="number" step="0.01"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              value={amount} onChange={e => setAmount(e.target.value)}
            />
            {target && parsedAmount > 0 && (
              <p className={`mt-1 text-xs ${remainingAfter != null && remainingAfter > 0 ? 'text-slate-500 dark:text-slate-400' : 'text-red-500'}`}>
                {remainingAfter != null && remainingAfter > 0
                  ? `That advance will close at ${formatCurrency(remainingAfter)} instead of ${formatCurrency(target.amount_etb ?? 0)}.`
                  : 'Must be less than the target advance\'s current amount.'}
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Notes</label>
            <textarea
              rows={2}
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              value={notes} onChange={e => setNotes(e.target.value)}
            />
          </div>
        </div>
        <div className="px-5 py-4 border-t dark:border-slate-700 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleApply} disabled={saving || !valid} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {saving ? 'Applying…' : <><CheckCircle2 className="h-3.5 w-3.5 inline mr-1" />Apply</>}
          </button>
        </div>
      </div>
    </div>
  )
}
