import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { OPEN_STAGES, SOURCE_LABEL, STAGE_BY_VALUE } from '@/lib/salesJourney'
import type { SalesChecklistItem, SalesEngagementRow } from '@/types/database'
import { KpiCard } from '@/components/shared/KpiCard'
import { ClientsStrip } from './client-history/ClientsStrip'
import { AlertTriangle, Banknote, CheckCircle2, ChevronDown, Circle, FileWarning, Target, TrendingUp, Upload } from 'lucide-react'

type Filter = 'all' | 'open' | 'won' | 'missing_docs' | 'owed'

const DOC_CLS: Record<SalesChecklistItem['status'], string> = {
  have:       'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800/40',
  missing:    'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800/40',
  not_yet:    'bg-slate-50 text-slate-400 border-slate-200 dark:bg-slate-800 dark:text-slate-500 dark:border-slate-700',
  not_needed: 'bg-slate-50 text-slate-300 border-slate-100 line-through dark:bg-slate-800/50 dark:text-slate-600 dark:border-slate-700',
}

interface OpenInvoice { id: string; invoice_number: string | null; amount: number; date: string | null; due_date: string | null; contract_id: string | null; clients: { client_name: string } | null }

/** Days since the invoice fell due (or was raised, when no due date was set). */
function ageDays(r: OpenInvoice) {
  const from = r.due_date ?? r.date
  if (!from) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(from).getTime()) / 86_400_000))
}

/**
 * Every deal from first contact to final payment (v_sales_engagements,
 * migration 331): the pipeline, what has been invoiced and received, what the
 * clients still owe and for how long, the WHT certificates to collect, and
 * the documents each deal still needs on file.
 */
