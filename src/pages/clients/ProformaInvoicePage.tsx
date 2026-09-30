import { useState, useMemo } from 'react'
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, Trash2, Printer, Save, Package, Scale, Heading, GitBranch, Copy, Percent, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { COST_ROLES, costIsOld, marginTone, sectionOf, useCatalogCosting, useVatRate, withHeadings, type CostPart, type DraftLine } from '@/lib/catalog'
import { DEFAULT_PLAN, OPEN_STAGES } from '@/lib/salesJourney'
import { useCompanyProfile } from '@/lib/companyProfile'
import { buildProformaHtml } from '@/lib/documents/proformaDocument'
import { printHtml } from '@/lib/documents/issue'
import { DEFAULT_DISCOUNT_LIMIT, discountLabel, discountedTotals, type DiscountKind } from '@/lib/discount'
import type { Client } from '@/types/database'
import { ProformaSources } from './ProformaSources'
import { ProformaPriceGuide } from './ProformaPriceGuide'

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

interface CostRow {
  proforma_item_id: string; cost_per_unit: number; cost_source: 'recipe' | 'market' | 'manual'
  market_price_id: string | null; stock_item_id: string | null; basis_note: string | null; priced_at: string | null
  parts: CostPart[] | null; extra: number | null
}

interface SourceProforma {
  id: string; proforma_number: string | null; client_id: string; project_id: string | null; opportunity_id: string | null
  template_id: string | null; source_boq_id: string | null; validity_days: number; payment_terms: string | null; notes: string | null
  scope: string | null; exclusions: string | null
  discount_kind: DiscountKind | null; discount_value: number | null; discount_reason: string | null
  items: { id: string; product_id: string | null; description: string; qty: number; unit: string | null; unit_price: number; section: string | null; sort_order: number }[]
  costs: { proforma_item_id: string; cost_per_unit: number; cost_source: string; parts: CostPart[] | null; extra: number | null }[]
}

/**
 * Build a proforma (migrations 337, 368): lines from the Services Catalog, a
 * template or a project's BOQ, or typed in, grouped under section headings;
 * scope and exclusions; VAT at the stored rate for the proforma's date; for
 * admin, executive and finance, the cost and margin of every line. Opened
 * with ?from=<id>&mode=revise it becomes the next version of that proforma;
 * with mode=copy, a new one starting from it.
 */
