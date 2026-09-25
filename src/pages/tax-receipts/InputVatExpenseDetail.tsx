import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDateGC } from '@/lib/utils'
import { PrivateDocLink } from '@/components/shared/PrivateDocLink'
import type { InputVatRow } from '@/types/database'
import { ExternalLink } from 'lucide-react'

interface ExpenseDetail {
  item_service_description: string | null
  description_of_item: string | null
  quantity: number | null
  uom: string | null
  amount_etb: number | null
  wht_amount: number | null
  net_payable: number | null
  paid_date: string | null
  payment_method: string | null
  payment_state: string | null
  bank_ref: string | null
  notes: string | null
  projects: { project_name: string } | null
  categories: { category_name: string } | null
  sub_categories: { item_name: string } | null
  accounts: { account_name: string } | null
  transfers: { transfer_id_code: string | null } | null
}

interface ReceiptDetail {
  receipt_no: string | null
  receipt_date: string | null
  vat_amount: number | null
  vendor_tin_on_receipt: string | null
  document_url: string | null
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="truncate text-xs text-slate-700 dark:text-slate-200">{value ?? '—'}</p>
    </div>
  )
}

/**
 * What the purchase behind an input VAT line was: item, project, category,
 * how and when it was paid, and the VAT receipt captured for it. Loaded
 * only when the row is opened.
 */
export function InputVatExpenseDetail({ row }: { row: InputVatRow }) {
  const { data: e, isLoading } = useQuery({
    queryKey: ['input-vat-expense', row.expense_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select(`
          item_service_description, description_of_item, quantity, uom, amount_etb, wht_amount, net_payable,
          paid_date, payment_method, payment_state, bank_ref, notes,
          projects:project_id ( project_name ),
          categories:category_id ( category_name ),
          sub_categories:sub_category_id ( item_name ),
          accounts:account_id ( account_name ),
          transfers:transfer_id ( transfer_id_code )
        `)
        .eq('id', row.expense_id)
        .maybeSingle()
      if (error) throw error
      return data as unknown as ExpenseDetail | null
    },
  })

  const { data: receipt } = useQuery({
    queryKey: ['input-vat-receipt', row.receipt_id],
    enabled: !!row.receipt_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vendor_receipts')
        .select('receipt_no, receipt_date, vat_amount, vendor_tin_on_receipt, document_url')
        .eq('id', row.receipt_id!)
        .maybeSingle()
      if (error) throw error
      return data as ReceiptDetail | null
    },
  })

  if (isLoading) return <p className="text-xs text-slate-400">Loading…</p>
  if (!e) return <p className="text-xs text-slate-400">This purchase is not visible to you.</p>

  const item = e.item_service_description ?? e.description_of_item
  const qty = e.quantity != null ? `${e.quantity}${e.uom ? ` ${e.uom}` : ''}` : null
  const category = [e.categories?.category_name, e.sub_categories?.item_name].filter(Boolean).join(' · ') || null
  const paid = [e.payment_method, e.accounts?.account_name].filter(Boolean).join(' · ') || null
  const bankRef = e.transfers?.transfer_id_code ?? e.bank_ref

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{item ?? 'No description'}{qty ? <span className="text-slate-400"> · {qty}</span> : null}</p>
        <Link to={`/expenses/${row.expense_id}`}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-white dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
          Open expense <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Item label="Project" value={e.projects?.project_name ?? row.project_name} />
        <Item label="Category" value={category} />
        <Item label="Vendor" value={`${row.vendor_name ?? 'No vendor'}${row.vendor_tin ? ` · TIN ${row.vendor_tin}` : ''}`} />
        <Item label="Status" value={e.payment_state} />
        <Item label="Amount" value={formatCurrency(Number(e.amount_etb ?? 0))} />
        <Item label="WHT" value={Number(e.wht_amount ?? 0) > 0 ? formatCurrency(Number(e.wht_amount)) : null} />
        <Item label="Net paid" value={e.net_payable != null ? formatCurrency(Number(e.net_payable)) : null} />
        <Item label="VAT" value={`${formatCurrency(Number(row.vat_amount ?? 0))} · ${row.vat_source === 'estimated' ? 'estimated' : row.vat_source === 'receipt' ? 'from receipt' : 'entered'}`} />
        <Item label="Paid" value={e.paid_date ? formatDateGC(e.paid_date) : null} />
        <Item label="Paid by" value={paid} />
        <Item label="Bank ref" value={bankRef} />
        <Item label="Declared in" value={row.declare_period_label} />
      </div>
      {receipt ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-dashed px-3 py-2 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300">
          <span className="font-semibold">VAT receipt</span>
          <span>No. {receipt.receipt_no ?? '—'}</span>
          {receipt.receipt_date && <span>{formatDateGC(receipt.receipt_date)}</span>}
          <span>VAT {formatCurrency(Number(receipt.vat_amount ?? 0))}</span>
          <span>TIN on receipt {receipt.vendor_tin_on_receipt ?? '—'}</span>
          {receipt.document_url && <PrivateDocLink path={receipt.document_url} title="View receipt document" />}
        </div>
      ) : (
        <p className="text-[11px] text-slate-400">No VAT receipt captured for this purchase yet.</p>
      )}
      {e.notes && <p className="text-[11px] text-slate-500 dark:text-slate-400">{e.notes}</p>}
    </div>
  )
}
