import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { BankLine } from '@/lib/bankReconciliation'
import { CheckCircle2, ExternalLink, Link2, Users } from 'lucide-react'

// Salaries are paid in pieces: a bulk transfer for the staff at one bank,
// one transfer per person at another. A line pays particular people on a run
// (499): pick the run, tick who it paid (worked out for you where it can be),
// and match.

interface Run {
  id: string; payroll_record: string | null; start_date: string | null; end_date: string | null
  payroll_type: string | null; payment_status: string | null; approval_status: string
}
interface StaffRow {
  staff_id: string; net_amount: number; bank_line_id: string | null
  staff: { employee_name: string } | null
  line: { value_date: string; debit_amount: number | null; account_id: string } | null
}
interface Request { id: string; request_code: string; status: string; bank_id: string | null; payee_lines: { key?: string }[] | null }

const FEE = 25

export function PayrollLine({ line, accounts, initialRunId, onDone }: {
  line: BankLine
  accounts: { id: string; account_name: string }[]
  initialRunId?: string | null
  onDone: () => void
}) {
  const { toast } = useToast()
  const accountName = useMemo(() => new Map(accounts.map(a => [a.id, a.account_name])), [accounts])

  const { data: runs = [] } = useQuery({
    queryKey: ['bank-payroll-runs'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll')
        .select('id, payroll_record, start_date, end_date, payroll_type, payment_status, approval_status')
        .eq('is_archived', false).order('end_date', { ascending: false }).limit(40)
      if (error) throw error
      return (data ?? []) as Run[]
    },
  })
  // The run closest to the line's date, unless one was suggested.
  const nearest = useMemo(() => [...runs].sort((a, b) =>
    Math.abs(Date.parse(a.end_date ?? '1970-01-01') - Date.parse(line.value_date)) - Math.abs(Date.parse(b.end_date ?? '1970-01-01') - Date.parse(line.value_date)))[0]?.id ?? null,
  [runs, line.value_date])
  const [chosenRun, setRun] = useState<string | null>(null)
  const runId = chosenRun ?? initialRunId ?? nearest
  const run = runs.find(r => r.id === runId)

  const { data: staff = [], isLoading } = useQuery({
    queryKey: ['bank-payroll-staff', runId],
    enabled: !!runId,
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_staff')
        .select('staff_id, net_amount, bank_line_id, staff:staff_id ( employee_name ), line:bank_line_id ( value_date, debit_amount, account_id )')
        .eq('payroll_id', runId!)
      if (error) throw error
      return ((data ?? []) as unknown as StaffRow[]).sort((a, b) => Number(b.net_amount) - Number(a.net_amount) || (a.staff?.employee_name ?? '').localeCompare(b.staff?.employee_name ?? ''))
    },
  })
  const { data: requests = [] } = useQuery({
    queryKey: ['bank-payroll-requests', runId],
    enabled: !!runId,
    queryFn: async () => {
      const { data, error } = await supabase.from('payment_requests').select('id, request_code, status, bank_id, payee_lines').eq('payroll_id', runId!).order('request_code')
      if (error) throw error
      return (data ?? []) as Request[]
    },
  })
  // Who the database works out this line paid, to start with.
  const { data: plan = [] } = useQuery({
    queryKey: ['bank-payroll-plan', line.line_id, runId],
    enabled: !!runId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('payroll_line_plan', { p_line_id: line.line_id, p_payroll_id: runId })
      if (error) throw error
      return (data ?? []) as { staff_id: string; how: string }[]
    },
  })

  const [ticked, setTicked] = useState<Map<string, Set<string>>>(new Map())
  const picked = ticked.get(runId ?? '') ?? new Set(plan.map(p => p.staff_id))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const unpaid = staff.filter(s => !s.bank_line_id)
  const total = staff.filter(s => picked.has(s.staff_id)).reduce((n, s) => n + Number(s.net_amount), 0)
  const diff = Math.round((Number(line.amount) - total) * 100) / 100
  const fits = picked.size > 0 && diff >= -0.01 && diff <= FEE
  const needsNote = picked.size > 0 && diff > FEE
  const canMatch = picked.size > 0 && diff >= -0.01 && (!needsNote || note.trim().length > 2)

  function setPicked(next: Set<string>) { setTicked(m => new Map(m).set(runId ?? '', next)) }
  function toggle(id: string) { const n = new Set(picked); if (n.has(id)) n.delete(id); else n.add(id); setPicked(n) }
  const payeesOf = (r: Request) => new Set((r.payee_lines ?? []).map(p => /^worker:([0-9a-f-]{36})$/.exec(p.key ?? '')?.[1]).filter((x): x is string => !!x))

  async function match() {
    if (!runId) return
    setBusy(true)
    const { error } = await supabase.rpc('match_bank_line_to_payroll', {
      p_line_id: line.line_id, p_payroll_id: runId, p_staff_ids: [...picked], p_note: note.trim() || null,
    })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`Matched: ${picked.size} ${picked.size === 1 ? 'person' : 'people'} on ${run?.payroll_record ?? 'the run'} paid by this line`, 'success')
    onDone()
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <select value={runId ?? ''} onChange={e => setRun(e.target.value || null)}
          className="rounded-md border bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
          {runs.map(r => (
            <option key={r.id} value={r.id}>
              {r.payroll_record ?? 'Payroll'} · {r.payroll_type ?? ''} · {formatDate(r.start_date)} → {formatDate(r.end_date)} · {r.payment_status ?? ''}
            </option>
          ))}
        </select>
        {run && <Link to={`/payroll/${run.id}`} target="_blank" className="flex items-center gap-1 text-[11px] text-brand hover:underline">Open run <ExternalLink className="h-3 w-3" /></Link>}
        {run && run.approval_status !== 'finance_approved' && <span className="text-[11px] text-amber-700 dark:text-amber-400">Not approved yet: the line can still be matched, but the run won't show as paid.</span>}
      </div>

      {requests.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-slate-500">Payment requests:</span>
          {requests.map(r => {
            const ids = [...payeesOf(r)].filter(id => unpaid.some(s => s.staff_id === id))
            return (
              <button key={r.id} type="button" disabled={ids.length === 0} onClick={() => setPicked(new Set(ids))}
                title={ids.length ? `Tick the ${ids.length} unpaid on it` : 'Everyone on it is paid'}
                className={`rounded-full border px-2 py-0.5 dark:border-slate-600 ${r.status === 'issued' ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 line-through'} enabled:hover:border-brand disabled:opacity-50`}>
                {r.request_code}{r.bank_id ? ` · ${accountName.get(r.bank_id) ?? 'bank'}` : ''} · {ids.length} unpaid
              </button>
            )
          })}
          <button type="button" onClick={() => setPicked(new Set(unpaid.map(s => s.staff_id)))} className="rounded-full border px-2 py-0.5 text-slate-600 hover:border-brand dark:border-slate-600 dark:text-slate-300">Everyone unpaid</button>
          <button type="button" onClick={() => setPicked(new Set())} className="text-slate-400 hover:text-slate-600">Clear</button>
        </div>
      )}

      <div className="rounded-lg border bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-3 py-2 text-xs dark:border-slate-700">
          <span className="flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-200"><Users className="h-3.5 w-3.5" /> {picked.size} ticked</span>
          <span className="tabular-nums text-slate-600 dark:text-slate-300">{formatCurrency(total)} of {formatCurrency(Number(line.amount))}</span>
          {picked.size > 0 && (fits
            ? <span className="flex items-center gap-1 font-semibold text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> Adds up{diff > 0.005 ? ` (plus a ${formatCurrency(diff)} fee)` : ''}</span>
            : <span className={`font-semibold tabular-nums ${diff > 0 ? 'text-amber-600' : 'text-red-600'}`}>{diff > 0 ? `${formatCurrency(diff)} not explained` : `${formatCurrency(-diff)} more than the line`}</span>)}
          {plan[0] && <span className="text-[11px] text-slate-400">Worked out: {plan[0].how}</span>}
        </div>
        <div className="max-h-80 divide-y overflow-y-auto text-xs dark:divide-slate-700">
          {isLoading && <p className="px-3 py-2 text-slate-400">Loading…</p>}
          {staff.map(s => {
            const paid = !!s.bank_line_id
            return (
              <label key={s.staff_id} className={`flex items-center gap-2 px-3 py-1.5 ${paid ? 'opacity-60' : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40'}`}>
                <input type="checkbox" disabled={paid} checked={!paid && picked.has(s.staff_id)} onChange={() => toggle(s.staff_id)} className="h-3.5 w-3.5 accent-brand" />
                <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{s.staff?.employee_name ?? 'Staff'}</span>
                {paid && s.line && (
                  <span className="text-[11px] text-slate-400">
                    paid {formatDate(s.line.value_date)} · {accountName.get(s.line.account_id) ?? 'bank'}{s.bank_line_id === line.line_id ? ' (this line)' : ''}
                  </span>
                )}
                <span className="w-28 text-right tabular-nums text-slate-700 dark:text-slate-200">{formatCurrency(Number(s.net_amount))}</span>
              </label>
            )
          })}
        </div>
        <div className="space-y-2 border-t px-3 py-2.5 dark:border-slate-700">
          {needsNote && (
            <input value={note} onChange={e => setNote(e.target.value)} placeholder={`Why the line is ${formatCurrency(diff)} more than their pay`}
              className="w-full rounded-md border px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
          )}
          <button onClick={match} disabled={busy || !canMatch}
            className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">
            <Link2 className="h-3.5 w-3.5" /> {busy ? 'Matching…' : `Match: this line paid ${picked.size} ${picked.size === 1 ? 'person' : 'people'}`}
          </button>
          <p className="text-[11px] text-slate-400">
            Their pay goes to the books against {accountName.get(line.account_id) ?? 'this account'}; the run shows as paid once everyone on it is covered and it's approved.
          </p>
        </div>
      </div>
    </div>
  )
}
