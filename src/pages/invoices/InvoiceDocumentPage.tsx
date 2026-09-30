import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FileText, Wallet } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useVatRate } from '@/lib/catalog'
import { useCompanyProfile, useCompanySignoff } from '@/lib/companyProfile'
import { buildInvoiceHtml, type InvoiceDocInput } from '@/lib/documents/invoiceDocument'
import { DocumentActions } from '@/components/documents/DocumentActions'
import { FactList, Panel, Pill, RecordHeader, RecordLayout } from '@/components/record/Record'

interface SaleRow {
  id: string; invoice_number: string | null; date: string | null; due_date: string | null; amount: number | null
  sales_description: string; sales_status: string | null; is_vat_exempt: boolean | null; notes: string | null
  client_id: string | null; proforma_id: string | null; contract_id: string | null; amount_received: number | null
  clients: { client_name: string; tin: string | null; address: string | null; phone_number: string | null; email: string | null } | null
  projects: { project_name: string } | null
  proformas: { proforma_number: string | null; total: number | null; discount_amount: number | null } | null
  contracts: { contract_no: string | null } | null
}

/**
 * An invoice as the client receives it (migration 368): the tax invoice
 * built from the sale, with print / PDF and share filed in the register
 * with its QR check.
 */
export default function InvoiceDocumentPage() {
  const { id } = useParams<{ id: string }>()
  const { data: company } = useCompanyProfile()
  const { data: signoff } = useCompanySignoff()

  const { data: sale, isLoading } = useQuery({
    queryKey: ['invoice-document', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('sales')
        .select('id, invoice_number, date, due_date, amount, sales_description, sales_status, is_vat_exempt, notes, client_id, proforma_id, contract_id, amount_received, clients(client_name, tin, address, phone_number, email), projects(project_name), proformas:proforma_id(proforma_number, total, discount_amount), contracts:contract_id(contract_no)')
        .eq('id', id!).single()
      if (error) throw error
      return data as unknown as SaleRow
    },
  })
  const { data: request } = useQuery({
    queryKey: ['invoice-request', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from('client_payment_requests').select('request_number, kind, percent, basis_amount').eq('sale_id', id!).maybeSingle()
      return data as { request_number: string; kind: string; percent: number | null; basis_amount: number } | null
    },
  })
  // Invoiced before this one against the same proforma or contract.
  const { data: before = 0 } = useQuery({
    queryKey: ['invoice-before', id, sale?.proforma_id, sale?.contract_id],
    enabled: !!sale && !!(sale.proforma_id || sale.contract_id),
    queryFn: async () => {
      let q = supabase.from('sales').select('id, amount, date, invoice_number').neq('id', sale!.id)
      q = sale!.proforma_id ? q.eq('proforma_id', sale!.proforma_id) : q.eq('contract_id', sale!.contract_id!)
      const { data } = await q
      return ((data ?? []) as { amount: number; date: string | null; invoice_number: string | null }[])
        .filter(s => (s.date ?? '') < (sale!.date ?? '') || ((s.date ?? '') === (sale!.date ?? '') && (s.invoice_number ?? '') < (sale!.invoice_number ?? '')))
        .reduce((t, s) => t + Number(s.amount ?? 0), 0)
    },
  })
  const { data: vatRate } = useVatRate(sale?.date ?? new Date().toISOString().slice(0, 10))

  const input: InvoiceDocInput | null = useMemo(() => {
    if (!sale) return null
    const basisTotal = request?.basis_amount ?? sale.proformas?.total ?? null
    return {
      number: sale.invoice_number, date: sale.date ?? new Date().toISOString().slice(0, 10), dueDate: sale.due_date,
      client: sale.clients, description: sale.sales_description, amount: Number(sale.amount ?? 0),
      vatRate: vatRate ?? 0.15, vatExempt: !!sale.is_vat_exempt,
      reference: { proforma: sale.proformas?.proforma_number, contract: sale.contracts?.contract_no, request: request?.request_number, projectName: sale.projects?.project_name },
      basis: basisTotal ? {
        label: sale.proformas?.proforma_number ? `proforma ${sale.proformas.proforma_number}${Number(sale.proformas.discount_amount ?? 0) > 0 ? ', after its discount' : ''}` : sale.contracts?.contract_no ? `contract ${sale.contracts.contract_no}` : 'the agreed total',
        total: Number(basisTotal), percent: request?.percent ?? null, previouslyInvoiced: before,
      } : null,
      signoff: signoff ?? null,
    }
    // company: rebuild when the letterhead loads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale, request, before, vatRate, signoff, company])
  const preview = useMemo(() => (input ? buildInvoiceHtml({ ...input, preview: true }) : ''), [input])

  if (isLoading || !sale) return <p className="py-16 text-center text-sm text-slate-400">Loading…</p>
  const paid = sale.sales_status === 'Paid'

  return (
    <div className="space-y-4">
      <RecordHeader
        back={{ to: '/invoices', label: 'Invoices' }}
        code={sale.invoice_number}
        title={sale.clients?.client_name ?? 'Invoice'}
        subtitle={sale.sales_description}
        pills={<Pill tone={paid ? 'green' : sale.sales_status === 'Invoiced' ? 'blue' : 'slate'}>{sale.sales_status ?? 'Draft'}</Pill>}
      />
      <div className="flex flex-wrap items-center gap-2">
        {input && (
          <DocumentActions type="invoice" sourceId={sale.id} number={sale.invoice_number} title="Invoice" party={sale.clients?.client_name ?? null}
            partyEmail={sale.clients?.email} partyPhone={sale.clients?.phone_number} total={Number(sale.amount ?? 0)}
            build={verify => buildInvoiceHtml({ ...input, verify })} />
        )}
        <Link to={`/sales/${sale.id}`} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
          <FileText className="h-4 w-4" /> The sale record
        </Link>
      </div>
      {!sale.clients?.tin && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/15 dark:text-amber-200">
          The client has no TIN on record, so the invoice can't show it.{sale.client_id && <> <Link to={`/clients/${sale.client_id}/edit`} className="font-semibold underline">Add it on the client</Link>.</>}
        </p>
      )}
      <RecordLayout
        main={
          <div className="overflow-hidden rounded-xl border bg-white shadow-sm dark:border-slate-700" style={{ height: 'min(1000px, calc(100vh - 220px))', minHeight: 520 }}>
            <iframe srcDoc={preview} title="Invoice" className="h-full w-full border-0" />
          </div>
        }
        rail={
          <Panel title="Money" icon={Wallet}>
            <FactList facts={[
              { label: 'Billed', value: formatCurrency(Number(sale.amount ?? 0)) },
              { label: 'Invoice date', value: formatDate(sale.date) },
              { label: 'Due', value: sale.due_date ? formatDate(sale.due_date) : '—' },
              ...(sale.amount_received != null ? [{ label: 'Received', value: formatCurrency(Number(sale.amount_received)), tone: 'green' as const }] : []),
              ...(before > 0 ? [{ label: 'Invoiced before this', value: formatCurrency(before) }] : []),
            ]} />
          </Panel>
        }
      />
    </div>
  )
}
