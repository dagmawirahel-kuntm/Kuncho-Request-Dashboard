import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import type { VrfPersonalDraw } from '@/types/database'
import { Plus, Trash2 } from 'lucide-react'

/**
 * Money taken from this VRF's returned funds for personal use
 * (vrf_personal_draws, migration 320). Company payments made from the same
 * money are recorded as expenses and payroll linked to the VRF; this is the
 * other use, so what is still held adds up.
 *
 * The database refuses a draw larger than what is left, and only admin can
 * delete one.
 */
export function VrfPersonalDraws({ vrfId, available, canEdit }: { vrfId: string; available: number; canEdit: boolean }) {
  const { toast } = useToast()
  const { role } = useAuth()
  const qc = useQueryClient()
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [amount, setAmount] = useState('')
  const [drawnBy, setDrawnBy] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: draws = [] } = useQuery({
    queryKey: ['vrf-personal-draws', vrfId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vrf_personal_draws').select('*').eq('vrf_id', vrfId)
        .order('draw_date', { ascending: false })
      if (error) throw error
      return data as VrfPersonalDraw[]
    },
  })

  function refresh() {
    qc.invalidateQueries({ queryKey: ['vrf-personal-draws', vrfId] })
    qc.invalidateQueries({ queryKey: ['vrf-fund', vrfId] })
    qc.invalidateQueries({ queryKey: ['vrf-register'] })
  }

  async function add() {
    const amt = parseFloat(amount)
    if (isNaN(amt) || amt <= 0) { toast('Enter the amount taken', 'error'); return }
    if (!drawnBy.trim()) { toast('Enter who took it', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('vrf_personal_draws').insert([{
      vrf_id: vrfId, draw_date: date, amount: amt, drawn_by: drawnBy.trim(), note: note.trim() || null,
    }])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    setAmount(''); setNote('')
    refresh()
    toast('Personal draw recorded', 'success')
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this personal draw?')) return
    const { error } = await supabase.from('vrf_personal_draws').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    refresh()
    toast('Draw deleted', 'success')
  }

  const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-800 border dark:border-slate-700 shadow-sm overflow-hidden">
      <div className="px-5 py-3 bg-slate-50 dark:bg-slate-700/50 border-b dark:border-slate-700 flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Taken for Personal Use</p>
        <span className="text-xs text-slate-400">{draws.length} draw{draws.length === 1 ? '' : 's'}</span>
      </div>

      {draws.length === 0 ? (
        <p className="px-5 py-4 text-center text-xs text-slate-400">No personal draws recorded against this VRF.</p>
      ) : (
        <div className="divide-y dark:divide-slate-700">
          {draws.map(d => (
            <div key={d.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{d.drawn_by}</p>
                <p className="text-xs text-slate-400">{formatDate(d.draw_date)}{d.note ? ` · ${d.note}` : ''}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(Number(d.amount))}</span>
                {role === 'admin' && (
                  <button onClick={() => remove(d.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete">
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
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Record money taken from this VRF for personal use. Up to {formatCurrency(available)} is left.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Date</label>
              <input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Amount *</label>
              <input type="number" step="0.01" className={inputCls} value={amount} onChange={e => setAmount(e.target.value)} />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Taken by *</label>
              <input className={inputCls} value={drawnBy} onChange={e => setDrawnBy(e.target.value)} placeholder="Name" />
            </div>
          </div>
          <input className={inputCls} value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" />
          <div className="flex justify-end">
            <button onClick={add} disabled={saving}
              className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50">
              <Plus className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Record Draw'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
