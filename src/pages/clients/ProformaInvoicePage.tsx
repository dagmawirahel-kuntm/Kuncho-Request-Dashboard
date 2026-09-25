import { useState, useRef, useMemo } from 'react'
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, Trash2, Printer, Save, ArrowRight, CheckCircle2, ClipboardList, Package } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { documentBaseCss, renderLetterhead, renderFooter } from '@/lib/documentTheme'
import { COST_ROLES, marginTone, useCatalogCosting, useVatRate, type DraftLine } from '@/lib/catalog'
import { DEFAULT_PLAN, OPEN_STAGES } from '@/lib/salesJourney'
import type { Client } from '@/types/database'
import { ProformaSources } from './ProformaSources'

type LineItem = DraftLine

/** Roles that can read BOQs (boqs_select) — the "From a BOQ" source. */
const BOQ_READ_ROLES = ['admin', 'executive', 'finance', 'project_manager', 'operations_manager', 'design', 'procurement_officer']

const inputCls =
  'w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:text-slate-100'

const numCls =
  'w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-2 text-sm tabular-nums outline-none focus:ring-2 focus:ring-brand dark:text-slate-100'

function fmt(n: number): string {
  return `ETB ${n.toLocaleString('en-ET', { minimumFractionDigits: 2 })}`
}

