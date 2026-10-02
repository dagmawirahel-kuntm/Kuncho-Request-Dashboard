import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { chime, confetti } from '@/lib/celebrate'

// Tells you when one of your own expenses moves forward — approved, then
// paid — the next time you have the app open. "Your own" is the submitter
// (purchaser_user_id), the same test the self-service RLS uses.
//
// There is no notification table behind this: the last stage this browser
// saw for each expense is kept in localStorage and compared on each fetch.
// The first fetch on a browser only records a baseline, so nobody is
// greeted with a pile of old news.

type Stage = 'pending' | 'manager_approved' | 'finance_approved' | 'paid' | 'rejected'
const RANK: Partial<Record<Stage, number>> = { pending: 0, manager_approved: 1, finance_approved: 2, paid: 3 }

interface Row {
  id: string
  expense_code: string | null
  item_service_description: string | null
  approval_status: string | null
  payment_status: boolean | null
  payment_state: string | null
}

function stageOf(e: Row): Stage {
  if (e.payment_status || e.payment_state === 'paid') return 'paid'
  return (e.approval_status ?? 'pending') as Stage
}

function nameOf(e: Row) {
  const what = e.item_service_description?.trim()
  const short = what && what.length > 40 ? `${what.slice(0, 38)}…` : what
  return [e.expense_code, short].filter(Boolean).join(' · ') || 'Your expense'
}

function readSeen(key: string): Record<string, Stage> | null {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null } catch { return null }
}

export function MyExpenseWatcher() {
  const { user } = useAuth()
  const { toast } = useToast()

  const { data } = useQuery({
    queryKey: ['my-expense-watch', user?.id],
    enabled: !!user,
    refetchInterval: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('expenses')
        .select('id, expense_code, item_service_description, approval_status, payment_status, payment_state')
        .eq('purchaser_user_id', user!.id).eq('is_archived', false)
        .order('created_at', { ascending: false }).limit(100)
      if (error) throw error
      return (data ?? []) as Row[]
    },
  })

  useEffect(() => {
    if (!data || !user) return
    const key = `expense-watch:${user.id}`
    const seen = readSeen(key)
    const now: Record<string, Stage> = {}
    const moved: { row: Row; stage: Stage }[] = []
    for (const e of data) {
      const stage = stageOf(e)
      now[e.id] = stage
      const before = seen?.[e.id]
      if (before && before !== stage && (RANK[stage] ?? -1) > (RANK[before] ?? -1)) moved.push({ row: e, stage })
    }
    try { localStorage.setItem(key, JSON.stringify(now)) } catch { /* nothing to do */ }
    if (!seen || moved.length === 0) return

    const paid = moved.filter(m => m.stage === 'paid')
    if (moved.length === 1) {
      const { row, stage } = moved[0]
      toast(stage === 'paid' ? `🎉 ${nameOf(row)} has been paid` : `✨ ${nameOf(row)} was approved`, 'success')
    } else {
      const approved = moved.length - paid.length
      const parts = [approved && `${approved} approved`, paid.length && `${paid.length} paid`].filter(Boolean).join(', ')
      toast(`✨ ${moved.length} of your expenses moved forward — ${parts}`, 'success')
    }
    if (paid.length) confetti('burst')
    chime(paid.length ? 'fanfare' : 'success')
  }, [data, user, toast])

  return null
}
