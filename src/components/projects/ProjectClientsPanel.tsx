import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, FilePlus2, FileText, Receipt, Search, Upload, UserPlus, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatCurrencyCompact } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { Panel, Pill, Stat } from '@/components/record/Record'
import type { SalesChecklistItem, SalesEngagementRow } from '@/types/database'
import { AddProjectClientsDialog } from './AddProjectClientsDialog'

// Everyone who pays for this project (migration 447). Most projects have one
// client; an event has its host and every exhibitor, each a client of its
// own with its own contract, proforma, invoice, payment and papers. One row
// per client: what was agreed, invoiced and received, which papers are on
// file, and the next thing missing.
//
// Exhibitors start from one common proforma and change their booth's
// specifics (migration 449): the project keeps which proforma that is, each
// client's new proforma is a copy of it, and the client's own proforma total
// can be taken as its contract price (VAT included, as proforma totals are).

type Deal = Pick<SalesEngagementRow, 'engagement_id' | 'contract_id' | 'client_id' | 'client_name' | 'client_tin' | 'contract_no' | 'contract_value'
  | 'contract_status' | 'invoiced' | 'received' | 'outstanding' | 'invoice_count' | 'wht_certificates_due' | 'wht_certificates_collected' | 'checklist'>
interface Extra { id: string; contract_value_includes_vat: boolean; wht_rate: number | null; notes: string | null }
type Filter = 'all' | 'papers' | 'invoice' | 'owing' | 'done'
interface Pf { id: string; proforma_number: string | null; client_id: string; total: number; status: string; clients: { client_name: string } | null }

// The papers worth a chip on each row, in order.
const PAPERS: { type: SalesChecklistItem['type']; short: string }[] = [
  { type: 'tin_licence', short: 'TIN & licence' },
  { type: 'proforma', short: 'Proforma' },
  { type: 'contract', short: 'Signed contract' },
]

function nextStep(d: Deal, own: Pf | undefined, hasBase: boolean): { text: string; tone: 'red' | 'amber' | 'green' | 'slate'; filter: Filter } {
  const missing = (t: string) => d.checklist?.some(c => c.type === t && c.status === 'missing')
  if (!d.client_tin) return { text: 'Needs its TIN', tone: 'red', filter: 'papers' }
  if (d.contract_value == null) return own
    ? { text: 'Take the price from its proforma', tone: 'amber', filter: 'papers' }
    : { text: hasBase ? 'Needs its proforma (from the common one)' : 'Needs the agreed price', tone: 'red', filter: 'papers' }
  if (missing('tin_licence')) return { text: 'Needs TIN & licence copy', tone: 'amber', filter: 'papers' }
  if (missing('contract')) return { text: 'Needs the signed contract', tone: 'amber', filter: 'papers' }
  if (missing('proforma')) return { text: 'Needs a proforma', tone: 'amber', filter: 'papers' }
  if (Number(d.invoiced) < Number(d.contract_value)) return { text: `${formatCurrency(Number(d.contract_value) - Number(d.invoiced))} to invoice`, tone: 'amber', filter: 'invoice' }
  if (Number(d.outstanding) > 0) return { text: `Owes ${formatCurrency(Number(d.outstanding))}`, tone: 'red', filter: 'owing' }
  if (d.wht_certificates_due > d.wht_certificates_collected) return { text: 'WHT certificate to collect', tone: 'amber', filter: 'papers' }
  return { text: 'Complete', tone: 'green', filter: 'done' }
}

