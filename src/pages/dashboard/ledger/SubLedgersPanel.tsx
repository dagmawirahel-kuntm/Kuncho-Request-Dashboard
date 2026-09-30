import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useClients, useStaff, useVendors } from '@/hooks/useLookups'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { buildStatementHtml } from '@/lib/documents/statement'
import { printHtml } from '@/lib/documents/issue'
import { shareHtmlFile } from '@/lib/documents/shareFile'
import { ArrowLeft, Printer, Smartphone, AlertTriangle, CheckCircle2 } from 'lucide-react'

// The sub-ledgers (381): each control account's balance per vendor, client
// or staff member. They are the same journal lines as the control account,
// so they always add up to it.

type PartyKind = 'vendor' | 'client' | 'staff'
const LEDGERS: { key: string; label: string; blurb: string; liability: boolean }[] = [
  { key: 'ap', label: 'Payables', blurb: 'Bills approved and not yet paid — per vendor (or staff member paid back)', liability: true },
  { key: 'wages_payable', label: 'Wages owed', blurb: 'Labour pay confirmed and approved, not yet paid', liability: true },
  { key: 'ar', label: 'Receivables', blurb: 'Invoices issued and not yet collected — per client', liability: false },
  { key: 'client_advances', label: 'Client advances', blurb: 'Money received from clients ahead of the invoice', liability: true },
  { key: 'vendor_advances', label: 'Vendor advances', blurb: 'Paid to vendors ahead of delivery, and vendor credit held', liability: false },
  { key: 'staff_advances', label: 'Staff advances', blurb: 'Cash advanced to staff, not yet accounted for', liability: false },
  { key: 'petty_cash', label: 'Petty cash floats', blurb: 'Cash held by each float custodian', liability: false },
]

type AgeRow = {
  party_type: PartyKind | null; party_id: string | null; party_name: string; balance: number
  age_0_30: number; age_31_60: number; age_61_90: number; age_over_90: number; oldest_open: string | null; last_activity: string | null
}
type Line = {
  journal_line_id: string; entry_date: string; description: string | null; notes: string | null; account_code: string; account_name: string
  party_type: PartyKind | null; party_id: string | null; debit: number; credit: number; running_balance: number
}

