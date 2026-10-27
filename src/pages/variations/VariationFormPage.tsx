import { useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { FormPage } from '@/components/shared/FormPage'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { useProjects } from '@/hooks/useLookups'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency as fmtMoney } from '@/lib/utils'
import { useVariation, useVoSettings, VO_ORIGIN, type Variation, type VariationLine, type VoOrigin } from '@/lib/variations'
import { Plus, Trash2 } from 'lucide-react'

const formatCurrency = (n: number) => fmtMoney(n).replace(/\.00$/, '')

// Recording a variation: what changed, who asked and when, and its price as
// a few lines (a fixed price is one line of 1 lot; a negative rate takes work
// out). It can be saved unpriced — "to price" — so nothing waits on the
// number (migration 459).

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'
const cellCls = 'w-full rounded-md border px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{label}{hint && <span className="font-normal text-slate-400"> — {hint}</span>}</label>
      {children}
    </div>
  )
}

interface DraftLine { key: string; description: string; quantity: string; unit: string; rate: string }
let seq = 0
const blank = (): DraftLine => ({ key: `n${++seq}`, description: '', quantity: '1', unit: 'lot', rate: '' })

export default function VariationFormPage() {
  const { id } = useParams<{ id: string }>()
  const { data, isLoading } = useVariation(id)
  if (id && isLoading) return <FormPage title="Edit variation" backTo={`/variations/${id}`} loading onSave={() => {}} />
  return <Body id={id} vo={data?.vo} lines={data?.lines ?? []} />
}

