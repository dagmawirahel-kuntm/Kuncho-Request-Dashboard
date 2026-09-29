import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useClients, useProjects } from '@/hooks/useLookups'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { FormattedNumberInput } from '@/components/shared/FormattedNumberInput'
import { History, Plus, X, Trash2, CheckCircle2, AlertTriangle, Scale, Info } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const required = label.endsWith('*')
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
        {required ? label.slice(0, -1).trim() : label}
        {required && <span className="text-brand"> *</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  )
}

interface Summary {
  year_start: string
  invoices: number
  owed_at_start: number
  collected: number
  withheld: number
  still_owed: number
  opening_balance: number | null
  opening_source: string | null
  opening_converted: boolean
}

interface Row {
  id: string
  invoice_number: string | null
  sales_description: string
  date: string
  due_date: string | null
  amount: number
  sales_status: string
  payment_date: string | null
  amount_received: number | null
  withheld_by_client: number | null
  transfer_id: string | null
  client_id: string | null
  clients: { client_name: string } | null
  contracts: { contract_no: string | null } | null
}

type Draft = {
  client_id: string | null
  invoice_number: string
  invoice_date: string
  description: string
  amount: number | undefined
  vat_exempt: boolean
  due_date: string
  project_id: string | null
  contract_mode: 'none' | 'existing' | 'new'
  contract_id: string | null
  contract_no: string
  contract_value: number | undefined
  signed_date: string
  completion_date: string
  notes: string
}

const EMPTY: Draft = {
  client_id: null, invoice_number: '', invoice_date: '', description: '', amount: undefined, vat_exempt: false,
  due_date: '', project_id: null, contract_mode: 'none', contract_id: null, contract_no: '', contract_value: undefined,
  signed_date: '', completion_date: '', notes: '',
}

