import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { Panel, Pill } from '@/components/record/Record'
import { PhotoUploader } from '@/components/shared/PhotoUploader'
import { fmtMoney } from '@/lib/labour'
import {
  CHARGE_STATUS, DEFAULT_CHECKLIST, STAGE_LABEL, halfDays,
  type CheckLine, type DamageCharge, type FixtureCheck, type ProjectClosing,
} from '@/lib/labourDay'
import type { DeliveryPhoto } from '@/types/database'
import { Boxes, CheckCircle2, ClipboardCheck, Flag, Hammer, Lock, PackageCheck, PackageOpen, Plus, Receipt, Scale, Trash2, Truck, Undo2, Users } from 'lucide-react'

type Draft = { fixture_id: string; quantity: string; missing_qty: string; checklist: { item: string; ok: boolean }[]; photos: DeliveryPhoto[]; note: string }
type Inspect = { ok_qty: string; damaged_qty: string; checklist: { item: string; ok: boolean }[]; photos: DeliveryPhoto[]; note: string }
const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50'
const field = 'rounded-lg border px-2.5 py-1.5 text-base sm:text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

// A project's closing (491): Delivered when the event is done (the PM);
// Costing Closed when every fixture is back, inspected and repaired and the
// labour is locked and confirmed (finance). Fixtures are checked out and
// back here; a return inspection opens repair work on this project and,
// where the contract allows, a damage charge.
export function ProjectClosingPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { data: c, isLoading, error } = useQuery({
    queryKey: ['project-closing', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('project_closing', { p_project: projectId })
      if (error) throw error
      return data as ProjectClosing
    },
  })
  const { data: labour } = useQuery({
    queryKey: ['project-labour-summary', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('project_labour_summary', { p_project: projectId })
      if (error) throw error
      return data as {
        costs_visible: boolean; cost: number | null; budget: number | null; over_budget: boolean | null
        by_source: Record<string, { person_days: number; cost: number | null }> | null
        sheet: { build_days: number; repair_days: number; build_cost: number | null; repair_cost: number | null; not_locked_days: number }
      } | null
    },
  })
  const [busy, setBusy] = useState<string | null>(null)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['project-closing', projectId] })
    qc.invalidateQueries({ queryKey: ['project-labour-summary', projectId] })
    qc.invalidateQueries({ queryKey: ['labour-flags'] })
  }
  async function run(key: string, fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) {
    setBusy(key)
    const { error } = await fn()
    setBusy(null)
    if (error) { toast(error.message, 'error'); return false }
    toast(ok, 'success')
    refresh()
    return true
  }

  if (isLoading) return <p className="p-6 text-center text-sm text-slate-400">Loading…</p>
  if (error || !c) return <p className="p-6 text-center text-sm text-slate-500">{(error as Error)?.message ?? 'Not available'}</p>

  const closed = c.stage === 'closed'
  const returnsToInspect = c.checks.filter(k => k.kind === 'return' && k.status === 'received')
  const inspected = c.checks.filter(k => k.kind === 'return' && k.status === 'inspected')
  const anyOut = c.fixtures.some(f => Number(f.still_out) > 0)

  return (
    <div className="space-y-4">
      {/* The two closing points */}
      <Panel title="Closing" icon={Flag} action={<Pill tone={STAGE_LABEL[c.stage].tone}>{STAGE_LABEL[c.stage].label}</Pill>}>
        <ol className="mb-3 grid gap-2 sm:grid-cols-3">
          {([
            ['In progress', true, null],
            ['Delivered', !!c.delivered_at, c.delivered_at ? `${fmtDate(c.delivered_at)} · ${c.delivered_by_name ?? ''}` : 'Event done, invoice can go'],
            ['Costing closed', !!c.costing_closed_at, c.costing_closed_at ? `${fmtDate(c.costing_closed_at)} · ${c.costing_closed_by_name ?? ''}` : 'Labour cost and profit final'],
          ] as const).map(([label, done, sub]) => (
            <li key={label} className={`rounded-xl border px-3 py-2 ${done ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800/40 dark:bg-emerald-900/10' : 'dark:border-slate-700'}`}>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100">{done && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}{label}</p>
              {sub && <p className="text-xs text-slate-500">{sub}</p>}
            </li>
          ))}
        </ol>
        {c.stage === 'delivered' && c.open_for_days != null && (
          <p className={`mb-3 text-sm ${c.open_for_days > c.costing_open_days ? 'text-red-600' : 'text-slate-600 dark:text-slate-300'}`}>
            Delivered {c.open_for_days} day{c.open_for_days === 1 ? '' : 's'} ago — costing is flagged after {c.costing_open_days}.
          </p>
        )}
        {!closed && c.blockers.length > 0 && c.stage !== 'active' && (
          <div className="mb-3 rounded-xl bg-amber-50 p-3 text-sm dark:bg-amber-900/10">
            <p className="mb-1 font-semibold text-amber-900 dark:text-amber-200">Before costing can close</p>
            <ul className="list-inside list-disc text-amber-900 dark:text-amber-200">
              {c.blockers.filter(b => b.kind !== 'not_delivered').map(b => <li key={b.kind}>{b.label} ({b.n})</li>)}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {c.stage === 'active' && c.can_deliver && (
            <button disabled={!!busy} className={`${btn} bg-brand text-white`}
              onClick={() => { const n = prompt('Mark delivered — the event is done and the invoice can go. Note (optional):'); if (n !== null) void run('deliver', () => supabase.rpc('project_mark_delivered', { p_project: projectId, p_note: n || null }), 'Marked delivered') }}>
              <PackageCheck className="h-3.5 w-3.5" /> Mark delivered
            </button>
          )}
          {c.stage === 'delivered' && c.can_deliver && (
            <button disabled={!!busy} className={`${btn} border text-slate-600 dark:border-slate-600 dark:text-slate-300`}
              onClick={() => { const n = prompt('Why isn\'t it delivered after all?'); if (n?.trim()) void run('undeliver', () => supabase.rpc('project_undo_delivered', { p_project: projectId, p_reason: n }), 'Delivery undone') }}>
              <Undo2 className="h-3.5 w-3.5" /> Not delivered after all
            </button>
          )}
          {c.stage === 'delivered' && c.can_close && (
            <button disabled={!!busy || c.blockers.length > 0} className={`${btn} bg-emerald-600 text-white`} title={c.blockers.length ? 'Clear the list above first' : undefined}
              onClick={() => { if (confirm('Close costing? Labour cost and profit become final, and nothing more can be costed to this project.')) void run('close', () => supabase.rpc('project_close_costing', { p_project: projectId, p_note: null }), 'Costing closed') }}>
              <Lock className="h-3.5 w-3.5" /> Close costing
            </button>
          )}
          {closed && c.can_close && (
            <button disabled={!!busy} className={`${btn} border text-slate-600 dark:border-slate-600 dark:text-slate-300`}
              onClick={() => { const n = prompt('Why reopen costing?'); if (n?.trim()) void run('reopen', () => supabase.rpc('project_reopen_costing', { p_project: projectId, p_reason: n }), 'Costing reopened') }}>
              <Undo2 className="h-3.5 w-3.5" /> Reopen costing
            </button>
          )}
        </div>
        {c.events.length > 0 && (
          <ul className="mt-3 space-y-0.5 border-t pt-2 text-xs text-slate-500 dark:border-slate-700">
            {c.events.map(e => <li key={e.id}>{fmtDate(e.at)} · {e.kind.replace(/_/g, ' ')} · {e.by_name ?? '—'}{e.note ? ` — ${e.note}` : ''}</li>)}
          </ul>
        )}
      </Panel>

      {/* Labour on this project */}
      {labour && (
        <Panel title="Labour on this project" icon={Users}>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Fact label="Build (day sheets)" value={`${halfDays(Number(labour.sheet.build_days))} days`} sub={labour.costs_visible ? fmtMoney(labour.sheet.build_cost) : undefined} />
            <Fact label="Post-event repair" value={`${halfDays(Number(labour.sheet.repair_days))} days`} sub={labour.costs_visible ? fmtMoney(labour.sheet.repair_cost) : undefined} />
            <Fact label="On work orders & before" value={`${Math.round(Number(labour.by_source?.day?.person_days ?? 0) + Number(labour.by_source?.legacy?.person_days ?? 0))} entries`}
              sub={labour.costs_visible ? fmtMoney(Number(labour.by_source?.day?.cost ?? 0) + Number(labour.by_source?.legacy?.cost ?? 0)) : undefined} />
            <Fact label="All labour" value={labour.costs_visible ? fmtMoney(labour.cost) : '—'}
              sub={labour.budget ? `of ${fmtMoney(labour.budget)} budget` : 'no labour budget'} tone={labour.over_budget ? 'red' : undefined} />
          </div>
          {labour.sheet.not_locked_days > 0 && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{labour.sheet.not_locked_days} day sheet{labour.sheet.not_locked_days === 1 ? '' : 's'} with labour here not locked yet.</p>}
        </Panel>
      )}

      <DamageTerms c={c} projectId={projectId} onSaved={refresh} />
      <FixtureList c={c} projectId={projectId} onSaved={refresh} disabled={closed} />

      {c.can_inspect && !closed && c.fixtures.length > 0 && (
        <CheckForm c={c} projectId={projectId} onSaved={refresh} anyOut={anyOut} />
      )}

      {returnsToInspect.map(k => <InspectForm key={k.id} check={k} onSaved={refresh} canInspect={c.can_inspect} />)}

      {inspected.length > 0 && (
        <Panel title="Inspected returns" icon={ClipboardCheck} count={inspected.length}>
          <ul className="space-y-3">
            {inspected.map(k => <InspectedReturn key={k.id} check={k} c={c} projectId={projectId} onSaved={refresh} />)}
          </ul>
        </Panel>
      )}

      {c.charges.length > 0 && <Charges charges={c.charges} onSaved={refresh} />}

      <Panel title="Checks out and back" icon={Truck} count={c.checks.length}>
        {c.checks.length === 0 ? <p className="text-sm text-slate-400">No fixtures checked out yet.</p> : (
          <ul className="divide-y text-sm dark:divide-slate-700">
            {c.checks.map(k => (
              <li key={k.id} className="py-2">
                <p className="text-slate-800 dark:text-slate-100">
                  {k.kind === 'dispatch' ? 'Out' : 'Back'} · {k.code} · {fmtDate(k.checked_at)} · {k.checked_by_name ?? '—'}
                  {k.kind === 'return' && <> {' '}<Pill tone={k.status === 'inspected' ? 'green' : 'amber'}>{k.status === 'inspected' ? 'Inspected' : 'To inspect'}</Pill></>}
                </p>
                <p className="text-xs text-slate-500">
                  {(k.lines ?? []).map(l => `${Number(l.quantity)}${Number(l.missing_qty) ? ` (+${Number(l.missing_qty)} lost)` : ''} × ${l.name}${Number(l.damaged_qty) ? ` — ${Number(l.damaged_qty)} damaged` : ''}`).join(' · ')}
                  {k.note ? ` · ${k.note}` : ''}
                </p>
                {k.photos?.length > 0 && <div className="mt-1 flex gap-1">{k.photos.map(p => <a key={p.url} href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt="" className="h-10 w-10 rounded object-cover" /></a>)}</div>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

function Fact({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'red' }) {
  return (
    <div className="rounded-xl border px-3 py-2 dark:border-slate-700">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-sm font-semibold ${tone === 'red' ? 'text-red-600' : 'text-slate-800 dark:text-slate-100'}`}>{value}</p>
      {sub && <p className={`text-xs ${tone === 'red' ? 'text-red-600' : 'text-slate-500'}`}>{sub}</p>}
    </div>
  )
}

function DamageTerms({ c, projectId, onSaved }: { c: ProjectClosing; projectId: string; onSaved: () => void }) {
  const { toast } = useToast()
  const [yes, setYes] = useState(c.damage_chargeable)
  const [terms, setTerms] = useState(c.damage_terms ?? '')
  const [saving, setSaving] = useState(false)
  const savedKey = `${c.damage_chargeable}|${c.damage_terms ?? ''}`
  const [prev, setPrev] = useState(savedKey)
  if (prev !== savedKey) { setPrev(savedKey); setYes(c.damage_chargeable); setTerms(c.damage_terms ?? '') }
  const dirty = yes !== c.damage_chargeable || terms !== (c.damage_terms ?? '')
  async function save() {
    setSaving(true)
    const { error } = await supabase.rpc('project_set_damage_terms', { p_project: projectId, p_chargeable: yes, p_terms: terms })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Damage terms saved', 'success'); onSaved()
  }
  return (
    <Panel title="Damage terms" icon={Scale}>
      <div className="space-y-2">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Damage chargeable to client</span>
          <div className="inline-flex overflow-hidden rounded-lg border dark:border-slate-600">
            {[true, false].map(v => (
              <button key={String(v)} disabled={!c.can_set_terms} onClick={() => setYes(v)}
                className={`px-3 py-1 text-xs font-semibold ${yes === v ? 'bg-brand text-white' : 'text-slate-600 dark:text-slate-300'}`}>{v ? 'Yes' : 'No'}</button>
            ))}
          </div>
        </div>
        <textarea value={terms} onChange={e => setTerms(e.target.value)} disabled={!c.can_set_terms} rows={2} placeholder="What the contract says about damage (optional)"
          className={`${field} w-full`} />
        {c.can_set_terms && dirty && <div className="flex justify-end"><button onClick={save} disabled={saving} className={`${btn} bg-brand text-white`}>{saving ? 'Saving…' : 'Save'}</button></div>}
      </div>
    </Panel>
  )
}

function FixtureList({ c, projectId, onSaved, disabled }: { c: ProjectClosing; projectId: string; onSaved: () => void; disabled: boolean }) {
  const { toast } = useToast()
  const [adding, setAdding] = useState<{ name: string; quantity: string; unit: string }[]>([])
  const [busy, setBusy] = useState(false)
  async function save(items: unknown[]) {
    setBusy(true)
    const { error } = await supabase.rpc('project_fixtures_save', { p_project: projectId, p_items: items })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    setAdding([]); onSaved()
  }
  async function fromBoq() {
    setBusy(true)
    const { data, error } = await supabase.rpc('project_fixtures_from_boq', { p_project: projectId })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`${Number(data)} fixture${Number(data) === 1 ? '' : 's'} added from the BOQ`, 'success'); onSaved()
  }
  const editable = c.can_inspect && !disabled
  return (
    <Panel title="Fixtures" icon={Boxes} count={c.fixtures.length} action={editable && (
      <div className="flex gap-2">
        <button onClick={fromBoq} disabled={busy} className="text-xs text-brand">From the BOQ</button>
        <button onClick={() => setAdding(a => [...a, { name: '', quantity: '1', unit: 'pcs' }])} className="flex items-center gap-1 text-xs text-brand"><Plus className="h-3.5 w-3.5" /> Add</button>
      </div>
    )}>
      {c.fixtures.length === 0 && adding.length === 0 ? (
        <p className="text-sm text-slate-400">No fixtures listed yet. Add what goes out to the event — or start from the BOQ.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Fixture</th><th className="py-1 text-right">Qty</th><th className="py-1 text-right">Out</th><th className="py-1 text-right">Back</th><th className="py-1 text-right">Lost</th><th className="py-1 text-right">Damaged</th><th /></tr></thead>
            <tbody className="divide-y dark:divide-slate-700">
              {c.fixtures.map(f => (
                <tr key={f.fixture_id}>
                  <td className="py-1.5 text-slate-800 dark:text-slate-100">{f.name}</td>
                  <td className="py-1.5 text-right tabular-nums">{Number(f.quantity)} {f.unit}</td>
                  <td className={`py-1.5 text-right tabular-nums ${Number(f.still_out) ? 'font-semibold text-amber-600' : 'text-slate-400'}`}>{Number(f.still_out) || '—'}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-500">{Number(f.back) || '—'}</td>
                  <td className={`py-1.5 text-right tabular-nums ${Number(f.missing) ? 'text-red-600' : 'text-slate-400'}`}>{Number(f.missing) || '—'}</td>
                  <td className={`py-1.5 text-right tabular-nums ${Number(f.damaged) ? 'text-red-600' : 'text-slate-400'}`}>{Number(f.damaged) || '—'}</td>
                  <td className="py-1.5 text-right">
                    {editable && !Number(f.sent) && (
                      <button onClick={() => save([{ id: f.fixture_id, remove: true }])} disabled={busy} className="rounded p-1 text-slate-400 hover:text-red-600" aria-label={`Remove ${f.name}`}><Trash2 className="h-3.5 w-3.5" /></button>
                    )}
                  </td>
                </tr>
              ))}
              {adding.map((a, i) => (
                <tr key={`new-${i}`}>
                  <td className="py-1.5"><input autoFocus={i === adding.length - 1} value={a.name} onChange={e => setAdding(xs => xs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="e.g. Reception desk" className={`${field} w-full`} /></td>
                  <td className="py-1.5 text-right" colSpan={2}>
                    <input type="number" min={1} value={a.quantity} onChange={e => setAdding(xs => xs.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} className={`${field} w-16 text-right`} />
                    <input value={a.unit} onChange={e => setAdding(xs => xs.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} className={`${field} ml-1 w-16`} />
                  </td>
                  <td colSpan={4} className="py-1.5 text-right"><button onClick={() => setAdding(xs => xs.filter((_, j) => j !== i))} className="rounded p-1 text-slate-400"><Trash2 className="h-3.5 w-3.5" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding.length > 0 && (
        <div className="mt-2 flex justify-end">
          <button onClick={() => save(adding.filter(a => a.name.trim()).map(a => ({ name: a.name, quantity: Number(a.quantity) || 1, unit: a.unit })))} disabled={busy || !adding.some(a => a.name.trim())} className={`${btn} bg-brand text-white`}>
            {busy ? 'Saving…' : 'Save fixtures'}
          </button>
        </div>
      )}
    </Panel>
  )
}

function ChecklistChips({ list, onChange, disabled }: { list: { item: string; ok: boolean }[]; onChange: (l: { item: string; ok: boolean }[]) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((c, i) => (
        <button key={c.item} type="button" disabled={disabled} onClick={() => onChange(list.map((x, j) => (j === i ? { ...x, ok: !x.ok } : x)))}
          className={`rounded-full border px-2 py-0.5 text-[11px] ${c.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200' : 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200'}`}>
          {c.ok ? '✓' : '✗'} {c.item}
        </button>
      ))}
    </div>
  )
}
const freshChecklist = () => DEFAULT_CHECKLIST.map(item => ({ item, ok: true }))

// Check out to the event, or receive back.
function CheckForm({ c, projectId, onSaved, anyOut }: { c: ProjectClosing; projectId: string; onSaved: () => void; anyOut: boolean }) {
  const { toast } = useToast()
  const [kind, setKind] = useState<'dispatch' | 'return' | null>(null)
  const [lines, setLines] = useState<Record<string, Draft>>({})
  const [note, setNote] = useState('')
  const [photos, setPhotos] = useState<DeliveryPhoto[]>([])
  const [busy, setBusy] = useState(false)
  function start(k: 'dispatch' | 'return') {
    setKind(k); setNote(''); setPhotos([])
    setLines(Object.fromEntries(c.fixtures.map(f => [f.fixture_id, {
      fixture_id: f.fixture_id,
      quantity: String(k === 'dispatch' ? Math.max(Number(f.quantity) - Number(f.still_out), 0) : Number(f.still_out)),
      missing_qty: '0', checklist: freshChecklist(), photos: [], note: '',
    }])))
  }
  async function save() {
    setBusy(true)
    const { error } = await supabase.rpc('fixture_check_save', {
      p_project: projectId, p_kind: kind, p_note: note.trim() || null, p_photos: photos,
      p_lines: Object.values(lines).map(l => ({ fixture_id: l.fixture_id, quantity: Number(l.quantity) || 0, missing_qty: Number(l.missing_qty) || 0,
        checklist: kind === 'dispatch' ? l.checklist : [], photos: l.photos, note: l.note.trim() || null })),
    })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(kind === 'dispatch' ? 'Checked out' : 'Received back — inspect it next', 'success')
    setKind(null); onSaved()
  }
  const set = (id: string, f: (d: Draft) => Draft) => setLines(ls => ({ ...ls, [id]: f(ls[id]) }))
  return (
    <Panel title="Check fixtures out or back" icon={Truck} action={!kind && (
      <div className="flex gap-2">
        <button onClick={() => start('dispatch')} className={`${btn} bg-brand text-white`}><PackageOpen className="h-3.5 w-3.5" /> Check out</button>
        <button onClick={() => start('return')} disabled={!anyOut} className={`${btn} border text-slate-700 dark:border-slate-600 dark:text-slate-200`}><PackageCheck className="h-3.5 w-3.5" /> Receive back</button>
      </div>
    )}>
      {!kind ? <p className="text-sm text-slate-500">Check what leaves for the event (condition and photos), and what comes back.</p> : (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{kind === 'dispatch' ? 'Going out to the event' : 'Coming back — count what came back; mark anything lost'}</p>
          <ul className="space-y-3">
            {c.fixtures.filter(f => kind === 'dispatch' ? Number(f.quantity) > Number(f.still_out) : Number(f.still_out) > 0).map(f => {
              const l = lines[f.fixture_id]
              if (!l) return null
              return (
                <li key={f.fixture_id} className="rounded-xl border p-3 dark:border-slate-700">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex-1 text-sm font-medium text-slate-800 dark:text-slate-100">{f.name}</span>
                    <label className="text-xs text-slate-500">{kind === 'dispatch' ? 'Out' : 'Back'}
                      <input type="number" min={0} value={l.quantity} onChange={e => set(f.fixture_id, d => ({ ...d, quantity: e.target.value }))} className={`${field} ml-1 w-16 text-right`} />
                    </label>
                    {kind === 'return' && (
                      <label className="text-xs text-slate-500">Lost
                        <input type="number" min={0} value={l.missing_qty} onChange={e => set(f.fixture_id, d => ({ ...d, missing_qty: e.target.value }))} className={`${field} ml-1 w-16 text-right`} />
                      </label>
                    )}
                    <span className="text-xs text-slate-400">of {kind === 'dispatch' ? Number(f.quantity) - Number(f.still_out) : Number(f.still_out)} {f.unit}</span>
                  </div>
                  {kind === 'dispatch' && <div className="mt-2"><ChecklistChips list={l.checklist} onChange={cl => set(f.fixture_id, d => ({ ...d, checklist: cl }))} /></div>}
                  <div className="mt-2 flex flex-wrap items-start gap-2">
                    <PhotoUploader photos={l.photos} onChange={p => set(f.fixture_id, d => ({ ...d, photos: p }))} folder={`fixtures/${projectId}`} label="Photo" />
                    <input value={l.note} onChange={e => set(f.fixture_id, d => ({ ...d, note: e.target.value }))} placeholder="Note" className={`${field} min-w-[10rem] flex-1`} />
                  </div>
                </li>
              )
            })}
          </ul>
          <PhotoUploader photos={photos} onChange={setPhotos} folder={`fixtures/${projectId}`} label="Truck / load photo" />
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note for the whole check (truck, driver…)" className={`${field} w-full`} />
          <div className="flex justify-end gap-2">
            <button onClick={() => setKind(null)} className={`${btn} border text-slate-600 dark:border-slate-600 dark:text-slate-300`}>Cancel</button>
            <button onClick={save} disabled={busy} className={`${btn} bg-brand text-white`}>{busy ? 'Saving…' : kind === 'dispatch' ? 'Check out' : 'Receive back'}</button>
          </div>
        </div>
      )}
    </Panel>
  )
}

// Inspect a return: what came back fine and what's damaged, with the checklist.
function InspectForm({ check, onSaved, canInspect }: { check: FixtureCheck; onSaved: () => void; canInspect: boolean }) {
  const { toast } = useToast()
  const lines = (check.lines ?? []).filter(l => Number(l.quantity) > 0)
  const [d, setD] = useState<Record<string, Inspect>>(() => Object.fromEntries(lines.map(l => [l.fixture_id, { ok_qty: String(Number(l.quantity)), damaged_qty: '0', checklist: freshChecklist(), photos: [], note: '' }])))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (id: string, f: (x: Inspect) => Inspect) => setD(s => ({ ...s, [id]: f(s[id]) }))
  async function save() {
    setBusy(true)
    const { error } = await supabase.rpc('fixture_return_inspect', {
      p_check: check.id, p_note: note.trim() || null,
      p_lines: lines.map(l => ({ fixture_id: l.fixture_id, ok_qty: Number(d[l.fixture_id].ok_qty) || 0, damaged_qty: Number(d[l.fixture_id].damaged_qty) || 0,
        checklist: d[l.fixture_id].checklist, photos: d[l.fixture_id].photos, note: d[l.fixture_id].note.trim() || null })),
    })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Inspection saved', 'success'); onSaved()
  }
  return (
    <Panel title={`Inspect return ${check.code}`} icon={ClipboardCheck} action={<Pill tone="amber">To inspect</Pill>}>
      <p className="mb-2 text-xs text-slate-500">Back {fmtDate(check.checked_at)} · received by {check.checked_by_name ?? '—'}{check.note ? ` · ${check.note}` : ''}</p>
      <ul className="space-y-3">
        {lines.map(l => {
          const x = d[l.fixture_id]
          const adds = (Number(x.ok_qty) || 0) + (Number(x.damaged_qty) || 0) === Number(l.quantity)
          return (
            <li key={l.fixture_id} className="rounded-xl border p-3 dark:border-slate-700">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex-1 text-sm font-medium text-slate-800 dark:text-slate-100">{l.name} <span className="font-normal text-slate-500">· {Number(l.quantity)} back</span></span>
                <label className="text-xs text-slate-500">Fine<input type="number" min={0} disabled={!canInspect} value={x.ok_qty} onChange={e => set(l.fixture_id, v => ({ ...v, ok_qty: e.target.value }))} className={`${field} ml-1 w-16 text-right`} /></label>
                <label className="text-xs text-slate-500">Damaged<input type="number" min={0} disabled={!canInspect} value={x.damaged_qty} onChange={e => set(l.fixture_id, v => ({ ...v, damaged_qty: e.target.value }))} className={`${field} ml-1 w-16 text-right`} /></label>
                {!adds && <span className="text-xs text-red-600">must add up to {Number(l.quantity)}</span>}
              </div>
              <div className="mt-2"><ChecklistChips list={x.checklist} disabled={!canInspect} onChange={cl => set(l.fixture_id, v => ({ ...v, checklist: cl }))} /></div>
              {canInspect && (
                <div className="mt-2 flex flex-wrap items-start gap-2">
                  <PhotoUploader photos={x.photos} onChange={p => set(l.fixture_id, v => ({ ...v, photos: p }))} folder={`fixtures/${check.id}`} label="Photo" />
                  <input value={x.note} onChange={e => set(l.fixture_id, v => ({ ...v, note: e.target.value }))} placeholder="What's wrong with it?" className={`${field} min-w-[10rem] flex-1`} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {canInspect && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Inspection note (optional)" className={`${field} min-w-[12rem] flex-1`} />
          <button onClick={save} disabled={busy} className={`${btn} bg-brand text-white`}>{busy ? 'Saving…' : 'Save inspection'}</button>
        </div>
      )}
    </Panel>
  )
}

function InspectedReturn({ check, c, projectId, onSaved }: { check: FixtureCheck; c: ProjectClosing; projectId: string; onSaved: () => void }) {
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [charge, setCharge] = useState<CheckLine | null>(null)
  const [amount, setAmount] = useState('')
  const [what, setWhat] = useState('')
  async function repair(l: CheckLine) {
    setBusy(l.fixture_id)
    const { error } = await supabase.rpc('fixture_open_repair', { p_check: check.id, p_fixture: l.fixture_id, p_scope: null })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    toast(`Repair work order opened for ${l.name} — its labour goes on the day sheet as Repair on this project`, 'success'); onSaved()
  }
  async function raise() {
    if (!charge) return
    setBusy('charge')
    const { error } = await supabase.rpc('damage_charge_raise', { p_check: check.id, p_fixture: charge.fixture_id, p_description: what, p_amount: Number(amount), p_photos: charge.photos ?? [] })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    toast('Damage charge raised — finance approves it', 'success'); setCharge(null); setAmount(''); setWhat(''); onSaved()
  }
  const damaged = (check.lines ?? []).filter(l => Number(l.damaged_qty) > 0)
  return (
    <li className="rounded-xl border p-3 dark:border-slate-700">
      <p className="text-sm text-slate-800 dark:text-slate-100">{check.code} · inspected {fmtDate(check.inspected_at)} by {check.inspected_by_name ?? '—'}</p>
      {damaged.length === 0 ? <p className="text-xs text-emerald-700 dark:text-emerald-300">Everything came back fine.</p> : (
        <ul className="mt-2 space-y-2">
          {damaged.map(l => (
            <li key={l.fixture_id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="flex-1 text-slate-700 dark:text-slate-200">{Number(l.damaged_qty)} × {l.name} damaged{l.note ? ` — ${l.note}` : ''}</span>
              {l.repair ? (
                <Link to={`/work-orders/${l.repair.id}`} className="flex items-center gap-1 text-xs text-brand"><Hammer className="h-3.5 w-3.5" /> Repair work order ({l.repair.status.replace('_', ' ')})</Link>
              ) : c.can_inspect && (
                <button onClick={() => repair(l)} disabled={busy === l.fixture_id} className={`${btn} border text-slate-700 dark:border-slate-600 dark:text-slate-200`}><Hammer className="h-3.5 w-3.5" /> Open repair</button>
              )}
              {c.damage_chargeable && c.can_inspect && (
                <button onClick={() => { setCharge(l); setWhat(`${l.name} damaged at the event${l.note ? ` — ${l.note}` : ''}`) }} className={`${btn} border text-slate-700 dark:border-slate-600 dark:text-slate-200`}><Receipt className="h-3.5 w-3.5" /> Charge the client</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {charge && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-900/40">
          <input value={what} onChange={e => setWhat(e.target.value)} className={`${field} min-w-[12rem] flex-1`} />
          <input type="number" min={1} value={amount} onChange={e => setAmount(e.target.value)} placeholder="ETB" className={`${field} w-28 text-right`} />
          <button onClick={() => setCharge(null)} className={`${btn} border text-slate-600 dark:border-slate-600 dark:text-slate-300`}>Cancel</button>
          <button onClick={raise} disabled={busy === 'charge' || !(Number(amount) > 0) || !what.trim()} className={`${btn} bg-brand text-white`}>Raise charge</button>
        </div>
      )}
      {projectId && null}
    </li>
  )
}

function Charges({ charges, onSaved }: { charges: DamageCharge[]; onSaved: () => void }) {
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  async function decide(g: DamageCharge, action: 'approve' | 'waive' | 'invoiced') {
    const note = action === 'waive' ? prompt('Why waive this charge?') : action === 'invoiced' ? prompt('Invoice number or note (optional)') : null
    if (action === 'waive' && !note?.trim()) return
    setBusy(g.id)
    const { error } = await supabase.rpc('damage_charge_decide', { p_id: g.id, p_action: action, p_note: note?.trim() || null })
    setBusy(null)
    if (error) { toast(error.message, 'error'); return }
    toast('Updated', 'success'); onSaved()
  }
  return (
    <Panel title="Damage charges" icon={Receipt} count={charges.length}>
      <ul className="divide-y text-sm dark:divide-slate-700">
        {charges.map(g => (
          <li key={g.id} className="flex flex-wrap items-center gap-2 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-slate-800 dark:text-slate-100">{g.code} · {g.description}</p>
              <p className="text-xs text-slate-500">Raised by {g.raised_by_name ?? '—'} · {fmtDate(g.raised_at)}{g.decision_note ? ` · ${g.decision_note}` : ''}</p>
            </div>
            <span className="font-semibold tabular-nums">{fmtMoney(g.amount)}</span>
            <Pill tone={CHARGE_STATUS[g.status].tone}>{CHARGE_STATUS[g.status].label}</Pill>
            {g.status === 'raised' && (
              <>
                <button onClick={() => decide(g, 'waive')} disabled={busy === g.id} className={`${btn} border text-slate-600 dark:border-slate-600 dark:text-slate-300`}>Waive</button>
                <button onClick={() => decide(g, 'approve')} disabled={busy === g.id} className={`${btn} bg-emerald-600 text-white`}>Approve</button>
              </>
            )}
            {g.status === 'approved' && <button onClick={() => decide(g, 'invoiced')} disabled={busy === g.id} className={`${btn} bg-brand text-white`}>Mark invoiced</button>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-slate-400">Finance approves or waives a charge, then marks it invoiced.</p>
    </Panel>
  )
}
