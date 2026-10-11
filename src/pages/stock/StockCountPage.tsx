import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import { fieldCls } from '@/lib/formStyles'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { ActionDialog } from '@/components/shared/ActionDialog'
import { Panel, Pill, RecordHeader, Stat, type RecordAction } from '@/components/record/Record'
import { printHtml } from '@/lib/leavePrint'
import { stockCountSheetHtml } from '@/lib/stockCountSheet'
import { useUserNames } from '@/lib/attendance'
import { useStockItemsLite } from '@/lib/stockFamilies'
import { Camera, CheckCircle2, Eye, FileText, Keyboard, PackagePlus, Printer, Search, Send, XCircle } from 'lucide-react'

type Via = 'screen' | 'paper' | 'telegram'
interface CountLine {
  id: string; stock_item_id: string; line_no: number | null; system_qty: number; counted_qty: number | null; unit_cost: number | null
  note: string | null; entered_via: Via | null
  stock_items: { item_name: string; amharic_name: string | null; item_code: string | null; unit: string; warehouse_zone: string | null } | null
}
interface Count {
  id: string; code: string; warehouse_zone: string | null; status: string; count_date: string; notes: string | null; posted_at: string | null
  sheet_prints: number; sheet_printed_at: string | null; sheet_printed_by: string | null; paper_counted_by: string | null; paper_photo_path: string | null
}
type Filter = 'all' | 'todo' | 'diff'

const KEEPERS = ['admin', 'executive', 'stock_manager', 'procurement_officer'] // as is_stock_keeper()

/**
 * One count: enter what is on the shelf, see the differences, post them.
 * It can also go round on paper (migration 446): print the numbered sheet,
 * count by hand, then type it in here row for row.
 */
