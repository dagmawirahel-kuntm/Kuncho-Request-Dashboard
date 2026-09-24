import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { VrfReturn, VrfRegisterRow } from '@/types/database'
import { AlertCircle, CheckCircle2, Plus, Trash2 } from 'lucide-react'

function refreshVrf(qc: ReturnType<typeof useQueryClient>, vrfId: string) {
  for (const key of [['vrf-returns', vrfId], ['vrf', vrfId], ['vrf-register'], ['vrf-register', vrfId], ['vrf-fund', vrfId], ['vrf-holding-accounts'], ['vendor-receipts']]) {
    qc.invalidateQueries({ queryKey: key })
  }
}

/**
 * The money that came back from a VRF, one entry per return
 * (vrf_returns, migration 322). The VRF's returned total and status follow
 * from these; each return lands in a holding account and moves out of
 * "VRF Funds in Transit" in the ledger. Only admin can delete one.
 */
export function VrfReturns({ reg, canEdit }: { reg: VrfRegisterRow; canEdit: boolean }) {
  const { toast } = useToast()
  const { role } = useAuth()
  const qc = useQueryClient()
  const outstanding = Math.max(0, Number(reg.expected_return ?? 0) - Number(reg.returned))
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [amount, setAmount] = useState(outstanding > 0 ? outstanding.toFixed(2) : '')
  const [accountId, setAccountId] = useState<string | null>(reg.return_account_id)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: returns = [] } = useQuery({
    queryKey: ['vrf-returns', reg.vrf_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('vrf_returns').select('*').eq('vrf_id', reg.vrf_id).order('return_date')
      if (error) throw error
      return data as VrfReturn[]
    },
  })

  const { data: holding = [] } = useQuery({
    queryKey: ['vrf-holding-account-options'],
    queryFn: async () => {
      const { data, error } = await supabase.from('accounts').select('id, account_name, holder_name').eq('is_vrf_holding', true).order('account_name')
      if (error) throw error
      return data as { id: string; account_name: string; holder_name: string | null }[]
    },
  })
  const names = useMemo(() => new Map(holding.map(h => [h.id, h.account_name])), [holding])
  const options = useMemo(() => holding.map(h => ({ id: h.id, label: h.account_name, sub: h.holder_name ?? undefined })), [holding])

  async function add() {
    const amt = parseFloat(amount)
    if (isNaN(amt) || amt <= 0) { toast('Enter the amount that came back', 'error'); return }
    if (!accountId) { toast('Choose the holding account it came back to', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('vrf_returns').insert([{ vrf_id: reg.vrf_id, return_date: date, amount: amt, account_id: accountId, note: note.trim() || null }])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    setAmount(''); setNote('')
    refreshVrf(qc, reg.vrf_id)
    toast('Return recorded', 'success')
  }

  async function setAccount(r: VrfReturn, account: string | null) {
    const { error } = await supabase.from('vrf_returns').update({ account_id: account }).eq('id', r.id)
    if (error) { toast(error.message, 'error'); return }
    refreshVrf(qc, reg.vrf_id)
  }

  async function setDateOf(r: VrfReturn, d: string) {
    if (!d) return
    const { error } = await supabase.from('vrf_returns').update({ return_date: d }).eq('id', r.id)
    if (error) { toast(error.message, 'error'); return }
    refreshVrf(qc, reg.vrf_id)
  }

  async function remove(r: VrfReturn) {
    if (!window.confirm(`Delete the ${formatCurrency(Number(r.amount))} return?`)) return
    const { error } = await supabase.from('vrf_returns').delete().eq('id', r.id)
    if (error) { toast(error.message, 'error'); return }
    refreshVrf(qc, reg.vrf_id)
    toast('Return deleted', 'success')
  }

  const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-800 border dark:border-slate-700 shadow-sm overflow-hidden">
      <div className="px-5 py-3 bg-slate-50 dark:bg-slate-700/50 border-b dark:border-slate-700 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Money Returned</p>
        <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
          {formatCurrency(Number(reg.returned))} of {formatCurrency(Number(reg.expected_return ?? 0))} expected
        </span>
      </div>

      {returns.length === 0 ? (
        <p className="px-5 py-4 text-center text-xs text-slate-400">Nothing has come back yet.</p>
      ) : (
        <div className="divide-y dark:divide-slate-700">
          {returns.map(r => (
            <div key={r.id} className="grid grid-cols-1 gap-2 px-5 py-2.5 sm:grid-cols-[8.5rem_1fr_auto] sm:items-center">
              {canEdit ? (
                <input type="date" aria-label="Return date" className="rounded border px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  defaultValue={r.return_date} onBlur={e => e.target.value !== r.return_date && setDateOf(r, e.target.value)} />
              ) : (
                <span className="text-sm text-slate-600 dark:text-slate-300">{formatDate(r.return_date)}</span>
              )}
              <div className="min-w-0">
                {r.account_id ? (
                  <p className="truncate text-sm text-slate-700 dark:text-slate-200">{names.get(r.account_id) ?? 'Holding account'}</p>
                ) : canEdit ? (
                  <div className="max-w-xs">
                    <SearchableSelect value={null} onChange={v => setAccount(r, v)} options={options} placeholder="Which holding account?" />
                  </div>
                ) : (
                  <p className="text-sm text-amber-600 dark:text-amber-400">Holding account not recorded</p>
                )}
                {r.note && <p className="truncate text-[11px] text-slate-400">{r.note}</p>}
              </div>
              <div className="flex items-center justify-end gap-3">
                <span className="text-sm font-semibold tabular-nums text-green-600 dark:text-green-400">{formatCurrency(Number(r.amount))}</span>
                {role === 'admin' && (
                  <button onClick={() => remove(r)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete return">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <div className="space-y-3 border-t p-5 dark:border-slate-700">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Date it came back</label>
              <input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Amount *</label>
              <input type="number" step="0.01" min="0" className={inputCls} value={amount} onChange={e => setAmount(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Holding account *</label>
              <SearchableSelect value={accountId} onChange={setAccountId} options={options} placeholder="Select…" />
            </div>
          </div>
          <input className={inputCls} value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" />
          <div className="flex justify-end">
            <button onClick={add} disabled={saving}
              className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50">
              <Plus className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Record Return'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * What converting the old records could not settle on its own (migration 322),
 * or a VRF that does not reconcile. Marking it reviewed clears the list.
 */
export function VrfReviewPanel({ reg, canEdit }: { reg: VrfRegisterRow; canEdit: boolean }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  if (!reg.needs_review || reg.review_notes.length === 0) return null

  async function markReviewed() {
    const { error } = await supabase.from('vendor_receipt_facilitation')
      .update({ needs_review: false, review_notes: [] }).eq('id', reg.vrf_id)
    if (error) { toast(error.message, 'error'); return }
    refreshVrf(qc, reg.vrf_id)
    toast('Marked as reviewed', 'success')
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-700/40 dark:bg-amber-900/20">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div>
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">To confirm on this VRF</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-600 dark:text-slate-300">
              {reg.review_notes.map(n => <li key={n}>{n}</li>)}
            </ul>
            <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">Correct the figures with Edit, or the returns below, then mark it reviewed.</p>
          </div>
        </div>
        {canEdit && (
          <button onClick={markReviewed}
            className="flex shrink-0 items-center gap-1 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-slate-800 dark:text-amber-300">
            <CheckCircle2 className="h-3.5 w-3.5" /> Mark reviewed
          </button>
        )}
      </div>
    </div>
  )
}
