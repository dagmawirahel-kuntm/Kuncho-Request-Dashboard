import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

interface NotificationItem {
  label: string
  count: number
  to: string
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { user } = useAuth()

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Resolve "my staff record" (same user_id-or-email pattern used
  // throughout this app) so a personal calendar message addressed to
  // me specifically can surface here — every other item in this bell
  // is a passive, global count, not targeted to one person.
  const { data: myStaffId } = useQuery({
    queryKey: ['my-staff-id-for-notifications', user?.id],
    queryFn: async () => {
      const email = user!.email?.toLowerCase() ?? ''
      const orFilter = email ? `user_id.eq.${user!.id},email.ilike.${email}` : `user_id.eq.${user!.id}`
      const { data } = await supabase.from('staff').select('id, user_id, email').or(orFilter).limit(5)
      if (!data || data.length === 0) return null
      const linked = data.find(r => r.user_id === user!.id)
      const byEmail = data.find(r => (r.email ?? '').toLowerCase() === email)
      return (linked ?? byEmail ?? data[0])?.id ?? null
    },
    enabled: !!user,
  })

  const { data } = useQuery({
    queryKey: ['notifications', myStaffId],
    queryFn: async () => {
      const [expenses, orders, transport, payroll, emergency, overBudget, personalEvents] = await Promise.all([
        supabase.from('expenses').select('*', { count: 'exact', head: true }).eq('payment_status', false),
        supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('transportation_requests').select('*', { count: 'exact', head: true }).eq('payment_status', false),
        supabase.from('payroll').select('*', { count: 'exact', head: true }).neq('payment_status', 'paid'),
        supabase.from('emergency_payroll_summary').select('*', { count: 'exact', head: true }).neq('payment_status', 'paid'),
        supabase.from('v_project_cost_group_budget').select('*', { count: 'exact', head: true }).eq('over_budget', true),
        myStaffId
          ? supabase.from('company_events').select('*', { count: 'exact', head: true }).eq('recipient_staff_id', myStaffId).gte('event_date', new Date().toISOString().slice(0, 10))
          : Promise.resolve({ count: 0 }),
      ])
      // "Flagged for review" — this is a passive, global badge anyone can
      // see, not a targeted alert to finance. Never describe it as
      // "finance was notified" in copy. The personal-messages item below
      // is the one genuine exception — it IS addressed to this viewer.
      const items: NotificationItem[] = [
        { label: 'Messages for you', count: personalEvents.count ?? 0, to: '/calendar' },
        { label: 'Unpaid expenses', count: expenses.count ?? 0, to: '/expenses' },
        { label: 'Pending orders', count: orders.count ?? 0, to: '/orders' },
        { label: 'Pending transportation requests', count: transport.count ?? 0, to: '/transportation' },
        { label: 'Pending payroll', count: payroll.count ?? 0, to: '/payroll' },
        { label: 'Pending emergency payroll', count: emergency.count ?? 0, to: '/emergency-payroll' },
        { label: 'Cost groups flagged for review (over budget)', count: overBudget.count ?? 0, to: '/projects' },
      ]
      return items.filter(i => i.count > 0)
    },
    refetchInterval: 60_000,
  })

  const items = data ?? []
  const total = items.reduce((sum, i) => sum + i.count, 0)

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative flex items-center justify-center rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      >
        <Bell className="h-4.5 w-4.5" />
        {total > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>
      {open && (
        <div className="animate-fade-in-up absolute right-0 z-30 mt-1 w-72 rounded-md border bg-white p-2 shadow-lg">
          <p className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Needs attention</p>
          {items.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-slate-400">You're all caught up</p>
          ) : (
            items.map(item => (
              <button
                key={item.label}
                onClick={() => { navigate(item.to); setOpen(false) }}
                className="flex w-full items-center justify-between rounded px-2 py-2 text-left text-sm hover:bg-slate-50"
              >
                <span className="text-slate-700">{item.label}</span>
                <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">{item.count}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
