import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { fieldCls } from '@/lib/formStyles'
import { useToast } from '@/contexts/ToastContext'
import { useProjects, useStaffDirectory } from '@/hooks/useLookups'
import { useStockMatches, type StockMatch } from '@/lib/stockMatch'
import { StockNameInput } from '@/components/stock/StockNameInput'
import { SearchableSelect } from '@/components/shared/SearchableSelect'
import { Panel } from '@/components/record/Record'
import { ArrowLeft, Send, Trash2, AlertTriangle, Package } from 'lucide-react'

// Issue several items from the warehouse to one project at once. Each line
// is costed at the item's average cost (issue_stock_to_project, migration
// 364), and the warehouse can't be driven below zero unless you say so.

interface Line { id: string; name: string; code: string | null; unit: string; have: number; qty: string }

export default function StockIssuePage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { data: projects = [] } = useProjects()
  const { data: staff = [] } = useStaffDirectory()

  const [projectId, setProjectId] = useState<string | null>(params.get('project'))
  const [to, setTo] = useState<string | null>(null)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [search, setSearch] = useState('')
  const [allowShort, setAllowShort] = useState(false)
  const [saving, setSaving] = useState(false)
  const { data: matches = [], isFetching } = useStockMatches(search, { limit: 8 })

  // Opened from an item's page (?item=) or with several picked on the stock
  // page (?items=a,b,c): start with those items.
  const preset = useMemo(() => [...new Set([params.get('item'), ...(params.get('items') ?? '').split(',')].filter(Boolean))] as string[], [params])
  const { data: presetItems } = useQuery({
    queryKey: ['stock-issue-preset', preset.join(',')],
    enabled: preset.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from('v_stock_item_usage').select('id, item_name, item_code, unit, qty_on_hand').in('id', preset)
      return (data ?? []) as { id: string; item_name: string; item_code: string | null; unit: string; qty_on_hand: number }[]
    },
  })
  const [presetUsed, setPresetUsed] = useState(false)
  if (presetItems && !presetUsed) {
    setPresetUsed(true)
    const order = new Map(preset.map((id, i) => [id, i]))
    setLines([...presetItems].sort((x, y) => (order.get(x.id) ?? 0) - (order.get(y.id) ?? 0))
      .map(p => ({ id: p.id, name: p.item_name, code: p.item_code, unit: p.unit, have: Number(p.qty_on_hand ?? 0), qty: '' })))
  }

  function add(m: StockMatch) {
    setSearch('')
    if (lines.some(l => l.id === m.id)) { toast(`${m.item_name} is already on the list`, 'info'); return }
    setLines(ls => [...ls, { id: m.id, name: m.item_name, code: m.item_code, unit: m.unit, have: Number(m.qty_on_hand ?? 0), qty: '' }])
  }
  const set = (id: string, qty: string) => setLines(ls => ls.map(l => (l.id === id ? { ...l, qty } : l)))

  const short = lines.filter(l => Number(l.qty) > l.have)
  const ready = !!projectId && lines.length > 0 && lines.every(l => Number(l.qty) > 0) && (short.length === 0 || allowShort)
  const projectOptions = useMemo(() => projects.map((p: { id: string; project_name: string }) => ({ id: p.id, label: p.project_name })), [projects])
  const staffOptions = useMemo(() => staff.map((s: { id: string; employee_name: string; trade_tag?: string | null }) => ({ id: s.id, label: s.employee_name, sub: s.trade_tag ?? '' })), [staff])

  async function submit() {
    if (!ready) return
    setSaving(true)
    const { data, error } = await supabase.rpc('issue_stock_to_project', {
      p_project_id: projectId,
      p_lines: lines.map(l => ({ stock_item_id: l.id, quantity: Number(l.qty) })),
      p_issue_date: date,
      p_issued_to_staff_id: to,
      p_notes: notes.trim() || null,
      p_allow_short: allowShort,
    })
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    for (const k of ['stock-levels', 'stock-items', 'stock-catalog', 'stock-issues', 'stock-item-brief']) qc.invalidateQueries({ queryKey: [k] })
    toast(`${data} item${data === 1 ? '' : 's'} issued to ${projectOptions.find(p => p.id === projectId)?.label ?? 'the project'}`, 'success')
    navigate(lines.length === 1 ? `/stock/${lines[0].id}` : '/stock')
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to="/stock" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"><ArrowLeft className="h-4 w-4" /> Stock</Link>
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Issue stock to a project</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Everything leaving the warehouse for one project, in one go. Each line is costed at the item's average price.</p>
      </div>

      <Panel>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-slate-500">Project *
            <div className="mt-1"><SearchableSelect value={projectId} onChange={setProjectId} options={projectOptions} placeholder="Which project is it going to?" /></div>
          </label>
          <label className="block text-xs font-medium text-slate-500">Handed to
            <div className="mt-1"><SearchableSelect value={to} onChange={setTo} options={staffOptions} placeholder="Who is taking it (optional)" /></div>
          </label>
          <label className="block text-xs font-medium text-slate-500">Date
            <input type="date" className={`${fieldCls} mt-1`} value={date} onChange={e => setDate(e.target.value)} />
          </label>
          <label className="block text-xs font-medium text-slate-500">Note
            <input className={`${fieldCls} mt-1`} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. delivery note number, vehicle" />
          </label>
        </div>
      </Panel>

      <Panel title="Items" icon={Package} count={lines.length} padded={false}
        action={lines.some(l => !l.qty && l.have > 0) ? (
          <button onClick={() => setLines(ls => ls.map(l => (l.qty || l.have <= 0 ? l : { ...l, qty: String(l.have) })))} className="text-xs font-medium text-brand hover:underline">
            Fill in all that is held
          </button>
        ) : undefined}>
        <div className="border-b px-4 py-3 dark:border-slate-700">
          <StockNameInput value={search} onChange={setSearch} matches={matches} loading={isFetching} onPick={add}
            placeholder="Find an item to add — name or code" className={fieldCls} />
        </div>
        {lines.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">Add the items going out.</p>
        ) : (
          <ul className="divide-y dark:divide-slate-700/60">
            {lines.map(l => {
              const over = Number(l.qty) > l.have
              return (
                <li key={l.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{l.name}{l.code && <span className="ml-1.5 font-mono text-[11px] text-slate-400">{l.code}</span>}</p>
                    <p className={`text-xs ${l.have <= 0 ? 'text-red-600' : 'text-slate-500'}`}>{l.have} {l.unit} in the warehouse</p>
                    {over && <p className="flex items-center gap-1 text-[11px] text-red-600"><AlertTriangle className="h-3 w-3" /> More than the warehouse holds</p>}
                  </div>
                  <input type="number" min={0} step="any" inputMode="decimal" value={l.qty} onChange={e => set(l.id, e.target.value)} aria-label={`Quantity of ${l.name}`}
                    className={`w-24 rounded-md border px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:ring-2 focus:ring-brand dark:bg-slate-900 dark:text-slate-100 ${over ? 'border-red-300' : 'dark:border-slate-600'}`} />
                  <span className="w-12 text-xs text-slate-400">{l.unit}</span>
                  <button onClick={() => setLines(ls => ls.filter(x => x.id !== l.id))} aria-label={`Remove ${l.name}`} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      {short.length > 0 && (
        <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/15 dark:text-amber-300">
          <input type="checkbox" checked={allowShort} onChange={e => setAllowShort(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-amber-300" />
          <span>{short.length} line{short.length === 1 ? ' asks' : 's ask'} for more than the system says is in the warehouse. Issue anyway (the stock goes below zero until it is counted).</span>
        </label>
      )}

      <div className="flex items-center justify-end gap-3">
        <span className="text-xs text-slate-400">{lines.length ? `${lines.filter(l => Number(l.qty) > 0).length} of ${lines.length} lines ready` : ''}</span>
        <button onClick={submit} disabled={!ready || saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50">
          <Send className="h-4 w-4" /> {saving ? 'Issuing…' : 'Issue to project'}
        </button>
      </div>
    </div>
  )
}
