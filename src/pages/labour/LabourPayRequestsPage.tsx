import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { Pill } from '@/components/record/Record'
import { dayLabel, fmtMoney } from '@/lib/labour'
import { REQUEST_STATUS, usePayableDrafts, usePayRequestList, type PayableDraft, type RequestRow } from '@/lib/labourPayRequests'
import { ArrowLeft, CheckCircle2, ChevronRight, FileCheck2, ShieldAlert } from 'lucide-react'

const card = 'rounded-2xl border bg-white dark:border-slate-700 dark:bg-slate-800'
const FINANCE = ['admin', 'executive', 'finance']

// The PM's payment requests (479): confirmed pay sheets go to finance
// together, with each worker's bank account, advances deducted, the signed
// attendance sheet and the PM's sign-off. Finance works its queue here too.
export default function LabourPayRequestsPage() {
  const { hasRole } = useAuth()
  const finance = hasRole(...FINANCE)
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'mine' || !finance ? 'mine' : 'finance'
  const setView = (v: 'mine' | 'finance') => setParams(p => { const n = new URLSearchParams(p); n.set('view', v); return n }, { replace: true })

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-10">
      <Link to="/labour" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand"><ArrowLeft className="h-4 w-4" /> Labour</Link>
      <div>
        <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-slate-100"><FileCheck2 className="h-5 w-5 text-brand" /> Payment requests</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {view === 'finance' ? 'Requests from project managers: check, approve or send back, then pay as one batch.'
            : 'Put confirmed pay sheets into one request for finance — with bank accounts, advances, the signed attendance sheet and your sign-off.'}
        </p>
      </div>
      {finance && (
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-sm dark:bg-slate-900/40">
          {(['finance', 'mine'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`flex-1 rounded-lg px-3 py-1.5 font-medium ${view === v ? 'bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-slate-100' : 'text-slate-500'}`}>
              {v === 'finance' ? 'Finance queue' : 'Make a request'}
            </button>
          ))}
        </div>
      )}
      {view === 'finance' ? <FinanceQueue /> : <Mine />}
    </div>
  )
}

