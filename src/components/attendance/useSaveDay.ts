import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { ATTENDANCE_KEYS, addisToday, type AttendanceRow } from '@/lib/attendance'
import { formatDateGC } from '@/lib/utils'

function daysAgo(date: string) {
  return Math.round((new Date(addisToday() + 'T00:00:00').getTime() - new Date(date + 'T00:00:00').getTime()) / 86400000)
}

/** Whether the database will want a reason for this write (same rules as the guard). */
export function needsReason(date: string, exists: boolean) {
  const ago = daysAgo(date)
  return exists ? ago > 0 : ago > 2
}

// Records one person's day: inserts it, or changes the existing row.
// Asks for a reason first when the day has passed.
export function useSaveDay(ask: (title: string, detail?: string) => Promise<string | null>) {
  const qc = useQueryClient()
  const { toast } = useToast()

  return async function save(staffId: string, name: string, date: string, patch: Partial<AttendanceRow>, existing: AttendanceRow | undefined, presetReason?: string | null) {
    let change_reason: string | null = presetReason ?? null
    if (!change_reason && needsReason(date, !!existing)) {
      change_reason = await ask(
        existing ? `Change ${name}'s ${formatDateGC(date)}?` : `Record ${name} for ${formatDateGC(date)}?`,
        existing ? 'This day has passed, so the change needs a reason.' : 'This is more than two days late, so it needs a reason.',
      )
      if (!change_reason) return false
    }
    const { error } = existing
      ? await supabase.from('staff_attendance').update({ ...patch, change_reason }).eq('id', existing.id)
      : await supabase.from('staff_attendance').insert([{ staff_id: staffId, work_date: date, status: 'present', ...patch, change_reason }])
    if (error) { toast(error.message, 'error'); return false }
    for (const k of ATTENDANCE_KEYS) qc.invalidateQueries({ queryKey: k })
    return true
  }
}
