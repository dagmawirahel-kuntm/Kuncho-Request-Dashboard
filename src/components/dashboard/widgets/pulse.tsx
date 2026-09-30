import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Award, Cake, Megaphone, Send, Sparkles, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import type { WidgetProps } from '@/lib/dashboard/types'
import { ListSkeleton, WidgetCard } from '../WidgetCard'

// ── Team pulse ────────────────────────────────────────────────────────────
// What's happening with the people around you: announcements (company
// calendar), thanks colleagues send each other, and work anniversaries
// (migration 380). Until that migration is run, thanks and anniversaries
// are simply absent and the widget shows announcements alone.

interface Kudo { id: string; from_name: string | null; to_name: string; to_department: string | null; message: string; created_at: string; mine: boolean }
interface Milestone { staff_id: string; employee_name: string; department: string | null; years: number; anniversary: string }
interface Recipient { id: string; employee_name: string; department: string | null }

type FeedItem =
  | { kind: 'announcement'; id: string; at: string; title: string; detail: string | null }
  | { kind: 'kudos'; id: string; at: string; kudo: Kudo }
  | { kind: 'milestone'; id: string; at: string; m: Milestone }

const today = () => new Date().toISOString().slice(0, 10)

function whenLabel(at: string): string {
  const d = new Date(at.length === 10 ? at + 'T00:00:00' : at)
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const day = new Date(d); day.setHours(0, 0, 0, 0)
  const diff = Math.round((day.getTime() - start.getTime()) / 86_400_000)
  if (diff === 0) {
    if (at.length > 10) {
      const hours = Math.floor((Date.now() - d.getTime()) / 3_600_000)
      return hours < 1 ? 'Just now' : `${hours}h ago`
    }
    return 'Today'
  }
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  return diff > 0 ? `In ${diff} days` : `${-diff}d ago`
}

function ThankForm({ onDone }: { onDone: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [to, setTo] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const { data: people = [] } = useQuery({
    queryKey: ['kudos-recipients'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('kudos_recipients')
      if (error) throw error
      return (data ?? []) as Recipient[]
    },
  })

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!to || !message.trim()) return
    setSending(true)
    const { error } = await supabase.from('kudos').insert({ to_staff_id: to, message: message.trim() })
    setSending(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Thanks sent 🎉', 'success')
    qc.invalidateQueries({ queryKey: ['dash', 'kudos'] })
    onDone()
  }

  return (
    <form onSubmit={send} className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/50 dark:bg-amber-900/10">
      <SearchableSelect
        value={to}
        onChange={setTo}
        placeholder="Who do you want to thank?"
        options={people.map(p => ({ id: p.id, label: p.employee_name, sub: p.department ?? undefined }))}
      />
      <textarea
        value={message}
        onChange={e => setMessage(e.target.value.slice(0, 280))}
        rows={2}
        placeholder="What did they do? e.g. “Thanks for getting the rebar to site before the pour.”"
        className="w-full resize-none rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-300 dark:border-slate-600 dark:bg-slate-800"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-400">Everyone at Kuncho can see thanks · {280 - message.length} left</span>
        <div className="flex gap-2">
          <button type="button" onClick={onDone} className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-white dark:hover:bg-slate-700">Cancel</button>
          <button type="submit" disabled={!to || !message.trim() || sending}
            className="flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50">
            <Send className="h-3.5 w-3.5" /> {sending ? 'Sending…' : 'Send thanks'}
          </button>
        </div>
      </div>
    </form>
  )
}

