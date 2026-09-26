import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Banknote, CalendarCheck, Clock, Landmark, Send, CheckCircle2, AlertTriangle, Circle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useAccountControl, type ChecklistItem, type ForecastDay } from '@/lib/cashControl'
import { lastEndedEcMonth } from '@/lib/ecMonths'
import { AlertsPanel } from '@/components/cash/AlertsPanel'
import { QueryListWidget, WidgetCard } from '../WidgetCard'

export function PaymentsToSend() {
  return (
    <QueryListWidget
      title="Approved, to pay" icon={Send} to="/finance/payments" queryKey={['to-pay']} empty="Nothing approved is waiting to be paid."
      fetch={async () => {
        const { data, error } = await supabase.from('v_to_pay_queue')
          .select('id, expense_code, item_service_description, vendor_name, project_name, cash_to_send, net_payable, amount_etb, days_since_approval')
          .order('days_since_approval', { ascending: false })
        if (error) throw error
        const rows = data ?? []
        const total = rows.reduce((s, r) => s + Number(r.cash_to_send ?? r.net_payable ?? r.amount_etb ?? 0), 0)
        return {
          total: rows.length, summary: `${formatCurrency(total)} to send`,
          rows: rows.slice(0, 6).map(r => ({
            id: r.id, title: r.vendor_name || r.item_service_description || r.expense_code || 'Payment',
            subtitle: [r.expense_code, r.project_name].filter(Boolean).join(' · '),
            badge: Number(r.days_since_approval ?? 0) >= 3 ? { text: `${r.days_since_approval}d`, tone: 'amber' as const } : null,
            right: formatCurrency(Number(r.cash_to_send ?? r.net_payable ?? r.amount_etb ?? 0)),
            to: `/expenses/${r.id}`,
          })),
        }
      }}
    />
  )
}

export function FinanceApprovals() {
  return (
    <QueryListWidget
      title="Awaiting finance approval" icon={Clock} to="/finance/payments" queryKey={['fin-approvals']} empty="Nothing waiting for approval."
      fetch={async () => {
        const { data, error } = await supabase.from('v_finance_pending_approval')
          .select('id, expense_code, item_service_description, vendor_name, project_name, amount_etb, approval_status, created_at')
          .order('created_at')
        if (error) throw error
        const rows = data ?? []
        return {
          total: rows.length,
          rows: rows.slice(0, 6).map(r => ({
            id: r.id, title: r.item_service_description || r.expense_code || 'Expense',
            subtitle: [r.vendor_name, r.project_name, formatDate(r.created_at)].filter(Boolean).join(' · '),
            badge: { text: String(r.approval_status).replace(/_/g, ' '), tone: 'amber' as const },
            right: formatCurrency(Number(r.amount_etb ?? 0)), to: `/expenses/${r.id}`,
          })),
        }
      }}
    />
  )
}

export function AwaitingBank() {
  return (
    <QueryListWidget
      title="Sent, not on the bank yet" icon={Banknote} to="/finance/payments" queryKey={['awaiting-bank']} empty="Every sent payment is on a statement."
      fetch={async () => {
        const { data, error } = await supabase.from('v_awaiting_bank_confirmation')
          .select('id, expense_code, vendor_name, item_service_description, net_payable, amount_etb, account_name, days_waiting')
          .order('days_waiting', { ascending: false })
        if (error) throw error
        const rows = data ?? []
        return {
          total: rows.length,
          summary: `${formatCurrency(rows.reduce((s, r) => s + Number(r.net_payable ?? r.amount_etb ?? 0), 0))} sent`,
          rows: rows.slice(0, 6).map(r => ({
            id: r.id, title: r.vendor_name || r.item_service_description || r.expense_code || 'Payment',
            subtitle: [r.expense_code, r.account_name].filter(Boolean).join(' · '),
            badge: Number(r.days_waiting ?? 0) > 5 ? { text: `${r.days_waiting}d`, tone: 'amber' as const } : null,
            right: formatCurrency(Number(r.net_payable ?? r.amount_etb ?? 0)), to: `/expenses/${r.id}`,
          })),
        }
      }}
    />
  )
}

// CBE today, its lowest point in the coming week, and money waiting in
// collection banks (migrations 347, 349).
export function CashPosition() {
  const { data: control = [] } = useAccountControl()
  const main = control.find(c => c.role === 'main')
  const waiting = control.reduce((s, c) => s + Number(c.waiting_to_move ?? 0), 0)
  const { data: days = [] } = useQuery({
    queryKey: ['dash', 'forecast7', main?.account_id],
    enabled: !!main,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('cash_forecast', { p_days: 7, p_account_id: main!.account_id, p_include_possible: false })
      if (error) throw error
      return (data ?? []) as ForecastDay[]
    },
  })
  const low = days.reduce<ForecastDay | null>((lo, d) => (lo == null || d.closing < lo.closing ? d : lo), null)
  const outToday = days[0]?.money_out ?? 0
  return (
    <WidgetCard title="Cash position" icon={Landmark} to="/cash-forecast">
      <div className="grid grid-cols-2 gap-3 p-4 text-sm">
        <Figure label={main ? `${main.account_name} today` : 'Main account'} value={formatCurrency(main?.app_balance ?? 0)} />
        <Figure label="Going out today" value={formatCurrency(outToday)} tone="out" />
        <Figure label={low ? `Lowest this week · ${formatDate(low.day)}` : 'Lowest this week'} value={formatCurrency(low?.closing ?? main?.app_balance ?? 0)}
          tone={(low?.closing ?? 0) < 0 ? 'bad' : undefined} />
        <Figure label="Waiting in collection banks" value={formatCurrency(waiting)} link="/accounts" />
      </div>
    </WidgetCard>
  )
}

function Figure({ label, value, tone, link }: { label: string; value: string; tone?: 'out' | 'bad'; link?: string }) {
  const cls = tone === 'out' ? 'text-red-600 dark:text-red-400' : tone === 'bad' ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-100'
  const body = (
    <>
      <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`text-base font-bold tabular-nums ${cls}`}>{value}</p>
    </>
  )
  return link ? <Link to={link} className="rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/40">{body}</Link> : <div>{body}</div>
}

export function BankAlerts() {
  return <AlertsPanel limit={5} title="Bank & cash alerts" />
}

const STATE_ICON = {
  ok: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />,
  warn: <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />,
  todo: <Circle className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600" />,
}

// Where last month's close stands (migration 350).
export function MonthEndStatus() {
  const period = lastEndedEcMonth()
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['dash', 'month-end', period.from, period.to],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('month_end_checklist', { p_from: period.from, p_to: period.to })
      if (error) throw error
      return (data ?? []) as ChecklistItem[]
    },
  })
  const done = items.filter(i => i.state === 'ok').length
  const open = items.filter(i => i.state !== 'ok')
  return (
    <WidgetCard title={`Month-end · ${period.label}`} icon={CalendarCheck} to="/month-end">
      {isLoading ? <p className="px-4 py-6 text-center text-sm text-slate-400">Loading…</p> : (
        <div className="space-y-2 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>{done} of {items.length} done</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} />
          </div>
          <ul className="space-y-1">
            {open.slice(0, 5).map(i => (
              <li key={`${i.account_id}-${i.check_key}`} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                {STATE_ICON[i.state]}
                <span className="truncate">{i.account_name ? `${i.account_name}: ` : ''}{i.title}</span>
              </li>
            ))}
            {open.length === 0 && <li className="text-xs text-emerald-600">Ready to sign off.</li>}
          </ul>
        </div>
      )}
    </WidgetCard>
  )
}