function dayBefore(iso: string) {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Invoices from before this fiscal year that the client still owes. The
 * revenue and its VAT were last year's; when the money comes in it settles
 * Accounts Receivable (migration 370) instead of counting as new income.
 * Their total is the Accounts Receivable line of the opening balances.
 */
export default function CarriedForwardPage() {
  const { role } = useAuth()
  const canEdit = role === 'admin' || role === 'finance'
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: clients = [] } = useClients()
  const { data: projects = [] } = useProjects()
  const clientOptions = useMemo(() => clients.map((c: { id: string; client_name: string }) => ({ id: c.id, label: c.client_name })), [clients])
  const projectOptions = useMemo(() => projects.map((p: { id: string; project_name: string }) => ({ id: p.id, label: p.project_name })), [projects])

  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  // Ages are counted from when the page opened.
  const [now] = useState(() => Date.now())
  const today = new Date(now).toISOString().slice(0, 10)

  const { data: summary } = useQuery({
    queryKey: ['carried-forward-summary'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('carried_forward_summary')
      if (error) throw error
      return data as Summary | null
    },
  })

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['carried-forward'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales')
        .select('id, invoice_number, sales_description, date, due_date, amount, sales_status, payment_date, amount_received, withheld_by_client, transfer_id, client_id, clients(client_name), contracts(contract_no)')
        .eq('carried_forward', true)
        .eq('is_archived', false)
        .order('date', { ascending: true })
      if (error) throw error
      return data as unknown as Row[]
    },
  })

  const { data: clientContracts = [] } = useQuery({
    queryKey: ['contracts-for-client', draft.client_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('contracts').select('id, contract_no, status, signed_date')
        .eq('client_id', draft.client_id!).order('signed_date', { ascending: false, nullsFirst: false })
      if (error) throw error
      return data as { id: string; contract_no: string | null; status: string; signed_date: string | null }[]
    },
    enabled: !!draft.client_id,
  })

  const yearStart = summary?.year_start ?? null
  const lastDay = yearStart ? dayBefore(yearStart) : undefined

  function set<K extends keyof Draft>(k: K, v: Draft[K]) { setDraft(d => ({ ...d, [k]: v })) }

  function refresh() {
    qc.invalidateQueries({ queryKey: ['carried-forward'] })
    qc.invalidateQueries({ queryKey: ['carried-forward-summary'] })
    qc.invalidateQueries({ queryKey: ['outstanding-invoices'] })
    qc.invalidateQueries({ queryKey: ['sales'] })
  }

  async function save() {
    if (!draft.client_id) { setError('Choose the client'); return }
    if (!draft.invoice_date) { setError('Enter the date the invoice was issued'); return }
    if (!draft.description.trim()) { setError('Say what the invoice was for'); return }
    if (!draft.amount || draft.amount <= 0) { setError('Enter the amount still owed'); return }
    if (draft.contract_mode === 'new' && !draft.contract_no.trim()) { setError('Enter the contract number, or choose "No contract"'); return }
    setError(''); setSaving(true)
    const { error: err } = await supabase.rpc('add_carried_forward_receivable', {
      p_client_id: draft.client_id,
      p_invoice_date: draft.invoice_date,
      p_amount: draft.amount,
      p_description: draft.description.trim(),
      p_invoice_number: draft.invoice_number.trim() || null,
      p_contract_id: draft.contract_mode === 'existing' ? draft.contract_id : null,
      p_new_contract: draft.contract_mode === 'new' ? {
        contract_no: draft.contract_no.trim(),
        contract_value: draft.contract_value ?? '',
        signed_date: draft.signed_date,
        completion_date: draft.completion_date,
      } : null,
      p_project_id: draft.project_id,
      p_vat_exempt: draft.vat_exempt,
      p_due_date: draft.due_date || null,
      p_notes: draft.notes.trim() || null,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    toast('Recorded — it now shows as owed by the client', 'success')
    // Keep the client and contract for the next line of the same job.
    setDraft(d => ({ ...EMPTY, client_id: d.client_id, project_id: d.project_id,
      contract_mode: d.contract_mode === 'none' ? 'none' : 'existing',
      contract_id: d.contract_mode === 'existing' ? d.contract_id : null }))
    qc.invalidateQueries({ queryKey: ['contracts-for-client'] })
    refresh()
  }

  async function remove(r: Row) {
    if (!confirm(`Remove ${r.invoice_number ?? 'this invoice'} (${formatCurrency(r.amount)})? Only do this if it was entered by mistake.`)) return
    setBusy(r.id)
    const { error: err } = await supabase.rpc('remove_carried_forward_receivable', { p_sale_id: r.id })
    setBusy(null)
    if (err) { toast(err.message, 'error'); return }
    toast('Removed', 'success')
    refresh()
  }

  async function writeOpening() {
    setBusy('opening')
    const { data, error: err } = await supabase.rpc('set_opening_receivables_balance')
    setBusy(null)
    if (err) { toast(err.message, 'error'); return }
    toast(Number(data) > 0 ? `Opening Accounts Receivable set to ${formatCurrency(Number(data))}` : 'Opening Accounts Receivable cleared', 'success')
    refresh()
  }

  const opening = summary?.opening_balance ?? null
  const openingMatches = opening != null && summary != null && Math.abs(Number(opening) - Number(summary.owed_at_start)) < 0.01
  const openingIsOurs = !summary?.opening_source || summary.opening_source.startsWith('Carried-forward receivables')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100">
            <History className="h-5 w-5 text-brand" /> Owed from last year
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Work finished and invoiced before {yearStart ? formatDate(yearStart) : 'this fiscal year'} that the client hasn't fully paid.
            The income and its VAT belonged to last year, so when the money arrives it settles what the client owed — it isn't
            counted as new income, and the VAT isn't declared again.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/invoices" className="rounded-md border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
            Outstanding invoices
          </Link>
          {canEdit && !adding && (
            <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand/90">
              <Plus className="h-4 w-4" /> Record an invoice
            </button>
          )}
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: `Owed on ${formatDate(summary.year_start)}`, value: formatCurrency(Number(summary.owed_at_start)), sub: `${summary.invoices} invoice${summary.invoices === 1 ? '' : 's'}` },
            { label: 'Collected since', value: formatCurrency(Number(summary.collected)), sub: Number(summary.withheld) > 0 ? `plus ${formatCurrency(Number(summary.withheld))} withheld by clients` : 'by bank' },
            { label: 'Still owed', value: formatCurrency(Number(summary.still_owed)), sub: Number(summary.still_owed) > 0 ? 'shows in the cash forecast' : 'all collected', strong: true },
            { label: 'Opening balance (AR)', value: opening != null ? formatCurrency(Number(opening)) : 'Not set', sub: summary.opening_converted ? 'posted to the ledger' : openingMatches ? 'matches this list' : opening == null ? 'not in the opening balances yet' : 'differs from this list' },
          ].map(c => (
            <div key={c.label} className="min-w-0 rounded-xl border bg-white p-3 sm:p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{c.label}</p>
              <p className={`mt-0.5 text-base sm:text-lg font-bold tabular-nums break-words ${c.strong ? 'text-brand' : 'text-slate-800 dark:text-slate-100'}`}>{c.value}</p>
              <p className="text-[11px] text-slate-400">{c.sub}</p>
            </div>
          ))}
        </div>
      )}

      {summary && canEdit && Number(summary.owed_at_start) > 0 && !summary.opening_converted && !openingMatches && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/10 dark:text-amber-300">
          <Scale className="h-4 w-4 shrink-0" />
          <p className="flex-1 min-w-[16rem]">
            {openingIsOurs
              ? <>The opening balances should show {formatCurrency(Number(summary.owed_at_start))} owed by clients on {formatDate(summary.year_start)}.
                  {opening != null && <> They show {formatCurrency(Number(opening))} now.</>}</>
              : <>An Accounts Receivable opening balance of {formatCurrency(Number(opening))} was entered from another source ({summary.opening_source}).
                  Compare it with this list; the two should agree.</>}
          </p>
          {openingIsOurs && (
            <button onClick={writeOpening} disabled={busy === 'opening'} className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
              {busy === 'opening' ? 'Saving…' : 'Use this total as the opening balance'}
            </button>
          )}
        </div>
      )}

      {adding && canEdit && (
        <div className="rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center justify-between border-b px-4 py-3 dark:border-slate-700">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Record an unpaid invoice from last year</h2>
            <button onClick={() => { setAdding(false); setError('') }} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Close"><X className="h-4 w-4" /></button>
          </div>
          <div className="space-y-4 p-4">
            <div className="flex items-start gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-900/50 dark:text-slate-400">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                Only invoices issued before {yearStart ? formatDate(yearStart) : 'this fiscal year'}. If the work was finished but never invoiced,
                raise a normal invoice now instead. If the client will pay in parts, record each part on its own line so each bank payment matches one.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Client *">
                <SearchableSelect value={draft.client_id} onChange={v => setDraft(d => ({ ...d, client_id: v, contract_id: null, contract_mode: d.contract_mode === 'existing' ? 'none' : d.contract_mode }))} options={clientOptions} placeholder="Select client…" />
              </Field>
              <Field label="Project" hint="Optional — the project the work was for.">
                <SearchableSelect value={draft.project_id} onChange={v => set('project_id', v)} options={projectOptions} placeholder="Select project…" />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Invoice number" hint="As printed on the invoice. Left blank, it gets a CF- number.">
                <input className={inputCls} value={draft.invoice_number} onChange={e => set('invoice_number', e.target.value)} placeholder="e.g. INV-2025-044" />
              </Field>
              <Field label="Invoice date *">
                <input type="date" className={inputCls} max={lastDay} value={draft.invoice_date} onChange={e => set('invoice_date', e.target.value)} />
              </Field>
              <Field label="Expected payment date" hint="Used by the cash forecast.">
                <input type="date" className={inputCls} value={draft.due_date} onChange={e => set('due_date', e.target.value)} />
              </Field>
            </div>

            <Field label="What it was for *">
              <input className={inputCls} value={draft.description} onChange={e => set('description', e.target.value)} placeholder="e.g. Final payment — office fit-out, Bole" />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Amount still owed (ETB, incl. VAT) *" hint="What the client still has to pay on this invoice, before any withholding.">
                <FormattedNumberInput className={inputCls} value={draft.amount ?? null} onChange={n => set('amount', n)} />
              </Field>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand" checked={draft.vat_exempt} onChange={e => set('vat_exempt', e.target.checked)} />
                  The invoice carried no VAT (exempt)
                </label>
              </div>
            </div>

            <div className="rounded-lg border p-3 dark:border-slate-700">
              <p className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-400">Contract</p>
              <div className="mb-3 flex flex-wrap gap-2">
                {([['none', 'No contract'], ['existing', 'Already in the system'], ['new', 'Add the contract']] as const).map(([k, label]) => (
                  <button key={k} type="button" onClick={() => set('contract_mode', k)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${draft.contract_mode === k ? 'border-brand bg-brand/10 text-brand' : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
                    {label}
                  </button>
                ))}
              </div>
              {draft.contract_mode === 'existing' && (
                draft.client_id
                  ? <SearchableSelect value={draft.contract_id} onChange={v => set('contract_id', v)}
                      options={clientContracts.map(c => ({ id: c.id, label: c.contract_no ?? 'Untitled contract', sub: c.status }))}
                      placeholder={clientContracts.length ? 'Select contract…' : 'This client has no contracts yet'} />
                  : <p className="text-xs text-slate-400">Choose the client first.</p>
              )}
              {draft.contract_mode === 'new' && (
                <div className="grid gap-3 sm:grid-cols-4">
                  <Field label="Contract number *">
                    <input className={inputCls} value={draft.contract_no} onChange={e => set('contract_no', e.target.value)} />
                  </Field>
                  <Field label="Contract value (incl. VAT)">
                    <FormattedNumberInput className={inputCls} value={draft.contract_value ?? null} onChange={n => set('contract_value', n)} />
                  </Field>
                  <Field label="Signed">
                    <input type="date" className={inputCls} value={draft.signed_date} onChange={e => set('signed_date', e.target.value)} />
                  </Field>
                  <Field label="Work completed">
                    <input type="date" className={inputCls} value={draft.completion_date} onChange={e => set('completion_date', e.target.value)} />
                  </Field>
                  <p className="text-[11px] text-slate-400 sm:col-span-4">Saved as a completed contract, so nothing new is scheduled against it.</p>
                </div>
              )}
            </div>

            <Field label="Notes">
              <textarea rows={2} className={inputCls} value={draft.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional — e.g. agreed to pay after handover snag list" />
            </Field>

            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => { setAdding(false); setError('') }} className="rounded-md border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">Done</button>
              <button onClick={save} disabled={saving} className="rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save and add another'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
        {isLoading ? (
          <p className="py-12 text-center text-sm text-slate-400">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="py-14 text-center">
            <CheckCircle2 className="mx-auto mb-2 h-7 w-7 text-slate-300" />
            <p className="text-sm text-slate-500 dark:text-slate-400">Nothing recorded as owed from last year.</p>
            {canEdit && <p className="mt-1 text-xs text-slate-400">Use “Record an invoice” for each unpaid invoice from a finished contract.</p>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2">Invoice</th>
                  <th className="px-4 py-2">Client</th>
                  <th className="px-4 py-2">Contract</th>
                  <th className="px-4 py-2">Issued</th>
                  <th className="px-4 py-2 text-right">Owed</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {rows.map(r => {
                  const paid = r.sales_status === 'Paid'
                  const days = Math.floor((now - new Date(`${r.date}T00:00:00`).getTime()) / 86_400_000)
                  const overdue = !paid && r.due_date && r.due_date < today
                  return (
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-4 py-2.5">
                        <Link to={`/sales/${r.id}`} className="font-mono text-xs font-bold text-brand hover:underline">{r.invoice_number ?? '—'}</Link>
                        <p className="max-w-[18rem] truncate text-xs text-slate-500 dark:text-slate-400">{r.sales_description}</p>
                      </td>
                      <td className="px-4 py-2.5 text-slate-700 dark:text-slate-200">
                        {r.client_id ? <Link to={`/clients/${r.client_id}`} className="hover:underline">{r.clients?.client_name ?? '—'}</Link> : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400">{r.contracts?.contract_no ?? '—'}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400">{formatDate(r.date)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(r.amount)}</td>
                      <td className="px-4 py-2.5 text-xs">
                        {paid ? (
                          <span className="text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
                            Paid {r.payment_date ? formatDate(r.payment_date) : ''}
                            {r.amount_received != null && <span className="block text-[11px] text-slate-400">{formatCurrency(r.amount_received)} received{Number(r.withheld_by_client ?? 0) > 0 && ` · ${formatCurrency(r.withheld_by_client)} withheld`}</span>}
                          </span>
                        ) : (
                          <span className={overdue ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}>
                            {overdue && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />}
                            Owed · {days} days since invoice
                            {r.due_date && <span className="block text-[11px] text-slate-400">expected {formatDate(r.due_date)}</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {canEdit && !paid && !r.transfer_id && (
                          <button onClick={() => remove(r)} disabled={busy === r.id} title="Remove — entered by mistake"
                            className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-900/20">
                            <Trash2 className="h-3.5 w-3.5" />
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

      <p className="flex items-start gap-1.5 text-[11px] text-slate-400">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        When the client pays, match the bank credit to the invoice in Bank Reconciliation (it is suggested however old the invoice is) —
        what the client kept back is recorded as withholding tax receivable, and the rest settles Accounts Receivable.
      </p>
    </div>
  )
}
