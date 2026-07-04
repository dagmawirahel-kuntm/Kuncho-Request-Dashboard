import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { getDeptColor, DEPARTMENTS } from '@/lib/departments'
import { formatEthiopian } from '@/lib/ethiopianCalendar'
import type { CompanyEvent, CompanyEventType } from '@/types/database'
import { Megaphone, CalendarDays, CheckSquare, Sun, Plus, Trash2, Clock } from 'lucide-react'

const TYPE_META: Record<CompanyEventType, { icon: React.ReactNode; cls: string; label: string }> = {
  announcement: { icon: <Megaphone className="h-3.5 w-3.5" />, cls: 'text-blue-500 bg-blue-50 dark:bg-blue-900/20', label: 'Announcement' },
  event:        { icon: <CalendarDays className="h-3.5 w-3.5" />, cls: 'text-violet-500 bg-violet-50 dark:bg-violet-900/20', label: 'Event' },
  task:         { icon: <CheckSquare className="h-3.5 w-3.5" />, cls: 'text-amber-500 bg-amber-50 dark:bg-amber-900/20', label: 'To-do' },
  holiday:      { icon: <Sun className="h-3.5 w-3.5" />, cls: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20', label: 'Holiday' },
}

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

function fmtTime(t: string | null): string | null {
  if (!t) return null
  const [h, m] = t.split(':')
  return `${h}:${m}`
}

export default function CalendarPage() {
  const { role, user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const canPost = ['admin', 'manager', 'hr_officer'].includes(role ?? '')

  const todayStr = new Date().toISOString().slice(0, 10)
  const [showForm, setShowForm] = useState(false)
  const [deptFilter, setDeptFilter] = useState('All')

  const [form, setForm] = useState({
    title: '', description: '', event_date: todayStr,
    start_time: '', end_time: '', event_type: 'announcement' as CompanyEventType,
    department: '',
  })
  const [saving, setSaving] = useState(false)

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['company-events', todayStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_events')
        .select('*')
        .gte('event_date', todayStr)
        .order('event_date')
        .order('start_time', { nullsFirst: false })
      if (error) throw error
      return data as CompanyEvent[]
    },
  })

  const filtered = useMemo(() => {
    if (deptFilter === 'All') return events
    if (deptFilter === 'Company-wide') return events.filter(e => !e.department)
    return events.filter(e => e.department === deptFilter || !e.department)
  }, [events, deptFilter])

  // group by date
  const grouped = useMemo(() => {
    const map = new Map<string, CompanyEvent[]>()
    for (const ev of filtered) {
      if (!map.has(ev.event_date)) map.set(ev.event_date, [])
      map.get(ev.event_date)!.push(ev)
    }
    return [...map.entries()]
  }, [filtered])

  async function handlePost() {
    if (!form.title.trim()) { toast('Title is required', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('company_events').insert([{
      title: form.title.trim(),
      description: form.description.trim() || null,
      event_date: form.event_date,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      event_type: form.event_type,
      department: form.department || null,
      created_by: user?.id ?? null,
    }])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    setForm({ title: '', description: '', event_date: todayStr, start_time: '', end_time: '', event_type: 'announcement', department: '' })
    setShowForm(false)
    qc.invalidateQueries({ queryKey: ['company-events'] })
    qc.invalidateQueries({ queryKey: ['dept-board-events'] })
    toast('Posted to the calendar', 'success')
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Remove this from the calendar?')) return
    const { error } = await supabase.from('company_events').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['company-events'] })
    qc.invalidateQueries({ queryKey: ['dept-board-events'] })
    toast('Removed', 'success')
  }

  function dateHeading(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00')
    const diff = Math.round((d.getTime() - new Date(todayStr + 'T00:00:00').getTime()) / 86_400_000)
    const nice = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    const et = formatEthiopian(d)
    const prefix = diff === 0 ? 'Today — ' : diff === 1 ? 'Tomorrow — ' : ''
    return `${prefix}${nice} · ${et}`
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Company Calendar</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Announcements, events, to-dos and holidays — company-wide and per department</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
            Today: {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })} · {formatEthiopian(new Date())} (Ethiopian)
          </p>
        </div>
        {canPost && (
          <button
            onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90"
          >
            <Plus className="h-4 w-4" /> {showForm ? 'Close' : 'Post to Calendar'}
          </button>
        )}
      </div>

      {/* Post form (admin/manager/HR) */}
      {showForm && canPost && (
        <div className="rounded-2xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 space-y-4 shadow-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Title</label>
              <input type="text" className={inputCls} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Monthly all-hands / Deliver Awash order / Safety inspection" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Type</label>
              <select className={inputCls} value={form.event_type} onChange={e => setForm(f => ({ ...f, event_type: e.target.value as CompanyEventType }))}>
                <option value="announcement">Announcement</option>
                <option value="event">Event</option>
                <option value="task">To-do</option>
                <option value="holiday">Holiday</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Audience</label>
              <select className={inputCls} value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))}>
                <option value="">Company-wide (everyone)</option>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d} department</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Date</label>
              <input type="date" className={inputCls} value={form.event_date} onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))} />
              {form.event_date && (
                <p className="mt-1 text-[11px] text-slate-400">
                  Ethiopian: <span className="font-medium text-slate-500 dark:text-slate-400">{formatEthiopian(form.event_date)}</span>
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">From</label>
                <input type="time" className={inputCls} value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">To</label>
                <input type="time" className={inputCls} value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} />
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Details (optional)</label>
              <textarea rows={2} className={inputCls} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
          <button onClick={handlePost} disabled={saving}
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50">
            {saving ? 'Posting…' : 'Post'}
          </button>
        </div>
      )}

      {/* Department filter */}
      <div className="flex flex-wrap gap-1.5">
        {['All', 'Company-wide', ...DEPARTMENTS].map(tab => {
          const active = deptFilter === tab
          const color = getDeptColor(tab)
          return (
            <button key={tab} onClick={() => setDeptFilter(tab)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                active ? 'text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
              }`}
              style={active ? { backgroundColor: DEPARTMENTS.includes(tab) ? color.bg : '#1a1f26' } : undefined}>
              {tab}
            </button>
          )
        })}
      </div>

      {/* Agenda */}
      {isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
      ) : grouped.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed dark:border-slate-700 bg-white dark:bg-slate-800 py-16 text-center">
          <CalendarDays className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-sm text-slate-500">Nothing on the calendar yet.</p>
          {canPost && <p className="text-xs text-slate-400 mt-1">Use "Post to Calendar" to publish the first announcement.</p>}
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([date, list]) => (
            <div key={date} className="rounded-2xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-900/50 border-b dark:border-slate-700">
                <p className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wide">{dateHeading(date)}</p>
              </div>
              <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
                {list.map(ev => {
                  const meta = TYPE_META[ev.event_type]
                  const time = fmtTime(ev.start_time)
                  return (
                    <div key={ev.id} className="flex items-start gap-3 px-4 py-3">
                      <span className={`mt-0.5 rounded-md p-1.5 flex-shrink-0 ${meta.cls}`}>{meta.icon}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{ev.title}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-[10px] text-slate-400">{meta.label}</span>
                          {time && <span className="text-[10px] text-slate-400 flex items-center gap-0.5"><Clock className="h-2.5 w-2.5" />{time}{ev.end_time ? `–${fmtTime(ev.end_time)}` : ''}</span>}
                          {ev.department
                            ? <span className={`rounded-full px-1.5 py-0 text-[9px] font-semibold ${getDeptColor(ev.department).pill}`}>{ev.department}</span>
                            : <span className="rounded-full px-1.5 py-0 text-[9px] font-semibold bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400">Company-wide</span>}
                        </div>
                        {ev.description && <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{ev.description}</p>}
                      </div>
                      {canPost && (
                        <button onClick={() => handleDelete(ev.id)}
                          className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 flex-shrink-0" title="Remove">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