export default function StockCountPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { user, role } = useAuth()
  const keeper = KEEPERS.includes(role ?? '')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [confirm, setConfirm] = useState<null | 'post' | 'cancel'>(null)
  const [busy, setBusy] = useState(false)
  // Typing in a paper sheet: same rows, figures marked as from paper.
  const [paper, setPaper] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [opts, setOpts] = useState({ blind: true, onlyUncounted: false, blankRows: 10 })
  const [adding, setAdding] = useState(false)
  // A line to put the cursor on once it is on the screen (just added, or "Go to #").
  const pendingLine = useRef<number | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const { data: names } = useUserNames()

  const { data: count } = useQuery({
    queryKey: ['stock-count', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_counts').select('*').eq('id', id!).single()
      if (error) throw error
      return data as Count
    },
  })
  const { data: lines = [], isLoading } = useQuery({
    queryKey: ['stock-count-lines', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_count_lines')
        .select('id, stock_item_id, line_no, system_qty, counted_qty, unit_cost, note, entered_via, stock_items(item_name, amharic_name, item_code, unit, warehouse_zone)')
        .eq('count_id', id!)
      if (error) throw error
      return ((data ?? []) as unknown as CountLine[])
        .sort((a, b) => (a.line_no ?? 1e9) - (b.line_no ?? 1e9) || (a.stock_items?.item_name ?? '').localeCompare(b.stock_items?.item_name ?? ''))
    },
  })

  // What has been typed but not saved yet, so the input stays responsive.
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({})
  const open = count?.status === 'counting'

  async function save(l: CountLine, raw: string) {
    const v = raw.trim() === '' ? null : Number(raw)
    if (v != null && (isNaN(v) || v < 0)) { toast('Counts are zero or more', 'error'); return }
    if (v === (l.counted_qty == null ? null : Number(l.counted_qty))) { setDraft(d => { const n = { ...d }; delete n[l.id]; return n }); return }
    const via: Via | null = v == null ? null : paper ? 'paper' : 'screen'
    const { error } = await supabase.from('stock_count_lines')
      .update({ counted_qty: v, counted_at: v == null ? null : new Date().toISOString(), counted_by: user?.id ?? null, entered_via: via })
      .eq('id', l.id)
    if (error) { toast(error.message, 'error'); return }
    qc.setQueryData<CountLine[]>(['stock-count-lines', id], old => old?.map(x => (x.id === l.id ? { ...x, counted_qty: v, entered_via: via } : x)))
    setDraft(d => { const n = { ...d }; delete n[l.id]; return n })
  }
  async function saveNote(l: CountLine, raw: string) {
    const v = raw.trim() || null
    if (v === l.note) return
    const { error } = await supabase.from('stock_count_lines').update({ note: v }).eq('id', l.id)
    if (error) { toast(error.message, 'error'); return }
    qc.setQueryData<CountLine[]>(['stock-count-lines', id], old => old?.map(x => (x.id === l.id ? { ...x, note: v } : x)))
    setNoteDraft(d => { const n = { ...d }; delete n[l.id]; return n })
  }

  const diff = (l: CountLine) => (l.counted_qty == null ? 0 : Number(l.counted_qty) - Number(l.system_qty))
  const counted = lines.filter(l => l.counted_qty != null)
  const different = counted.filter(l => diff(l) !== 0)
  const fromPaper = counted.filter(l => l.entered_via === 'paper').length
  const valueDiff = different.reduce((s, l) => s + diff(l) * Number(l.unit_cost ?? 0), 0)
  const visible = useMemo(() => {
    const t = q.trim().toLowerCase().replace(/^#/, '')
    return lines.filter(l =>
      (filter === 'all' || (filter === 'todo' ? l.counted_qty == null : l.counted_qty != null && diff(l) !== 0))
      && (!t || String(l.line_no) === t || `${l.stock_items?.item_name ?? ''} ${l.stock_items?.amharic_name ?? ''} ${l.stock_items?.item_code ?? ''}`.toLowerCase().includes(t)))
  }, [lines, filter, q])

  // Enter and the arrow keys move between lines, as down a paper sheet.
  function moveFrom(i: number, by: number) {
    const next = document.querySelector<HTMLInputElement>(`input[data-row="${i + by}"]`)
    if (next) { next.focus(); next.select() } else (document.activeElement as HTMLElement | null)?.blur()
  }
  function focusLine(n: number) {
    const el = document.querySelector<HTMLInputElement>(`input[data-line="${n}"]`)
    if (!el) return false
    el.focus(); el.select(); el.scrollIntoView({ block: 'center' })
    return true
  }
  function goToLine(n: number) {
    setFilter('all'); setQ('')
    pendingLine.current = focusLine(n) ? null : n
  }
  useEffect(() => {
    if (pendingLine.current != null && focusLine(pendingLine.current)) pendingLine.current = null
  }, [visible])

  async function post() {
    setBusy(true)
    const { data, error } = await supabase.rpc('post_stock_count', { p_count_id: id! })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(data ? `${data} adjustment${data === 1 ? '' : 's'} booked` : 'Posted — everything matched', 'success')
    setConfirm(null); setPaper(false)
    for (const k of ['stock-count', 'stock-count-lines']) qc.invalidateQueries({ queryKey: [k, id] })
    for (const k of ['stock-counts', 'stock-open-counts', 'stock-levels', 'stock-items', 'stock-catalog']) qc.invalidateQueries({ queryKey: [k] })
  }
  async function cancel() {
    setBusy(true)
    const { error } = await supabase.rpc('cancel_stock_count', { p_count_id: id! })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    setConfirm(null); setPaper(false)
    qc.invalidateQueries({ queryKey: ['stock-count', id] })
    qc.invalidateQueries({ queryKey: ['stock-counts'] })
  }

  async function printSheet() {
    if (!count) return
    const printNo = (count.sheet_prints ?? 0) + 1
    const html = await stockCountSheetHtml(count, lines.map(l => ({
      line_no: l.line_no, item_name: l.stock_items?.item_name ?? '—', amharic_name: l.stock_items?.amharic_name ?? null,
      item_code: l.stock_items?.item_code ?? null, unit: l.stock_items?.unit ?? '', warehouse_zone: l.stock_items?.warehouse_zone ?? null,
      system_qty: Number(l.system_qty), counted_qty: l.counted_qty == null ? null : Number(l.counted_qty), note: l.note,
    })), { ...opts, printNo, url: `${window.location.origin}/stock/counts/${count.id}` })
    if (!printHtml(html)) { toast('Allow pop-ups to print the sheet', 'error'); return }
    setPrinting(false)
    // Each print of an open count is kept, so an old copy can be told apart.
    if (open && keeper) {
      const { error } = await supabase.from('stock_counts')
        .update({ sheet_prints: printNo, sheet_printed_at: new Date().toISOString(), sheet_printed_by: user?.id ?? null }).eq('id', count.id)
      if (error) toast(error.message, 'error')
      qc.invalidateQueries({ queryKey: ['stock-count', id] })
      qc.invalidateQueries({ queryKey: ['stock-counts'] })
    }
  }

  async function saveCounter(raw: string) {
    if (!count) return
    const v = raw.trim() || null
    if (v === count.paper_counted_by) return
    const { error } = await supabase.from('stock_counts').update({ paper_counted_by: v }).eq('id', count.id)
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['stock-count', id] })
  }

  async function uploadPhoto(file: File) {
    if (!count) return
    const path = `stock-counts/${count.code}-${Date.now()}.${file.name.split('.').pop() || 'jpg'}`
    const up = await supabase.storage.from('finance-documents').upload(path, file)
    if (up.error) { toast(up.error.message, 'error'); return }
    const { error } = await supabase.rpc('stock_count_keep_sheet_photo', { p_count_id: count.id, p_path: path })
    if (error) { toast(error.message, 'error'); return }
    qc.invalidateQueries({ queryKey: ['stock-count', id] })
    toast('Photo of the sheet kept with the count', 'success')
  }
  async function viewPhoto() {
    if (!count?.paper_photo_path) return
    const { data, error } = await supabase.storage.from('finance-documents').createSignedUrl(count.paper_photo_path, 300)
    if (error) { toast(error.message, 'error'); return }
    window.open(data.signedUrl, '_blank')
  }

  if (!count) return <p className="py-16 text-center text-sm text-slate-400">Loading…</p>
  const actions: RecordAction[] = [
    { label: `Post ${different.length} difference${different.length === 1 ? '' : 's'}`, icon: CheckCircle2, primary: true, onClick: () => setConfirm('post'), hidden: !open, disabled: counted.length === 0 },
    { label: open ? 'Print count sheet' : 'Print result', icon: Printer, onClick: () => (open ? setPrinting(true) : void printSheet()) },
    { label: paper ? 'Done typing in' : 'Type in from paper', icon: Keyboard, onClick: () => { setPaper(p => !p); setFilter('all'); setQ('') }, hidden: !open || !keeper },
    { label: 'Cancel count', icon: XCircle, danger: true, onClick: () => setConfirm('cancel'), hidden: !open },
  ]
  const cols = paper ? 6 : 5
  const printedBy = count.sheet_printed_by ? names?.get(count.sheet_printed_by) : null

  return (
    <div className="space-y-4">
      <RecordHeader
        back={{ to: '/stock/counts', label: 'Stock counts' }}
        code={count.code}
        title={`Count · ${count.warehouse_zone ?? 'Everything'}`}
        subtitle={`${formatDate(count.count_date)}${count.notes ? ` · ${count.notes}` : ''}`}
        pills={<Pill tone={open ? 'amber' : count.status === 'posted' ? 'green' : 'slate'}>{open ? 'In progress' : count.status === 'posted' ? `Posted ${formatDate(count.posted_at)}` : 'Cancelled'}</Pill>}
        actions={actions}
      />

      <input ref={photoInput} type="file" accept="image/*,application/pdf" capture="environment" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void uploadPhoto(f) }} />

      {(count.sheet_prints > 0 || count.paper_counted_by || count.paper_photo_path || fromPaper > 0) && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <FileText className="h-3.5 w-3.5" />
          {count.sheet_prints > 0 && <span>Sheet printed {count.sheet_prints === 1 ? 'once' : `${count.sheet_prints} times`}, last {formatDateTime(count.sheet_printed_at)}{printedBy ? ` by ${printedBy}` : ''}</span>}
          {count.paper_counted_by && <span>Counted on paper by <b className="text-slate-700 dark:text-slate-200">{count.paper_counted_by}</b></span>}
          {fromPaper > 0 && <span>{fromPaper} figure{fromPaper === 1 ? '' : 's'} typed in from paper</span>}
          {count.paper_photo_path && keeper && <button onClick={viewPhoto} className="inline-flex items-center gap-1 font-medium text-brand hover:underline"><Eye className="h-3.5 w-3.5" /> Photo of the signed sheet</button>}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Counted" value={`${counted.length} of ${lines.length}`} tone={counted.length === lines.length && lines.length ? 'green' : undefined} />
        <Stat label="Different" value={different.length} tone={different.length ? 'amber' : undefined} />
        <Stat label="Short / over" value={`${different.filter(l => diff(l) < 0).length} / ${different.filter(l => diff(l) > 0).length}`} />
        <Stat label="Value of differences" value={formatCurrency(valueDiff)} tone={valueDiff < 0 ? 'red' : valueDiff > 0 ? 'green' : undefined} sub="at average cost" />
      </div>

      {paper && open && (
        <div className="space-y-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900 dark:border-sky-900/50 dark:bg-sky-900/20 dark:text-sky-200">
          <p className="flex gap-2">
            <Keyboard className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <b>Typing in the paper sheet.</b> The # on the paper is the # here. Type the figure and press <b>Enter</b> to go to the next line
              (↑ ↓ move too). A box left empty on paper stays empty here; a written 0 is typed as 0. Remarks go in the last column.
              Things written in the rows at the end: <b>Add an item found on the shelf</b>, then type their figure.
            </span>
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[11px] font-medium text-sky-800 dark:text-sky-300">Counted on paper by
              <input key={count.paper_counted_by ?? ''} defaultValue={count.paper_counted_by ?? ''} onBlur={e => void saveCounter(e.target.value)}
                placeholder="Names on the sheet" className={`${fieldCls} mt-1 w-56 bg-white`} />
            </label>
            <label className="text-[11px] font-medium text-sky-800 dark:text-sky-300">Go to #
              <input type="number" min={1} inputMode="numeric" placeholder="12" className={`${fieldCls} mt-1 w-20 bg-white`}
                onKeyDown={e => { if (e.key === 'Enter') { const n = Number((e.target as HTMLInputElement).value); if (n) goToLine(n) } }} />
            </label>
            <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 rounded-md border border-sky-300 bg-white px-3 py-2 text-xs font-medium text-sky-800 hover:bg-sky-100 dark:border-sky-800 dark:bg-slate-800 dark:text-sky-200">
              <PackagePlus className="h-3.5 w-3.5" /> Add an item found on the shelf
            </button>
            <button onClick={() => photoInput.current?.click()} className="inline-flex items-center gap-1.5 rounded-md border border-sky-300 bg-white px-3 py-2 text-xs font-medium text-sky-800 hover:bg-sky-100 dark:border-sky-800 dark:bg-slate-800 dark:text-sky-200">
              <Camera className="h-3.5 w-3.5" /> {count.paper_photo_path ? 'Replace the photo of the sheet' : 'Photo of the signed sheet'}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] max-w-sm flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find an item or #…"
            className="w-full rounded-md border bg-white py-2 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        {([['all', 'All'], ['todo', 'Not counted'], ['diff', 'Different']] as [Filter, string][]).map(([f, label]) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${filter === f ? 'border-brand bg-brand text-white' : 'border-slate-200 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
            {label}
          </button>
        ))}
        {open && keeper && !paper && (
          <button onClick={() => setAdding(true)} className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300">
            <PackagePlus className="h-3.5 w-3.5" /> Add an item
          </button>
        )}
      </div>

      <Panel padded={false}>
        {isLoading ? <p className="py-10 text-center text-sm text-slate-400">Loading…</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900/40">
                <tr>
                  <th className="w-10 py-2 pl-4 pr-1 text-right font-medium">#</th>
                  <th className="px-3 py-2 text-left font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">System says</th>
                  <th className="px-3 py-2 text-right font-medium">Counted</th>
                  {paper && <th className="px-3 py-2 text-left font-medium">Remark</th>}
                  <th className="px-3 py-2 text-right font-medium">Difference</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700/60">
                {visible.map((l, i) => {
                  const d = diff(l)
                  return (
                    <tr key={l.id} className={d < 0 ? 'bg-red-50/40 dark:bg-red-900/10' : d > 0 ? 'bg-emerald-50/40 dark:bg-emerald-900/10' : ''}>
                      <td className="py-2 pl-4 pr-1 text-right align-top text-xs font-semibold tabular-nums text-slate-400">{l.line_no ?? ''}</td>
                      <td className="px-3 py-2">
                        <Link to={`/stock/${l.stock_item_id}`} className="font-medium text-slate-800 hover:text-brand dark:text-slate-100">{l.stock_items?.item_name ?? '—'}</Link>
                        <p className="text-[11px] text-slate-400">
                          {[l.stock_items?.amharic_name, l.stock_items?.item_code, l.stock_items?.warehouse_zone].filter(Boolean).join(' · ')}
                        </p>
                        {!paper && l.note && <p className="text-[11px] italic text-slate-500">“{l.note}”</p>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{Number(l.system_qty)} {l.stock_items?.unit}</td>
                      <td className="px-3 py-2 text-right">
                        <span className="inline-flex items-center justify-end gap-1.5">
                          <ViaMark via={l.counted_qty == null ? null : l.entered_via} />
                          {open ? (
                            <input type="number" min={0} step="any" inputMode="decimal" aria-label={`Counted, line ${l.line_no ?? ''} ${l.stock_items?.item_name ?? ''}`}
                              data-row={i} data-line={l.line_no ?? undefined}
                              value={draft[l.id] ?? (l.counted_qty ?? '')}
                              onChange={e => setDraft(dr => ({ ...dr, [l.id]: e.target.value }))}
                              onBlur={e => save(l, e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); moveFrom(i, 1) }
                                if (e.key === 'ArrowUp') { e.preventDefault(); moveFrom(i, -1) }
                              }}
                              className={`w-24 rounded-md border px-2 py-1 text-right tabular-nums outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 ${paper && l.counted_qty == null ? 'border-sky-300 bg-sky-50/60' : ''}`} />
                          ) : <span className="tabular-nums">{l.counted_qty ?? '—'}</span>}
                        </span>
                      </td>
                      {paper && (
                        <td className="px-3 py-2">
                          <input value={noteDraft[l.id] ?? (l.note ?? '')} aria-label={`Remark, line ${l.line_no ?? ''}`}
                            onChange={e => setNoteDraft(n => ({ ...n, [l.id]: e.target.value }))}
                            onBlur={e => saveNote(l, e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                            placeholder="—" className="w-40 rounded-md border px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
                        </td>
                      )}
                      <td className={`px-3 py-2 text-right tabular-nums ${d < 0 ? 'font-semibold text-red-600' : d > 0 ? 'font-semibold text-emerald-600' : 'text-slate-300'}`}>
                        {l.counted_qty == null ? '' : d === 0 ? '✓' : `${d > 0 ? '+' : ''}${d}`}
                        {d !== 0 && l.unit_cost ? <span className="block text-[10px] font-normal text-slate-400">{formatCurrency(d * Number(l.unit_cost))}</span> : null}
                      </td>
                    </tr>
                  )
                })}
                {visible.length === 0 && <tr><td colSpan={cols} className="px-4 py-8 text-center text-sm text-slate-400">Nothing here.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {printing && (
        <ActionDialog title="Print the count sheet" confirmLabel="Print" onClose={() => setPrinting(false)} onConfirm={() => void printSheet()}
          description={`Numbered like the screen, so it can be typed in row for row. This will be print no. ${(count.sheet_prints ?? 0) + 1}.`}>
          <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={opts.blind} onChange={e => setOpts(o => ({ ...o, blind: e.target.checked }))} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand" />
            <span>Leave out what the system says<span className="block text-xs text-slate-500">A blind count: people write what is on the shelf, not what they expect to find.</span></span>
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={opts.onlyUncounted} onChange={e => setOpts(o => ({ ...o, onlyUncounted: e.target.checked }))} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand" />
            <span>Only items not counted yet ({lines.length - counted.length})<span className="block text-xs text-slate-500">For a second round, or a sheet for another person.</span></span>
          </label>
          <label className="block text-sm text-slate-700 dark:text-slate-200">Empty rows for things found on the shelf
            <input type="number" min={0} max={40} value={opts.blankRows} onChange={e => setOpts(o => ({ ...o, blankRows: Math.max(0, Math.min(40, Number(e.target.value) || 0)) }))}
              className={`${fieldCls} mt-1 w-24`} />
          </label>
        </ActionDialog>
      )}
      {adding && <AddFoundItem countId={count.id} onLine={lines.map(l => l.stock_item_id)} onClose={() => setAdding(false)}
        onAdded={n => { setAdding(false); goToLine(n); qc.invalidateQueries({ queryKey: ['stock-count-lines', id] }) }} />}
      {confirm === 'post' && (
        <ActionDialog title="Post this count" confirmLabel="Post" busy={busy} onClose={() => setConfirm(null)} onConfirm={post}
          description={`${different.length} difference${different.length === 1 ? '' : 's'} will be booked as adjustments (${formatCurrency(valueDiff)} at average cost). ${lines.length - counted.length ? `${lines.length - counted.length} item${lines.length - counted.length === 1 ? ' was' : 's were'} not counted and stay as they are.` : ''} A posted count can't be changed.`} />
      )}
      {confirm === 'cancel' && (
        <ActionDialog title="Cancel this count" confirmLabel="Cancel count" danger busy={busy} onClose={() => setConfirm(null)} onConfirm={cancel}
          description="Nothing is booked. The counted figures stay on record." />
      )}
    </div>
  )
}

/** How a figure got here, when it wasn't typed on this screen. */
function ViaMark({ via }: { via: Via | null }) {
  if (via === 'paper') return <span title="Typed in from the paper sheet"><FileText className="h-3.5 w-3.5 text-sky-500" /></span>
  if (via === 'telegram') return <span title="Sent on Telegram"><Send className="h-3.5 w-3.5 text-sky-500" /></span>
  return null
}

/** Something on the shelf that isn't on the count: add it, numbered after the last line. */
function AddFoundItem({ countId, onLine, onClose, onAdded }: { countId: string; onLine: string[]; onClose: () => void; onAdded: (lineNo: number) => void }) {
  const { toast } = useToast()
  const { data: items = [] } = useStockItemsLite()
  const [q, setQ] = useState('')
  const [pick, setPick] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const taken = useMemo(() => new Set(onLine), [onLine])
  const t = q.trim().toLowerCase()
  const found = t.length < 2 ? [] : items.filter(i => !i.is_tool && `${i.item_name} ${i.item_code ?? ''}`.toLowerCase().includes(t)).slice(0, 8)
  async function add() {
    if (!pick) return
    setBusy(true)
    const { data, error } = await supabase.rpc('stock_count_add_item', { p_count_id: countId, p_item: pick })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`Added as line ${data}`, 'success')
    onAdded(Number(data))
  }
  return (
    <ActionDialog title="Add an item found on the shelf" confirmLabel="Add to the count" busy={busy} canConfirm={!!pick} onClose={onClose} onConfirm={add}
      description="It goes at the end of the list with the next number, and what the system says about it now. Write that number on the sheet.">
      <input autoFocus value={q} onChange={e => { setQ(e.target.value); setPick(null) }} placeholder="Item name or code…" className={fieldCls} />
      <ul className="max-h-64 divide-y overflow-y-auto rounded-md border dark:divide-slate-700 dark:border-slate-700">
        {found.map(i => {
          const on = taken.has(i.id)
          return (
            <li key={i.id}>
              <button disabled={on} onClick={() => setPick(i.id)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm disabled:opacity-50 ${pick === i.id ? 'bg-brand/10 text-brand' : 'hover:bg-slate-50 dark:hover:bg-slate-700/40'}`}>
                <span className="min-w-0 truncate"><b className="font-medium">{i.item_name}</b> <span className="text-xs text-slate-400">{i.item_code ?? ''} · {i.unit}</span></span>
                {on && <span className="shrink-0 text-[11px] text-slate-400">already on the count</span>}
              </button>
            </li>
          )
        })}
        {t.length >= 2 && found.length === 0 && <li className="px-3 py-3 text-xs text-slate-400">No stock item by that name. Ask for it to be set up in the catalogue first.</li>}
        {t.length < 2 && <li className="px-3 py-3 text-xs text-slate-400">Type at least two letters.</li>}
      </ul>
    </ActionDialog>
  )
}
