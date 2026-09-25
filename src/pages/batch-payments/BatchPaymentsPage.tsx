import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import { DataTable } from '@/components/shared/DataTable'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import { EXPENSE_TYPE_THEME } from '@/lib/expenseTypeTheme'
import type { BatchPayment, ExpenseType } from '@/types/database'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { Plus, Pencil, Trash2 } from 'lucide-react'

type LinkedExpense = {
  amount_etb: number | null
  wht_amount: number | null
  credit_applied_etb: number | null
  payment_state: string
  expense_type: ExpenseType | null
}

type BatchRow = BatchPayment & {
  user_profiles: { full_name: string } | null
  batch_payment_expenses: { expense_id: string; expenses: LinkedExpense | null }[]
}

// Where a batch stands, read off its expenses. A batch has no status of its
// own — it is sent, paid or stuck exactly when its expenses are — and the
// list used to show none of it, so a paid batch and one nobody had released
// looked identical.
type BatchStage = 'empty' | 'awaiting_approval' | 'ready' | 'sent' | 'paid' | 'mixed'
const STAGE: Record<BatchStage, { label: string; cls: string }> = {
  empty:             { label: 'Empty',             cls: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300' },
  awaiting_approval: { label: 'Awaiting approval', cls: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200' },
  ready:             { label: 'Ready to pay',      cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  sent:              { label: 'Sent',              cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  paid:              { label: 'Paid',              cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  mixed:             { label: 'Partly paid',       cls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' },
}

function stageOf(expenses: LinkedExpense[]): BatchStage {
  if (expenses.length === 0) return 'empty'
  const states = new Set(expenses.map(e => e.payment_state))
  if (states.size === 1 && states.has('paid')) return 'paid'
  if (states.has('paid')) return 'mixed'
  if (states.has('sent')) return 'sent'
  if (states.has('unpaid')) return 'awaiting_approval'
  if (states.has('approved_to_pay')) return 'ready'
  return 'mixed'
}

const linked = (r: BatchRow) => r.batch_payment_expenses.map(b => b.expenses).filter(Boolean) as LinkedExpense[]

export default function BatchPaymentsPage() {
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { role } = useAuth()
  const canWrite = role === 'admin' || role === 'finance'

  const { data = [], isLoading } = useQuery({
    queryKey: ['batch-payments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('batch_payments')
        .select('*, user_profiles(full_name), batch_payment_expenses(expense_id, expenses(amount_etb, wht_amount, credit_applied_etb, payment_state, expense_type))')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as BatchRow[]
    },
  })

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this batch payment? This cannot be undone.')) return
    const { error } = await supabase.from('batch_payments').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['batch-payments'] })
    toast('Payment deleted', 'success')
  }

  const columns: ColumnDef<BatchRow>[] = useMemo(() => [
    { accessorKey: 'payment_code', header: 'Payment Code', cell: ({ row, getValue }) => (
      <Link to={`/batch-payments/${row.original.id}`} className="text-brand hover:underline">{(getValue() as string) ?? row.original.id.slice(0, 8)}</Link>
    ) },
    {
      id: 'type', header: 'Type',
      accessorFn: row => {
        const types = Array.from(new Set(linked(row).map(e => e.expense_type).filter(Boolean))) as ExpenseType[]
        return types.length === 1 ? EXPENSE_TYPE_THEME[types[0]]?.label ?? types[0] : types.length > 1 ? 'Mixed' : '—'
      },
    },
    {
      id: 'stage', header: 'Status',
      accessorFn: row => STAGE[stageOf(linked(row))].label,
      cell: ({ row }) => {
        const s = STAGE[stageOf(linked(row.original))]
        return <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', s.cls)}>{s.label}</span>
      },
    },
    {
      id: 'total', header: 'Net to Send',
      // What leaves the account — gross less WHT and any vendor credit —
      // matching the To-Pay queue and the batch's Payment Request.
      accessorFn: row => linked(row).reduce((s, e) => s + Number(e.amount_etb ?? 0) - Number(e.wht_amount ?? 0) - Number(e.credit_applied_etb ?? 0), 0),
      cell: ({ getValue }) => <span className="tabular-nums font-medium">{formatCurrency(getValue() as number)}</span>,
    },
    { id: 'expenses_count', header: 'Expenses', accessorFn: row => row.batch_payment_expenses.length },
    { id: 'assignee_name', header: 'Paid By', accessorFn: row => row.user_profiles?.full_name ?? '—' },
    { accessorKey: 'created_at', header: 'Created', cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'notes', header: 'Notes', cell: ({ getValue }) => <span className="text-slate-400 truncate block max-w-xs">{(getValue() as string) ?? '—'}</span> },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        canWrite ? (
          <div className="flex items-center gap-1">
            <Link to={`/batch-payments/${row.original.id}/edit`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit code / notes"><Pencil className="h-3.5 w-3.5" /></Link>
            <button onClick={() => handleDelete(row.original.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ) : null
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [canWrite])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Batch Payments</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Several approved payments sent as one wire, with one Payment Request</p>
        </div>
        {canWrite && (
          // Batches are made where the payments are: tick them in the To-Pay
          // queue. That path checks each one is approved, records who pays
          // and from which account, and moves them to Sent together — the
          // old blank form here did none of that.
          <Link to="/finance/payments" className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90" title="Select approved payments in the To-Pay queue, then Create Batch Payment">
            <Plus className="h-4 w-4" /> New Batch
          </Link>
        )}
      </div>
      {isLoading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : <DataTable columns={columns} data={data} searchPlaceholder="Search payments…" persistKey="batch-payments" initialGlobalFilter={searchParams.get('q') ?? undefined} tableName="batch_payments" queryKeys={['batch-payments']} />}
    </div>
  )
}