function buildHtml(p: {
  client?: Client
  items: LineItem[]
  proformaNum: string
  date: string
  validityDays: number
  paymentTerms: string
  notes: string
  subtotal: number
  vat: number
  vatRate: number
  total: number
}): string {
  const rows = p.items.map((it, i) => `
    <tr>
      <td class="c">${i + 1}</td>
      <td>${it.description || '—'}</td>
      <td class="r">${it.qty}</td>
      <td class="r">${it.unit}</td>
      <td class="r">${fmt(it.unitPrice)}</td>
      <td class="r">${fmt(it.qty * it.unitPrice)}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
${documentBaseCss}
html{zoom:0.58}
body{padding:40px 52px;color:#111;font-size:11pt;line-height:1.5;min-height:1123px}
.to{font-size:10pt;margin-bottom:20px}
.to b{font-size:11pt}
table{width:100%;border-collapse:collapse;margin-bottom:20px;font-size:10pt}
thead tr{background:#1B3A5C;color:#fff}
th{padding:8px 10px;text-align:left;font-weight:600;font-size:9pt;letter-spacing:.4px}
th.r,td.r{text-align:right}
th.c,td.c{text-align:center}
tbody tr:nth-child(even){background:#f7f9fb}
td{padding:7px 10px;border-bottom:1px solid #ddd}
.tot{font-size:11pt;font-weight:700}
.subtot td{border-top:2px solid #1B3A5C;background:#f0f4f8}
.notice{font-size:9pt;color:#888;margin-top:20px;font-style:italic}
</style>
</head>
<body>
${renderLetterhead({
  docTitle: 'PROFORMA INVOICE',
  docCode: p.proformaNum || undefined,
  metaLines: [p.date, ...(p.validityDays ? [`Valid for: ${p.validityDays} days`] : [])],
  gradient: 'proforma',
})}
${p.client ? `
<div class="to">
  <div style="color:#888;font-size:9pt;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Bill To</div>
  <b>${p.client.client_name}</b>
  ${p.client.phone_number ? `<div>${p.client.phone_number}</div>` : ''}
  ${p.client.email ? `<div>${p.client.email}</div>` : ''}
</div>` : ''}
<table>
  <thead>
    <tr>
      <th class="c" style="width:36px">#</th>
      <th>Description</th>
      <th class="r" style="width:60px">Qty</th>
      <th class="r" style="width:60px">Unit</th>
      <th class="r" style="width:130px">Unit Price</th>
      <th class="r" style="width:130px">Total</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
  <tbody>
    <tr><td colspan="5" style="text-align:right;padding-right:12px;color:#555;font-size:10pt">Subtotal</td><td class="r">${fmt(p.subtotal)}</td></tr>
    <tr><td colspan="5" style="text-align:right;padding-right:12px;color:#555;font-size:10pt">VAT (${Math.round(p.vatRate * 1000) / 10}%)</td><td class="r">${fmt(p.vat)}</td></tr>
    <tr class="subtot"><td colspan="5" style="text-align:right;padding-right:12px" class="tot">Grand Total</td><td class="r tot" style="color:#1B3A5C">${fmt(p.total)}</td></tr>
  </tbody>
</table>
${p.paymentTerms ? `<div style="font-size:10pt;margin-bottom:8px"><b>Payment Terms:</b> ${p.paymentTerms}</div>` : ''}
${p.notes ? `<div style="font-size:10pt;color:#555">${p.notes}</div>` : ''}
<div class="notice">This proforma invoice is not a tax invoice. Subject to change.</div>
${renderFooter(p.proformaNum || undefined)}
</body>
</html>`
}

/**
 * Build a proforma (migration 337): lines from the Services Catalog, a
 * template or a project's BOQ, or typed in; VAT at the stored rate for the
 * proforma's date; for admin, executive and finance, the cost and margin of
 * every catalog line as you price it. Saved against its deal and project,
 * it converts to an invoice or becomes the project's draft BOQ.
 */
export default function ProformaInvoicePage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user, role } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const previewRef = useRef<HTMLIFrameElement>(null)
  const canSeeCost = COST_ROLES.includes(role as string)
  const canReadBoqs = BOQ_READ_ROLES.includes(role as string)

  const { data: client, isLoading } = useQuery<Client>({
    queryKey: ['client', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('*').eq('id', id!).single()
      if (error) throw error
      return data as Client
    },
    enabled: !!id,
  })
  const { data: deals = [] } = useQuery({
    queryKey: ['client-open-deals', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('opportunities').select('id, title, stage').eq('client_id', id!)
      if (error) throw error
      return (data ?? []) as { id: string; title: string; stage: string }[]
    },
  })
  const { data: projects = [] } = useQuery({
    queryKey: ['client-projects-lookup', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('id, project_name').eq('client_id', id!).order('project_name')
      if (error) throw error
      return (data ?? []) as { id: string; project_name: string }[]
    },
  })
  const { data: costing = [] } = useCatalogCosting(canSeeCost)
  const costBy = useMemo(() => new Map(costing.map(c => [c.product_id, c])), [costing])

  const [proformaNum, setProformaNum]   = useState('')
  const [date, setDate]                 = useState(() => new Date().toISOString().slice(0, 10))
  const [validityDays, setValidityDays] = useState(30)
  const [paymentTerms, setPaymentTerms] = useState(`${DEFAULT_PLAN.advance}% advance on signing, ${DEFAULT_PLAN.progress}% against progress, ${DEFAULT_PLAN.final}% on handover`)
  const [notes, setNotes]               = useState('')
  const [opportunityId, setOpportunityId] = useState<string>(searchParams.get('opportunity_id') ?? '')
  const [projectId, setProjectId]       = useState<string>(searchParams.get('project_id') ?? '')
  const [templateId, setTemplateId]     = useState<string | null>(null)
  const [sourceBoqId, setSourceBoqId]   = useState<string | null>(null)
  const [items, setItems]               = useState<LineItem[]>([])

  const [saving, setSaving]           = useState(false)
  const [makingBoq, setMakingBoq]     = useState(false)
  const [savedProforma, setSavedProforma] = useState<{ id: string; proforma_number: string } | null>(null)

  const { data: vatRate, isLoading: vatLoading } = useVatRate(date)

  const addLines   = (lines: LineItem[]) => setItems(p => [...p.filter(i => i.description.trim() || i.unitPrice), ...lines])
  const removeItem = (itemId: string) => setItems(p => p.filter(i => i.id !== itemId))
  const updateItem = (itemId: string, field: keyof LineItem, value: string | number) =>
    setItems(p => p.map(i => i.id === itemId ? { ...i, [field]: value } : i))

  const subtotal = items.reduce((s, i) => s + i.qty * i.unitPrice, 0)
  const rate     = vatRate ?? 0
  const vat      = subtotal * rate
  const total    = subtotal + vat

  // Cost of the catalog lines that have a recipe; margin on those lines.
  const costed = useMemo(() => {
    let cost = 0, revenue = 0, missing = 0, below = 0
    for (const i of items) {
      const c = i.productId ? costBy.get(i.productId) : undefined
      if (c?.cost_per_unit == null) { if (i.unitPrice > 0) missing++; continue }
      cost += i.qty * Number(c.cost_per_unit)
      revenue += i.qty * i.unitPrice
      if (i.unitPrice < Number(c.cost_per_unit)) below++
    }
    return { cost, revenue, missing, below, margin: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : null }
  }, [items, costBy])

  const previewDoc = useMemo(
    () => buildHtml({ client, items, proformaNum, date, validityDays, paymentTerms, notes, subtotal, vat, vatRate: rate, total }),
    [client, items, proformaNum, date, validityDays, paymentTerms, notes, subtotal, vat, rate, total],
  )

  function handlePrint() {
    previewRef.current?.contentWindow?.print()
  }

  async function handleSave() {
    const lines = items.filter(i => i.description.trim())
    if (lines.length === 0) { toast('Add at least one line', 'error'); return }
    if (vatRate == null) { toast('No VAT rate is on record for this date — ask the tax officer to add it', 'error'); return }
    setSaving(true)
    const { data: pf, error: pfErr } = await supabase
      .from('proformas')
      .insert([{
        proforma_number: proformaNum || null,
        client_id: id,
        opportunity_id: opportunityId || null,
        project_id: projectId || null,
        template_id: templateId,
        source_boq_id: sourceBoqId,
        date,
        validity_days: validityDays,
        payment_terms: paymentTerms,
        notes,
        subtotal,
        vat_amount: vat,
        total,
        status: 'draft',
        created_by: user?.id ?? null,
      }])
      .select('id, proforma_number')
      .single()

    if (pfErr || !pf) { toast(pfErr?.message ?? 'Save failed', 'error'); setSaving(false); return }

    const { error: itemErr } = await supabase.from('proforma_items').insert(
      lines.map((it, idx) => ({
        proforma_id: pf.id,
        product_id: it.productId,
        description: it.description,
        qty: it.qty,
        unit: it.unit,
        unit_price: it.unitPrice,
        vat_rate: vatRate,
        sort_order: idx,
      }))
    )
    if (itemErr) { toast(itemErr.message, 'error'); setSaving(false); return }

    setSavedProforma({ id: pf.id, proforma_number: pf.proforma_number ?? '' })
    if (!proformaNum) setProformaNum(pf.proforma_number ?? '')
    qc.invalidateQueries({ queryKey: ['proformas'] })
    qc.invalidateQueries({ queryKey: ['sales-engagements'] })
    toast(`Proforma ${pf.proforma_number} saved`, 'success')
    setSaving(false)
  }

  async function handleMakeBoq() {
    if (!savedProforma || !projectId) return
    setMakingBoq(true)
    const { error } = await supabase.rpc('create_boq_from_proforma', { p_proforma_id: savedProforma.id, p_project_id: projectId })
    setMakingBoq(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['boqs'] })
    toast('Draft BOQ created on the project', 'success')
    navigate(`/projects/${projectId}`)
  }

  if (isLoading) return <div className="flex items-center justify-center h-64 text-slate-500 dark:text-slate-400">Loading…</div>

  const openDeals = deals.filter(d => OPEN_STAGES.includes(d.stage as never) || d.id === opportunityId)

  return (
    <div className="flex flex-col gap-4">
      {/* Top bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <button onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Proforma · {client?.client_name}</h1>
          {savedProforma && (
            <span className="rounded-full bg-green-100 dark:bg-green-900/30 px-2.5 py-0.5 text-xs font-semibold text-green-700 dark:text-green-300 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> {savedProforma.proforma_number}
            </span>
          )}
          <button onClick={handlePrint}
            className="inline-flex items-center gap-1.5 rounded-lg border dark:border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">
            <Printer className="w-4 h-4" /> Print
          </button>
          {!savedProforma ? (
            <button onClick={handleSave} disabled={saving || vatLoading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60">
              <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save Proforma'}
            </button>
          ) : (
            <>
              {projectId && (
                <button onClick={handleMakeBoq} disabled={makingBoq} title="The job went ahead: turn these lines into the project's draft BOQ"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-brand px-3 py-2 text-sm font-medium text-brand hover:bg-brand/10 disabled:opacity-60">
                  <ClipboardList className="w-4 h-4" /> {makingBoq ? 'Creating…' : 'Make it the project BOQ'}
                </button>
              )}
              {/* Invoices come from payment requests — a share of this
                  proforma at a time — not from the proforma itself (340). */}
              <Link to={`/clients/${id}/payment-request?proforma_id=${savedProforma.id}`}
                title="Ask the client for a share of this proforma — the invoice is raised from the request"
                className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700">
                <ArrowRight className="w-4 h-4" /> Request Payment
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Body: form + preview */}
      <div className="flex gap-5 items-start">
        {/* ── Form column ── */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* Invoice meta */}
          <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Proforma Details</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Proforma Number <span className="text-slate-300">(auto)</span></label>
                <input className={inputCls} placeholder="PI-2026-001" value={proformaNum} onChange={e => setProformaNum(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Date</label>
                <input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Validity (days)</label>
                <input type="number" min={1} className={inputCls} value={validityDays} onChange={e => setValidityDays(Number(e.target.value))} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">For the deal</label>
                <select className={inputCls} value={opportunityId} onChange={e => setOpportunityId(e.target.value)}>
                  <option value="">— No deal —</option>
                  {openDeals.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Payment Terms</label>
                <input className={inputCls} value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Project <span className="text-slate-300">(if the work has one)</span></label>
                <select className={inputCls} value={projectId} onChange={e => setProjectId(e.target.value)}>
                  <option value="">— None yet —</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.project_name}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-4">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Notes</label>
                <textarea className={inputCls} rows={2} placeholder="Scope, exclusions, lead time…" value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Line items */}
          <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Line Items</h2>
              {(templateId || sourceBoqId) && (
                <span className="text-[11px] text-slate-400">{templateId ? 'Built from a template' : ''}{templateId && sourceBoqId ? ' · ' : ''}{sourceBoqId ? 'Built from a BOQ' : ''}</span>
              )}
            </div>
            {!savedProforma && id && (
              <div className="mb-4 rounded-lg bg-slate-50 p-3 dark:bg-slate-900/40">
                <ProformaSources clientId={id} canReadBoqs={canReadBoqs}
                  onAdd={addLines}
                  onTemplate={(tid, lines) => { setTemplateId(tid); addLines(lines) }}
                  onBoq={(bid, lines) => { setSourceBoqId(bid); addLines(lines) }} />
              </div>
            )}
            {items.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">Pick from the catalog, drop in a template, or pull a BOQ to start.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b dark:border-slate-700 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                      <th className="pb-2 pr-2">Description</th>
                      <th className="pb-2 pr-2 w-16">Qty</th>
                      <th className="pb-2 pr-2 w-16">Unit</th>
                      <th className="pb-2 pr-2 w-24">Unit Price</th>
                      <th className="pb-2 pr-2 w-32 text-right">Total</th>
                      {canSeeCost && <th className="pb-2 pl-1 pr-1 w-16">Margin</th>}
                      <th className="pb-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-slate-700">
                    {items.map(item => {
                      const c = item.productId ? costBy.get(item.productId) : undefined
                      const m = c?.cost_per_unit != null && item.unitPrice > 0 ? Math.round(((item.unitPrice - Number(c.cost_per_unit)) / item.unitPrice) * 1000) / 10 : null
                      return (
                        <tr key={item.id}>
                          <td className="py-2 pr-3">
                            <div className="flex items-center gap-1.5">
                              {item.productId && <Package className="h-3.5 w-3.5 shrink-0 text-brand" aria-label="From the catalog" />}
                              <input className={inputCls} placeholder="Description" value={item.description} onChange={e => updateItem(item.id, 'description', e.target.value)} disabled={!!savedProforma} />
                            </div>
                          </td>
                          <td className="py-2 pr-2">
                            <input type="number" min={0} className={numCls} value={item.qty} onChange={e => updateItem(item.id, 'qty', Number(e.target.value))} disabled={!!savedProforma} />
                          </td>
                          <td className="py-2 pr-2">
                            <input className={numCls} value={item.unit} onChange={e => updateItem(item.id, 'unit', e.target.value)} disabled={!!savedProforma} />
                          </td>
                          <td className="py-2 pr-2">
                            <input type="number" min={0} className={numCls} value={item.unitPrice} onChange={e => updateItem(item.id, 'unitPrice', Number(e.target.value))} disabled={!!savedProforma} />
                          </td>
                          <td className="py-2 pr-2 whitespace-nowrap text-right text-slate-700 dark:text-slate-200 font-medium tabular-nums">
                            {fmt(item.qty * item.unitPrice)}
                          </td>
                          {canSeeCost && (
                            <td className="py-2 pl-1 pr-1" title={c?.cost_per_unit != null ? `Cost ${formatCurrency(Number(c.cost_per_unit))} per ${item.unit}` : 'No cost recipe'}>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${marginTone(m)}`}>{m != null ? `${m}%` : '—'}</span>
                            </td>
                          )}
                          <td className="py-2">
                            {!savedProforma && (
                              <button onClick={() => removeItem(item.id)} aria-label="Remove line" className="text-slate-400 hover:text-red-500 transition-colors">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Summary */}
          <div className="grid gap-4 rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm sm:grid-cols-2">
            {canSeeCost ? (
              <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Margin · only you can see this</p>
                {costed.revenue > 0 ? (
                  <>
                    <p className="flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-sm font-bold tabular-nums ${marginTone(costed.margin)}`}>{costed.margin}%</span>
                      <span>{formatCurrency(costed.revenue - costed.cost)} over a cost of {formatCurrency(costed.cost)}</span>
                    </p>
                    {costed.below > 0 && <p className="flex items-center gap-1 text-red-600 dark:text-red-400"><AlertTriangle className="h-3.5 w-3.5" /> {costed.below} line{costed.below === 1 ? ' is' : 's are'} priced below cost</p>}
                  </>
                ) : <p className="text-slate-400">Catalog lines with a cost recipe show their margin here.</p>}
                {costed.missing > 0 && <p className="text-slate-400">{costed.missing} line{costed.missing === 1 ? ' has' : 's have'} no cost to compare — <Link to="/catalog" className="text-brand hover:underline">add recipes in the catalog</Link>.</p>}
              </div>
            ) : <div />}
            <div className="ml-auto w-full max-w-xs space-y-2 text-sm">
              <div className="flex justify-between text-slate-600 dark:text-slate-300"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
              <div className="flex justify-between text-slate-600 dark:text-slate-300">
                <span>VAT {vatRate != null ? `(${Math.round(vatRate * 1000) / 10}%)` : ''}</span>
                <span>{vatRate != null ? fmt(vat) : vatLoading ? '…' : <span className="text-xs text-red-600">no rate on record</span>}</span>
              </div>
              <div className="flex justify-between border-t dark:border-slate-700 pt-2 font-bold text-slate-800 dark:text-slate-100 text-base"><span>Grand Total</span><span>{fmt(total)}</span></div>
            </div>
          </div>
        </div>

        {/* ── Preview column ── */}
        <div className="hidden lg:block w-[460px] flex-shrink-0 sticky top-0">
          <p className="text-[10px] uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2 text-center font-semibold">Live Preview</p>
          <div className="rounded-xl overflow-hidden border dark:border-slate-700 shadow-lg bg-white" style={{ height: 'min(710px, calc(100vh - 155px))' }}>
            <iframe ref={previewRef} srcDoc={previewDoc} className="w-full h-full border-0" title="Proforma Invoice Preview" />
          </div>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center mt-2">Updates live as you type · Print button prints this view</p>
        </div>
      </div>
    </div>
  )
}