export default function SalesJourneyPage() {
  const { role } = useAuth()
  const canUpload = role === 'admin' || role === 'executive' || role === 'finance' || (role as string) === 'sales'
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<string | null>(null)

  const { data: deals = [], isLoading } = useQuery({
    queryKey: ['sales-engagements'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_sales_engagements').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as SalesEngagementRow[]
    },
  })

  // Invoices raised and approved but not yet paid — what clients owe.
  const { data: openInvoices = [] } = useQuery({
    queryKey: ['sales-open-invoices'],
    queryFn: async () => {
      const { data, error } = await supabase.from('sales')
        .select('id, invoice_number, amount, date, due_date, contract_id, clients(client_name)')
        .is('payment_date', null)
        .in('approval_status', ['manager_approved', 'finance_approved'])
        .neq('sales_status', 'Cancelled')
        .eq('is_archived', false)
      if (error) throw error
      return (data ?? []) as unknown as OpenInvoice[]
    },
  })

  // Sales this year not tied to any contract: they sit outside every deal.
  const { data: unlinked = [] } = useQuery({
    queryKey: ['sales-unlinked'],
    queryFn: async () => {
      const { data, error } = await supabase.from('sales')
        .select('id, invoice_number, amount, clients(client_name)')
        .is('contract_id', null).eq('is_archived', false).neq('sales_status', 'Cancelled')
      if (error) throw error
      return (data ?? []) as unknown as { id: string; invoice_number: string | null; amount: number; clients: { client_name: string } | null }[]
    },
  })

  const k = useMemo(() => {
    const openDeals = deals.filter(d => OPEN_STAGES.includes(d.stage))
    const won = deals.filter(d => d.stage === 'won')
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
    return {
      pipeline: sum(openDeals.map(d => Number(d.estimated_value ?? 0))),
      pipelineCount: openDeals.length,
      contracted: sum(won.map(d => Number(d.contract_value ?? 0))),
      wonCount: won.length,
      invoiced: sum(deals.map(d => Number(d.invoiced))),
      received: sum(deals.map(d => Number(d.received))),
      notYetInvoiced: sum(won.map(d => Math.max(0, Number(d.not_yet_invoiced)))),
      whtOwed: sum(deals.map(d => Number(d.wht_certificates_due) - Number(d.wht_certificates_collected))),
      missingDocs: deals.filter(d => d.docs_missing > 0).length,
    }
  }, [deals])

  const aging = useMemo(() => {
    const b = [
      { label: 'Current – 30 days', min: 0, max: 30, total: 0, count: 0 },
      { label: '31 – 60 days', min: 31, max: 60, total: 0, count: 0 },
      { label: '61 – 90 days', min: 61, max: 90, total: 0, count: 0 },
      { label: 'Over 90 days', min: 91, max: Infinity, total: 0, count: 0 },
    ]
    for (const r of openInvoices) {
      const d = ageDays(r)
      const x = b.find(y => d >= y.min && d <= y.max)!
      x.total += Number(r.amount); x.count += 1
    }
    return { buckets: b, total: b.reduce((s, x) => s + x.total, 0) }
  }, [openInvoices])

  const shown = deals.filter(d =>
    filter === 'all' ? true
      : filter === 'open' ? OPEN_STAGES.includes(d.stage)
      : filter === 'won' ? d.stage === 'won'
      : filter === 'missing_docs' ? d.docs_missing > 0
      : Number(d.outstanding) > 0 || Number(d.wht_certificates_due) > Number(d.wht_certificates_collected))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Sales Journey</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Every deal from first contact to final payment — the money and the paperwork.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Pipeline" value={formatCurrency(k.pipeline)} sub={`${k.pipelineCount} open deal${k.pipelineCount === 1 ? '' : 's'} · estimated`} icon={Target} color="bg-sky-50 text-sky-600" />
        <KpiCard label="Contracted" value={formatCurrency(k.contracted)} sub={`${k.wonCount} won · ${formatCurrency(k.notYetInvoiced)} not yet invoiced`} icon={TrendingUp} color="bg-indigo-50 text-indigo-600" />
        <KpiCard label="Received" value={formatCurrency(k.received)} sub={`of ${formatCurrency(k.invoiced)} invoiced on contracts`} icon={Banknote} color="bg-emerald-50 text-emerald-600" />
        <KpiCard label="Clients owe" value={formatCurrency(aging.total)} sub={`${openInvoices.length} unpaid invoice${openInvoices.length === 1 ? '' : 's'} · ${k.whtOwed} WHT certificate${k.whtOwed === 1 ? '' : 's'} to collect`} icon={AlertTriangle} color="bg-amber-50 text-amber-600" />
      </div>

      {/* Receivables by age */}
      <div className="rounded-xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">What clients owe, by age</h2>
          <span className="text-xs text-slate-400">from the due date, or the invoice date when none was set</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {aging.buckets.map((x, i) => (
            <div key={x.label} className={`rounded-lg border px-3 py-2 dark:border-slate-700 ${i === 3 && x.total > 0 ? 'border-red-200 bg-red-50 dark:bg-red-900/20' : ''}`}>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{x.label}</p>
              <p className="mt-1 text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(x.total)}</p>
              <p className="text-[10px] text-slate-400">{x.count} invoice{x.count === 1 ? '' : 's'}</p>
            </div>
          ))}
        </div>
        {unlinked.length > 0 && (
          <p className="mt-3 flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
            <FileWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {unlinked.length} invoice{unlinked.length === 1 ? ' is' : 's are'} not linked to a contract, so {unlinked.length === 1 ? 'it sits' : 'they sit'} outside every deal:{' '}
            {unlinked.map(u => `${u.invoice_number ?? 'no number'} (${u.clients?.client_name ?? '—'}, ${formatCurrency(Number(u.amount))})`).join(', ')}.
            Link {unlinked.length === 1 ? 'it' : 'them'} from the sale.
          </p>
        )}
      </div>

      <ClientsStrip />

      {/* Deals */}
      <div className="rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 dark:border-slate-700">
          <h2 className="mr-auto text-sm font-bold text-slate-800 dark:text-slate-100">Deals</h2>
          {([
            ['all', `All (${deals.length})`],
            ['open', 'In the pipeline'],
            ['won', 'Won'],
            ['missing_docs', `Missing documents (${k.missingDocs})`],
            ['owed', 'Money or WHT owed'],
          ] as [Filter, string][]).map(([f, label]) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${filter === f ? 'bg-brand text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'}`}>
              {label}
            </button>
          ))}
        </div>
        {isLoading ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">Nothing here.</p>
        ) : (
          <div className="divide-y dark:divide-slate-700">
            {shown.map(d => (
              <DealRow key={d.engagement_id} d={d} open={open === d.engagement_id}
                onToggle={() => setOpen(o => (o === d.engagement_id ? null : d.engagement_id))} canUpload={canUpload} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function DealRow({ d, open, onToggle, canUpload }: { d: SalesEngagementRow; open: boolean; onToggle: () => void; canUpload: boolean }) {
  const st = STAGE_BY_VALUE[d.stage]
  const value = Number(d.contract_value ?? d.estimated_value ?? 0)
  const paidPct = value > 0 ? Math.min(100, (Number(d.received) / value) * 100) : 0
  const invPct = value > 0 ? Math.min(100, (Number(d.invoiced) / value) * 100) : 0
  const due = d.checklist.filter(c => c.status === 'have' || c.status === 'missing')
  const whtOwed = Number(d.wht_certificates_due) - Number(d.wht_certificates_collected)

  return (
    <div>
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="grid w-full grid-cols-1 gap-2 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/30 md:grid-cols-[1.6fr_1.2fr_1fr_auto] md:items-center">
        <div className="min-w-0">
          <p className="flex items-center gap-2 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
            {d.title}
          </p>
          <p className="truncate pl-5 text-[11px] text-slate-500 dark:text-slate-400">
            {d.client_name ?? 'No client yet'}
            {d.source ? ` · ${SOURCE_LABEL[d.source]}` : ''}{d.brought_by_name ? ` · by ${d.brought_by_name}` : ''}{d.referrer_name ? ` · via ${d.referrer_name}` : ''}
          </p>
        </div>
        <div>
          <div className="flex items-center justify-between text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
            <span>{formatCurrency(value)}{d.contract_value == null && d.estimated_value != null ? ' est.' : ''}</span>
            {d.contract_id && <span>received {formatCurrency(Number(d.received))}</span>}
          </div>
          {d.contract_id && (
            <div className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700" title={`Invoiced ${formatCurrency(Number(d.invoiced))} · received ${formatCurrency(Number(d.received))}`}>
              <span className="absolute inset-y-0 left-0 bg-indigo-200 dark:bg-indigo-800" style={{ width: `${invPct}%` }} />
              <span className="absolute inset-y-0 left-0 bg-emerald-500" style={{ width: `${paidPct}%` }} />
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {due.map(c => (
            <span key={c.type} title={c.label} className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${DOC_CLS[c.status]}`}>{c.label.split(' ')[0]}</span>
          ))}
          {whtOwed > 0 && <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300">WHT ×{whtOwed}</span>}
        </div>
        {st && <span className={`justify-self-start rounded-full px-2 py-0.5 text-[11px] font-semibold md:justify-self-end ${st.cls}`}>{st.label}</span>}
      </button>
      {open && <DealDetail d={d} canUpload={canUpload} />}
    </div>
  )
}

