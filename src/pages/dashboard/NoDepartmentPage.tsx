import { UserCog } from 'lucide-react'

// Landing fallback for an authenticated, approved user whose staff
// record has no department assigned yet (or has no linked staff
// record at all) — a sensible placeholder rather than an error or a
// silent default into a leadership view (spec §1's explicit ask).
// Nothing else about their access changes; they can still navigate
// anywhere else their role permits via the sidebar.
export default function NoDepartmentPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
          <UserCog className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-lg font-bold text-slate-800 dark:text-slate-100">No department assigned yet</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
          You don't have a home page yet because you haven't been assigned to a department. Contact your administrator to get assigned — once that's done, you'll land on your department's page automatically.
        </p>
      </div>
    </div>
  )
}
