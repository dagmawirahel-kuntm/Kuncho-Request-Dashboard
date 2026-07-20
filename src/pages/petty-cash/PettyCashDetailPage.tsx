import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { PettyCashFloat, PettyCashTransaction, PettyCashReplenishment } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { ChevronLeft, Wallet, Plus, Check, X } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

type FloatDetail = PettyCashFloat & { staff: { employee_name: string } | null; projects: { project_name: string } | null }

export default function PettyCashDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user, role } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const canApprove = role === 'admin' || role === 'manager' || role === 'finance' || role === 'project_manager'

  const { data: float, isLoading } = useQuery({
    queryKey: ['petty-cash-float', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('petty_cash_floats').select('*, staff(employee_name), projects(project_name)').eq('id', id!).single()
      if (error) throw error
      return data as FloatDetail
    },
    enabled: !!id,
  })

  const { data: transactions = [] } = useQuery({
    queryKey: ['petty-cash-transactions', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('petty_cash_transactions').select('*').eq('float_id', id!).order('created_at', { ascending: false })
      if (error) throw error
      return data as PettyCashTransaction[]
    },
    enabled: !!id,
  })

  const { data: replenishments = [] } = useQuery({
    queryKey: ['petty-cash-replenishments', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('petty_cash_replenishments').select('*').eq('float_id', id!).order('created_at', { ascending: false })
      if (error) throw error
      return data as PettyCashReplenishment[]
    },
    enabled: !!id,
  })

  const [showSpendForm, setShowSpendForm] = useState(false)
  const [spendAmount, setSpendAmount] = useState('')
  const [spendPurpose, setSpendPurpose] = useState('')
  const [spendReceipt, setSpendReceipt] = useState(false)
  const [savingSpend, setSavingSpend] = useState(false)

  const [showReplenishForm, setShowReplenishForm] = useState(false)
  const [replenishAmount, setReplenishAmount] = useState('')
  const [savingReplenish, setSavingReplenish] = useState(false)

  function refresh() {
    qc.invalidateQueries({ queryKey: ['petty-cash-float', id] })
    qc.invalidateQueries({ queryKey: ['petty-cash-transactions', id] })
    qc.invalidateQueries({ queryKey: ['petty-cash-replenishments', id] })
    qc.invalidateQueries({ queryKey: ['petty-cash-floats'] })
  }

  async function handleRecordSpend() {
    const amount = parseFloat(spendAmount)
    if (!amount || amount <= 0) { toast('Enter an amount', 'error'); return }
    if (!spendPurpose.trim()) { toast('Purpose is required', 'error'); return }
    setSavingSpend(true)
    const { error } = await supabase.from('petty_cash_transactions').insert([{
      float_id: id, amount, purpose: spendPurpose.trim(), receipt_attached: spendReceipt, recorded_by: user?.id ?? null,
    }])
    setSavingSpend(false)
    if (error) { toast(error.message, 'error'); return }
    setSpendAmount(''); setSpendPurpose(''); setSpendReceipt(false); setShowSpendForm(false)
    refresh()
    toast('Spend recorded', 'success')
  }

  async function handleRequestReplenishment() {
    const amount = parseFloat(replenishAmount)
    if (!amount || amount <= 0) { toast('Enter an amount', 'error'); return }
    setSavingReplenish(true)
    const { error } = await supabase.from('petty_cash_replenishments').insert([{
      float_id: id, amount_requested: amount, requested_by: user?.id ?? null, status: 'pending',
    }])
    setSavingReplenish(false)
    if (error) { toast(error.message, 'error'); return }
    setReplenishAmount(''); setShowReplenishForm(false)
    refresh()
    toast(amount > 5000 ? 'Replenishment requested — needs Project Manager approval' : 'Replenishment requested', 'success')
  }

  async function handleReplenishmentDecision(replId: string, status: 'approved' | 'rejected') {
    const { error } = await supabase.from('petty_cash_replenishments').update({
      status, approved_by: user?.id ?? null, approved_at: new Date().toISOString(),
    }).eq('id', replId)
    if (error) { toast(error.message, 'error'); return }
    refresh()
    toast(status === 'approved' ? 'Replenishment approved' : 'Replenishment rejected', 'success')
  }

  if (isLoading || !float) {
    return <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
  }

  return (
    <div className="space-y-5">
      <Link to="/petty-cash" className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 w-fit">
        <ChevronLeft className="h-4 w-4" /> Back to Petty Cash
      </Link>

      <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Wallet className="h-5 w-5 text-brand" /> {float.staff?.employee_name ?? 'Unknown custodian'}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">{float.projects?.project_name ?? 'Office-wide float'}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">Current Balance</p>
            <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">{formatCurrency(float.current_balance)}</p>
            <p className="text-xs text-slate-400">of {formatCurrency(float.float_amount)} float</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Spend */}
        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Record Spend</h2>
            <button onClick={() => setShowSpendForm(v => !v)} className="rounded p-1 text-brand hover:bg-brand/10"><Plus className="h-4 w-4" /></button>
          </div>
          {showSpendForm && (
            <div className="space-y-2">
              <input type="number" step="0.01" min="0" className={inputCls} placeholder="Amount (ETB)" value={spendAmount} onChange={e => setSpendAmount(e.target.value)} />
              <input type="text" className={inputCls} placeholder="Purpose" value={spendPurpose} onChange={e => setSpendPurpose(e.target.value)} />
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <input type="checkbox" checked={spendReceipt} onChange={e => setSpendReceipt(e.target.checked)} /> Receipt attached
              </label>
              <button onClick={handleRecordSpend} disabled={savingSpend} className="w-full rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-60">
                {savingSpend ? 'Saving…' : 'Record'}
              </button>
            </div>
          )}
          <div className="divide-y dark:divide-slate-700 max-h-64 overflow-y-auto">
            {transactions.length === 0 ? (
              <p className="py-4 text-center text-xs text-slate-400">No spend recorded yet</p>
            ) : transactions.map(t => (
              <div key={t.id} className="py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-slate-700 dark:text-slate-200 truncate">{t.purpose}</p>
                  <p className="text-[11px] text-slate-400">{formatDate(t.created_at)}{t.receipt_attached ? ' · Receipt attached' : ''}</p>
                </div>
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 tabular-nums shrink-0">−{formatCurrency(t.amount)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Replenishment */}
        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Replenishment</h2>
            <button onClick={() => setShowReplenishForm(v => !v)} className="rounded p-1 text-brand hover:bg-brand/10"><Plus className="h-4 w-4" /></button>
          </div>
          {showReplenishForm && (
            <div className="space-y-2">
              <input type="number" step="0.01" min="0" className={inputCls} placeholder="Amount requested (ETB)" value={replenishAmount} onChange={e => setReplenishAmount(e.target.value)} />
              {parseFloat(replenishAmount) > 5000 && (
                <p className="text-[11px] text-amber-600">Over ETB 5,000 — needs Project Manager approval.</p>
              )}
              <button onClick={handleRequestReplenishment} disabled={savingReplenish} className="w-full rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-60">
                {savingReplenish ? 'Requesting…' : 'Request Replenishment'}
              </button>
            </div>
          )}
          <div className="divide-y dark:divide-slate-700 max-h-64 overflow-y-auto">
            {replenishments.length === 0 ? (
              <p className="py-4 text-center text-xs text-slate-400">No replenishment requests yet</p>
            ) : replenishments.map(r => (
              <div key={r.id} className="py-2 flex items-center justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 tabular-nums">+{formatCurrency(r.amount_requested)}</p>
                  <p className="text-[11px] text-slate-400">
                    {formatDate(r.created_at)}{r.requires_pm_approval ? ' · Needs PM approval' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={r.status} />
                  {canApprove && r.status === 'pending' && (
                    <>
                      <button onClick={() => handleReplenishmentDecision(r.id, 'approved')} className="rounded p-1 text-slate-400 hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-900/30" title="Approve"><Check className="h-3.5 w-3.5" /></button>
                      <button onClick={() => handleReplenishmentDecision(r.id, 'rejected')} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30" title="Reject"><X className="h-3.5 w-3.5" /></button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