function DealDetail({ d, canUpload }: { d: SalesEngagementRow; canUpload: boolean }) {
  const whtOwed = Number(d.wht_certificates_due) - Number(d.wht_certificates_collected)
  return (
    <div className="grid gap-4 bg-slate-50 px-4 py-4 dark:bg-slate-900/40 md:grid-cols-2">
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Documents</p>
        <ul className="space-y-1.5">
          {d.checklist.map(c => <ChecklistLine key={c.type} d={d} item={c} canUpload={canUpload} />)}
        </ul>
        {!d.client_id && <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">Add the client to this deal to file its documents.</p>}
      </div>
      <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Money</p>
        {d.contract_id ? (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 tabular-nums">
            <dt className="text-slate-400">Contract</dt><dd>{d.contract_no ?? '—'} · {d.contract_status ?? '—'}{d.signed_date ? ` · signed ${formatDate(d.signed_date)}` : ''}</dd>
            <dt className="text-slate-400">Contract value</dt><dd>{formatCurrency(Number(d.contract_value ?? 0))}</dd>
            <dt className="text-slate-400">Invoiced</dt><dd>{formatCurrency(Number(d.invoiced))} · {d.invoice_count} invoice{d.invoice_count === 1 ? '' : 's'}</dd>
            <dt className="text-slate-400">Received</dt><dd>{formatCurrency(Number(d.received))}</dd>
            <dt className="text-slate-400">Owed now</dt><dd className={Number(d.outstanding) > 0 ? 'font-semibold text-amber-700 dark:text-amber-400' : ''}>{formatCurrency(Number(d.outstanding))}</dd>
            <dt className="text-slate-400">Still to invoice</dt><dd>{formatCurrency(Math.max(0, Number(d.not_yet_invoiced)))}</dd>
            <dt className="text-slate-400">WHT certificates</dt><dd className={whtOwed > 0 ? 'font-semibold text-amber-700 dark:text-amber-400' : ''}>{d.wht_certificates_collected} of {d.wht_certificates_due} collected</dd>
          </dl>
        ) : (
          <p className="text-slate-400">No contract yet{d.estimated_value != null ? ` · estimated ${formatCurrency(Number(d.estimated_value))}` : ''}.</p>
        )}
        {d.lost_reason && <p className="text-red-600 dark:text-red-400">Lost: {d.lost_reason}</p>}
        <div className="flex flex-wrap gap-3 pt-2">
          {d.opportunity_id && <Link to={`/opportunities/${d.opportunity_id}/edit`} className="text-brand hover:underline">Open the deal</Link>}
          {d.contract_id && <Link to={`/contracts/${d.contract_id}/edit`} className="text-brand hover:underline">Contract & payment plan</Link>}
          {d.project_id && <Link to={`/projects/${d.project_id}`} className="text-brand hover:underline">Project{d.project_name ? ` · ${d.project_name}` : ''}</Link>}
          {d.client_id && <Link to={`/sales-journey/clients/${d.client_id}`} className="text-brand hover:underline">Client history</Link>}
          {d.client_id && <Link to={`/clients/${d.client_id}`} className="text-brand hover:underline">Client file</Link>}
        </div>
      </div>
    </div>
  )
}

/**
 * One checklist line, with a file upload that files the document against
 * the deal: its client's private folder, and client_attachments tagged with
 * the document type, the opportunity and the contract.
 */
function ChecklistLine({ d, item, canUpload }: { d: SalesEngagementRow; item: SalesChecklistItem; canUpload: boolean }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function upload(file: File) {
    if (!d.client_id) return
    setBusy(true)
    const path = `${d.client_id}/${item.type}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error: upErr } = await supabase.storage.from('client-documents').upload(path, file, { upsert: false })
    if (upErr) { setBusy(false); toast(`Upload failed: ${upErr.message}`, 'error'); return }
    const { error } = await supabase.from('client_attachments').insert([{
      client_id: d.client_id, file_name: file.name, file_path: path, file_size: file.size, mime_type: file.type || null,
      category: item.type, opportunity_id: d.opportunity_id, contract_id: d.contract_id,
    }])
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['sales-engagements'] })
    qc.invalidateQueries({ queryKey: ['client-attachments'] })
    toast(`${item.label} filed`, 'success')
  }

  const Icon = item.status === 'have' ? CheckCircle2 : item.status === 'missing' ? AlertTriangle : Circle
  const iconCls = item.status === 'have' ? 'text-green-600' : item.status === 'missing' ? 'text-red-500' : 'text-slate-300 dark:text-slate-600'
  const note = item.status === 'not_yet' ? 'due later' : item.status === 'not_needed' ? 'not needed' : item.status === 'missing' ? 'missing' : 'on file'

  return (
    <li className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${iconCls}`} />
        <span className="truncate">{item.label}</span>
        <span className="shrink-0 text-[10px] text-slate-400">{note}</span>
      </span>
      {canUpload && d.client_id && item.status !== 'not_needed' && (
        <>
          <input ref={input} type="file" className="hidden" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
            onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
          <button type="button" onClick={() => input.current?.click()} disabled={busy}
            className="flex shrink-0 items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-white disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
            <Upload className="h-3 w-3" /> {busy ? 'Uploading…' : item.status === 'have' ? 'Add' : 'Upload'}
          </button>
        </>
      )}
    </li>
  )
}
