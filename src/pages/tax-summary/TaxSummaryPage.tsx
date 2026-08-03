import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { AlertTriangle, CheckCircle2, Clock, FileText } from 'lucide-react'

interface OutstandingRow {
  obligation_type_id: string
  tax_type: string
  name: string
  period_month: string
  filed: boolean
  filed_date: string | null
  reference_number: string | null
  due_date: string | null
  status: 'filed' | 'outstanding' | 'overdue' | 'current'
}

const TAX_TYPE_LABEL: Record<string, string> = { VAT: 'VAT', WHT: 'WHT', payroll_tax: 'Payroll Tax', other: 'Other' }

const STATUS_META: Record<OutstandingRow['status'], { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  filed:       { label: 'Filed',       cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300', icon: CheckCircle2 },
  overdue:     { label: 'Overdue',     cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',                 icon: AlertTriangle },
  outstanding: { label: 'Outstanding', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',         icon: Clock },
  current:     { label: 'Current',     cls: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',            icon: Clock },
}

export default function TaxSummaryPage() {
  const { role } = useAuth()
  const canWrite = role === 'admin' || role === 'finance'

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['tax-outstanding-status'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_tax_outstanding_status')
        .select('*')
        .order('period_month', { ascending: false })
      if (error) throw error
      return data as OutstandingRow[]
    },
  })

  const byType = useMemo(() => {
    const m = new Map<string, OutstandingRow[]>()
    for (const r of rows) {
      const list = m.get(r.tax_type) ?? []
      list.push(r)
      m.set(r.tax_type, list)
    }
    return Array.from(m.entries())
  }, [rows])

  const openCount = rows.filter(r => r.status === 'outstanding' || r.status === 'overdue').length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Tax Summary</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Outstanding tax status — which returns are filed, still open, or overdue, per obligation and period
          </p>
        </div>
        <Link to="/tax-management" className="rounded-md border dark:border-slate-600 px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
          Tax Management
        </Link>
      </div>

      {openCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {openCount} tax period{openCount > 1 ? 's' : ''} still outstanding — file to keep the company current with ERCA.
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="py-12 text-center text-sm text-slate-400">
          No tax obligations configured yet. Set them up in Tax Management.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {byType.map(([taxType, periods]) => (
            <div key={taxType} className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b dark:border-slate-700">
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{TAX_TYPE_LABEL[taxType] ?? taxType}</p>
                <p className="text-xs text-slate-400">{periods[0]?.name}</p>
              </div>
              <div className="divide-y dark:divide-slate-700">
                {periods.map(p => {
                  const meta = STATUS_META[p.status]
                  const Icon = meta.icon
                  return (
                    <div key={`${p.obligation_type_id}-${p.period_month}`} className="flex items-center justify-between gap-2 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{formatDate(p.period_month)}</p>
                        <p className="text-xs text-slate-400">
                          {p.filed
                            ? `Filed ${p.filed_date ? formatDate(p.filed_date) : ''}${p.reference_number ? ` · ${p.reference_number}` : ''}`
                            : p.due_date ? `Due ${formatDate(p.due_date)}` : 'No due date set'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.cls}`}>
                          <Icon className="h-3 w-3" /> {meta.label}
                        </span>
                        {!p.filed && canWrite && (p.status === 'outstanding' || p.status === 'overdue') && (
                          <Link
                            to={`/tax-management/log?obligation_type_id=${p.obligation_type_id}&period_month=${p.period_month}`}
                            className="rounded-md bg-brand px-2 py-1 text-[10px] font-medium text-white hover:bg-brand/90 flex items-center gap-1"
                          >
                            <FileText className="h-3 w-3" /> File
                          </Link>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
