import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { COMPANY_NAME, COMPANY_ADDRESS, gradientCss } from '@/lib/documentTheme'
import { ArrowLeft, Printer, Layers } from 'lucide-react'
import type { BatchPayment } from '@/types/database'

type BatchExpense = {
  id: string
  expense_code: string | null
  item_service_description: string | null
  amount_etb: number | null
  rollup_period_start: string | null
  rollup_period_end: string | null
  projects: { project_name: string } | null
  vendor_id: string | null
  vendors: { vendor_name: string; bank_account: string | null } | null
  paid_to_staff_id: string | null
  labor_requisitions: { role_needed: string; payment_basis: string; volume_unit: string | null } | null
}

type WorkerLine = {
  id: string
  expense_id: string
  staff_id: string
  employee_name: string
  bank_account: string | null
  units: number | null
  rate: number | null
  subtotal: number | null
  unit_label: string
  gang_size: number | null
  gang_member_names: string | null
  vendor_name: string | null
  vendor_bank_account: string | null
}

// One combined Payment Request across several already-approved labor
// rollup drafts — e.g. every trade on one work order, batched into a
// single document instead of finance printing N separate ones.
export default function BatchPaymentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data: batch, isLoading: batchLoading } = useQuery({
    queryKey: ['batch-payment-detail', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('batch_payments').select('*').eq('id', id!).single()
      if (error) throw error
      return data as BatchPayment
    },
    enabled: !!id,
  })

  const { data: batchExpenses = [], isLoading: expensesLoading } = useQuery({
    queryKey: ['batch-payment-expenses-detail', id],
    queryFn: async () => {
      const { data: links, error: linkErr } = await supabase.from('batch_payment_expenses').select('expense_id').eq('batch_payment_id', id!)
      if (linkErr) throw linkErr
      const ids = links.map(l => l.expense_id)
      if (ids.length === 0) return []
      const { data, error } = await supabase
        .from('expenses')
        .select('id, expense_code, item_service_description, amount_etb, rollup_period_start, rollup_period_end, projects(project_name), vendor_id, vendors(vendor_name, bank_account), paid_to_staff_id, labor_requisitions:rolled_up_from_requisition_id(role_needed, payment_basis, volume_unit)')
        .in('id', ids)
      if (error) throw error
      return (data ?? []) as unknown as BatchExpense[]
    },
    enabled: !!id,
  })

  const expenseIds = useMemo(() => batchExpenses.map(e => e.id), [batchExpenses])

  const { data: workerLines = [], isLoading: workersLoading } = useQuery({
    queryKey: ['batch-payment-workers', id, expenseIds],
    queryFn: async () => {
      if (expenseIds.length === 0) return []
      const { data, error } = await supabase
        .from('labor_expense_workers')
        .select('id, expense_id, staff_id, days_worked, day_rate, subtotal, gang_size, gang_member_names, staff(employee_name, bank_account)')
        .in('expense_id', expenseIds)
      if (error) throw error
      const byExpense = new Map(batchExpenses.map(e => [e.id, e]))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((w: any) => {
        const exp = byExpense.get(w.expense_id)
        const isVolume = exp?.labor_requisitions?.payment_basis === 'per_volume'
        return {
          id: w.id, expense_id: w.expense_id, staff_id: w.staff_id,
          employee_name: w.staff?.employee_name ?? 'Unknown staff',
          bank_account: w.staff?.bank_account ?? null,
          units: w.days_worked, rate: w.day_rate, subtotal: w.subtotal,
          unit_label: isVolume ? (exp?.labor_requisitions?.volume_unit ?? 'units') : 'days',
          gang_size: w.gang_size, gang_member_names: w.gang_member_names,
          vendor_name: exp?.vendors?.vendor_name ?? null,
          vendor_bank_account: exp?.vendors?.bank_account ?? null,
        } as WorkerLine
      })
    },
    enabled: expenseIds.length > 0,
  })

  const grandTotal = batchExpenses.reduce((sum, e) => sum + (e.amount_etb ?? 0), 0)
  const totalHeadcount = workerLines.reduce((sum, w) => sum + Math.max(w.gang_size ?? 1, 1), 0)
  const scopeLabel = useMemo(() => {
    const roles = Array.from(new Set(batchExpenses.map(e => e.labor_requisitions?.role_needed).filter(Boolean)))
    const projects = Array.from(new Set(batchExpenses.map(e => e.projects?.project_name).filter(Boolean)))
    return { roles, projects }
  }, [batchExpenses])
  const periodStart = batchExpenses.map(e => e.rollup_period_start).filter(Boolean).sort()[0]
  const periodEnd = batchExpenses.map(e => e.rollup_period_end).filter(Boolean).sort().slice(-1)[0]

  const isLoading = batchLoading || expensesLoading || workersLoading

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><p className="text-slate-400 text-sm">Loading…</p></div>
  }
  if (!batch) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-slate-500">Batch payment not found.</p>
        <Link to="/batch-payments" className="text-sm text-blue-600 hover:underline">← Back to Batch Payments</Link>
      </div>
    )
  }

  return (
    <>
      {/* Print-only combined Payment Request */}
      <div className="hidden print:block">
        <div style={{ fontFamily: 'Arial, Helvetica, sans-serif', color: '#1a1a1a', maxWidth: '750px', margin: '0 auto', padding: '24px' }}>
          <div style={{ background: gradientCss('laborPayment'), borderRadius: '10px', padding: '18px 22px', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                <div style={{ width: '36px', height: '36px', background: 'rgba(255,255,255,0.22)', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ color: '#fff', fontWeight: 900, fontSize: '12px', letterSpacing: '-0.5px' }}>K</span>
                </div>
                <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 900, color: '#fff', letterSpacing: '-0.3px' }}>{COMPANY_NAME}</h1>
              </div>
              <p style={{ margin: 0, fontSize: '10px', color: 'rgba(255,255,255,0.78)', lineHeight: 1.6 }}>{COMPANY_ADDRESS}</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ margin: 0, fontSize: '9px', color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '1.2px' }}>Document</p>
              <p style={{ margin: '3px 0 0', fontSize: '20px', fontWeight: 800, color: '#fff' }}>PAYMENT REQUEST — BATCH</p>
              <p style={{ margin: '4px 0 0', fontFamily: 'monospace', fontSize: '11px', color: 'rgba(255,255,255,0.85)', fontWeight: 700 }}>{batch.payment_code ?? batch.id.slice(0, 8)}</p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '20px' }}>
            {[
              { label: 'Scope', value: scopeLabel.projects.length === 1 ? scopeLabel.projects[0] : `${scopeLabel.projects.length} projects` },
              { label: 'Trades', value: scopeLabel.roles.join(', ') || '—' },
              { label: 'Period Covered', value: periodStart && periodEnd ? `${formatDate(periodStart)} → ${formatDate(periodEnd)}` : '—' },
              { label: 'Underlying Drafts', value: String(batchExpenses.length) },
            ].map(f => (
              <div key={f.label} style={{ background: '#f4f6f8', borderRadius: '5px', padding: '10px 12px' }}>
                <p style={{ margin: 0, fontSize: '9px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.8px' }}>{f.label}</p>
                <p style={{ margin: '3px 0 0', fontWeight: 700, fontSize: '11px' }}>{f.value}</p>
              </div>
            ))}
          </div>

          <div style={{ marginBottom: '18px', border: '1px solid #dde2ea', borderRadius: '5px', overflow: 'hidden' }}>
            <div style={{ background: '#1B3A5C', color: '#fff', padding: '7px 12px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              Worker Breakdown · {totalHeadcount} worker{totalHeadcount === 1 ? '' : 's'} covered
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
              <thead>
                <tr style={{ background: '#f4f6f8' }}>
                  <th style={{ padding: '6px 12px', textAlign: 'left', fontWeight: 600, fontSize: '9px', textTransform: 'uppercase', color: '#888' }}>Worker</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, fontSize: '9px', textTransform: 'uppercase', color: '#888' }}>Bank Account</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, fontSize: '9px', textTransform: 'uppercase', color: '#888', width: '70px' }}>Duration/Vol.</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, fontSize: '9px', textTransform: 'uppercase', color: '#888', width: '90px' }}>Rate</th>
                  <th style={{ padding: '6px 12px', textAlign: 'right', fontWeight: 600, fontSize: '9px', textTransform: 'uppercase', color: '#888', width: '100px' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {workerLines.map(w => (
                  <tr key={w.id} style={{ borderTop: '1px solid #e4e8ee' }}>
                    <td style={{ padding: '6px 12px' }}>
                      {(w.gang_size ?? 1) > 1
                        ? <>Gang of {w.gang_size} <span style={{ color: '#999', fontSize: '10px' }}>via {w.employee_name}</span>{w.gang_member_names && <div style={{ fontSize: '9px', color: '#999' }}>{w.gang_member_names}</div>}</>
                        : w.employee_name}
                    </td>
                    <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>
                      {(w.gang_size ?? 1) > 1 ? (w.vendor_bank_account ?? `Vendor: ${w.vendor_name ?? '—'}`) : (w.bank_account ?? '—')}
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'right' }}>{w.units ?? '—'} {w.unit_label}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right' }}>{w.rate != null ? formatCurrency(w.rate) : '—'}</td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', fontWeight: 600 }}>{w.subtotal != null ? formatCurrency(w.subtotal) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: '#f4f6f8', borderTop: '2px solid #dde2ea' }}>
                  <td colSpan={4} style={{ padding: '10px 12px', fontWeight: 700, textAlign: 'right', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#555' }}>Total</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 900, fontSize: '15px', color: '#1B3A5C' }}>{formatCurrency(grandTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div style={{ marginBottom: '18px', background: '#f8f9fb', borderRadius: '5px', padding: '10px 14px', fontSize: '10px', lineHeight: 1.8 }}>
            <p style={{ margin: '0 0 4px', fontWeight: 700, color: '#888', textTransform: 'uppercase', fontSize: '9px' }}>Underlying Drafts</p>
            {batchExpenses.map(e => (
              <p key={e.id} style={{ margin: 0 }}>
                {e.expense_code ?? e.id.slice(0, 8)} — {e.item_service_description ?? '—'} — {formatCurrency(e.amount_etb ?? 0)}
              </p>
            ))}
          </div>

          {batch.notes && (
            <div style={{ marginBottom: '18px', background: '#f8f9fb', borderRadius: '5px', padding: '10px 14px', fontSize: '11px' }}>
              <strong>Notes:</strong> {batch.notes}
            </div>
          )}

          <div style={{ marginTop: '36px', borderTop: '2px solid #dde2ea', paddingTop: '20px' }}>
            <p style={{ margin: '0 0 16px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: '#aaa', letterSpacing: '1px' }}>Authorization & Approval Signatures</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
              {['Prepared By', 'Finance Approved', 'Disbursed By'].map(label => (
                <div key={label}>
                  <p style={{ margin: '0 0 2px', fontSize: '9px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.8px' }}>{label}</p>
                  <div style={{ borderBottom: '1.5px solid #999', minHeight: '32px', marginBottom: '4px' }} />
                  <p style={{ margin: 0, fontSize: '9px', color: '#ccc' }}>Name &nbsp;/&nbsp; Signature &nbsp;/&nbsp; Date</p>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop: '44px', borderTop: '1px solid #e4e8ee', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ margin: 0, fontSize: '9px', color: '#bbb' }}>{COMPANY_NAME} · This is an official payment request document</p>
            <p style={{ margin: 0, fontSize: '9px', color: '#bbb' }}>Ref: {batch.payment_code ?? batch.id}</p>
          </div>
        </div>
      </div>

      {/* Screen view */}
      <div className="space-y-5 print:hidden">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-200">
            <ArrowLeft className="h-4 w-4" /> Batch Payments
          </button>
          <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">
            <Printer className="h-3.5 w-3.5" /> Print Payment Request
          </button>
        </div>

        <div className="rounded-2xl overflow-hidden" style={{ background: '#1B3A5C' }}>
          <div className="px-6 py-7">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-12 w-12 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0 border border-white/20" style={{ background: 'rgba(255,255,255,0.18)' }}>
                <Layers className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-white/60 text-xs uppercase tracking-widest">Batch Payment</p>
                <h1 className="text-white font-bold text-lg leading-tight font-mono">{batch.payment_code ?? batch.id.slice(0, 8)}</h1>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {scopeLabel.projects.map(p => (
                <span key={p} className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)' }}>{p}</span>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 text-center divide-x divide-white/10" style={{ background: 'rgba(0,0,0,0.22)' }}>
            <div className="py-3 px-2">
              <p className="text-white/50 text-xs uppercase tracking-wide">Total</p>
              <p className="text-white font-black text-xl tabular-nums">{formatCurrency(grandTotal)}</p>
            </div>
            <div className="py-3 px-2">
              <p className="text-white/50 text-xs uppercase tracking-wide">Workers</p>
              <p className="text-white font-bold text-sm">{totalHeadcount}</p>
            </div>
            <div className="py-3 px-2">
              <p className="text-white/50 text-xs uppercase tracking-wide">Drafts</p>
              <p className="text-white font-bold text-sm">{batchExpenses.length}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b dark:border-slate-700">
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Worker Breakdown</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-xs text-slate-500">Worker</th>
                  <th className="text-left px-4 py-2 font-medium text-xs text-slate-500">Bank Account</th>
                  <th className="text-right px-4 py-2 font-medium text-xs text-slate-500">Duration/Vol.</th>
                  <th className="text-right px-4 py-2 font-medium text-xs text-slate-500">Rate</th>
                  <th className="text-right px-4 py-2 font-medium text-xs text-slate-500">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {workerLines.map(w => (
                  <tr key={w.id}>
                    <td className="px-4 py-2 text-slate-700 dark:text-slate-200">
                      {(w.gang_size ?? 1) > 1 ? (
                        <>
                          <span className="font-medium">Gang of {w.gang_size}</span>
                          <span className="text-xs text-slate-400"> via {w.employee_name}</span>
                          {w.gang_member_names && <p className="text-[11px] text-slate-400">{w.gang_member_names}</p>}
                        </>
                      ) : w.employee_name}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">
                      {(w.gang_size ?? 1) > 1 ? (w.vendor_bank_account ?? `Vendor: ${w.vendor_name ?? '—'}`) : (w.bank_account ?? '—')}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{w.units ?? '—'} {w.unit_label}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{w.rate != null ? formatCurrency(w.rate) : '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold">{w.subtotal != null ? formatCurrency(w.subtotal) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/40">
                  <td colSpan={4} className="px-4 py-2.5 text-right text-xs font-bold uppercase text-slate-500">Total</td>
                  <td className="px-4 py-2.5 text-right font-black text-slate-800 dark:text-slate-100 tabular-nums">{formatCurrency(grandTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b dark:border-slate-700">
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Underlying Drafts</h2>
          </div>
          <div className="divide-y dark:divide-slate-700">
            {batchExpenses.map(e => (
              <div key={e.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <Link to={`/expenses/${e.id}`} className="text-sm text-brand hover:underline truncate block">{e.expense_code ?? e.id.slice(0, 8)}</Link>
                  <p className="text-xs text-slate-400 truncate">{e.item_service_description}</p>
                </div>
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{formatCurrency(e.amount_etb ?? 0)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
