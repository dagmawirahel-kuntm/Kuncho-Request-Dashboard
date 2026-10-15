import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDateGC } from '@/lib/utils'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { WITHHOLDING_PROFILES, withholdingProfileLabel } from '@/lib/clientWithholding'
import type { WithholdingProfile } from '@/types/database'
import { Boxes, Link2, Plus, Search, Trash2 } from 'lucide-react'

// Engagements paid by many clients for a priced package — exhibition booths,
// sponsorship tiers, training seats (migration 455). Set the project's
// packages; money in that fits a package (less what that kind of client keeps
// back, less a transfer charge) is listed to record and match in one step;
// clients can be invoiced in bulk before they pay; and every payment shows
// what the client kept back: income tax, VAT withheld, transfer charge.

interface Pkg { id: string; project_id: string; name: string; net_amount: number; vat_exempt: boolean; active: boolean }
interface Line {
  line_id: string; value_date: string; account_id: string; account_name: string | null; narration: string | null; reference: string | null
  amount: number; package_id: string | null; package_name: string | null; gross: number | null; profile: WithholdingProfile | null
  expected: number | null; charge: number | null
}
interface ClientLite { id: string; client_name: string; withholding_profile: WithholdingProfile | null; business_type: string | null }
interface SaleRow {
  id: string; invoice_number: string | null; client_id: string | null; amount: number | null; amount_received: number | null
  income_tax_withheld: number | null; vat_withheld: number | null; receipt_charge: number | null; receipt_shortfall: number | null
  sales_status: string | null; transfer_id: string | null; date: string | null; payment_date: string | null; package_id: string | null
}

const VAT = 0.15, WHT = 0.03, VAT_WITHHELD = 0.075, WHT_THRESHOLD = 20000
const etb = (n: number | null | undefined) => formatCurrency(Math.round(Number(n ?? 0) * 100) / 100)
const today = () => new Date().toISOString().slice(0, 10)
const addDays = (d: string, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10) }
const effProfile = (c: ClientLite | undefined): WithholdingProfile => c?.withholding_profile ?? (c?.business_type === 'Government' ? 'government' : 'income_tax')

function expectedReceived(net: number, exempt: boolean, profile: WithholdingProfile) {
  const gross = net * (1 + (exempt ? 0 : VAT))
  const it = profile !== 'none' && net >= WHT_THRESHOLD ? net * WHT : 0
  const vw = profile === 'government' && !exempt ? net * VAT_WITHHELD : 0
  return Math.round((gross - it - vw) * 100) / 100
}

const STOP = new Set(['TRANSFER', 'PAYMENT', 'BANK', 'BOOTH', 'PACKAGE', 'PACKAG', 'DONE', 'MOBIL', 'MOBILE', 'CREDIT', 'FINANCE', 'ETHIO', 'ETHIOPIA', 'ETHIOPIAN', 'FORUM'])
function nameHint(narration: string | null, clients: ClientLite[]): ClientLite | undefined {
  const words = (narration ?? '').toUpperCase().split(/[^A-Z]+/).filter(w => w.length >= 4 && !STOP.has(w))
  if (!words.length) return undefined
  return clients.find(c => c.client_name.toUpperCase().split(/[^A-Z]+/).some(w => w.length >= 4 && words.includes(w)))
}

