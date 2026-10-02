import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, ClipboardList, History, Sun, Settings2, FileText } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { RecordHeader } from '@/components/record/Record'
import { Segmented } from '@/components/shared/Segmented'
import { useAttendancePeople, useAttendanceSettings } from '@/lib/attendance'
import { MyDay } from './MyDay'
import { RegisterTab } from './RegisterTab'
import { MonthSheet } from './MonthSheet'
import { ChangesTab } from './ChangesTab'
import { PaperTab } from './PaperTab'

type Tab = 'me' | 'register' | 'paper' | 'month' | 'changes'

// Day-to-day attendance for staff (casual workers are recorded under
// Labour, which pays them). Everyone sees their own day; whoever looks
// after people also gets the roll-call, the month sheet and the log.
export default function AttendancePage() {
  const { role } = useAuth()
  const { data: people = [], isLoading } = useAttendancePeople()
  const me = people.find(p => p.is_me) ?? null
  const recordsOthers = people.some(p => p.can_record && !p.is_me)
  const seesOthers = people.some(p => !p.is_me)
  const isHr = role === 'hr_officer' || role === 'admin'
  const [tab, setTab] = useState<Tab | null>(null)
  const active: Tab = tab ?? (recordsOthers ? 'register' : seesOthers ? 'month' : 'me')
  const [rulesOpen, setRulesOpen] = useState(false)

  const tabs = [
    ...(me ? [{ value: 'me' as Tab, label: 'My day', icon: Sun }] : []),
    ...(recordsOthers ? [{ value: 'register' as Tab, label: 'Roll-call', icon: ClipboardList }, { value: 'paper' as Tab, label: 'From paper', icon: FileText }] : []),
    ...(seesOthers ? [{ value: 'month' as Tab, label: 'Month', icon: CalendarCheck }, { value: 'changes' as Tab, label: 'Changes', icon: History }] : []),
  ]

  return (
    <div className="space-y-4">
      <RecordHeader
        back={{ to: '/dashboard', label: 'Dashboard' }}
        title="Attendance"
        subtitle="Who came in, when, and who recorded it"
        actions={[{ label: 'Rules', icon: Settings2, onClick: () => setRulesOpen(o => !o), hidden: !isHr }]}
      />

      {rulesOpen && isHr && <RulesPanel onClose={() => setRulesOpen(false)} />}

      {isLoading ? <p className="py-12 text-center text-sm text-slate-400">Loading…</p>
        : people.length === 0 ? (
          <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-8 text-center text-sm text-slate-500">
            Your login isn't linked to a staff record yet, so there's nothing to show. Ask HR to link it.
          </div>
        ) : (
          <>
            {tabs.length > 1 && <Segmented value={active} onChange={setTab} ariaLabel="View" options={tabs} />}
            {active === 'me' && me && <MyDay me={me} />}
            {active === 'register' && <RegisterTab people={people} />}
            {active === 'paper' && <PaperTab people={people} />}
            {active === 'month' && <MonthSheet people={people.filter(p => !p.is_me || p.can_record)} canLock={isHr} />}
            {active === 'changes' && <ChangesTab people={people} />}
          </>
        )}
    </div>
  )
}

function RulesPanel({ onClose }: { onClose: () => void }) {
  const { data: s } = useAttendanceSettings()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [form, setForm] = useState<{ day_starts: string; late_after_minutes: number; lunch_ends: string; day_ends: string } | null>(null)
  const v = form ?? (s ? { day_starts: s.day_starts.slice(0, 5), late_after_minutes: s.late_after_minutes, lunch_ends: (s.lunch_ends ?? '13:30').slice(0, 5), day_ends: s.day_ends.slice(0, 5) } : null)
  if (!v) return null
  async function save() {
    const { error } = await supabase.from('attendance_settings').update({ ...v, updated_at: new Date().toISOString() }).eq('id', true)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['attendance-settings'] })
    toast('Rules saved', 'success'); onClose()
  }
  const cls = 'rounded-md border px-2 py-1.5 text-sm dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100'
  return (
    <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4 flex flex-wrap items-end gap-4">
      <label className="text-xs text-slate-600 dark:text-slate-300">Day starts<br /><input type="time" className={cls} value={v.day_starts} onChange={e => setForm({ ...v, day_starts: e.target.value })} /></label>
      <label className="text-xs text-slate-600 dark:text-slate-300">Late after (minutes)<br /><input type="number" min={0} max={180} className={`${cls} w-24`} value={v.late_after_minutes} onChange={e => setForm({ ...v, late_after_minutes: Number(e.target.value) })} /></label>
      <label className="text-xs text-slate-600 dark:text-slate-300">Back from lunch by<br /><input type="time" className={cls} value={v.lunch_ends} onChange={e => setForm({ ...v, lunch_ends: e.target.value })} /></label>
      <label className="text-xs text-slate-600 dark:text-slate-300">Day ends<br /><input type="time" className={cls} value={v.day_ends} onChange={e => setForm({ ...v, day_ends: e.target.value })} /></label>
      <p className="flex-1 min-w-[12rem] text-[11px] text-slate-400">Used to mark check-ins as on time or late. Changing it doesn't touch days already recorded.</p>
      <button onClick={save} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white">Save rules</button>
    </div>
  )
}
