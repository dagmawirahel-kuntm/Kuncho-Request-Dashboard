import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable, type QuickFilter } from '@/components/shared/DataTable'
import { formatCurrency } from '@/lib/utils'
import type { VrfPaymentState, VrfRegisterRow, VrfStatus } from '@/types/database'
import { PAYMENT_CLS, PAYMENT_LABEL } from './vrfPayment'
import { AlertCircle, Pencil, Trash2 } from 'lucide-react'

const STATUS_CLS: Record<VrfStatus, string> = {
  open:    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  partial: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  settled: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
}

/** A VRF needs a look when the conversion left notes or the money doesn't reconcile. */
function toConfirm(r: VrfRegisterRow) {
  return r.needs_review || Math.abs(Number(r.unaccounted)) >= 1
}

/** DataTable keys rows by id; a register row's id is its VRF's. */
type Row = VrfRegisterRow & { id: string }

const money = (key: keyof VrfRegisterRow, header: string, cls = ''): ColumnDef<Row> => ({
  id: key as string,
  header,
  accessorFn: r => Number(r[key] ?? 0),
  cell: ({ getValue }) => <span className={`tabular-nums ${cls}`}>{formatCurrency(getValue() as number)}</span>,
})

const quickFilters: QuickFilter[] = [
  { columnId: 'payment_state', label: 'Payment', options: (Object.keys(PAYMENT_LABEL) as VrfPaymentState[]).map(p => ({ label: PAYMENT_LABEL[p], value: p })) },
  { columnId: 'status', label: 'Status', options: (['open', 'partial', 'settled'] as VrfStatus[]).map(s => ({ label: s[0].toUpperCase() + s.slice(1), value: s })) },
  { columnId: 'check', label: 'To confirm', options: [{ label: 'To confirm', value: 'To confirm' }, { label: 'Confirmed', value: 'Confirmed' }] },
]

/**
 * Every VRF as a sortable, searchable row (v_vrf_register): who arranged it,
 * which vendor issued the receipt, where the money went, and whether anything
 * on it still needs confirming. The row opens the full record.
 */
export function VrfTable({ rows, canWrite, onDelete }: {
  rows: VrfRegisterRow[]
  canWrite: boolean
  onDelete: (e: React.MouseEvent, id: string) => void
}) {
  const columns = useMemo<ColumnDef<Row>[]>(() => [
    {
      id: 'record_name',
      header: 'VRF',
      accessorFn: r => r.record_name ?? '',
      cell: ({ row }) => (
        <Link to={`/vendor-receipts/${row.original.vrf_id}`} className="font-mono text-xs font-bold text-brand hover:underline">
          {row.original.record_name ?? 'Untitled'}
        </Link>
      ),
    },
    // Sorts by date; reads as the Ethiopian month.
    {
      id: 'trxn_date',
      header: 'Month',
      accessorFn: r => r.trxn_date ?? '',
      cell: ({ row }) => <span className="whitespace-nowrap text-slate-600 dark:text-slate-300">{row.original.period_label ?? '—'}</span>,
    },
    { id: 'facilitator_name', header: 'Facilitator', accessorFn: r => r.facilitator_name ?? '' },
    {
      id: 'vendor_name',
      header: 'Vendor',
      accessorFn: r => r.vendor_name ?? '',
      cell: ({ row }) => row.original.vendor_name
        ? <span title={row.original.vendor_tin ? `TIN ${row.original.vendor_tin}` : 'No TIN on file'}>{row.original.vendor_name}</span>
        : <span className="text-amber-600 dark:text-amber-400">Not recorded</span>,
    },
    money('receipt_amount', 'Receipt', 'font-semibold'),
    money('transferred', 'Sent'),
    money('wht_recorded', 'WHT', 'text-slate-500'),
    money('commission', 'Commission', 'text-amber-700 dark:text-amber-400'),
    money('returned', 'Returned', 'text-green-600 dark:text-green-400'),
    money('held', 'Still held'),
    {
      id: 'payment_state',
      header: 'Payment',
      accessorFn: r => r.payment_state,
      filterFn: 'equals',
      cell: ({ row }) => {
        const p = row.original.payment_state
        return (
          <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${PAYMENT_CLS[p]}`}
            title={p === 'sent' && row.original.sent_date ? `Sent ${row.original.sent_date}` : undefined}>
            {PAYMENT_LABEL[p]}
          </span>
        )
      },
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: r => r.status,
      filterFn: 'equals',
      cell: ({ getValue }) => {
        const s = getValue() as VrfStatus
        return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS_CLS[s]}`}>{s}</span>
      },
    },
    {
      id: 'check',
      header: 'Check',
      accessorFn: r => (toConfirm(r) ? 'To confirm' : 'Confirmed'),
      filterFn: 'equals',
      cell: ({ row }) => toConfirm(row.original)
        ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400"
            title={row.original.review_notes.join('\n') || 'Money does not reconcile'}>
            <AlertCircle className="h-3.5 w-3.5" /> {Math.max(1, row.original.review_notes.length)}
          </span>
        )
        : <span className="text-[11px] text-slate-400">—</span>,
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row }) => canWrite ? (
        <div className="flex items-center gap-1">
          <Link to={`/vendor-receipts/${row.original.vrf_id}/edit`} title="Edit"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700">
            <Pencil className="h-3.5 w-3.5" />
          </Link>
          <button onClick={e => onDelete(e, row.original.vrf_id)} title="Delete"
            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null,
    },
  ], [canWrite, onDelete])
  const data = useMemo<Row[]>(() => rows.map(r => ({ ...r, id: r.vrf_id })), [rows])

  return (
    <DataTable
      columns={columns}
      data={data}
      searchPlaceholder="Search VRF, facilitator or vendor…"
      persistKey="vrf-register"
      quickFilters={quickFilters}
      expandable={{ summaryColumnIds: ['record_name', 'trxn_date', 'vendor_name', 'receipt_amount', 'payment_state', 'status', 'check'] }}
    />
  )
}