export function TeamPulse({ ctx }: WidgetProps) {
  const { user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [thanking, setThanking] = useState(false)
  const own = !!user && user.id === ctx.userId

  const t = today()

  const announcements = useQuery({
    queryKey: ['dash', 'pulse-announcements', ctx.department ?? '__company__', t],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      // A week either side of today.
      const from = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
      const to = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
      let q = supabase.from('company_events').select('id, title, description, event_date')
        .eq('event_type', 'announcement').gte('event_date', from).lte('event_date', to)
        .order('event_date', { ascending: false }).limit(6)
      if (ctx.department) q = q.or(`department.is.null,department.eq.${ctx.department}`)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })
  const kudos = useQuery({
    queryKey: ['dash', 'kudos'],
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('recent_kudos', { p_limit: 8 })
      if (error) throw error
      return (data ?? []) as Kudo[]
    },
  })
  const milestones = useQuery({
    queryKey: ['dash', 'milestones', t],
    staleTime: 60 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('team_milestones', { p_days: 7 })
      if (error) throw error
      return (data ?? []) as Milestone[]
    },
  })

  // Thanks need migration 380; without it there's nothing to send them to.
  const thanksAvailable = kudos.isSuccess

  const feed: FeedItem[] = [
    ...(announcements.data ?? []).map(a => ({ kind: 'announcement' as const, id: `a-${a.id}`, at: a.event_date, title: a.title, detail: a.description })),
    ...(kudos.data ?? []).map(k => ({ kind: 'kudos' as const, id: `k-${k.id}`, at: k.created_at, kudo: k })),
    ...(milestones.data ?? []).map(m => ({ kind: 'milestone' as const, id: `m-${m.staff_id}`, at: m.anniversary, m })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8)

  async function takeBack(id: string) {
    const { error } = await supabase.from('kudos').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['dash', 'kudos'] })
  }

  const loading = announcements.isLoading && kudos.isLoading

  return (
    <WidgetCard title="Team pulse" icon={Sparkles}>
      <div className="flex h-full flex-col">
        {loading ? <ListSkeleton rows={3} /> : feed.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">
            Quiet week so far.{thanksAvailable && own ? ' Be the first to thank someone.' : ''}
          </p>
        ) : (
          <ul className="space-y-0.5 px-2 pb-2">
            {feed.map(f => (
              <li key={f.id} className="group flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/40">
                {f.kind === 'announcement' ? (
                  <>
                    <span className="rounded-lg bg-blue-50 p-1.5 text-blue-500 dark:bg-blue-900/25 dark:text-blue-300"><Megaphone className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{f.title}</p>
                      {f.detail && <p className="line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{f.detail}</p>}
                    </div>
                  </>
                ) : f.kind === 'kudos' ? (
                  <>
                    <span className="rounded-lg bg-amber-50 p-1.5 text-amber-500 dark:bg-amber-900/25 dark:text-amber-300"><Award className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-600 dark:text-slate-300">
                        <span className="font-semibold text-slate-800 dark:text-slate-100">{f.kudo.from_name ?? 'Someone'}</span> thanked{' '}
                        <span className="font-semibold text-slate-800 dark:text-slate-100">{f.kudo.to_name}</span>
                      </p>
                      <p className="text-xs italic text-slate-500 dark:text-slate-400">“{f.kudo.message}”</p>
                    </div>
                    {f.kudo.mine && own && (
                      <button onClick={() => takeBack(f.kudo.id)} title="Take back" aria-label="Take back this thank-you"
                        className="rounded p-0.5 text-slate-300 opacity-0 hover:text-red-500 group-hover:opacity-100 focus-visible:opacity-100">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <span className="rounded-lg bg-pink-50 p-1.5 text-pink-500 dark:bg-pink-900/25 dark:text-pink-300"><Cake className="h-4 w-4" /></span>
                    <p className="min-w-0 flex-1 text-sm text-slate-600 dark:text-slate-300">
                      <span className="font-semibold text-slate-800 dark:text-slate-100">{f.m.employee_name}</span>
                      {' '}{f.at >= t ? (f.at === t ? 'marks' : 'will mark') : 'marked'} {f.m.years} year{f.m.years === 1 ? '' : 's'} at Kuncho 🎉
                      {f.m.department && <span className="text-xs text-slate-400"> · {f.m.department}</span>}
                    </p>
                  </>
                )}
                <span className="shrink-0 pt-0.5 text-[11px] text-slate-400">{whenLabel(f.at)}</span>
              </li>
            ))}
          </ul>
        )}
        {thanksAvailable && own && (
          <div className="mt-auto border-t px-3 py-3 dark:border-slate-700">
            {thanking ? <ThankForm onDone={() => setThanking(false)} /> : (
              <button onClick={() => setThanking(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-50 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-300 dark:hover:bg-amber-900/30">
                <Award className="h-3.5 w-3.5" /> Say thanks to a colleague
              </button>
            )}
          </div>
        )}
      </div>
    </WidgetCard>
  )
}
