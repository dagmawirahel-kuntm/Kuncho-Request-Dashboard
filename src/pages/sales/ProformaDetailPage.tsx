import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, CheckCircle2, ClipboardList, Copy, GitBranch, Layers, Percent, Receipt, ShieldAlert, ShieldCheck, ThumbsDown, Wallet } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { COST_ROLES, marginTone } from '@/lib/catalog'
import { useCompanyProfile, useCompanySignoff } from '@/lib/companyProfile'
import { buildProformaHtml, effectiveStatus, type ProformaDocInput } from '@/lib/documents/proformaDocument'
import { DocumentActions } from '@/components/documents/DocumentActions'
import { ActionDialog } from '@/components/shared/ActionDialog'
import { FactList, Panel, Pill, RecordHeader, RecordLayout, type Tone } from '@/components/record/Record'
import type { ProformaStatus } from '@/types/database'
import { DEFAULT_DISCOUNT_LIMIT, discountLabel, discountPercent, type DiscountKind } from '@/lib/discount'

interface PF {
  id: string; proforma_number: string | null; client_id: string; project_id: string | null; opportunity_id: string | null
  date: string; validity_days: number | null; valid_until: string | null; payment_terms: string | null; notes: string | null
  scope: string | null; exclusions: string | null; subtotal: number; vat_amount: number; total: number; status: ProformaStatus
  version: number; root_proforma_id: string | null; parent_proforma_id: string | null; created_by: string | null; created_at: string
  sent_at: string | null; sent_to: string | null; accepted_at: string | null; declined_at: string | null; decline_reason: string | null
  source_boq_id: string | null
  lines_total: number | null; discount_kind: DiscountKind | null; discount_value: number | null; discount_amount: number | null
  discount_reason: string | null; discount_set_by: string | null; discount_approved_by: string | null; discount_approved_at: string | null
  clients: { client_name: string; tin: string | null; address: string | null; phone_number: string | null; email: string | null } | null
  projects: { project_name: string } | null
  opportunities: { title: string } | null
}
interface Line { id: string; description: string; qty: number; unit: string | null; unit_price: number; vat_rate: number | null; section: string | null; sort_order: number }

const STATUS: Record<string, { tone: Tone; label: string }> = {
  draft: { tone: 'slate', label: 'Draft — not sent yet' }, sent: { tone: 'blue', label: 'Sent' }, accepted: { tone: 'green', label: 'Accepted' },
  declined: { tone: 'red', label: 'Declined' }, converted: { tone: 'green', label: 'Invoiced' }, expired: { tone: 'amber', label: 'Expired' },
  superseded: { tone: 'slate', label: 'Replaced by a newer version' },
}

/**
 * One proforma (migration 368): the document exactly as the client gets
 * it, with print / PDF and share (each filed with its QR check), what
 * happened to it (sent, accepted, declined, expired, invoiced), its
 * versions, what's been asked for and invoiced against it, and — for the
 * roles that see cost — its margin.
 */
