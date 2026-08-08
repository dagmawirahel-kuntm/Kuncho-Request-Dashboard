import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useMyStaffId } from '@/hooks/useMyStaff'
import { AlertTriangle } from 'lucide-react'

// Gentle nudge — never a hard block. If the foreman's most recent report is
// older than today AND not yet submitted, surface it. Shown above every Site
// Ops page and on the landing page.
export function YesterdayNudge() {
  const { data: staff } = useMyStaffId()
  const staffId = staff?.id
  const { data: latest } = useQuery({
    queryKey: ['foreman-latest-report', staffId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('site_daily_reports')
        .select('id, project_id, report_date, submitted_at, projects(project_name)')
        .eq('foreman_staff_id', staffId!)
        .is('submitted_at', null)
        .order('report_date', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data as any
    },
    enabled: !!staffId,
  })
  if (!latest) return null
  const today = new Date().toISOString().slice(0, 10)
  if (latest.report_date >= today) return null

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
      <span className="flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        {latest.report_date}'s daily report for <span className="font-medium">{latest.projects?.project_name ?? 'a site'}</span> hasn't been submitted.
      </span>
      <Link to={`/site-foreman/daily-report?draft=${latest.id}`} className="shrink-0 rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-amber-700">
        Submit now
      </Link>
    </div>
  )
}
