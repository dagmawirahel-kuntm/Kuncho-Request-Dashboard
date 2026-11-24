// Overtime for the whole company, a month at a time: every Overtime run
// that pays for the month (a month can have more than one), its priced hours
// (532) and what each line paid — for the month view and its printed
// statement, with the months before it to compare.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ecMonthDates, monthOfDates, type PricedHour } from '@/lib/payroll'
import { addDays } from '@/lib/labour'

export type OtPersonMonth = {
  staff_id: string
  name: string
  role: string | null
  hours: PricedHour[]
  take_home: number
  gross: number
  paye: number
  /** Cost to the company (gross; overtime carries no employer pension). */
  cost: number
  /** Take-home on lines typed as an amount, with no hours behind them. */
  typed: number
}

export type OtMonth = {
  key: string
  y: number
  m: number
  label: string
  start: string
  end: string
  runs: { id: string; record: string | null; paid: boolean }[]
  people: OtPersonMonth[]
}

export const otHoursOf = (p: Pick<OtPersonMonth, 'hours'>) => p.hours.reduce((s, h) => s + Number(h.hours), 0)

/** Overtime by month, newest first, for the months since `monthsBack` months ago. */
export function useOvertimeMonths(monthsBack = 8) {
  return useQuery({
    queryKey: ['overtime-months', monthsBack],
    staleTime: 60_000,
    queryFn: async (): Promise<OtMonth[]> => {
      const since = addDays(new Date().toISOString().slice(0, 10), -31 * monthsBack)
      const { data: runs, error } = await supabase.from('payroll')
        .select('id, payroll_record, start_date, end_date, payment_status, is_archived')
        .eq('payroll_type', 'Overtime').gte('start_date', since)
      if (error) throw error
      const live = (runs ?? []).filter(r => !r.is_archived && r.start_date)
      if (!live.length) return []
      const ids = live.map(r => r.id as string)
      const [hoursQ, linesQ] = await Promise.all([
        supabase.from('payroll_overtime_hours').select('*').in('payroll_id', ids),
        supabase.from('v_payroll_line_tax_app').select('payroll_id, staff_id, employee_name, base_net, gross_share, paye_share, employer_cost_share').in('payroll_id', ids),
      ])
      if (hoursQ.error) throw hoursQ.error
      if (linesQ.error) throw linesQ.error
      const staffIds = Array.from(new Set((linesQ.data ?? []).map(l => l.staff_id as string)))
      const { data: staff } = staffIds.length
        ? await supabase.from('staff').select('id, role').in('id', staffIds)
        : { data: [] as { id: string; role: string | null }[] }
      const roleOf = new Map((staff ?? []).map(s => [s.id as string, (s.role as string | null) ?? null]))

      const months = new Map<string, OtMonth>()
      const monthOfRun = new Map<string, OtMonth>()
      for (const r of live) {
        const mo = monthOfDates(r.start_date, r.end_date)
        if (!mo) continue
        const key = `${mo.y}-${mo.m}`
        let M = months.get(key)
        if (!M) {
          const d = ecMonthDates(mo.y, mo.m)
          M = { key, y: mo.y, m: mo.m, label: mo.label, start: d.start, end: d.end, runs: [], people: [] }
          months.set(key, M)
        }
        M.runs.push({ id: r.id, record: r.payroll_record, paid: r.payment_status === 'paid' })
        monthOfRun.set(r.id, M)
      }
      const hoursBy = new Map<string, PricedHour[]>()
      for (const h of (hoursQ.data ?? []) as (PricedHour & { payroll_id: string; staff_id: string })[]) {
        const k = `${h.payroll_id}|${h.staff_id}`
        hoursBy.set(k, [...(hoursBy.get(k) ?? []), h])
      }
      for (const l of (linesQ.data ?? []) as { payroll_id: string; staff_id: string; employee_name: string; base_net: number | null; gross_share: number | null; paye_share: number | null; employer_cost_share: number | null }[]) {
        const M = monthOfRun.get(l.payroll_id)
        if (!M) continue
        let P = M.people.find(p => p.staff_id === l.staff_id)
        if (!P) {
          P = { staff_id: l.staff_id, name: l.employee_name, role: roleOf.get(l.staff_id) ?? null, hours: [], take_home: 0, gross: 0, paye: 0, cost: 0, typed: 0 }
          M.people.push(P)
        }
        const hrs = hoursBy.get(`${l.payroll_id}|${l.staff_id}`) ?? []
        P.hours.push(...hrs)
        P.take_home += Number(l.base_net ?? 0)
        P.gross += Number(l.gross_share ?? 0)
        P.paye += Number(l.paye_share ?? 0)
        P.cost += Number(l.employer_cost_share ?? l.gross_share ?? 0)
        if (!hrs.length) P.typed += Number(l.base_net ?? 0)
      }
      for (const M of months.values()) M.people.sort((a, b) => otHoursOf(b) - otHoursOf(a) || b.take_home - a.take_home)
      return [...months.values()].sort((a, b) => (b.y - a.y) || (b.m - a.m))
    },
  })
}
