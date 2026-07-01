import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Proforma, ProformaStatus } from '@/types/database'
import { FileText, Plus } from 'lucide-react'

type ProformaRow = Proforma & { clients: { client_name: string } | null }

const STATUS_CLS: Record<ProformaStatus, string> = {
  draft:     'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  sent:      'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  accepted:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  converted: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  expired:   'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
}

export default function ProformasPage() {
  const { data: proformas = [], isLoading } = useQuery({
    queryKey: ['proformas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('proformas')
        .select('*, clients:client_id(client_name)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as ProformaRow[]
    },
  })

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Proforma Invoices</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Track quotes sent to clients before converting to sales invoices</p>
        </div>
        <Link to="/clients" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
          <Plus className="h-4 w-4" /> New Proforma
        </Link>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
      ) : proformas.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed dark:border-slate-700 bg-white dark:bg-slate-800 py-16 text-center">
          <FileText className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-sm text-slate-500">No proforma invoices yet.</p>
          <p className="text-xs text-slate-400 mt-1">Go to a client page and click "Proforma Invoice" to create one.</p>
        </div>
      ) : (
        <div className="rounded-2xl bg-white dark:bg-slate-800 border dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="hidden sm:grid grid-cols-[6rem_1fr_1fr_7rem_6rem_6rem] gap-3 px-4 py-2.5 bg-slate-50 dark:bg-slate-700/50 border-b dark:border-slate-700 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            <span>Number</span>
            <span>Client</span>
            <span>Notes / Terms</span>
            <span className="text-right">Total</span>
            <span>Date</span>
            <span>Status</span>
          </div>
          {proformas.map((p, i) => (
            <div key={p.id}
              className={`sm:grid sm:grid-cols-[6rem_1fr_1fr_7rem_6rem_6rem] sm:gap-3 flex flex-col gap-1 px-4 py-3.5 ${i < proformas.length - 1 ? 'border-b dark:border-slate-700' : ''}`}>
              <span className="font-mono text-xs font-bold text-brand">{p.proforma_number ?? '—'}</span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                  {(p as any).clients?.client_name ?? '—'}
                </p>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {p.payment_terms ?? p.notes ?? '—'}
              </p>
              <p className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200 text-right">
                {p.total != null ? formatCurrency(p.total) : '—'}
              </p>
              <p className="text-xs text-slate-400">{formatDate(p.date)}</p>
              <span className={`inline-block self-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${STATUS_CLS[p.status]}`}>
                {p.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