function Body({ id, vo, lines }: { id?: string; vo?: Variation; lines: VariationLine[] }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data: projects = [] } = useProjects()
  const { data: settings } = useVoSettings()
  const projectOptions = useMemo(() => (projects as { id: string; project_name: string }[]).map(p => ({ id: p.id, label: p.project_name })), [projects])

  const [projectId, setProjectId] = useState<string | null>(vo?.project_id ?? params.get('project'))
  const [title, setTitle] = useState(vo?.title ?? '')
  const [description, setDescription] = useState(vo?.description ?? '')
  const [origin, setOrigin] = useState<VoOrigin>(vo?.origin ?? 'client')
  const [instructedBy, setInstructedBy] = useState(vo?.instructed_by ?? '')
  const [instructedOn, setInstructedOn] = useState(vo?.instructed_on ?? new Date().toISOString().slice(0, 10))
  const [days, setDays] = useState(vo ? String(vo.time_extension_days || '') : '')
  const [late, setLate] = useState(vo?.recorded_late ?? false)
  const [draft, setDraft] = useState<DraftLine[]>(lines.length
    ? lines.map(l => ({ key: l.id, description: l.description, quantity: String(l.quantity), unit: l.unit, rate: String(l.rate) }))
    : [blank()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const priced = draft.filter(l => l.description.trim() && l.rate.trim() !== '')
  const subtotal = priced.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.rate) || 0), 0)
  const vatRate = vo?.vat_rate ?? settings?.vat_rate ?? 0.15
  const setLine = (key: string, patch: Partial<DraftLine>) => setDraft(d => d.map(l => (l.key === key ? { ...l, ...patch } : l)))

  async function save() {
    setError('')
    if (!projectId) { setError('Choose the project'); return }
    if (!title.trim()) { setError('Say what the variation is'); return }
    const half = draft.find(l => l.description.trim() && l.rate.trim() === '')
    if (half) { setError(`"${half.description}" needs a rate — or leave the whole price empty to price it later`); return }
    setSaving(true)
    const { data: saved, error: err } = await supabase.rpc('save_variation', {
      p_id: id ?? null,
      p_vo: {
        project_id: projectId, title: title.trim(), description: description.trim(), origin, instructed_by: instructedBy.trim(),
        instructed_on: instructedOn, time_extension_days: days ? parseInt(days, 10) : 0, recorded_late: late,
      },
      p_lines: priced.map(l => ({ description: l.description.trim(), quantity: parseFloat(l.quantity) || 1, unit: l.unit.trim() || 'lot', rate: parseFloat(l.rate) })),
    })
    setSaving(false)
    if (err) { setError(err.message); toast(err.message, 'error'); return }
    for (const k of ['variations', 'variation', 'contract-sum']) qc.invalidateQueries({ queryKey: [k] })
    toast(priced.length ? 'Variation saved — submit it when the price is right' : 'Variation recorded — price it when you can', 'success')
    navigate(`/variations/${saved as string}`)
  }

  return (
    <FormPage title={id ? `Edit ${vo?.vo_code ?? 'variation'}` : 'New variation'} backTo={id ? `/variations/${id}` : '/variations'} error={error} saving={saving}
      saveLabel={id ? 'Save changes' : 'Record variation'} onSave={save}>
      <Field label="Project *">
        <SearchableSelect value={projectId} onChange={setProjectId} options={projectOptions} placeholder="Which project…" disabled={!!id} />
      </Field>
      <Field label="What changed *" hint="one line">
        <input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} maxLength={160} placeholder="e.g. Move the kitchen island 1 m and add two socket points" />
      </Field>
      <Field label="Details" hint="what the client asked, drawings, anything the addendum should say">
        <textarea rows={3} className={inputCls} value={description} onChange={e => setDescription(e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Who asked">
          <select className={inputCls} value={origin} onChange={e => setOrigin(e.target.value as VoOrigin)}>
            {(Object.keys(VO_ORIGIN) as VoOrigin[]).filter(o => o !== 'site_report' || origin === 'site_report').map(o => <option key={o} value={o}>{VO_ORIGIN[o]}</option>)}
          </select>
        </Field>
        <Field label="Their name">
          <input className={inputCls} value={instructedBy} onChange={e => setInstructedBy(e.target.value)} placeholder="e.g. Ato Bereket, client rep" />
        </Field>
        <Field label="Instructed on">
          <input type="date" className={inputCls} value={instructedOn} onChange={e => setInstructedOn(e.target.value)} />
        </Field>
      </div>

      <div>
        <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Price</span>
          <span className="text-[11px] text-slate-400">qty × rate, before VAT — a fixed price is one line of 1 lot; a negative rate takes work out. Leave empty to price later.</span>
        </div>
        <div className="overflow-hidden rounded-lg border dark:border-slate-700">
          <ul className="divide-y dark:divide-slate-700/60">
            {draft.map((l, n) => {
              const amt = (parseFloat(l.quantity) || 0) * (parseFloat(l.rate) || 0)
              return (
                <li key={l.key} className="grid grid-cols-[1fr_1fr_1fr_2rem] gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_5rem_5rem_7rem_7rem_2rem] sm:items-center">
                  <input className={`${cellCls} col-span-4 sm:col-span-1`} value={l.description} onChange={e => setLine(l.key, { description: e.target.value })} placeholder={n === 0 ? 'e.g. Socket point, supply and fix' : 'Description'} aria-label={`Line ${n + 1}`} />
                  <input type="number" inputMode="decimal" step="any" min={0} className={`${cellCls} text-right`} value={l.quantity} onChange={e => setLine(l.key, { quantity: e.target.value })} aria-label="Quantity" />
                  <input className={cellCls} value={l.unit} onChange={e => setLine(l.key, { unit: e.target.value })} aria-label="Unit" />
                  <input type="number" inputMode="decimal" step="any" className={`${cellCls} text-right`} value={l.rate} onChange={e => setLine(l.key, { rate: e.target.value })} placeholder="Rate" aria-label="Rate" />
                  <span className={`col-span-3 text-sm font-semibold tabular-nums sm:col-span-1 sm:text-right ${amt < 0 ? 'text-red-600' : 'text-slate-800 dark:text-slate-100'}`}>{formatCurrency(amt)}</span>
                  <button type="button" onClick={() => setDraft(d => (d.length > 1 ? d.filter(x => x.key !== l.key) : [blank()]))} className="justify-self-end rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove line"><Trash2 className="h-4 w-4" /></button>
                </li>
              )
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900/40">
            <button type="button" onClick={() => setDraft(d => [...d, { ...blank(), quantity: '', unit: '' }])} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"><Plus className="h-3.5 w-3.5" /> Add line</button>
            <span className="text-slate-600 dark:text-slate-300">
              {formatCurrency(subtotal)} + VAT {Math.round(vatRate * 100)}% = <b className="text-slate-900 dark:text-white">{formatCurrency(subtotal * (1 + vatRate))}</b>
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Extra time" hint="days added to completion">
          <input type="number" min={0} className={inputCls} value={days} onChange={e => setDays(e.target.value)} placeholder="0" />
        </Field>
        <label className="flex items-start gap-2 self-end rounded-lg border px-3 py-2 text-sm dark:border-slate-700">
          <input type="checkbox" className="mt-0.5" checked={late} onChange={e => setLate(e.target.checked)} />
          <span><b>Recorded late</b><span className="block text-xs text-slate-500">The work was done before anyone recorded it — e.g. found when collecting.</span></span>
        </label>
      </div>
    </FormPage>
  )
}