export function ProjectClientsPanel({ projectId, projectName, mainClientId }: { projectId: string; projectName: string; mainClientId: string | null }) {
  const { role } = useAuth()
  const qc = useQueryClient()
  const { toast } = useToast()
  const canEdit = role === 'admin' || role === 'finance'
  const canChooseBase = canEdit || role === 'executive' || (role as string) === 'sales'
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')

  const { data: deals = [], isLoading } = useQuery({
    queryKey: ['project-clients', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_sales_engagements')
        .select('engagement_id, contract_id, client_id, client_name, client_tin, contract_no, contract_value, contract_status, invoiced, received, outstanding, invoice_count, wht_certificates_due, wht_certificates_collected, checklist')
        .eq('project_id', projectId)
      if (error) throw error
      return ((data ?? []) as Deal[]).sort((a, b) =>
        Number(b.client_id === mainClientId) - Number(a.client_id === mainClientId) || (a.client_name ?? '').localeCompare(b.client_name ?? ''))
    },
  })
  const { data: extra } = useQuery({
    queryKey: ['project-clients-extra', projectId],
    queryFn: async () => {
      const [k, c] = await Promise.all([
        supabase.from('contracts').select('id, contract_value_includes_vat, wht_rate, notes').eq('project_id', projectId),
        supabase.from('contracts').select('client_id, clients(id, phone_number)').eq('project_id', projectId),
      ])
      if (k.error) throw k.error
      const phones = new Map<string, string | null>()
      for (const r of (c.data ?? []) as unknown as { clients: { id: string; phone_number: string | null } | null }[]) if (r.clients) phones.set(r.clients.id, r.clients.phone_number)
      return { contracts: new Map(((k.data ?? []) as Extra[]).map(x => [x.id, x])), phones }
    },
  })

  // The proformas under the project: the common one, and each client's latest.
  const { data: pfs } = useQuery({
    queryKey: ['project-clients-proformas', projectId],
    queryFn: async () => {
      const [p, f] = await Promise.all([
        supabase.from('projects').select('base_proforma_id').eq('id', projectId).single(),
        supabase.from('proformas').select('id, proforma_number, client_id, total, status, clients(client_name)')
          .eq('project_id', projectId).order('created_at', { ascending: false }),
      ])
      if (f.error) throw f.error
      const list = (f.data ?? []) as unknown as Pf[]
      const latest = new Map<string, Pf>()
      for (const x of list) if (!['superseded', 'declined'].includes(x.status) && !latest.has(x.client_id)) latest.set(x.client_id, x)
      const baseId = (p.data as { base_proforma_id: string | null } | null)?.base_proforma_id ?? null
      return { list, latest, base: list.find(x => x.id === baseId) ?? null }
    },
  })
  const base = pfs?.base ?? null

  function refresh() {
    for (const k of ['project-clients', 'project-clients-extra', 'project-clients-proformas', 'sales-engagements', 'project-workspace', 'project-contract']) qc.invalidateQueries({ queryKey: [k] })
  }
  async function chooseBase(id: string | null) {
    const { error } = await supabase.rpc('project_set_common_proforma', { p_project_id: projectId, p_proforma_id: id })
    if (error) { toast(error.message, 'error'); return }
    toast(id ? 'Every new proforma here now starts from that one' : 'No common proforma', 'success')
    refresh()
  }
  // A proforma's total has VAT in it, so the contract price does too.
  async function takeProformaPrice(d: Deal, pf: Pf) {
    if (!d.contract_id) return
    const { error } = await supabase.from('contracts').update({ contract_value: Number(pf.total), contract_value_includes_vat: true }).eq('id', d.contract_id)
    if (error) { toast(error.message, 'error'); return }
    toast(`${d.client_name}: ${formatCurrency(Number(pf.total))} from ${pf.proforma_number ?? 'its proforma'}`, 'success')
    refresh()
  }
  async function saveAmount(d: Deal, raw: string) {
    const v = raw.replace(/[^0-9.]/g, '') === '' ? null : Number(raw.replace(/[^0-9.]/g, ''))
    if (v === (d.contract_value == null ? null : Number(d.contract_value)) || !d.contract_id) return
    const { error } = await supabase.from('contracts').update({ contract_value: v }).eq('id', d.contract_id)
    if (error) { toast(error.message, 'error'); return }
    refresh()
  }
  async function toggleVat(d: Deal, now: boolean) {
    if (!d.contract_id) return
    const { error } = await supabase.from('contracts').update({ contract_value_includes_vat: !now }).eq('id', d.contract_id)
    if (error) { toast(error.message, 'error'); return }
    refresh()
  }
  async function saveTin(d: Deal, raw: string) {
    const v = raw.trim() || null
    if (v === d.client_tin || !d.client_id) return
    const { error } = await supabase.from('clients').update({ tin: v }).eq('id', d.client_id)
    if (error) { toast(error.message, 'error'); return }
    refresh()
  }

  const withNext = useMemo(() => deals.map(d => ({ d, next: nextStep(d, d.client_id ? pfs?.latest.get(d.client_id) : undefined, !!pfs?.base) })), [deals, pfs])
  const shown = withNext.filter(({ d, next }) =>
    (filter === 'all' || next.filter === filter)
    && (!q.trim() || `${d.client_name ?? ''} ${d.contract_no ?? ''} ${d.client_tin ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())))
  const sum = (f: (d: Deal) => number) => deals.reduce((s, d) => s + f(d), 0)
  const agreed = sum(d => Number(d.contract_value ?? 0))
  const invoiced = sum(d => Number(d.invoiced))
  const received = sum(d => Number(d.received))
  const count = (f: Filter) => withNext.filter(x => x.next.filter === f).length
  const noPrice = deals.filter(d => d.contract_value == null).length

  if (!isLoading && deals.length <= 1 && !canEdit) return null

  return (
    <Panel title="Who pays for this project" icon={Users} count={deals.length} padded={false}
      action={canEdit && (
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
          <UserPlus className="h-3.5 w-3.5" /> Add clients
        </button>
      )}>
      {isLoading ? <p className="py-8 text-center text-sm text-slate-400">Loading…</p> : deals.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">
          No contracts on this project yet. When several clients each pay their own part (an event's exhibitors, say), add them here: each gets a client record and a contract of its own under {projectName}.
        </p>
      ) : (
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Agreed" value={formatCurrency(agreed)} sub={noPrice ? `${noPrice} without a price yet` : `${deals.length} client${deals.length === 1 ? '' : 's'}`} tone={noPrice ? 'amber' : undefined} />
            <Stat label="Invoiced" value={formatCurrency(invoiced)} sub={agreed ? `${Math.round((invoiced / agreed) * 100)}% of agreed` : undefined} />
            <Stat label="Received" value={formatCurrency(received)} tone={received && received >= invoiced ? 'green' : undefined} sub={invoiced > received ? `${formatCurrency(invoiced - received)} owed` : undefined} />
            <Stat label="Complete" value={`${count('done')} of ${deals.length}`} tone={count('done') === deals.length ? 'green' : undefined} sub={`${count('papers')} missing papers`} />
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-dashed px-3 py-2 text-xs dark:border-slate-600">
            <FileText className="h-3.5 w-3.5 text-brand" />
            <span className="font-medium text-slate-600 dark:text-slate-300">Common proforma</span>
            {base
              ? <Link to={`/proformas/${base.id}`} className="font-mono font-semibold text-brand hover:underline">{base.proforma_number ?? 'Draft'}</Link>
              : <span className="text-slate-400">none chosen</span>}
            {base && <span className="text-slate-400">{base.clients?.client_name} · {formatCurrency(Number(base.total))}</span>}
            {canChooseBase && (pfs?.list.length ?? 0) > 0 && (
              <select value={base?.id ?? ''} onChange={e => void chooseBase(e.target.value || null)} aria-label="Common proforma"
                className="rounded-md border bg-white px-1.5 py-1 text-xs dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
                <option value="">{base ? 'None' : 'Choose…'}</option>
                {pfs!.list.filter(x => x.status !== 'superseded').map(x => (
                  <option key={x.id} value={x.id}>{x.proforma_number ?? 'Draft'} · {x.clients?.client_name ?? ''} · {formatCurrencyCompact(Number(x.total))}</option>
                ))}
              </select>
            )}
            <span className="basis-full text-[11px] text-slate-400 sm:basis-auto">
              {base
                ? 'Each client\'s new proforma starts as a copy of it; change their booth\'s specifics there, then take the price from it.'
                : (pfs?.list.length ?? 0) > 0
                  ? 'Pick the proforma every client starts from.'
                  : 'Make it first: create the proforma for one client (the first button on their row), then choose it here.'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[12rem] max-w-xs flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a client…"
                className="w-full rounded-md border bg-white py-2 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </div>
            {([['all', 'All', deals.length], ['papers', 'Missing papers', count('papers')], ['invoice', 'To invoice', count('invoice')], ['owing', 'Owing', count('owing')], ['done', 'Complete', count('done')]] as [Filter, string, number][]).map(([f, label, n]) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${filter === f ? 'border-brand bg-brand text-white' : 'border-slate-200 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                {label} <span className="opacity-70">{n}</span>
              </button>
            ))}
          </div>

          <div className="overflow-x-auto rounded-lg border dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900/40">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Client</th>
                  <th className="px-3 py-2 text-left font-medium">TIN</th>
                  <th className="px-3 py-2 text-left font-medium">Contract</th>
                  <th className="px-3 py-2 text-right font-medium">Agreed</th>
                  <th className="px-3 py-2 text-right font-medium">Invoiced / received</th>
                  <th className="px-3 py-2 text-left font-medium">Papers</th>
                  <th className="px-3 py-2 text-left font-medium">Next</th>
                  <th className="px-3 py-2 text-right font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700/60">
                {shown.map(({ d, next }) => {
                  const x = d.contract_id ? extra?.contracts.get(d.contract_id) : undefined
                  const own = d.client_id ? pfs?.latest.get(d.client_id) : undefined
                  const phone = d.client_id ? extra?.phones.get(d.client_id) : null
                  return (
                    <tr key={d.engagement_id} className="align-top">
                      <td className="min-w-[12rem] px-3 py-2">
                        {d.client_id ? <Link to={`/clients/${d.client_id}`} className="font-medium text-slate-800 hover:text-brand dark:text-slate-100">{d.client_name}</Link> : <span className="font-medium">{d.client_name}</span>}
                        {d.client_id === mainClientId && <span className="ml-1.5"><Pill tone="brand">Host</Pill></span>}
                        <p className="text-[11px] text-slate-400">{[phone, x?.wht_rate ? `withholds ${Number(x.wht_rate)}%` : null].filter(Boolean).join(' · ')}</p>
                        {x?.notes && <p className="text-[11px] italic text-slate-400">{x.notes}</p>}
                      </td>
                      <td className="px-3 py-2">
                        {canEdit ? (
                          <input key={d.client_tin ?? ''} defaultValue={d.client_tin ?? ''} onBlur={e => void saveTin(d, e.target.value)} placeholder="TIN"
                            aria-label={`TIN of ${d.client_name}`}
                            className={`w-28 rounded-md border px-2 py-1 text-xs tabular-nums outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 ${d.client_tin ? '' : 'border-red-300 bg-red-50/50 dark:bg-red-900/10'}`} />
                        ) : <span className="text-xs tabular-nums">{d.client_tin ?? '—'}</span>}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {d.contract_id ? <Link to={`/contracts/${d.contract_id}/edit`} className="whitespace-nowrap font-mono font-medium text-brand hover:underline">{d.contract_no ?? 'Contract'}</Link> : '—'}
                        <p className="text-[11px] capitalize text-slate-400">{d.contract_status ?? ''}</p>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canEdit && d.contract_id ? (
                          <input key={String(d.contract_value)} defaultValue={d.contract_value ?? ''} inputMode="decimal" onBlur={e => void saveAmount(d, e.target.value)} placeholder="Price"
                            aria-label={`Agreed price for ${d.client_name}`}
                            className={`w-28 rounded-md border px-2 py-1 text-right text-xs tabular-nums outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 ${d.contract_value == null ? 'border-red-300 bg-red-50/50 dark:bg-red-900/10' : ''}`} />
                        ) : <span className="tabular-nums">{formatCurrency(d.contract_value)}</span>}
                        {x && (canEdit
                          ? <button onClick={() => void toggleVat(d, x.contract_value_includes_vat)} className="block w-full text-right text-[10px] text-slate-400 hover:text-brand">{x.contract_value_includes_vat ? 'incl. VAT' : '+ VAT'}</button>
                          : <span className="block text-[10px] text-slate-400">{x.contract_value_includes_vat ? 'incl. VAT' : '+ VAT'}</span>)}
                        {own && (d.contract_value == null || Number(own.total) !== Number(d.contract_value)) && (canEdit && d.contract_id
                          ? <button onClick={() => void takeProformaPrice(d, own)} title={`Take the total of ${own.proforma_number ?? 'its proforma'} as the agreed price`}
                              className="block w-full text-right text-[10px] font-medium text-brand hover:underline">use {own.proforma_number ?? 'proforma'}: {formatCurrencyCompact(Number(own.total))}</button>
                          : <span className="block text-[10px] text-slate-400">{own.proforma_number}: {formatCurrencyCompact(Number(own.total))}</span>)}
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums">
                        <span className="text-slate-700 dark:text-slate-200">{formatCurrency(Number(d.invoiced))}</span>
                        <span className={`block ${Number(d.received) >= Number(d.invoiced) && Number(d.invoiced) > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>{formatCurrency(Number(d.received))}</span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {PAPERS.map(p => {
                            const item = d.checklist?.find(c => c.type === p.type)
                            if (!item || item.status === 'not_needed') return null
                            return <PaperChip key={p.type} d={d} item={item} short={p.short} canUpload={canEdit} onDone={refresh} />
                          })}
                          {d.wht_certificates_due > 0 && (
                            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${d.wht_certificates_collected >= d.wht_certificates_due ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800/40 dark:bg-green-900/20 dark:text-green-300' : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300'}`}>
                              WHT {d.wht_certificates_collected}/{d.wht_certificates_due}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span className={next.tone === 'red' ? 'font-medium text-red-600' : next.tone === 'amber' ? 'text-amber-700 dark:text-amber-400' : next.tone === 'green' ? 'inline-flex items-center gap-1 text-emerald-600' : 'text-slate-500'}>
                          {next.tone === 'green' && <CheckCircle2 className="h-3.5 w-3.5" />}{next.text}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {d.client_id && (
                          <span className="inline-flex gap-1">
                            {own && <Link to={`/proformas/${own.id}`} title={`Open ${own.proforma_number ?? 'its proforma'}`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-brand dark:hover:bg-slate-700"><FileText className="h-4 w-4" /></Link>}
                            <Link to={base && base.client_id !== d.client_id ? `/clients/${d.client_id}/proforma?from=${base.id}&mode=copy&project_id=${projectId}` : `/clients/${d.client_id}/proforma?project_id=${projectId}`}
                              title={base && base.client_id !== d.client_id ? `New proforma, starting from ${base.proforma_number ?? 'the common one'}` : 'New proforma'}
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-brand dark:hover:bg-slate-700"><FilePlus2 className="h-4 w-4" /></Link>
                            <Link to={`/sales/new?client_id=${d.client_id}&project_id=${projectId}${d.contract_id ? `&contract_id=${d.contract_id}` : ''}`} title="New invoice / record payment" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-brand dark:hover:bg-slate-700"><Receipt className="h-4 w-4" /></Link>
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {shown.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-400">Nothing here.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {adding && <AddProjectClientsDialog projectId={projectId} projectName={projectName} onClose={() => { setAdding(false); refresh() }} />}
    </Panel>
  )
}

/**
 * One paper on a client's row: green when on file, red when missing. A
 * missing one is uploaded straight from here and filed against the client's
 * contract, as on the Sales Journey; a proforma is made, not uploaded.
 */
function PaperChip({ d, item, short, canUpload, onDone }: { d: Deal; item: SalesChecklistItem; short: string; canUpload: boolean; onDone: () => void }) {
  const { toast } = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const have = item.status === 'have'
  const cls = have ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800/40 dark:bg-green-900/20 dark:text-green-300'
    : item.status === 'missing' ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800/40 dark:bg-red-900/20 dark:text-red-300'
    : 'border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800'

  async function upload(file: File) {
    if (!d.client_id) return
    setBusy(true)
    const path = `${d.client_id}/${item.type}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const up = await supabase.storage.from('client-documents').upload(path, file, { upsert: false })
    if (up.error) { setBusy(false); toast(`Upload failed: ${up.error.message}`, 'error'); return }
    const { error } = await supabase.from('client_attachments').insert([{
      client_id: d.client_id, file_name: file.name, file_path: path, file_size: file.size, mime_type: file.type || null,
      category: item.type, contract_id: d.contract_id,
    }])
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`${item.label} filed for ${d.client_name}`, 'success')
    onDone()
  }

  if (have || !canUpload || item.type === 'proforma') {
    return <span title={`${item.label}: ${have ? 'on file' : item.status === 'missing' ? 'missing' : 'due later'}`} className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{have ? '✓ ' : ''}{short}</span>
  }
  return (
    <>
      <input ref={input} type="file" className="hidden" accept="image/*,application/pdf,.doc,.docx"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f) }} />
      <button type="button" disabled={busy} onClick={() => input.current?.click()} title={`Upload the ${item.label.toLowerCase()}`}
        className={`inline-flex items-center gap-0.5 whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-medium hover:opacity-80 disabled:opacity-50 ${cls}`}>
        <Upload className="h-2.5 w-2.5" /> {busy ? '…' : short}
      </button>
    </>
  )
}
