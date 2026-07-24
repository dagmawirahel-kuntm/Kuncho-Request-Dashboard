import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { RoleViewSwitcher } from '@/components/shared/RoleViewSwitcher'
import { formatDate } from '@/lib/utils'
import type { DesignPackage, DesignDrawing } from '@/types/database'
import { PenTool, FileCheck2, ClipboardList, ArrowRight } from 'lucide-react'

type PackageRow = DesignPackage & { projects: { project_name: string } | null }
type DrawingRow = DesignDrawing & { design_packages: { title: string } | null }

const OPEN_PACKAGE_STATUSES = ['brief', 'concept', 'detailed', 'client_review']

function SectionCard({ title, icon: Icon, to, children }: { title: string; icon: React.ElementType; to: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
          <Icon className="h-4 w-4 text-brand" /> {title}
        </h2>
        <Link to={to} className="flex items-center gap-1 text-xs text-slate-400 hover:text-brand">
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      {children}
    </div>
  )
}

export default function DesignViewPage() {
  const { role } = useAuth()

  const { data: packages = [], isLoading: loadingPackages } = useQuery({
    queryKey: ['design-view-packages'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('design_packages')
        .select('*, projects(project_name)')
        .in('status', OPEN_PACKAGE_STATUSES)
        .order('updated_at', { ascending: false })
        .limit(10)
      if (error) throw error
      return data as unknown as PackageRow[]
    },
  })

  const { data: drawings = [], isLoading: loadingDrawings } = useQuery({
    queryKey: ['design-view-drawings-issued'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('design_drawings')
        .select('*, design_packages(title)')
        .eq('status', 'issued')
        .order('issued_at', { ascending: false })
        .limit(8)
      if (error) throw error
      return data as unknown as DrawingRow[]
    },
  })

  const pendingSignOff = packages.filter(p => p.status === 'client_review')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Design</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Design packages, drawing sign-offs, and the FF&E queue</p>
      </div>

      <RoleViewSwitcher mode="base" role={role} />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4">
          <p className="text-xs text-slate-400">Open Packages</p>
          <p className="mt-1 text-xl font-bold text-blue-600">{packages.length}</p>
        </div>
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4">
          <p className="text-xs text-slate-400">Pending Client Sign-Off</p>
          <p className="mt-1 text-xl font-bold text-amber-600">{pendingSignOff.length}</p>
        </div>
        <div className="rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 p-4">
          <p className="text-xs text-slate-400">Drawings Awaiting Approval</p>
          <p className="mt-1 text-xl font-bold text-purple-600">{drawings.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Design Packages" icon={PenTool} to="/design">
          {loadingPackages ? (
            <p className="py-6 text-center text-xs text-slate-400">Loading…</p>
          ) : packages.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No open packages</p>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {packages.map(p => (
                <Link key={p.id} to="/design" className="flex items-center justify-between gap-2 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40 -mx-2 px-2 rounded">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700 dark:text-slate-200">{p.title}</p>
                    <p className="text-xs text-slate-400 truncate">{p.projects?.project_name ?? '—'}</p>
                  </div>
                  <StatusBadge status={p.status} />
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Pending Client Sign-Off" icon={FileCheck2} to="/design">
          {loadingPackages ? (
            <p className="py-6 text-center text-xs text-slate-400">Loading…</p>
          ) : pendingSignOff.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">Nothing waiting on a client sign-off</p>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {pendingSignOff.map(p => (
                <Link key={p.id} to="/design" className="flex items-center justify-between gap-2 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40 -mx-2 px-2 rounded">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700 dark:text-slate-200">{p.title}</p>
                    <p className="text-xs text-slate-400 truncate">{p.projects?.project_name ?? '—'}</p>
                  </div>
                  <span className="text-xs text-amber-600 font-medium">Awaiting client</span>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Drawings Awaiting Approval" icon={ClipboardList} to="/design">
          {loadingDrawings ? (
            <p className="py-6 text-center text-xs text-slate-400">Loading…</p>
          ) : drawings.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No issued drawings awaiting approval</p>
          ) : (
            <div className="divide-y dark:divide-slate-700">
              {drawings.map(d => (
                <div key={d.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700 dark:text-slate-200">{d.title} {d.drawing_no && <span className="text-slate-400">({d.drawing_no})</span>}</p>
                    <p className="text-xs text-slate-400 truncate">{d.design_packages?.title ?? '—'} · Issued {d.issued_at ? formatDate(d.issued_at) : '—'}</p>
                  </div>
                  <StatusBadge status={d.status} />
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  )
}
