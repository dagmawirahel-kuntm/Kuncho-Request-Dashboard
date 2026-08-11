import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Lightbulb, Info, HelpCircle, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { supabase } from '@/lib/supabase'
import { dismissHint, isHintDismissed, type TrainerHint } from '@/lib/trainerHints'

const VARIANT_STYLES = {
  next_step: {
    wrapper: 'bg-amber-50 border-l-amber-500 dark:bg-amber-900/15 dark:border-l-amber-500',
    icon: 'text-amber-600 dark:text-amber-400',
    action: 'bg-amber-500 text-white hover:bg-amber-600',
  },
  backfill: {
    wrapper: 'bg-blue-50 border-l-blue-500 dark:bg-blue-900/15 dark:border-l-blue-500',
    icon: 'text-blue-600 dark:text-blue-400',
    action: 'border border-blue-400 text-blue-700 hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-900/30',
  },
} as const

export function TrainerHintBanner({ entityType, entityId, hint }: {
  entityType: string
  entityId: string
  hint: TrainerHint | null
}) {
  const { profile, refreshProfile } = useAuth()
  const { toast } = useToast()
  const [showWhy, setShowWhy] = useState(false)
  const [dismissed, setDismissed] = useState(() => hint != null && isHintDismissed(entityType, entityId, hint.code))
  const [turningOff, setTurningOff] = useState(false)

  if (!profile?.trainer_hints_enabled) return null
  if (!hint) return null
  if (dismissed) return null

  const style = VARIANT_STYLES[hint.variant]

  function handleDismiss() {
    if (!hint) return
    dismissHint(entityType, entityId, hint.code)
    setDismissed(true)
  }

  async function handleTurnOff() {
    setTurningOff(true)
    const { error } = await supabase.rpc('set_trainer_hints_enabled', { p_enabled: false })
    setTurningOff(false)
    if (error) { toast(error.message, 'error'); return }
    await refreshProfile()
    toast('Trainer hints turned off. Re-enable in Settings.', 'success')
  }

  return (
    <div className={`flex flex-wrap items-start gap-3 rounded-lg border-l-[3px] px-4 py-3 text-sm ${style.wrapper}`}>
      {hint.variant === 'next_step'
        ? <Lightbulb className={`h-4 w-4 flex-shrink-0 mt-0.5 ${style.icon}`} />
        : <Info className={`h-4 w-4 flex-shrink-0 mt-0.5 ${style.icon}`} />}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-medium text-slate-700 dark:text-slate-200">{hint.message}</span>
          <button
            onClick={() => setShowWhy(v => !v)}
            title="Why am I seeing this?"
            className="flex-shrink-0 flex items-center justify-center h-4 w-4 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        </div>
        {showWhy && (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint.why}</p>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <Link to={hint.actionRoute} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${style.action}`}>
          {hint.actionLabel}
        </Link>
        <button
          onClick={handleDismiss}
          title="Dismiss this hint for this session"
          className="rounded p-1 text-slate-400 hover:bg-black/5 hover:text-slate-600 dark:hover:bg-white/10 dark:hover:text-slate-300"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={handleTurnOff}
          disabled={turningOff}
          className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 underline decoration-dotted disabled:opacity-50"
        >
          Turn off all hints
        </button>
      </div>
    </div>
  )
}