export default function PackageReceiptsPage() {
  const [params, setParams] = useSearchParams()
  const projectId = params.get('project')
  const [from, setFrom] = useState(() => params.get('from') ?? addDays(today(), -60))
  const [to, setTo] = useState(() => params.get('to') ?? today())

  const { data: projects = [] } = useQuery({
    queryKey: ['pkg-projects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('id, project_name, start_date').order('created_at', { ascending: false }).limit(500)
      if (error) throw error
      return (data ?? []) as { id: string; project_name: string; start_date: string | null }[]
    },
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100">
          <Boxes className="h-5 w-5 text-brand" /> Package receipts
        </h1>
        <p className="max-w-3xl text-sm text-slate-500 dark:text-slate-400">
          For engagements many clients pay for at a set price — exhibition booths, sponsorship tiers, seats. Money in that fits a package is
          lined up to record and match in one step, and each payment shows what the client kept back.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
        <label className="min-w-[240px] flex-1 text-xs text-slate-500 dark:text-slate-400">Project
          <SearchableSelect value={projectId} placeholder="Pick the project…"
            options={projects.map(p => ({ id: p.id, label: p.project_name, sub: p.start_date ? `from ${formatDateGC(p.start_date)}` : undefined }))}
            onChange={id => setParams(p => { const n = new URLSearchParams(p); if (id) n.set('project', id); else n.delete('project'); return n }, { replace: true })} />
        </label>
        <label className="text-xs text-slate-500 dark:text-slate-400">Money in from
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="block rounded-md border px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800" />
        </label>
        <label className="text-xs text-slate-500 dark:text-slate-400">to
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="block rounded-md border px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800" />
        </label>
      </div>

      {projectId ? <ProjectReceipts key={projectId} projectId={projectId} from={from} to={to} /> : (
        <p className="rounded-xl border bg-white px-4 py-12 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-800">Pick the project to collect for.</p>
      )}
    </div>
  )
}

function ProjectReceipts({ projectId, from, to }: { projectId: string; from: string; to: string }) {
  const qc = useQueryClient()
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['pkg-lines', projectId] })
    qc.invalidateQueries({ queryKey: ['pkg-sales', projectId] })
    qc.invalidateQueries({ queryKey: ['pkg-packages', projectId] })
  }

  const { data: packages = [] } = useQuery({
    queryKey: ['pkg-packages', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('project_packages').select('*').eq('project_id', projectId).order('created_at')
      if (error) throw error
      return (data ?? []) as Pkg[]
    },
  })
  const { data: clients = [] } = useQuery({
    queryKey: ['pkg-clients'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id, client_name, withholding_profile, business_type').order('client_name')
      if (error) throw error
      return (data ?? []) as ClientLite[]
    },
  })
  const { data: sales = [] } = useQuery({
    queryKey: ['pkg-sales', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('sales')
        .select('id, invoice_number, client_id, amount, amount_received, income_tax_withheld, vat_withheld, receipt_charge, receipt_shortfall, sales_status, transfer_id, date, payment_date, package_id')
        .eq('project_id', projectId).neq('sales_status', 'Cancelled').eq('is_archived', false).order('date')
      if (error) throw error
      return (data ?? []) as SaleRow[]
    },
  })
  const { data: lines = [], isLoading: linesLoading, error: linesError } = useQuery({
    queryKey: ['pkg-lines', projectId, from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('package_receipt_lines', { p_project_id: projectId, p_from: from, p_to: to })
      if (error) throw error
      return (data ?? []) as Line[]
    },
  })

  const clientById = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients])
  const open = sales.filter(s => !s.transfer_id && (s.sales_status === 'Invoiced' || s.sales_status === 'Draft'))
  const paid = sales.filter(s => s.amount_received != null)
  const sum = (rows: SaleRow[], k: keyof SaleRow) => rows.reduce((t, r) => t + Number(r[k] ?? 0), 0)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Fact label="Invoiced" value={etb(sum(sales, 'amount'))} sub={`${sales.length} sale${sales.length === 1 ? '' : 's'} · VAT ${etb(sum(sales, 'amount') * VAT / (1 + VAT))}`} />
        <Fact label="Received" value={etb(sum(paid, 'amount_received'))} sub={`${paid.length} paid`} />
        <Fact label="Income tax withheld" value={etb(sum(paid, 'income_tax_withheld'))} sub="certificates to collect" />
        <Fact label="VAT withheld" value={etb(sum(paid, 'vat_withheld'))} sub="off the VAT return" />
        <Fact label="Waiting for payment" value={String(open.length)} sub={etb(sum(open, 'amount'))} tone={open.length ? 'amber' : undefined} />
      </div>

      <Packages projectId={projectId} packages={packages} onChange={refresh} />

      <Section title="Money in to record" sub="Not matched to anything yet. Lines that fit a package come first, with the kind of client they fit.">
        {linesError ? <p className="px-4 py-3 text-sm text-red-600">{(linesError as Error).message}</p>
          : linesLoading ? <p className="px-4 py-6 text-center text-sm text-slate-400">Looking at the bank…</p>
          : <LinesTable lines={lines} packages={packages} clients={clients} clientById={clientById} open={open} projectId={projectId} onDone={refresh} />}
      </Section>

      <Section title="Invoiced, waiting for payment" sub="Match each to its bank line above (pick it in the client box), or from bank review.">
        {open.length === 0 ? <p className="px-4 py-6 text-center text-sm text-slate-400">Nothing waiting.</p> : (
          <table className="w-full text-sm">
            <tbody className="divide-y dark:divide-slate-700">
              {open.map(s => {
                const c = clientById.get(s.client_id ?? '')
                const pk = packages.find(p => p.id === s.package_id)
                const exp = pk ? expectedReceived(pk.net_amount, pk.vat_exempt, effProfile(c)) : null
                return (
                  <tr key={s.id}>
                    <td className="px-4 py-2"><Link to={`/sales/${s.id}`} className="font-mono text-xs text-brand hover:underline">{s.invoice_number}</Link></td>
                    <td className="px-4 py-2 text-slate-700 dark:text-slate-200">{c?.client_name ?? '—'}<p className="text-[11px] text-slate-400">{withholdingProfileLabel(c?.withholding_profile, c?.business_type)}</p></td>
                    <td className="px-4 py-2 text-xs text-slate-500">{formatDateGC(s.date)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{etb(s.amount)}{exp != null && <p className="text-[11px] text-slate-400">expect about {etb(exp)} in</p>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Section>

      <InvoiceClients packages={packages.filter(p => p.active)} clients={clients} sales={sales} onDone={refresh} />

      <Section title="Paid" sub="What each client sent, and what they kept back.">
        {paid.length === 0 ? <p className="px-4 py-6 text-center text-sm text-slate-400">No payments matched yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-900/40">
                  <th className="px-4 py-2">Client</th><th className="px-4 py-2">Paid</th><th className="px-4 py-2 text-right">Invoice</th>
                  <th className="px-4 py-2 text-right">Received</th><th className="px-4 py-2 text-right">Income tax</th><th className="px-4 py-2 text-right">VAT withheld</th>
                  <th className="px-4 py-2 text-right">Charge</th><th className="px-4 py-2 text-right">Still owed</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {paid.map(s => (
                  <tr key={s.id}>
                    <td className="px-4 py-2"><Link to={`/sales/${s.id}`} className="text-slate-700 hover:underline dark:text-slate-200">{clientById.get(s.client_id ?? '')?.client_name ?? '—'}</Link>
                      <p className="font-mono text-[11px] text-slate-400">{s.invoice_number}</p></td>
                    <td className="px-4 py-2 text-xs text-slate-500">{formatDateGC(s.payment_date)}</td>
                    <Num v={s.amount} /><Num v={s.amount_received} /><Num v={s.income_tax_withheld} /><Num v={s.vat_withheld} /><Num v={s.receipt_charge} />
                    <Num v={s.receipt_shortfall} tone="text-red-600 dark:text-red-400" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  )
}

function Packages({ projectId, packages, onChange }: { projectId: string; packages: Pkg[]; onChange: () => void }) {
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [net, setNet] = useState('')
  const [exempt, setExempt] = useState(false)
  const [busy, setBusy] = useState(false)

  async function add() {
    if (!name.trim() || !(Number(net) > 0)) { toast('Give the package a name and its price before VAT', 'error'); return }
    setBusy(true)
    const { error } = await supabase.from('project_packages').insert([{ project_id: projectId, name: name.trim(), net_amount: Number(net), vat_exempt: exempt }])
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    setName(''); setNet(''); setExempt(false); onChange()
  }
  async function retire(p: Pkg) {
    const { error } = await supabase.from('project_packages').update({ active: !p.active }).eq('id', p.id)
    if (error) { toast(error.message, 'error'); return }
    onChange()
  }

  return (
    <Section title="Packages" sub="What a client pays for. The price is before VAT; what each kind of client sends is worked out from it.">
      <div className="divide-y dark:divide-slate-700">
        {packages.map(p => (
          <div key={p.id} className={`flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2.5 text-sm ${p.active ? '' : 'opacity-50'}`}>
            <p className="min-w-[180px] flex-1 font-medium text-slate-800 dark:text-slate-100">{p.name}</p>
            <p className="tabular-nums text-slate-600 dark:text-slate-300">{etb(p.net_amount)} + {p.vat_exempt ? 'no VAT' : 'VAT'} = <b>{etb(p.net_amount * (1 + (p.vat_exempt ? 0 : VAT)))}</b></p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {WITHHOLDING_PROFILES.map(w => `${w.label}: ${etb(expectedReceived(p.net_amount, p.vat_exempt, w.value))}`).join(' · ')}
            </p>
            <button type="button" onClick={() => retire(p)} title={p.active ? 'Stop using it' : 'Use it again'} className="text-slate-400 hover:text-slate-600">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 bg-slate-50 px-4 py-2.5 dark:bg-slate-900/40">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Package name (e.g. Booth package)" className="min-w-[200px] flex-1 rounded-md border px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800" />
          <input value={net} onChange={e => setNet(e.target.value)} inputMode="decimal" placeholder="Price before VAT" className="w-40 rounded-md border px-2 py-1.5 text-sm tabular-nums dark:border-slate-600 dark:bg-slate-800" />
          <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300"><input type="checkbox" checked={exempt} onChange={e => setExempt(e.target.checked)} /> No VAT</label>
          <button type="button" disabled={busy} onClick={add} className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-50">
            <Plus className="h-3.5 w-3.5" /> Add package
          </button>
        </div>
      </div>
    </Section>
  )
}

function LinesTable({ lines, packages, clients, clientById, open, projectId, onDone }: {
  lines: Line[]; packages: Pkg[]; clients: ClientLite[]; clientById: Map<string, ClientLite>; open: SaleRow[]; projectId: string; onDone: () => void
}) {
  const [all, setAll] = useState(false)
  const [q, setQ] = useState('')
  const fitting = lines.filter(l => l.package_id)
  const needle = q.trim().toLowerCase()
  const shown = (all ? lines : fitting).filter(l => !needle || `${l.narration ?? ''} ${l.reference ?? ''} ${l.amount}`.toLowerCase().includes(needle))
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2 text-xs dark:border-slate-700">
        <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> Show all {lines.length} lines in, not only the {fitting.length} that fit a package
        </label>
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Narration, reference, amount" className="w-56 rounded-md border py-1 pl-7 pr-2 dark:border-slate-600 dark:bg-slate-800" />
        </div>
      </div>
      {shown.length === 0 ? <p className="px-4 py-6 text-center text-sm text-slate-400">{packages.length ? 'Nothing to record in these dates.' : 'Add a package first, or show all lines.'}</p> : (
        <div className="divide-y dark:divide-slate-700">
          {shown.map(l => <LineRow key={l.line_id} l={l} packages={packages} clients={clients} clientById={clientById} open={open} projectId={projectId} onDone={onDone} />)}
        </div>
      )}
    </div>
  )
}

function LineRow({ l, packages, clients, clientById, open, projectId, onDone }: {
  l: Line; packages: Pkg[]; clients: ClientLite[]; clientById: Map<string, ClientLite>; open: SaleRow[]; projectId: string; onDone: () => void
}) {
  const { toast } = useToast()
  const hint = useMemo(() => nameHint(l.narration, clients), [l.narration, clients])
  const [pick, setPick] = useState<string | null>(hint ? `client:${hint.id}` : null)
  const [pkgId, setPkgId] = useState<string | null>(l.package_id)
  const [amount, setAmount] = useState(String(l.gross ?? l.amount))
  const [busy, setBusy] = useState(false)

  const options = useMemo(() => [
    ...open.map(s => {
      const c = clientById.get(s.client_id ?? '')
      return { id: `sale:${s.id}`, label: `${c?.client_name ?? 'Client'} — invoiced`, sub: `${s.invoice_number ?? ''} · ${etb(s.amount)}` }
    }),
    ...clients.map(c => ({ id: `client:${c.id}`, label: c.client_name, sub: `new sale · ${withholdingProfileLabel(c.withholding_profile, c.business_type)}` })),
  ], [open, clients, clientById])

  const chosenClient = pick?.startsWith('client:') ? clientById.get(pick.slice(7))
    : pick?.startsWith('sale:') ? clientById.get(open.find(s => s.id === pick.slice(5))?.client_id ?? '') : undefined
  const mismatch = chosenClient && l.profile && effProfile(chosenClient) !== l.profile
  const pkg = packages.find(p => p.id === pkgId)

  async function record() {
    if (!pick) { toast('Pick who paid', 'error'); return }
    setBusy(true)
    const isSale = pick.startsWith('sale:')
    const { error } = await supabase.rpc('record_sale_from_bank_line', {
      p_line_id: l.line_id,
      p_client_id: isSale ? null : pick.slice(7),
      p_project_id: projectId,
      p_amount: isSale ? null : (pkg ? null : Number(amount) || null),
      p_package_id: isSale ? null : pkgId,
      p_sale_id: isSale ? pick.slice(5) : null,
    })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Recorded and matched', 'success')
    onDone()
  }

  return (
    <div className="grid gap-2 px-4 py-3 text-sm lg:grid-cols-[minmax(0,1.2fr)_auto_minmax(0,1.6fr)_auto] lg:items-center">
      <div className="min-w-0">
        <p className="text-xs text-slate-500 dark:text-slate-400">{formatDateGC(l.value_date)}{l.account_name ? ` · ${l.account_name}` : ''}</p>
        <p className="truncate font-mono text-xs text-slate-700 dark:text-slate-200" title={l.narration ?? ''}>{l.narration || '—'}</p>
        {l.reference && <p className="truncate text-[11px] text-slate-400">{l.reference}</p>}
      </div>
      <div className="text-right lg:w-36">
        <p className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{etb(l.amount)}</p>
        {l.package_id ? (
          <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
            {l.package_name} · {withholdingProfileLabel(l.profile)}{Number(l.charge) > 0 ? ` · charge ${etb(l.charge)}` : ''}
          </p>
        ) : <p className="text-[11px] text-slate-400">no package fits</p>}
      </div>
      <div className="min-w-0 space-y-1">
        <SearchableSelect value={pick} onChange={setPick} options={options} placeholder="Who paid? (an open invoice, or a client)" />
        {pick?.startsWith('client:') && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select value={pkgId ?? ''} onChange={e => setPkgId(e.target.value || null)} className="rounded-md border px-2 py-1 dark:border-slate-600 dark:bg-slate-800">
              <option value="">No package — invoice amount:</option>
              {packages.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {!pkgId && <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" className="w-36 rounded-md border px-2 py-1 tabular-nums dark:border-slate-600 dark:bg-slate-800" title="The invoice amount, before anything the client kept back" />}
          </div>
        )}
        {mismatch && (
          <p className="text-[11px] text-amber-700 dark:text-amber-300">
            This amount fits a client who {l.profile === 'government' ? 'withholds 3% and VAT' : l.profile === 'none' ? 'pays in full' : 'withholds 3%'};
            {' '}{chosenClient?.client_name} is set to “{withholdingProfileLabel(chosenClient?.withholding_profile, chosenClient?.business_type)}”. Check, or change the client's setting.
          </p>
        )}
      </div>
      <button type="button" disabled={busy || !pick} onClick={record}
        className="inline-flex items-center justify-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-40">
        <Link2 className="h-3.5 w-3.5" /> Record & match
      </button>
    </div>
  )
}

function InvoiceClients({ packages, clients, sales, onDone }: { packages: Pkg[]; clients: ClientLite[]; sales: SaleRow[]; onDone: () => void }) {
  const { toast } = useToast()
  const [pkgId, setPkgId] = useState<string>('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [date, setDate] = useState(today())
  const [busy, setBusy] = useState(false)
  const pkg = packages.find(p => p.id === pkgId) ?? packages[0]
  const already = new Set(sales.filter(s => s.package_id === pkg?.id).map(s => s.client_id))
  const needle = q.trim().toLowerCase()
  const list = clients.filter(c => !already.has(c.id) && (!needle || c.client_name.toLowerCase().includes(needle))).slice(0, 80)

  if (!pkg) return null
  async function go() {
    setBusy(true)
    const { data, error } = await supabase.rpc('create_package_invoices', { p_package_id: pkg.id, p_client_ids: [...picked], p_date: date })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`Invoiced ${data} client${data === 1 ? '' : 's'}`, 'success')
    setPicked(new Set()); onDone()
  }
  return (
    <Section title="Invoice clients" sub="For clients who signed up but whose money hasn't arrived — or went to another account. Each gets an invoice for the package.">
      <div className="space-y-2 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select value={pkg.id} onChange={e => setPkgId(e.target.value)} className="rounded-md border px-2 py-1.5 dark:border-slate-600 dark:bg-slate-800">
            {packages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-md border px-2 py-1.5 dark:border-slate-600 dark:bg-slate-800" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a client" className="min-w-[180px] flex-1 rounded-md border px-2 py-1.5 dark:border-slate-600 dark:bg-slate-800" />
          <button type="button" disabled={busy || picked.size === 0} onClick={go}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-40">
            Invoice {picked.size || ''} client{picked.size === 1 ? '' : 's'}
          </button>
        </div>
        <div className="grid max-h-56 grid-cols-1 gap-x-4 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          {list.map(c => (
            <label key={c.id} className="flex items-center gap-2 py-0.5 text-xs text-slate-700 dark:text-slate-200">
              <input type="checkbox" checked={picked.has(c.id)}
                onChange={e => setPicked(s => { const n = new Set(s); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n })} />
              <span className="truncate">{c.client_name}</span>
            </label>
          ))}
        </div>
        <p className="text-[11px] text-slate-400">Clients who already have a sale for this package are left out of the list.</p>
      </div>
    </Section>
  )
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="border-b px-4 py-3 dark:border-slate-700">
        <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h2>
        {sub && <p className="text-[11px] text-slate-500 dark:text-slate-400">{sub}</p>}
      </div>
      {children}
    </div>
  )
}

function Num({ v, tone }: { v: number | null | undefined; tone?: string }) {
  const n = Number(v ?? 0)
  return <td className={`px-4 py-2 text-right tabular-nums ${n > 0 ? (tone ?? 'text-slate-700 dark:text-slate-200') : 'text-slate-300 dark:text-slate-600'}`}>{n > 0 ? etb(n) : '—'}</td>
}

function Fact({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'amber' }) {
  return (
    <div className="rounded-xl border bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-slate-100'}`}>{value}</p>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">{sub}</p>
    </div>
  )
}