export default function SubLedgersPanel() {
  const [key, setKey] = useState('ap')
  const [party, setParty] = useState<AgeRow | null>(null)
  const ledger = LEDGERS.find(l => l.key === key)!

  const { data: totals = {} } = useQuery({
    queryKey: ['subledger-totals'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_subledger').select('system_key, balance')
      if (error) throw error
      const t: Record<string, number> = {}
      for (const r of (data ?? []) as { system_key: string; balance: number }[]) t[r.system_key] = (t[r.system_key] ?? 0) + Number(r.balance)
      return t
    },
  })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {LEDGERS.map(l => {
          const v = (totals[l.key] ?? 0) * (l.liability ? -1 : 1)
          return (
            <button key={l.key} onClick={() => { setKey(l.key); setParty(null) }}
              className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${key === l.key ? 'border-brand bg-brand/5 ring-1 ring-brand' : 'bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800'}`}>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{l.label}</p>
              <p className="mt-0.5 text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{formatCurrency(v)}</p>
            </button>
          )
        })}
      </div>

      {party ? <Statement ledger={ledger} party={party} onBack={() => setParty(null)} />
        : <Ageing ledger={ledger} onOpen={setParty} />}
    </div>
  )
}

function Ageing({ ledger, onOpen }: { ledger: typeof LEDGERS[number]; onOpen: (r: AgeRow) => void }) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['subledger-ageing', ledger.key],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('subledger_ageing', { p_key: ledger.key })
      if (error) throw error
      return (data ?? []) as AgeRow[]
    },
  })
  const sum = (f: (r: AgeRow) => number) => rows.reduce((s, r) => s + Number(f(r)), 0)
  const unnamed = rows.find(r => !r.party_id)

  return (
    <div className="overflow-hidden rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
      <div className="border-b px-4 py-3 dark:border-slate-700">
        <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">{ledger.label}</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">{ledger.blurb}. Age counts from the date of each bill still open, oldest paid first.</p>
      </div>
      {unnamed && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{formatCurrency(Number(unnamed.balance))} here names nobody — expenses with only a typed vendor name. Open “Not named” to put each line against the right one.</span>
        </div>
      )}
      {isLoading ? <p className="p-8 text-center text-sm text-slate-400">Loading…</p> : rows.length === 0 ? (
        <p className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Nothing open.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2">{ledger.key === 'ar' || ledger.key === 'client_advances' ? 'Client' : ledger.key.startsWith('staff') || ledger.key === 'petty_cash' ? 'Staff member' : 'Vendor'}</th>
                <th className="px-3 py-2 text-right">Balance</th>
                <th className="px-3 py-2 text-right">0–30 days</th>
                <th className="px-3 py-2 text-right">31–60</th>
                <th className="px-3 py-2 text-right">61–90</th>
                <th className="px-3 py-2 text-right">Over 90</th>
                <th className="px-3 py-2">Oldest open</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {rows.map(r => (
                <tr key={`${r.party_type}-${r.party_id}`} onClick={() => onOpen(r)} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40">
                  <td className={`px-4 py-2 font-medium ${r.party_id ? 'text-slate-800 dark:text-slate-100' : 'text-amber-700 dark:text-amber-400'}`}>{r.party_name}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatCurrency(r.balance)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{Number(r.age_0_30) ? formatCurrency(r.age_0_30) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{Number(r.age_31_60) ? formatCurrency(r.age_31_60) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-amber-600">{Number(r.age_61_90) ? formatCurrency(r.age_61_90) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-red-600">{Number(r.age_over_90) ? formatCurrency(r.age_over_90) : '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{r.oldest_open ? formatDate(r.oldest_open) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t font-semibold dark:border-slate-700">
              <tr>
                <td className="px-4 py-2">Total · {rows.length} {rows.length === 1 ? 'balance' : 'balances'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(sum(r => r.balance))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(sum(r => r.age_0_30))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(sum(r => r.age_31_60))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(sum(r => r.age_61_90))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(sum(r => r.age_over_90))}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

function Statement({ ledger, party, onBack }: { ledger: typeof LEDGERS[number]; party: AgeRow; onBack: () => void }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { role } = useAuth()
  const canFix = role === 'admin' || role === 'finance'
  const { data: lines = [], isLoading } = useQuery({
    queryKey: ['subledger-lines', ledger.key, party.party_type, party.party_id],
    queryFn: async () => {
      let q = supabase.from('v_subledger_lines').select('*').eq('system_key', ledger.key)
      q = party.party_id ? q.eq('party_type', party.party_type!).eq('party_id', party.party_id) : q.is('party_id', null)
      const { data, error } = await q.order('entry_date').order('journal_line_id')
      if (error) throw error
      return (data ?? []) as Line[]
    },
  })
  const sign = ledger.liability ? -1 : 1
  const code = `STM-${ledger.key.toUpperCase()}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`

  function document() {
    return buildStatementHtml({
      code, party_name: party.party_name, party_kind: party.party_type, ledger: lines[0]?.account_name ?? ledger.label,
      account_code: lines[0]?.account_code ?? '', liability: ledger.liability,
      from: lines[0]?.entry_date ?? null, to: new Date().toISOString().slice(0, 10), lines,
    })
  }
  async function send() {
    const r = await shareHtmlFile(document(), `Statement ${party.party_name}`, `Statement of account — ${party.party_name}`)
    if (r === 'downloaded') toast('Statement saved as a file', 'success')
  }

  // Lines naming nobody: finance says who they are for.
  const kinds = useMemo<PartyKind[]>(() => ledger.key === 'ar' || ledger.key === 'client_advances' ? ['client']
    : ledger.key === 'ap' ? ['vendor', 'staff'] : ledger.key === 'wages_payable' ? ['staff', 'vendor']
    : ledger.key === 'vendor_advances' ? ['vendor'] : ['staff'], [ledger.key])
  const { data: vendors = [] } = useVendors()
  const { data: clients = [] } = useClients()
  const { data: staff = [] } = useStaff()
  const partyOptions = useMemo(() => [
    ...(kinds.includes('vendor') ? (vendors as { id: string; vendor_name: string }[]).map(v => ({ id: `vendor:${v.id}`, label: v.vendor_name, sub: 'Vendor' })) : []),
    ...(kinds.includes('client') ? (clients as { id: string; client_name: string }[]).map(c => ({ id: `client:${c.id}`, label: c.client_name, sub: 'Client' })) : []),
    ...(kinds.includes('staff') ? (staff as { id: string; employee_name: string }[]).map(s => ({ id: `staff:${s.id}`, label: s.employee_name, sub: 'Staff' })) : []),
  ], [kinds, vendors, clients, staff])
  async function name(line: Line, v: string | null) {
    if (!v) return
    const [t, id] = v.split(':')
    const { error } = await supabase.rpc('set_journal_line_party', { p_line: line.journal_line_id, p_type: t, p_id: id })
    if (error) { toast(error.message, 'error'); return }
    toast('Named', 'success')
    qc.invalidateQueries({ queryKey: ['subledger-lines'] })
    qc.invalidateQueries({ queryKey: ['subledger-ageing'] })
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 dark:border-slate-700">
        <div>
          <button onClick={onBack} className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-brand"><ArrowLeft className="h-3 w-3" /> {ledger.label}</button>
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">{party.party_name}</h2>
          <p className="text-xs text-slate-500">{ledger.liability ? 'We owe' : 'Owed to us'} <b className="text-slate-700 dark:text-slate-200">{formatCurrency(party.balance)}</b></p>
        </div>
        {party.party_id && lines.length > 0 && (
          <div className="flex gap-2">
            <button onClick={send} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium dark:border-slate-600"><Smartphone className="h-3.5 w-3.5" /> Send file</button>
            <button onClick={() => printHtml(document(), `Statement ${party.party_name}`)} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium dark:border-slate-600"><Printer className="h-3.5 w-3.5" /> Print</button>
          </div>
        )}
      </div>
      {isLoading ? <p className="p-8 text-center text-sm text-slate-400">Loading…</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2">Date</th><th className="px-3 py-2">What</th>
                <th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th>
                <th className="px-3 py-2 text-right">Balance</th>
                {!party.party_id && canFix && <th className="px-3 py-2 w-64">Who is it for?</th>}
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {lines.map(l => (
                <tr key={l.journal_line_id}>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-500">{formatDate(l.entry_date)}</td>
                  <td className="px-3 py-2">
                    <p className="text-slate-700 dark:text-slate-200">{l.description}</p>
                    {l.notes && <p className="text-xs text-slate-400">{l.notes}</p>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(l.debit) ? formatCurrency(l.debit) : ''}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(l.credit) ? formatCurrency(l.credit) : ''}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{formatCurrency(sign * Number(l.running_balance))}</td>
                  {!party.party_id && canFix && (
                    <td className="px-3 py-1.5"><SearchableSelect value={null} onChange={v => name(l, v)} options={partyOptions} placeholder="Pick…" /></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
