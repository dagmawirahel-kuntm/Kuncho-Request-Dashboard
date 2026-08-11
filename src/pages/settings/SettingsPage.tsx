import { useState } from 'react'
import { Settings as SettingsIcon, Lightbulb } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { supabase } from '@/lib/supabase'

export default function SettingsPage() {
  const { profile, refreshProfile } = useAuth()
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)

  async function toggleTrainerHints(next: boolean) {
    setSaving(true)
    const { error } = await supabase.rpc('set_trainer_hints_enabled', { p_enabled: next })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    await refreshProfile()
    toast(next ? 'Trainer hints turned on' : 'Trainer hints turned off', 'success')
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div className="flex items-center gap-2">
        <SettingsIcon className="h-5 w-5 text-slate-400" />
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Settings</h1>
      </div>

      <section className="rounded-2xl border bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Trainer Hints</h2>
        </div>

        <label className="flex items-start justify-between gap-4 cursor-pointer">
          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Show next-step hints on entity pages</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              When on, entity pages show a small banner suggesting the natural next action based on the current state.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={profile?.trainer_hints_enabled ?? true}
            disabled={saving}
            onClick={() => toggleTrainerHints(!(profile?.trainer_hints_enabled ?? true))}
            className={`relative flex-shrink-0 h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${
              profile?.trainer_hints_enabled ?? true ? 'bg-brand' : 'bg-slate-300 dark:bg-slate-600'
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                profile?.trainer_hints_enabled ?? true ? 'translate-x-[22px]' : 'translate-x-0.5'
              }`}
            />
          </button>
        </label>
      </section>
    </div>
  )
}