export default function ProformaInvoicePage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user, role, profile } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const canSeeCost = COST_ROLES.includes(role as string)
  const canReadBoqs = BOQ_READ_ROLES.includes(role as string)
  const { data: company } = useCompanyProfile()
  const fromId = searchParams.get('from')
  const mode = (searchParams.get('mode') === 'revise' ? 'revise' : searchParams.get('mode') === 'copy' ? 'copy' : null)

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

  // Revising or copying: start from that proforma's lines and costs.
  const { data: source } = useQuery({
    queryKey: ['proforma-source', fromId, canSeeCost],
    enabled: !!fromId,
    queryFn: async () => {
      const { data: pf, error } = await supabase.from('proformas')
        .select('id, proforma_number, client_id, project_id, opportunity_id, template_id, source_boq_id, validity_days, payment_terms, notes, scope, exclusions, discount_kind, discount_value, discount_reason')
        .eq('id', fromId!).single()
      if (error) throw error
      const { data: items, error: e2 } = await supabase.from('proforma_items')
        .select('id, product_id, description, qty, unit, unit_price, section, sort_order').eq('proforma_id', fromId!).order('sort_order')
      if (e2) throw e2
      let costs: SourceProforma['costs'] = []
      if (canSeeCost && items?.length) {
        const { data: c } = await supabase.from('proforma_item_costs').select('proforma_item_id, cost_per_unit, cost_source, parts, extra').in('proforma_item_id', items.map(i => i.id))
        costs = (c ?? []) as SourceProforma['costs']
      }
      return { ...(pf as object), items: items ?? [], costs } as SourceProforma
    },
  })

  const [proformaNum, setProformaNum]   = useState('')
  const [date, setDate]                 = useState(() => new Date().toISOString().slice(0, 10))
  const [validityDays, setValidityDays] = useState(30)
  const [paymentTerms, setPaymentTerms] = useState(`${DEFAULT_PLAN.advance}% advance on signing, ${DEFAULT_PLAN.progress}% against progress, ${DEFAULT_PLAN.final}% on handover`)
  const [notes, setNotes]               = useState('')
  const [scope, setScope]               = useState('')
  const [exclusions, setExclusions]     = useState('')
  const [opportunityId, setOpportunityId] = useState<string>(searchParams.get('opportunity_id') ?? '')
  const [projectId, setProjectId]       = useState<string>(searchParams.get('project_id') ?? '')
  const [templateId, setTemplateId]     = useState<string | null>(null)
  const [sourceBoqId, setSourceBoqId]   = useState<string | null>(null)
  const [items, setItems]               = useState<LineItem[]>([])
  // One discount on the whole job, taken off before VAT (migration 383).
  const [discountKind, setDiscountKind]     = useState<DiscountKind>('percent')
  const [discountValue, setDiscountValue]   = useState(0)
  const [discountReason, setDiscountReason] = useState('')
  const [loadedFrom, setLoadedFrom]     = useState<string | null>(null)

  const [saving, setSaving]     = useState(false)
  const [guideFor, setGuideFor] = useState<string | null>(null)

  // Fill the form from the proforma being revised or copied, once.
  if (source && loadedFrom !== source.id) {
    setLoadedFrom(source.id)
    setValidityDays(source.validity_days ?? 30)
    if (source.payment_terms) setPaymentTerms(source.payment_terms)
    setNotes(source.notes ?? '')
    setScope(source.scope ?? '')
    setExclusions(source.exclusions ?? '')
    setOpportunityId(source.opportunity_id ?? '')
    setProjectId(source.project_id ?? '')
    setTemplateId(source.template_id)
    setSourceBoqId(source.source_boq_id)
    setDiscountKind(source.discount_kind ?? 'percent')
    setDiscountValue(Number(source.discount_value ?? 0))
    setDiscountReason(source.discount_reason ?? '')
    const costFor = new Map(source.costs.map(c => [c.proforma_item_id, c]))
    setItems(withHeadings(source.items.map(i => {
      const c = costFor.get(i.id)
      const cost = c && c.cost_source !== 'recipe'
        ? { parts: (c.parts ?? []) as CostPart[], extra: Number(c.extra ?? (c.parts?.length ? 0 : c.cost_per_unit)), perUnit: Number(c.cost_per_unit) }
        : undefined
      return { id: crypto.randomUUID(), productId: i.product_id, description: i.description, qty: Number(i.qty), unit: i.unit ?? 'pcs', unitPrice: Number(i.unit_price), section: i.section, cost }
    })))
  }

  const { data: vatRate, isLoading: vatLoading } = useVatRate(date)

  const addLines   = (lines: LineItem[]) => setItems(p => [...p.filter(i => i.isHeading || i.description.trim() || i.unitPrice), ...withHeadings(lines)])
  const addHeading = () => setItems(p => [...p, { id: crypto.randomUUID(), productId: null, description: '', qty: 0, unit: '', unitPrice: 0, isHeading: true }])
  const removeItem = (itemId: string) => setItems(p => p.filter(i => i.id !== itemId))
  const updateItem = (itemId: string, field: keyof LineItem, value: string | number) =>
    setItems(p => p.map(i => i.id === itemId ? { ...i, [field]: value } : i))
  const patchItem = (itemId: string, patch: Partial<LineItem>) =>
    setItems(p => p.map(i => i.id === itemId ? { ...i, ...patch } : i))

  // A cost built in the price guide wins over the catalog recipe's.
  const recipeCostOf = (i: LineItem) => {
    const c = i.productId ? costBy.get(i.productId) : undefined
    return c?.cost_per_unit != null ? Number(c.cost_per_unit) : null
  }
  const costOf = (i: LineItem) => i.cost?.perUnit ?? recipeCostOf(i)

  const priced     = items.filter(i => !i.isHeading)
  const linesTotal = priced.reduce((s, i) => s + i.qty * i.unitPrice, 0)
  const rate       = vatRate ?? 0
  const discount   = discountValue > 0 ? { kind: discountKind, value: discountValue, reason: discountReason.trim() || null } : null
  // VAT is charged on the price after the discount.
  const totals     = discountedTotals(linesTotal, discount, rate)
  const { subtotal, vat, total } = totals
  const discountLimit = Number(company?.discount_approval_percent ?? DEFAULT_DISCOUNT_LIMIT)
  const needsApproval = totals.amount > 0 && totals.percent > discountLimit

  const costed = useMemo(() => {
    let cost = 0, revenue = 0, missing = 0, below = 0, old = 0
    for (const i of items) {
      if (i.isHeading) continue
      const unitCost = costOf(i)
      if (costIsOld(i.cost)) old++
      if (unitCost == null) { if (i.unitPrice > 0) missing++; continue }
      cost += i.qty * unitCost
      revenue += i.qty * i.unitPrice
      if (i.unitPrice < unitCost) below++
    }
    return { cost, revenue, missing, below, old, margin: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, costBy])

  const docInput = useMemo(() => {
    const sections = sectionOf(items)
    return {
      number: proformaNum || (mode === 'revise' && source?.proforma_number ? `${source.proforma_number.replace(/-R\d+$/, '')} (revision)` : null),
      date, validityDays,
      client: client ? { client_name: client.client_name, tin: client.tin, address: client.address, phone_number: client.phone_number, email: client.email } : null,
      projectName: projects.find(p => p.id === projectId)?.project_name ?? null,
      lines: items.filter(i => !i.isHeading).map(i => ({ description: i.description, qty: i.qty, unit: i.unit, unitPrice: i.unitPrice, section: sections.get(i.id) ?? null })),
      subtotal, vat, vatRate: rate, total, paymentTerms, notes, scope, exclusions,
      linesTotal: totals.linesTotal,
      discount: discount && totals.amount > 0 ? { amount: totals.amount, percent: totals.percent, label: discountLabel(discount), reason: discount.reason } : null,
      preparedBy: profile?.full_name ? { name: profile.full_name, email: profile.email ?? null } : null,
      draft: true,
    }
    // company: the letterhead reads the loaded profile
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, proformaNum, mode, source, date, validityDays, client, projects, projectId, subtotal, vat, rate, total, paymentTerms, notes, scope, exclusions, profile, company, discountKind, discountValue, discountReason])
  const previewDoc = useMemo(() => buildProformaHtml({ ...docInput, preview: true }), [docInput])

  async function handleSave() {
    const sections = sectionOf(items)
    const lines = items.filter(i => !i.isHeading && i.description.trim())
    if (lines.length === 0) { toast('Add at least one line', 'error'); return }
    if (vatRate == null) { toast('No VAT rate is on record for this date — ask the tax officer to add it', 'error'); return }
    if (items.some(i => i.isHeading && !i.description.trim())) { toast('Name every section heading, or remove the empty ones', 'error'); return }
    if (totals.amount > 0 && !discountReason.trim()) { toast('Say why the discount is given', 'error'); return }
    setSaving(true)
    const { data: pf, error: pfErr } = await supabase
      .from('proformas')
      .insert([{
        proforma_number: mode === 'revise' ? null : (proformaNum || null),
        parent_proforma_id: mode === 'revise' ? fromId : null,
        client_id: id,
        opportunity_id: opportunityId || null,
        project_id: projectId || null,
        template_id: templateId,
        source_boq_id: sourceBoqId,
        date,
        validity_days: validityDays,
        payment_terms: paymentTerms,
        notes,
        scope: scope.trim() || null,
        exclusions: exclusions.trim() || null,
        lines_total: totals.linesTotal,
        discount_kind: totals.amount > 0 ? discountKind : null,
        discount_value: totals.amount > 0 ? discountValue : null,
        discount_amount: totals.amount,
        discount_reason: totals.amount > 0 ? discountReason.trim() : null,
        subtotal,
        vat_amount: vat,
        total,
        status: 'draft',
        created_by: user?.id ?? null,
      }])
      .select('id, proforma_number')
      .single()

    if (pfErr || !pf) { toast(pfErr?.message ?? 'Save failed', 'error'); setSaving(false); return }

    const { data: savedLines, error: itemErr } = await supabase.from('proforma_items').insert(
      lines.map((it, idx) => ({
        proforma_id: pf.id,
        product_id: it.productId,
        description: it.description,
        qty: it.qty,
        unit: it.unit,
        unit_price: it.unitPrice,
        vat_rate: vatRate,
        sort_order: idx,
        section: sections.get(it.id) ?? null,
      }))
    ).select('id, sort_order')
    if (itemErr) { toast(itemErr.message, 'error'); setSaving(false); return }

    // What each line costs us, and where the figure came from (367, 368).
    if (canSeeCost) {
      const idAt = new Map((savedLines ?? []).map(r => [r.sort_order as number, r.id as string]))
      const costs = lines.flatMap((it, idx): CostRow[] => {
        const lineId = idAt.get(idx)
        const recipe = recipeCostOf(it)
        if (!lineId) return []
        if (it.cost) {
          const one = it.cost.parts.length === 1 ? it.cost.parts[0] : null
          const dates = it.cost.parts.map(p => p.pricedAt).filter(Boolean) as string[]
          return [{
            proforma_item_id: lineId,
            cost_per_unit: it.cost.perUnit,
            cost_source: it.cost.parts.length ? 'market' : 'manual',
            market_price_id: one?.marketPriceId ?? null,
            stock_item_id: one?.stockItemId ?? null,
            basis_note: [
              ...it.cost.parts.map(p => `${p.qtyPer} ${p.unit} ${p.label} @ ${p.price}`),
              ...(it.cost.extra ? [`labour/other ${it.cost.extra}`] : []),
            ].join(' + ') || null,
            priced_at: dates.length ? dates.sort()[0] : null,
            parts: it.cost.parts,
            extra: it.cost.extra || 0,
          }]
        }
        return recipe != null ? [{ proforma_item_id: lineId, cost_per_unit: recipe, cost_source: 'recipe', market_price_id: null, stock_item_id: null, basis_note: 'Catalog recipe', priced_at: null, parts: null, extra: null }] : []
      })
      if (costs.length) {
        const { error: costErr } = await supabase.from('proforma_item_costs').insert(costs)
        if (costErr) toast(`Saved, but the line costs weren't: ${costErr.message}`, 'error')
      }
    }

    qc.invalidateQueries({ queryKey: ['proformas'] })
    qc.invalidateQueries({ queryKey: ['sales-engagements'] })
    toast(mode === 'revise' ? `Saved as ${pf.proforma_number} — the earlier version is marked superseded` : `Proforma ${pf.proforma_number} saved`, 'success')
    if (needsApproval) toast(`The ${totals.percent}% discount is over ${discountLimit}% — someone else in admin, executive or finance has to approve it before it's sent`, 'info')
    setSaving(false)
    navigate(`/proformas/${pf.id}`)
  }

  if (isLoading) return <div className="flex items-center justify-center h-64 text-slate-500 dark:text-slate-400">Loading…</div>

  const openDeals = deals.filter(d => OPEN_STAGES.includes(d.stage as never) || d.id === opportunityId)
  const validUntil = (() => { const d = new Date(`${date}T00:00:00`); d.setDate(d.getDate() + (validityDays || 0)); return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) })()

  return (
    <div className="flex flex-col gap-4">
      {/* Top bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <button onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">
            {mode === 'revise' ? 'Revise' : mode === 'copy' ? 'New proforma from' : 'Proforma'} · {mode && source?.proforma_number ? source.proforma_number : client?.client_name}
          </h1>
          {mode === 'revise' && <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"><GitBranch className="h-3 w-3" /> next version</span>}
          {mode === 'copy' && <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300"><Copy className="h-3 w-3" /> copy</span>}
          <button onClick={() => printHtml(buildProformaHtml(docInput), `${proformaNum || 'Proforma draft'} - ${client?.client_name ?? ''}`)}
            title="Print this draft. Save first to get a numbered copy with its QR check."
            className="inline-flex items-center gap-1.5 rounded-lg border dark:border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">
            <Printer className="w-4 h-4" /> Print draft
          </button>
          <button onClick={handleSave} disabled={saving || vatLoading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60">
            <Save className="w-4 h-4" /> {saving ? 'Saving…' : mode === 'revise' ? 'Save revision' : 'Save proforma'}
          </button>
        </div>
      </div>

      {client && !client.tin && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/15 dark:text-amber-200">
          {client.client_name} has no TIN on record, so the proforma can't show it. <Link to={`/clients/${client.id}/edit`} className="font-semibold underline">Add it on the client</Link>.
        </p>
      )}
      {company && !company.tin && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/15 dark:text-amber-200">
          Our own TIN and VAT number aren't set yet. <Link to="/settings/company" className="font-semibold underline">Fill in the company profile</Link> so every document carries them.
        </p>
      )}

      {/* Body: form + preview */}
      <div className="flex gap-5 items-start">
        {/* ── Form column ── */}
        <div className="flex-1 min-w-0 space-y-4">

          <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Proforma Details</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Proforma Number <span className="text-slate-300">(auto)</span></label>
                <input className={inputCls} placeholder={mode === 'revise' ? `${source?.proforma_number?.replace(/-R\d+$/, '') ?? 'PI'}-R…` : 'PI-2026-001'} value={proformaNum}
                  onChange={e => setProformaNum(e.target.value)} disabled={mode === 'revise'} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Date</label>
                <input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Valid for (days)</label>
                <input type="number" min={1} className={inputCls} value={validityDays} onChange={e => setValidityDays(Number(e.target.value))} />
                <span className="text-[11px] text-slate-400">until {validUntil}</span>
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
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Scope of work</label>
                <textarea className={inputCls} rows={2} placeholder="What the job covers, in a sentence or two" value={scope} onChange={e => setScope(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Not included</label>
                <textarea className={inputCls} rows={2} placeholder="e.g. Electrical works, permits, furniture" value={exclusions} onChange={e => setExclusions(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Notes</label>
                <textarea className={inputCls} rows={2} placeholder="Lead time, delivery, anything else" value={notes} onChange={e => setNotes(e.target.value)} />
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
            {id && (
              <div className="mb-4 space-y-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-900/40">
                <ProformaSources clientId={id} canReadBoqs={canReadBoqs}
                  onAdd={addLines}
                  onTemplate={(tid, lines) => { setTemplateId(tid); addLines(lines) }}
                  onBoq={(bid, lines) => { setSourceBoqId(bid); addLines(lines) }} />
                <button type="button" onClick={addHeading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-white dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                  <Heading className="h-3.5 w-3.5" /> Section heading
                </button>
              </div>
            )}
            {items.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">Pick from the catalog, drop in a template, or pull a BOQ to start.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] table-fixed text-sm">
                  <thead>
                    <tr className="border-b dark:border-slate-700 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                      <th className="pb-2 pr-2">Description</th>
                      <th className="pb-2 pr-2 w-20">Qty</th>
                      <th className="pb-2 pr-2 w-16">Unit</th>
                      <th className="pb-2 pr-2 w-28">Unit Price</th>
                      <th className="pb-2 pr-2 w-32 text-right">Total</th>
                      {canSeeCost && <th className="pb-2 pl-1 pr-1 w-[4.5rem]">Margin</th>}
                      <th className="pb-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-slate-700">
                    {items.map((item, idx) => {
                      if (item.isHeading) {
                        const next = items.slice(idx + 1)
                        const end = next.findIndex(x => x.isHeading)
                        const sub = (end === -1 ? next : next.slice(0, end)).reduce((s, x) => s + x.qty * x.unitPrice, 0)
                        return (
                          <tr key={item.id} className="bg-slate-50 dark:bg-slate-900/40">
                            <td className="py-2 pr-3" colSpan={4}>
                              <div className="flex items-center gap-2">
                                <Heading className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                                <input className={`${inputCls} font-semibold`} placeholder="Section name, e.g. Ceilings" value={item.description}
                                  onChange={e => updateItem(item.id, 'description', e.target.value)} aria-label="Section heading" />
                              </div>
                            </td>
                            <td className="py-2 pr-2 whitespace-nowrap text-right text-xs font-semibold tabular-nums text-slate-500">{fmt(sub)}</td>
                            {canSeeCost && <td />}
                            <td className="py-2">
                              <button onClick={() => removeItem(item.id)} aria-label="Remove heading" className="text-slate-400 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                            </td>
                          </tr>
                        )
                      }
                      const unitCost = costOf(item)
                      const m = unitCost != null && item.unitPrice > 0 ? Math.round(((item.unitPrice - unitCost) / item.unitPrice) * 1000) / 10 : null
                      return (
                        <tr key={item.id}>
                          <td className="py-2 pr-3">
                            <div className="flex items-center gap-1.5">
                              {item.productId && <Package className="h-3.5 w-3.5 shrink-0 text-brand" aria-label="From the catalog" />}
                              <input className={inputCls} placeholder="Description" value={item.description} onChange={e => updateItem(item.id, 'description', e.target.value)} />
                              <button type="button" onClick={() => setGuideFor(item.id)} title="Price guide: what the materials cost us"
                                aria-label={`Price guide for ${item.description || 'this line'}`}
                                className={`shrink-0 rounded-lg border p-2 transition-colors ${item.cost ? 'border-brand/40 bg-brand/5 text-brand' : 'border-slate-200 text-slate-400 hover:border-brand hover:text-brand dark:border-slate-600'}`}>
                                <Scale className="h-4 w-4" />
                              </button>
                            </div>
                            {item.cost && (
                              <p className={`mt-1 truncate pl-0.5 text-[11px] ${costIsOld(item.cost) ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}`}>
                                {canSeeCost ? `Costs ${formatCurrency(item.cost.perUnit)} per ${item.unit}` : 'Costed'}
                                {item.cost.parts.length ? ` · ${item.cost.parts.map(p => p.label).join(', ')}` : ''}
                                {item.cost.extra ? ' + labour' : ''}
                                {costIsOld(item.cost) ? ' · old price, check first' : ''}
                              </p>
                            )}
                          </td>
                          <td className="py-2 pr-2">
                            <input type="number" min={0} className={numCls} value={item.qty} onChange={e => updateItem(item.id, 'qty', Number(e.target.value))} aria-label="Quantity" />
                          </td>
                          <td className="py-2 pr-2">
                            <input className={numCls} value={item.unit} onChange={e => updateItem(item.id, 'unit', e.target.value)} aria-label="Unit" />
                          </td>
                          <td className="py-2 pr-2">
                            <input type="number" min={0} className={numCls} value={item.unitPrice} onChange={e => updateItem(item.id, 'unitPrice', Number(e.target.value))} aria-label="Unit price" />
                          </td>
                          <td className="py-2 pr-2 whitespace-nowrap text-right text-slate-700 dark:text-slate-200 font-medium tabular-nums">
                            {fmt(item.qty * item.unitPrice)}
                          </td>
                          {canSeeCost && (
                            <td className="py-2 pl-1 pr-1" title={unitCost != null ? `Cost ${formatCurrency(unitCost)} per ${item.unit}${item.cost ? ' (price guide)' : ' (catalog recipe)'}` : 'No cost yet: open the price guide'}>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${marginTone(m)}`}>{m != null ? `${m}%` : '—'}</span>
                            </td>
                          )}
                          <td className="py-2">
                            <button onClick={() => removeItem(item.id)} aria-label="Remove line" className="text-slate-400 hover:text-red-500 transition-colors">
                              <Trash2 className="w-4 h-4" />
                            </button>
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
                    {totals.amount > 0 && (() => {
                      // The discount comes off every line alike, so the costed lines lose the same share.
                      const net = costed.revenue * (1 - totals.percent / 100)
                      const after = net > 0 ? Math.round(((net - costed.cost) / net) * 1000) / 10 : null
                      return (
                        <p className="flex items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${marginTone(after)}`}>{after ?? '—'}%</span>
                          <span>after the {totals.percent}% discount · {formatCurrency(net - costed.cost)}</span>
                        </p>
                      )
                    })()}
                  </>
                ) : <p className="text-slate-400">Cost the lines in the price guide (<Scale className="inline h-3 w-3" />) or from catalog recipes to see the margin here.</p>}
                {costed.old > 0 && <p className="flex items-center gap-1 text-amber-600 dark:text-amber-400"><AlertTriangle className="h-3.5 w-3.5" /> {costed.old} line{costed.old === 1 ? ' is' : 's are'} costed from old prices — check before sending</p>}
                {costed.missing > 0 && <p className="text-slate-400">{costed.missing} line{costed.missing === 1 ? ' has' : 's have'} no cost yet — use the price guide (<Scale className="inline h-3 w-3" />) or <Link to="/catalog" className="text-brand hover:underline">catalog recipes</Link>.</p>}
              </div>
            ) : <div />}
            <div className="ml-auto w-full max-w-sm space-y-2 text-sm">
              {/* Discount on the whole job, before VAT (migration 383). */}
              <div className="rounded-lg border border-dashed border-slate-200 p-3 dark:border-slate-600">
                <div className="flex items-center gap-2">
                  <Percent className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Discount</span>
                  <div className="ml-auto flex shrink-0 overflow-hidden rounded-md border text-xs font-semibold dark:border-slate-600" role="group" aria-label="Discount as">
                    {(['percent', 'amount'] as const).map(k => (
                      <button key={k} type="button" onClick={() => setDiscountKind(k)} aria-pressed={discountKind === k}
                        className={`px-2.5 py-1 ${discountKind === k ? 'bg-slate-900 text-white dark:bg-brand dark:text-brand-foreground' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
                        {k === 'percent' ? '%' : 'ETB'}
                      </button>
                    ))}
                  </div>
                  <input type="number" min={0} max={discountKind === 'percent' ? 100 : undefined} step="any" value={discountValue || ''} placeholder="0"
                    onChange={e => setDiscountValue(Math.max(0, Number(e.target.value) || 0))} aria-label={discountKind === 'percent' ? 'Discount percent' : 'Discount in ETB'}
                    className="w-24 shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                </div>
                {discountValue > 0 && (
                  <>
                    <input className={`${inputCls} mt-2`} value={discountReason} onChange={e => setDiscountReason(e.target.value)}
                      placeholder="Why? e.g. repeat client, early payment" aria-label="Reason for the discount" />
                    {needsApproval ? (
                      <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                        <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" />
                        {totals.percent}% is over the {discountLimit}% limit: after saving, someone else in admin, executive or finance approves it before it can be sent.
                      </p>
                    ) : (
                      <p className="mt-1.5 text-[11px] text-slate-400">{totals.percent}% of the lines · within the {discountLimit}% you can give without approval</p>
                    )}
                  </>
                )}
              </div>
              {totals.amount > 0 && (
                <>
                  <div className="flex justify-between text-slate-600 dark:text-slate-300"><span>Total of the lines</span><span>{fmt(totals.linesTotal)}</span></div>
                  <div className="flex justify-between text-emerald-700 dark:text-emerald-400"><span>Discount{discountKind === 'percent' ? ` (${discountValue}%)` : ''}</span><span>−{fmt(totals.amount)}</span></div>
                </>
              )}
              <div className="flex justify-between text-slate-600 dark:text-slate-300"><span>{totals.amount > 0 ? 'Subtotal after discount' : 'Subtotal'}</span><span>{fmt(subtotal)}</span></div>
              <div className="flex justify-between text-slate-600 dark:text-slate-300">
                <span>VAT {vatRate != null ? `(${Math.round(vatRate * 1000) / 10}%)` : ''}</span>
                <span>{vatRate != null ? fmt(vat) : vatLoading ? '…' : <span className="text-xs text-red-600">no rate on record</span>}</span>
              </div>
              <div className="flex justify-between border-t dark:border-slate-700 pt-2 font-bold text-slate-800 dark:text-slate-100 text-base"><span>Grand Total</span><span>{fmt(total)}</span></div>
            </div>
          </div>
        </div>

        {guideFor && (() => {
          const line = items.find(i => i.id === guideFor)
          if (!line) return null
          const c = line.productId ? costBy.get(line.productId) : undefined
          return (
            <ProformaPriceGuide line={line} recipeCost={recipeCostOf(line)} canSeeCost={canSeeCost}
              defaultMarkup={c?.markup_percent != null ? Number(c.markup_percent) : 25}
              onApply={patch => patchItem(line.id, patch)} onClose={() => setGuideFor(null)} />
          )
        })()}

        {/* ── Preview column ── */}
        <div className="hidden lg:block w-[460px] flex-shrink-0 sticky top-0">
          <p className="text-[10px] uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2 text-center font-semibold">Live Preview</p>
          <div className="rounded-xl overflow-hidden border dark:border-slate-700 shadow-lg bg-white" style={{ height: 'min(710px, calc(100vh - 155px))' }}>
            <iframe srcDoc={previewDoc} className="w-full h-full border-0" title="Proforma Invoice Preview" />
          </div>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center mt-2">Updates live as you type · save to get the numbered copy with its QR check</p>
        </div>
      </div>
    </div>
  )
}
