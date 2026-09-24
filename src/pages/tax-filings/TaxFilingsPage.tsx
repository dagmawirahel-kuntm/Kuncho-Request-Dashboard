import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDateGC } from '@/lib/utils'
import type { TaxFilingView, TaxSchedule } from '@/types/database'
import { TaxFilingDetailModal } from './TaxFilingDetailModal'
import { useTaxFilingComputed } from '@/hooks/useTaxFilingComputed'
import { NewTaxFilingModal } from './NewTaxFilingModal'
import { Plus, CalendarPlus, Info, Paperclip, AlertTriangle } from 'lucide-react'

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  filed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  acknowledged: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
}
const OVERDUE_STYLE = 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'

// Same shape FiscalYearContext reads; that one is not exported, and this page
// picks its own fiscal year rather than following the global (admin-only)
// toggle, so it keeps its own query.
interface FiscalPeriodRow {
  id: string
  label: string
  start_date: string
  end_date: string
  is_current: boolean
  /** Which tax month this year's Pagume is declared with (migration 315). */
  pagume_attaches_to: 'nehase' | 'meskerem'
}

export default function TaxFilingsPage() {
  const { role, profile } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()

  const isTaxOfficer = !!profile?.is_tax_officer || role === 'admin'
  // Mirrors the tax_filings write policy (migration 302): tax officer or
  // admin. Everyone else who can reach the page reads only.
  const canEdit = isTaxOfficer

  const [fiscalPeriodId, setFiscalPeriodId] = useState<string | null>(null)
  const [openFiling, setOpenFiling] = useState<TaxFilingView | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [generating, setGenerating] = useState(false)

  const { data: periods = [] } = useQuery({
    // Own key: FiscalYearContext caches ['fiscal-periods'] with fewer
    // columns, and a shared key would hand this page rows without the
    // Pagume setting.
    queryKey: ['fiscal-periods', 'tax-filings'],
    staleTime: 300000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fiscal_periods')
        .select('id,label,start_date,end_date,is_current,pagume_attaches_to')
        .order('start_date', { ascending: false })
      if (error) throw error
      return data as FiscalPeriodRow[]
    },
  })

  const selectedPeriod = periods.find(p => p.id === fiscalPeriodId)
    ?? periods.find(p => p.is_current)
    ?? periods[0]
    ?? null

  const { data: schedules = [] } = useQuery({
    queryKey: ['tax-schedules'],
    staleTime: 300000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tax_schedules')
        .select('*')
        .eq('is_active', true)
        .order('display_order')
      if (error) throw error
      return data as TaxSchedule[]
    },
  })

  const { data: filings = [], isLoading } = useQuery({
    queryKey: ['tax-filings', selectedPeriod?.id ?? null],
    enabled: !!selectedPeriod,
    queryFn: async () => {
      // Filter on the Gregorian span rather than fiscal_period_id: a filing
      // recorded ad hoc (NewTaxFilingModal) has no fiscal_period_id, and
      // keying off it would hide exactly the corrections someone went out
      // of their way to record.
      const { data, error } = await supabase
        .from('v_tax_filings')
        .select('*')
        .gte('period_start_greg', selectedPeriod!.start_date)
        .lte('period_start_greg', selectedPeriod!.end_date)
        .order('period_start_greg')
      if (error) throw error
      return data as TaxFilingView[]
    },
  })

  // What each filing should declare, from the books (migration 313).
  const { data: computed } = useTaxFilingComputed(selectedPeriod?.id)

  // Grouped by schedule, in the catalogue's own display order.
  const groups = useMemo(() => {
    const order = new Map(schedules.map((s, i) => [s.code, i]))
    const byCode = new Map<string, TaxFilingView[]>()
    for (const f of filings) {
      const list = byCode.get(f.schedule_code) ?? []
      list.push(f)
      byCode.set(f.schedule_code, list)
    }
    return [...byCode.entries()]
      .sort((a, b) => (order.get(a[0]) ?? 999) - (order.get(b[0]) ?? 999))
      .map(([code, rows]) => ({ code, rows }))
  }, [filings, schedules])

  const overdueCount = filings.filter(f => f.is_overdue).length

  // Pagume is not a return of its own: each fiscal year declares it with
  // Nehase or with Meskerem. set_pagume_attachment() reshapes that year's
  // filings and refuses once any affected return has left draft.
  const [savingPagume, setSavingPagume] = useState(false)
  async function changePagume(target: 'nehase' | 'meskerem') {
    if (!selectedPeriod || target === selectedPeriod.pagume_attaches_to) return
    setSavingPagume(true)
    const { error } = await supabase.rpc('set_pagume_attachment', {
      p_fiscal_period_id: selectedPeriod.id, p_attaches_to: target,
    })
    setSavingPagume(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['fiscal-periods'] })
    qc.invalidateQueries({ queryKey: ['tax-filings'] })
    qc.invalidateQueries({ queryKey: ['tax-filing-computed'] })
    toast(`Pagume is now declared with ${target === 'nehase' ? 'Nehase' : 'Meskerem'} for ${selectedPeriod.label}`, 'success')
  }

  async function generatePeriods() {
    if (!selectedPeriod) return
    setGenerating(true)
    const { data, error } = await supabase.rpc('generate_tax_filing_periods', {
      p_fiscal_period_id: selectedPeriod.id,
    })
    setGenerating(false)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['tax-filings'] })
    // The RPC is idempotent — it skips periods that already exist — so zero
    // created is the normal answer on a second run, not a failure.
    const n = Number(data ?? 0)
    toast(n === 0 ? 'All periods for this year already exist' : `${n} filing period${n > 1 ? 's' : ''} created`, 'success')
  }

  // Seeds the EC year for an ad-hoc filing from the fiscal year on screen,
  // taken off an existing row rather than computed here. When the year has
  // no rows yet there is nothing to take it from, and the modal asks the
  // database instead of this file doing the conversion.
  const defaultEcYear = filings[0]?.period_ec_year ?? null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Tax Filings</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Every declaration Kuncho owes, by Ethiopian period, with the government record attached
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedPeriod?.id ?? ''}
            onChange={e => setFiscalPeriodId(e.target.value)}
            className="rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          >
            {periods.map(p => (
              <option key={p.id} value={p.id}>{p.label}{p.is_current ? ' (current)' : ''}</option>
            ))}
          </select>
          {selectedPeriod && (
            <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"
              title="Pagume's days are declared with the chosen month; there is no separate Pagume return">
              Pagume with
              <select
                value={selectedPeriod.pagume_attaches_to}
                disabled={!canEdit || savingPagume}
                onChange={e => changePagume(e.target.value as 'nehase' | 'meskerem')}
                className="rounded-md border px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="nehase">Nehase</option>
                <option value="meskerem">Meskerem</option>
              </select>
            </label>
          )}
          {canEdit && (
            <>
              <button onClick={generatePeriods} disabled={generating || !selectedPeriod}
                className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
                <CalendarPlus className="h-4 w-4" /> {generating ? 'Generating…' : 'Generate periods'}
              </button>
              <button onClick={() => setShowNew(true)}
                className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
                <Plus className="h-4 w-4" /> Record filing
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Periods are Ethiopian — <strong>Hamle 2018</strong>, not July 2026. The Gregorian dates shown alongside are
          only there to line the period up with a bank statement. Deleting a filing is admin-only, needs a reason,
          and is recorded permanently; that rule lives in the database, not in these buttons.
        </span>
      </div>

      {overdueCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-900/20 dark:text-red-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {overdueCount} filing{overdueCount > 1 ? 's are' : ' is'} past its due date and not yet acknowledged
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="space-y-2 py-12 text-center">
          <p className="text-sm text-slate-400">No filing periods for {selectedPeriod?.label ?? 'this year'} yet</p>
          {canEdit && (
            <p className="text-xs text-slate-400">
              Use <strong>Generate periods</strong> to create them from the schedules that apply to Kuncho.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(({ code, rows }) => {
            const schedule = schedules.find(s => s.code === code)
            return (
              <div key={code} className="overflow-hidden rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
                <div className="flex items-baseline justify-between gap-3 border-b px-5 py-3 dark:border-slate-700">
                  <div className="min-w-0">
                    <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                      {schedule?.display_label ?? code}
                    </h2>
                    <p className="truncate text-xs text-slate-400">
                      {schedule?.name}{schedule?.authority ? ` · ${schedule.authority}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{rows.length} period{rows.length > 1 ? 's' : ''}</span>
                </div>

                <div className="divide-y dark:divide-slate-700">
                  {rows.map(f => (
                    <button key={f.id} onClick={() => setOpenFiling(f)}
                      className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                          {f.period_label}
                          {f.includes_pagume && (
                            <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                              incl. Pagume
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {formatDateGC(f.period_start_greg)} – {formatDateGC(f.period_end_greg)}
                          {f.due_date_greg ? ` · due ${formatDateGC(f.due_date_greg)}` : ''}
                        </p>
                      </div>

                      {(() => {
                        const c = computed?.get(f.id)?.computed_amount
                        if (c == null) return null
                        // Flag a declared figure that differs from the books by
                        // more than a rounding cent; an undeclared draft is not
                        // a mismatch, just unfinished.
                        const mismatch = f.declared_amount != null && Math.abs(Number(f.declared_amount) - Number(c)) > 0.01
                        return (
                          <div className="hidden shrink-0 text-right sm:block">
                            <p className={`text-sm tabular-nums ${mismatch ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`}>
                              {formatCurrency(Number(c))}
                            </p>
                            <p className="text-[10px] uppercase tracking-wide text-slate-400">{mismatch ? 'computed ≠ declared' : 'computed'}</p>
                          </div>
                        )
                      })()}

                      <div className="hidden shrink-0 text-right sm:block">
                        <p className="text-sm tabular-nums text-slate-700 dark:text-slate-200">
                          {formatCurrency(f.declared_amount)}
                        </p>
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">declared</p>
                      </div>

                      {f.document_count > 0 && (
                        <span title={`${f.document_count} document${f.document_count > 1 ? 's' : ''}`}
                          className="flex shrink-0 items-center gap-0.5 text-[11px] text-slate-400">
                          <Paperclip className="h-3 w-3" />{f.document_count}
                        </span>
                      )}

                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        f.is_overdue ? OVERDUE_STYLE : STATUS_STYLE[f.status] ?? STATUS_STYLE.draft}`}>
                        {f.is_overdue ? 'Overdue' : f.status === 'acknowledged' ? 'Acknowledged' : f.status === 'filed' ? 'Filed' : 'Draft'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {openFiling && (
        <TaxFilingDetailModal filing={openFiling} canEdit={canEdit} computed={computed?.get(openFiling.id) ?? null} onClose={() => setOpenFiling(null)} />
      )}
      {showNew && (
        <NewTaxFilingModal
          schedules={schedules}
          defaultEcYear={defaultEcYear}
          onClose={() => setShowNew(false)}
        />
      )}
    </div>
  )
}