function Mine() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { data: drafts = [], isLoading } = usePayableDrafts()
  const { data: mine = [] } = usePayRequestList('mine')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const byProject = useMemo(() => {
    const m = new Map<string, { name: string; rows: PayableDraft[] }>()
    for (const d of drafts) {
      const g = m.get(d.project_id) ?? { name: d.project_name ?? '—', rows: [] }
      g.rows.push(d); m.set(d.project_id, g)
    }
    return [...m.entries()]
  }, [drafts])
  const chosen = drafts.filter(d => picked.has(d.expense_id))
  const total = chosen.reduce((s, d) => s + Number(d.amount), 0)
  const toggle = (id: string) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const toggleAll = (rows: PayableDraft[]) => setPicked(p => {
    const n = new Set(p); const all = rows.every(r => n.has(r.expense_id))
    for (const r of rows) { if (all) n.delete(r.expense_id); else n.add(r.expense_id) }
    return n
  })

  async function make() {
    setBusy(true)
    const { data, error } = await supabase.rpc('create_labour_pay_request', { p_expense_ids: [...picked], p_note: null })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['labour-payable-drafts'] })
    qc.invalidateQueries({ queryKey: ['labour-pay-requests'] })
    navigate(`/labour/requests/${data}`)
  }

  const open = mine.filter(r => r.status === 'draft' || r.status === 'returned')
  const rest = mine.filter(r => r.status !== 'draft' && r.status !== 'returned')

  return <>
    {open.length > 0 && (
      <section className={card}>
        <h2 className="border-b px-4 py-3 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">To finish and send</h2>
        <RequestList rows={open} />
      </section>
    )}

    <section className={card}>
      <h2 className="border-b px-4 py-3 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">Confirmed pay, not requested yet</h2>
      {isLoading ? <p className="p-6 text-center text-sm text-slate-400">Loading…</p> : drafts.length === 0 ? (
        <p className="flex items-center justify-center gap-2 p-6 text-sm text-slate-500"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Nothing waiting. Confirm pay first on <Link to="/labour/pay" className="text-brand">Confirm pay</Link>.</p>
      ) : byProject.map(([pid, g]) => (
        <div key={pid} className="border-b last:border-b-0 dark:border-slate-700">
          <button onClick={() => toggleAll(g.rows)} className="flex w-full items-center justify-between bg-slate-50 px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-900/30">
            <span>{g.name}</span><span className="normal-case text-brand">{g.rows.every(r => picked.has(r.expense_id)) ? 'Clear' : 'Pick all'}</span>
          </button>
          <ul className="divide-y dark:divide-slate-700">
            {g.rows.map(d => (
              <li key={d.expense_id}>
                <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/40">
                  <input type="checkbox" checked={picked.has(d.expense_id)} onChange={() => toggle(d.expense_id)} className="h-4 w-4 accent-brand" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{d.what ?? 'Labour'} <span className="font-normal text-slate-500">· {d.pay_sheet_code ?? d.expense_code}</span></p>
                    <p className="text-xs text-slate-500">
                      {d.period_start && d.period_end ? `${dayLabel(d.period_start)} – ${dayLabel(d.period_end)} · ` : ''}{d.workers} worker{d.workers === 1 ? '' : 's'}
                      {d.unverified > 0 && <span className="text-amber-600"> · {d.unverified} not verified by HR</span>}
                    </p>
                  </div>
                  {d.held && <Pill tone="amber">Held pay</Pill>}
                  <span className="text-sm font-semibold">{fmtMoney(d.amount)}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {picked.size > 0 && (
        <div className="sticky bottom-0 border-t bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
          <button onClick={make} disabled={busy} className="w-full rounded-xl bg-brand py-3 text-sm font-semibold text-white disabled:opacity-40">
            {busy ? 'Making…' : `Make a payment request · ${chosen.length} sheet${chosen.length === 1 ? '' : 's'} · ${fmtMoney(total)}`}
          </button>
        </div>
      )}
    </section>

    {rest.length > 0 && (
      <section className={card}>
        <h2 className="border-b px-4 py-3 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">Sent to finance</h2>
        <RequestList rows={rest} />
      </section>
    )}
  </>
}

function FinanceQueue() {
  const { data: rows = [], isLoading } = usePayRequestList('finance')
  const groups: { title: string; rows: RequestRow[]; empty: string }[] = [
    { title: 'To approve', rows: rows.filter(r => r.status === 'submitted'), empty: 'No requests waiting for approval.' },
    { title: 'Approved — to pay', rows: rows.filter(r => r.status === 'approved'), empty: 'Nothing approved and unpaid.' },
    { title: 'In a payment', rows: rows.filter(r => r.status === 'sent').slice(0, 20), empty: 'None yet.' },
  ]
  if (isLoading) return <p className="p-6 text-center text-sm text-slate-400">Loading…</p>
  return <>
    {groups.map(g => (
      <section key={g.title} className={card}>
        <h2 className="flex items-center justify-between border-b px-4 py-3 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">
          {g.title}{g.rows.length > 0 && <span className="text-sm font-normal text-slate-500">{fmtMoney(g.rows.reduce((s, r) => s + Number(r.net ?? 0), 0))}</span>}
        </h2>
        {g.rows.length === 0 ? <p className="p-5 text-center text-sm text-slate-400">{g.empty}</p> : <RequestList rows={g.rows} showWho />}
      </section>
    ))}
    <p className="text-center text-xs text-slate-400">Older single pay sheets are still on <Link to="/finance/labor-expense-drafts" className="text-brand">Labour Pay</Link>.</p>
  </>
}

function RequestList({ rows, showWho }: { rows: RequestRow[]; showWho?: boolean }) {
  return (
    <ul className="divide-y dark:divide-slate-700">
      {rows.map(r => {
        const st = REQUEST_STATUS[r.status]
        return (
          <li key={r.id}>
            <Link to={`/labour/requests/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/40">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{r.code} <span className="font-normal text-slate-500">· {r.projects ?? '—'}</span></p>
                <p className="truncate text-xs text-slate-500">
                  {r.sheets} sheet{r.sheets === 1 ? '' : 's'} · {r.workers} worker{r.workers === 1 ? '' : 's'}
                  {showWho && r.created_by_name ? ` · ${r.created_by_name}` : ''}
                  {r.status === 'sent' && r.batch_code ? ` · ${r.batch_code}${r.batch_paid ? ' (paid)' : ''}` : ''}
                </p>
                {r.status === 'returned' && r.returned_reason && <p className="truncate text-xs text-red-600">Sent back: {r.returned_reason}</p>}
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold">{fmtMoney(r.net)}</p>
                <div className="flex items-center justify-end gap-1">
                  {r.unverified > 0 && r.status !== 'sent' && <span title={`${r.unverified} not verified by HR`}><ShieldAlert className="h-3.5 w-3.5 text-amber-500" /></span>}
                  <Pill tone={st.tone}>{st.label}</Pill>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-300" />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