export default function ProformaDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { role, user } = useAuth()
  const canSeeCost = COST_ROLES.includes(role ?? '')
  const canWrite = ['admin', 'executive', 'finance'].includes(role ?? '')
  const { data: company } = useCompanyProfile()
  const { data: signoff } = useCompanySignoff()
  const [dialog, setDialog] = useState<null | 'decline'>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: pf, isLoading } = useQuery({
    queryKey: ['proforma', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('proformas')
        .select('*, clients:client_id(client_name, tin, address, phone_number, email), projects:project_id(project_name), opportunities:opportunity_id(title)')
        .eq('id', id!).single()
      if (error) throw error
      return data as unknown as PF
    },
  })
  const { data: lines = [] } = useQuery({
    queryKey: ['proforma-lines', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('proforma_items').select('id, description, qty, unit, unit_price, vat_rate, section, sort_order').eq('proforma_id', id!).order('sort_order')
      if (error) throw error
      return (data ?? []) as Line[]
    },
  })
  const { data: costs = [] } = useQuery({
    queryKey: ['proforma-costs', id],
    enabled: !!id && canSeeCost && lines.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('proforma_item_costs').select('proforma_item_id, cost_per_unit, cost_source').in('proforma_item_id', lines.map(l => l.id))
      if (error) throw error
      return (data ?? []) as { proforma_item_id: string; cost_per_unit: number; cost_source: string }[]
    },
  })
  const root = pf ? pf.root_proforma_id ?? pf.id : null
  const { data: versions = [] } = useQuery({
    queryKey: ['proforma-versions', root],
    enabled: !!root,
    queryFn: async () => {
      const { data, error } = await supabase.from('proformas').select('id, proforma_number, version, status, date, total')
        .or(`id.eq.${root},root_proforma_id.eq.${root}`).order('version', { ascending: false })
      if (error) throw error
      return (data ?? []) as { id: string; proforma_number: string | null; version: number; status: ProformaStatus; date: string; total: number }[]
    },
  })
  const { data: requests = [] } = useQuery({
    queryKey: ['client-payment-requests', 'proforma', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('client_payment_requests').select('id, request_number, kind, amount, percent, status, request_date, sale_id')
        .eq('proforma_id', id!).neq('status', 'cancelled').order('request_date')
      if (error) throw error
      return (data ?? []) as { id: string; request_number: string; kind: string; amount: number; percent: number | null; status: string; request_date: string; sale_id: string | null }[]
    },
  })
  const { data: author } = useQuery({
    queryKey: ['user-name', pf?.created_by],
    enabled: !!pf?.created_by,
    queryFn: async () => {
      const { data } = await supabase.from('user_profiles').select('full_name, email, phone_number').eq('id', pf!.created_by!).maybeSingle()
      return data as { full_name: string; email: string | null; phone_number: string | null } | null
    },
  })

  const discountAmt = Number(pf?.discount_amount ?? 0)
  const { data: discountPeople } = useQuery({
    queryKey: ['proforma-discount-people', pf?.discount_set_by, pf?.discount_approved_by],
    enabled: discountAmt > 0 && !!(pf?.discount_set_by || pf?.discount_approved_by),
    queryFn: async () => {
      const ids = [pf!.discount_set_by, pf!.discount_approved_by].filter(Boolean) as string[]
      const { data } = await supabase.from('user_profiles').select('id, full_name').in('id', ids)
      return new Map(((data ?? []) as { id: string; full_name: string }[]).map(u => [u.id, u.full_name]))
    },
  })

  const input: ProformaDocInput | null = useMemo(() => {
    if (!pf) return null
    return {
      number: pf.proforma_number, version: pf.version, date: pf.date, validityDays: pf.validity_days ?? 30,
      client: pf.clients, projectName: pf.projects?.project_name ?? null,
      lines: lines.map(l => ({ description: l.description, qty: Number(l.qty), unit: l.unit ?? '', unitPrice: Number(l.unit_price), section: l.section })),
      subtotal: Number(pf.subtotal), vat: Number(pf.vat_amount),
      vatRate: Number(pf.subtotal) > 0 ? Math.round((Number(pf.vat_amount) / Number(pf.subtotal)) * 10000) / 10000 : Number(lines[0]?.vat_rate ?? 0),
      total: Number(pf.total), paymentTerms: pf.payment_terms ?? '', notes: pf.notes ?? '', scope: pf.scope, exclusions: pf.exclusions,
      linesTotal: Number(pf.lines_total ?? pf.subtotal),
      discount: Number(pf.discount_amount ?? 0) > 0 ? {
        amount: Number(pf.discount_amount),
        percent: discountPercent(Number(pf.lines_total ?? 0), Number(pf.discount_amount)),
        label: discountLabel({ kind: pf.discount_kind ?? 'amount', value: Number(pf.discount_value ?? pf.discount_amount) }),
        reason: pf.discount_reason,
      } : null,
      preparedBy: author ? { name: author.full_name, phone: author.phone_number, email: author.email } : null,
      signoff: signoff ?? null,
    }
    // company: rebuild when the letterhead loads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pf, lines, author, signoff, company])
  const preview = useMemo(() => (input ? buildProformaHtml({ ...input, preview: true }) : ''), [input])

  const margin = useMemo(() => {
    const by = new Map(costs.map(c => [c.proforma_item_id, Number(c.cost_per_unit)]))
    let cost = 0, revenue = 0, missing = 0
    for (const l of lines) {
      const c = by.get(l.id)
      if (c == null) { missing++; continue }
      cost += Number(l.qty) * c; revenue += Number(l.qty) * Number(l.unit_price)
    }
    // The discount comes off every line alike, so the costed lines lose the same share of their price.
    const share = pf && Number(pf.lines_total ?? 0) > 0 ? Number(pf.discount_amount ?? 0) / Number(pf.lines_total) : 0
    revenue = revenue * (1 - share)
    return { cost, revenue, missing, pct: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : null }
  }, [costs, lines, pf])

  if (isLoading || !pf) return <p className="py-16 text-center text-sm text-slate-400">Loading…</p>

  const status = effectiveStatus(pf)
  // Discount over the company's limit (migration 390): a second person approves it before anything goes out.
  const discountPct = discountPercent(Number(pf.lines_total ?? 0), discountAmt)
  const discountLimit = Number(company?.discount_approval_percent ?? DEFAULT_DISCOUNT_LIMIT)
  const overLimit = discountAmt > 0 && discountPct > discountLimit
  const needsApproval = overLimit && !pf.discount_approved_by
  const canApproveDiscount = needsApproval && canWrite && !!user && user.id !== pf.discount_set_by
  const requested = requests.reduce((s, r) => s + Number(r.amount), 0)
  const invoiced = requests.filter(r => r.status === 'invoiced').reduce((s, r) => s + Number(r.amount), 0)
  const live = !['superseded', 'declined'].includes(pf.status)
  const revisable = !['converted', 'superseded'].includes(pf.status)

  async function update(patch: Record<string, unknown>, msg: string) {
    setBusy(true)
    const { error } = await supabase.from('proformas').update(patch).eq('id', pf!.id)
    setBusy(false)
    if (error) { toast(error.message, 'error'); return false }
    qc.invalidateQueries({ queryKey: ['proforma', id] })
    qc.invalidateQueries({ queryKey: ['proformas'] })
    toast(msg, 'success')
    return true
  }
  async function approveDiscount() {
    if (!user) return
    await update({ discount_approved_by: user.id }, `Discount of ${discountPct}% approved — the proforma can go out`)
  }
  async function makeBoq() {
    if (!pf?.project_id) return
    setBusy(true)
    const { error } = await supabase.rpc('create_boq_from_proforma', { p_proforma_id: pf.id, p_project_id: pf.project_id })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['boqs'] })
    toast('Draft BOQ created on the project', 'success')
    navigate(`/projects/${pf.project_id}`)
  }

  const tbtn = 'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700'

  return (
    <div className="space-y-4">
      <RecordHeader
        back={{ to: '/proformas', label: 'Proformas' }}
        code={pf.proforma_number}
        title={pf.clients?.client_name ?? 'Proforma'}
        subtitle={[pf.projects?.project_name, pf.opportunities?.title, `${formatDate(pf.date)} · valid until ${formatDate(pf.valid_until)}`].filter(Boolean).join(' · ')}
        pills={<>
          <Pill tone={STATUS[status]?.tone ?? 'slate'}>{STATUS[status]?.label ?? status}</Pill>
          {pf.version > 1 && <Pill tone="violet" icon={GitBranch}>Version {pf.version}</Pill>}
        </>}
      />

      {needsApproval && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-700/40 dark:bg-amber-900/20">
          <ShieldAlert className="h-5 w-5 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1 text-amber-900 dark:text-amber-200">
            <p className="font-semibold">A {discountPct}% discount needs approving</p>
            <p className="text-xs">
              It's over the {discountLimit}% limit. Until someone other than {discountPeople?.get(pf.discount_set_by ?? '') ?? 'the person who set it'} approves it,
              the proforma can't be printed as a numbered copy, sent, accepted or have payment requested.
              {pf.discount_reason ? <> Reason given: “{pf.discount_reason}”.</> : null}
            </p>
          </div>
          {canApproveDiscount ? (
            <button onClick={approveDiscount} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
              <ShieldCheck className="h-4 w-4" /> Approve discount
            </button>
          ) : (
            <span className="text-xs text-amber-700 dark:text-amber-300">
              {user?.id === pf.discount_set_by ? 'You set it, so someone else approves it.' : 'Admin, executive or finance can approve it.'}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {input && (
          <DocumentActions type="proforma" sourceId={pf.id} number={pf.proforma_number} title="Proforma" party={pf.clients?.client_name ?? null}
            partyEmail={pf.clients?.email} partyPhone={pf.clients?.phone_number} total={Number(pf.total)}
            build={verify => buildProformaHtml({ ...input, verify })} disabled={!live || needsApproval} />
        )}
        {canWrite && (
          <>
            {live && !needsApproval && pf.status !== 'accepted' && pf.status !== 'converted' && (
              <button onClick={() => update({ status: 'accepted', accepted_at: new Date().toISOString(), declined_at: null, decline_reason: null }, 'Marked accepted')} disabled={busy} className={tbtn}>
                <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Client accepted
              </button>
            )}
            {live && pf.status !== 'converted' && (
              <button onClick={() => setDialog('decline')} disabled={busy} className={tbtn}><ThumbsDown className="h-4 w-4 text-red-500" /> Declined</button>
            )}
            {revisable && (
              <Link to={`/clients/${pf.client_id}/proforma?from=${pf.id}&mode=revise`} className={tbtn} title="Change it and send a new version; this one is marked replaced">
                <GitBranch className="h-4 w-4" /> Revise
              </Link>
            )}
            <Link to={`/clients/${pf.client_id}/proforma?from=${pf.id}&mode=copy`} className={tbtn} title="Start a new proforma from this one"><Copy className="h-4 w-4" /> Copy</Link>
            {live && !needsApproval && requested < Number(pf.total) - 1 && (
              <Link to={`/clients/${pf.client_id}/payment-request?proforma_id=${pf.id}`} className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-700">
                <ArrowRight className="h-4 w-4" /> Request payment
              </Link>
            )}
            {pf.project_id && live && (
              <button onClick={makeBoq} disabled={busy} className={tbtn} title="The job went ahead: turn these lines into the project's draft BOQ"><ClipboardList className="h-4 w-4" /> Make it the project BOQ</button>
            )}
          </>
        )}
      </div>

      {pf.status === 'superseded' && versions[0] && versions[0].id !== pf.id && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
          This version was replaced. The current one is <Link to={`/proformas/${versions[0].id}`} className="font-semibold text-brand hover:underline">{versions[0].proforma_number}</Link>.
        </p>
      )}

      <RecordLayout
        main={
          <div className="overflow-hidden rounded-xl border bg-white shadow-sm dark:border-slate-700" style={{ height: 'min(1000px, calc(100vh - 220px))', minHeight: 520 }}>
            <iframe srcDoc={preview} title="Proforma" className="h-full w-full border-0" />
          </div>
        }
        rail={
          <>
            <Panel title="Money" icon={Wallet}>
              <FactList facts={[
                ...(discountAmt > 0 ? [
                  { label: 'Total of the lines', value: formatCurrency(Number(pf.lines_total ?? 0)) },
                  {
                    label: 'Discount', tone: 'green' as const,
                    value: <span className="inline-flex items-center gap-1"><Percent className="h-3 w-3" />−{formatCurrency(discountAmt)} · {discountPct}%</span>,
                    hint: [
                      pf.discount_reason,
                      discountPeople?.get(pf.discount_set_by ?? '') ? `set by ${discountPeople.get(pf.discount_set_by ?? '')}` : null,
                      pf.discount_approved_by ? `approved by ${discountPeople?.get(pf.discount_approved_by) ?? 'someone'} ${formatDateTime(pf.discount_approved_at)}` : overLimit ? 'not approved yet' : null,
                    ].filter(Boolean).join(' · ') || undefined,
                  },
                ] : []),
                { label: discountAmt > 0 ? 'Subtotal after discount' : 'Subtotal', value: formatCurrency(Number(pf.subtotal)) },
                { label: 'VAT', value: formatCurrency(Number(pf.vat_amount)) },
                { label: 'Total', value: formatCurrency(Number(pf.total)) },
                { label: 'Asked for', value: `${formatCurrency(requested)}${Number(pf.total) > 0 ? ` · ${Math.round((requested / Number(pf.total)) * 100)}%` : ''}` },
                { label: 'Invoiced', value: formatCurrency(invoiced), tone: invoiced > 0 ? 'green' : undefined },
                ...(canSeeCost && margin.revenue > 0 ? [{
                  label: 'Margin', hint: margin.missing ? `${margin.missing} line${margin.missing === 1 ? '' : 's'} without a cost` : undefined,
                  value: <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${marginTone(margin.pct)}`}>{margin.pct}% · {formatCurrency(margin.revenue - margin.cost)}</span>,
                }] : []),
              ]} />
            </Panel>

            <Panel title="What happened" icon={Receipt}>
              <FactList facts={[
                { label: 'Made', value: formatDateTime(pf.created_at), hint: author?.full_name },
                { label: 'Sent', value: pf.sent_at ? formatDateTime(pf.sent_at) : 'Not yet', hint: pf.sent_to ?? undefined, tone: pf.sent_at ? undefined : 'amber' },
                { label: 'Valid until', value: formatDate(pf.valid_until), tone: status === 'expired' ? 'red' : undefined },
                ...(pf.accepted_at ? [{ label: 'Accepted', value: formatDateTime(pf.accepted_at), tone: 'green' as const }] : []),
                ...(pf.declined_at ? [{ label: 'Declined', value: formatDateTime(pf.declined_at), hint: pf.decline_reason ?? undefined, tone: 'red' as const }] : []),
              ]} />
              {!pf.clients?.tin && <p className="mt-2 text-xs text-amber-600">The client has no TIN on record, so none is printed. <Link to={`/clients/${pf.client_id}/edit`} className="underline">Add it</Link>.</p>}
            </Panel>

            {versions.length > 1 && (
              <Panel title="Versions" icon={Layers} count={versions.length} padded={false}>
                <ul className="divide-y text-sm dark:divide-slate-700">
                  {versions.map(v => (
                    <li key={v.id}>
                      <Link to={`/proformas/${v.id}`} className={`flex items-center gap-2 px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/30 ${v.id === pf.id ? 'bg-brand/5' : ''}`}>
                        <span className="font-mono text-xs font-semibold text-brand">{v.proforma_number}</span>
                        <span className="text-xs text-slate-400">v{v.version} · {formatDate(v.date)}</span>
                        <span className="ml-auto text-xs tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(Number(v.total))}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {requests.length > 0 && (
              <Panel title="Payment requests" icon={ArrowRight} count={requests.length} padded={false}>
                <ul className="divide-y text-sm dark:divide-slate-700">
                  {requests.map(r => (
                    <li key={r.id} className="flex items-center gap-2 px-4 py-2">
                      <span className="font-mono text-xs">{r.request_number}</span>
                      <span className="text-xs capitalize text-slate-500">{r.kind}{r.percent ? ` · ${Number(r.percent)}%` : ''}</span>
                      <span className="ml-auto text-xs tabular-nums">{formatCurrency(Number(r.amount))}</span>
                      <Pill tone={r.status === 'invoiced' ? 'green' : 'blue'}>{r.status}</Pill>
                      {r.sale_id && <Link to={`/invoices/${r.sale_id}`} className="text-xs text-brand hover:underline">Invoice</Link>}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </>
        }
      />

      {dialog === 'decline' && (
        <ActionDialog title="The client declined" confirmLabel="Mark declined" danger busy={busy} onClose={() => setDialog(null)}
          onConfirm={async () => { if (await update({ status: 'declined', declined_at: new Date().toISOString(), decline_reason: reason.trim() || null }, 'Marked declined')) setDialog(null) }}
          description="Saying why helps price the next one.">
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. went with a cheaper quote, project postponed" autoFocus
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </ActionDialog>
      )}
    </div>
  )
}
