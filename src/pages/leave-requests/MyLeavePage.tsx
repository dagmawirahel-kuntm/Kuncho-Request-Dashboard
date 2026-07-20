import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatDateGC } from '@/lib/utils'
import type { LeaveRequest, LeaveType, Staff } from '@/types/database'
import { CalendarClock, Plus, X } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-colors dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

const LEAVE_TYPES: { value: LeaveType; label: string }[] = [
  { value: 'annual', label: 'Annual' },
  { value: 'sick', label: 'Sick' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'maternity', label: 'Maternity' },
  { value: 'compassionate', label: 'Compassionate' },
  { value: 'other', label: 'Other' },
]

function daysBetween(start: string, end: string) {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  return ms >= 0 ? Math.round(ms / 86400000) + 1 : null
}

export default function MyLeavePage() {
  const { user, role } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)

  // Match the logged-in user to their staff record — same pattern as
  // MyRequestsDashboardPage (explicit link, else email match).
  const { data: staff } = useQuery({
    queryKey: ['my-staff-record', user?.id],
    queryFn: async () => {
      const email = user!.email?.toLowerCase() ?? ''
      const orFilter = email ? `user_id.eq.${user!.id},email.ilike.${email}` : `user_id.eq.${user!.id}`
      const { data } = await supabase.from('staff').select('*').or(orFilter).limit(5)
      if (!data || data.length === 0) return null
      const linked = data.find(r => r.user_id === user!.id)
      const byEmail = data.find(r => (r.email ?? '').toLowerCase() === email)
      return (linked ?? byEmail ?? data[0]) as Staff
    },
    enabled: !!user,
  })

  const staffId = staff?.id

  const { data: myRequests = [], isLoading } = useQuery({
    queryKey: ['my-leave-requests', staffId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leave_requests')
        .select('*')
        .eq('staff_id', staffId!)
        .order('start_date', { ascending: false })
      if (error) throw error
      return data as LeaveRequest[]
    },
    enabled: !!staffId,
  })

  const thisYear = new Date().getFullYear()
  const daysUsedThisYear = myRequests
    .filter(r => r.status === 'approved' && new Date(r.start_date).getFullYear() === thisYear)
    .reduce((sum, r) => sum + (r.days ?? 0), 0)

  const [form, setForm] = useState<{ leave_type: LeaveType; start_date: string; end_date: string; reason: string }>({
    leave_type: 'annual', start_date: '', end_date: '', reason: '',
  })
  const [saving, setSaving] = useState(false)

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSubmit() {
    if (!staffId) { toast('Your login isn\'t linked to a staff profile yet — ask HR to link your account', 'error'); return }
    if (!form.start_date || !form.end_date) { toast('Pick a start and end date', 'error'); return }
    if (form.end_date < form.start_date) { toast('End date is before the start date', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('leave_requests').insert([{
      staff_id: staffId,
      leave_type: form.leave_type,
      start_date: form.start_date,
      end_date: form.end_date,
      days: daysBetween(form.start_date, form.end_date),
      reason: form.reason || null,
      status: 'pending',
    }])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['my-leave-requests', staffId] })
    setForm({ leave_type: 'annual', start_date: '', end_date: '', reason: '' })
    setShowForm(false)
    toast('Leave request submitted', 'success')
  }

  async function handleCancel(id: string) {
    if (!window.confirm('Withdraw this leave request?')) return
    const { error } = await supabase.from('leave_requests').update({ status: 'cancelled' }).eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['my-leave-requests', staffId] })
    toast('Request withdrawn', 'success')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">My Leave</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Request time off and track your submissions</p>
        </div>
        <button
          onClick={() => setShowForm(s => !s)}
          className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90"
        >
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showForm ? 'Cancel' : 'Request Leave'}
        </button>
      </div>

      {!staff && (
        <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-900/40 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Your login isn't linked to a staff profile yet, so you can't submit a leave request. Ask HR to set your email or link your account.
        </div>
      )}

      {staff && (
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Approved days used in {thisYear}</p>
            <p className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{daysUsedThisYear}</p>
          </div>
          <span className="rounded-lg p-2 bg-blue-50 text-blue-500 dark:bg-blue-900/20"><CalendarClock className="h-5 w-5" /></span>
        </div>
      )}

      {showForm && staff && (
        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Leave Type</label>
              <select className={inputCls} value={form.leave_type} onChange={e => set('leave_type', e.target.value as LeaveType)}>
                {LEAVE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Days {form.start_date && form.end_date && daysBetween(form.start_date, form.end_date) != null && (
                  <span className="text-slate-400">({daysBetween(form.start_date, form.end_date)})</span>
                )}
              </label>
              <div className={`${inputCls} bg-slate-50 dark:bg-slate-700/50 text-slate-400 dark:text-slate-500`}>Calculated from dates</div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Start Date *</label>
              <input type="date" className={inputCls} value={form.start_date} onChange={e => set('start_date', e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">End Date *</label>
              <input type="date" className={inputCls} value={form.end_date} onChange={e => set('end_date', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Reason</label>
            <textarea rows={2} className={inputCls} value={form.reason} onChange={e => set('reason', e.target.value)} />
          </div>
          <div className="flex justify-end">
            <button onClick={handleSubmit} disabled={saving} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60">
              {saving ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
        <div className="px-4 py-3 border-b dark:border-slate-700">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">My Requests</p>
        </div>
        {isLoading ? (
          <div className="py-10 text-center text-sm text-slate-400">Loading…</div>
        ) : myRequests.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400">
            {staff ? 'No leave requests yet' : 'Nothing to show'}
          </div>
        ) : (
          <div className="divide-y dark:divide-slate-700">
            {myRequests.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200 capitalize">{r.leave_type}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    {formatDateGC(r.start_date)} – {formatDateGC(r.end_date)}{r.days != null ? ` · ${r.days} day${r.days !== 1 ? 's' : ''}` : ''}
                  </p>
                  {r.reason && <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500 truncate">{r.reason}</p>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <StatusBadge status={r.status} />
                  {r.status === 'pending' && (
                    <button onClick={() => handleCancel(r.id)} className="text-xs text-red-500 hover:underline">Withdraw</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {role === 'admin' || role === 'hr_officer' ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Looking for the approval queue? See <Link to="/leave-requests" className="text-brand hover:underline">Leave Requests</Link>.
        </p>
      ) : null}
    </div>
  )
}
