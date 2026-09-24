import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { VrfHoldingAccount } from '@/types/database'
import { Wallet, Plus } from 'lucide-react'

/**
 * The accounts returned VRF money lands in, and what each holder keeps for
 * Kuncho (v_vrf_holding_accounts, migration 322): returned in, less company
 * payments and payroll made from it, less personal draws. The account's own
 * balance is shown beside it, since a wallet can carry other money too.
 *
 * Admin and finance can mark an account as a holding account and name its
 * holder; everyone with VRF access can see them.
 */
export function VrfHoldingAccounts() {
  const { toast } = useToast()
  const { role } = useAuth()
  const qc = useQueryClient()
  const canManage = role === 'admin' || role === 'finance'
  const [adding, setAdding] = useState<string | null>(null)

  const { data: rows = [] } = useQuery({
    queryKey: ['vrf-holding-accounts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_vrf_holding_accounts').select('*').order('held', { ascending: false })
      if (error) throw error
      return data as VrfHoldingAccount[]
    },
  })

  const { data: candidates = [] } = useQuery({
    queryKey: ['vrf-holding-candidates'],
    enabled: canManage,
    queryFn: async () => {
      const { data, error } = await supabase.from('accounts').select('id, account_name, type').eq('is_vrf_holding', false).order('account_name')
      if (error) throw error
      return data as { id: string; account_name: string; type: string | null }[]
    },
  })
  const options = useMemo(() => candidates.map(c => ({ id: c.id, label: c.account_name, sub: c.type ?? undefined })), [candidates])

  function refresh() {
    qc.invalidateQueries({ queryKey: ['vrf-holding-accounts'] })
    qc.invalidateQueries({ queryKey: ['vrf-holding-candidates'] })
    qc.invalidateQueries({ queryKey: ['vrf-holding-account-options'] })
  }

  async function markHolding() {
    if (!adding) return
    const { error } = await supabase.from('accounts').update({ is_vrf_holding: true }).eq('id', adding)
    if (error) { toast(error.message, 'error'); return }
    setAdding(null)
    refresh()
    toast('Marked as a holding account', 'success')
  }

  async function saveHolder(id: string, name: string, before: string | null) {
    const holder = name.trim() || null
    if (holder === before) return
    const { error } = await supabase.from('accounts').update({ holder_name: holder }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    refresh()
    toast('Holder saved', 'success')
  }

  if (rows.length === 0 && !canManage) return null

  return (
    <div className="rounded-2xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-slate-50 px-5 py-3 dark:border-slate-700 dark:bg-slate-700/50">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Holding accounts</h2>
          <span className="text-[11px] text-slate-400">where returned money is kept for Kuncho</span>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <div className="w-56">
              <SearchableSelect value={adding} onChange={setAdding} options={options} placeholder="Add an account…" />
            </div>
            <button onClick={markHolding} disabled={!adding}
              className="flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-white disabled:opacity-40 dark:border-slate-600 dark:text-slate-200">
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </div>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-4 text-center text-xs text-slate-400">No holding accounts yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-5 py-2 text-left font-semibold">Account</th>
                <th className="px-3 py-2 text-left font-semibold">Held by</th>
                <th className="px-3 py-2 text-right font-semibold">Returned in</th>
                <th className="px-3 py-2 text-right font-semibold">Company spend</th>
                <th className="px-3 py-2 text-right font-semibold">Personal</th>
                <th className="px-3 py-2 text-right font-semibold">Holds for Kuncho</th>
                <th className="px-5 py-2 text-right font-semibold">Account balance</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {rows.map(r => (
                <tr key={r.account_id}>
                  <td className="px-5 py-2 font-medium text-slate-700 dark:text-slate-200">{r.account_name}</td>
                  <td className="px-3 py-2">
                    {canManage ? (
                      <input aria-label={`Holder of ${r.account_name}`} defaultValue={r.holder_name ?? ''} placeholder="Who holds it?"
                        onBlur={e => saveHolder(r.account_id, e.target.value, r.holder_name)}
                        className="w-40 rounded border px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                    ) : (
                      <span className={r.holder_name ? 'text-slate-600 dark:text-slate-300' : 'text-amber-600 dark:text-amber-400'}>{r.holder_name ?? 'Not recorded'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-green-600 dark:text-green-400">{formatCurrency(Number(r.returned_in))}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(Number(r.company_spent))}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(Number(r.personal_drawn))}</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(Number(r.held))}</td>
                  <td className="px-5 py-2 text-right tabular-nums text-slate-500">{r.account_balance != null ? formatCurrency(Number(r.account_balance)) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
