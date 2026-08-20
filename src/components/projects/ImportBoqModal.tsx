import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency } from '@/lib/utils'
import { parseBoqExcel, type ParsedBoq } from '@/lib/boqExcelParser'
import { Upload, AlertTriangle, X, FileSpreadsheet } from 'lucide-react'

const inputCls = 'w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand focus:border-brand dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'

interface Props {
  projectId: string
  defaultTitle: string
  replaceBoqId?: string | null
  onClose: () => void
  onImported: (boqId: string) => void
}

export function ImportBoqModal({ projectId, defaultTitle, replaceBoqId, onClose, onImported }: Props) {
  const { toast } = useToast()
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed] = useState<ParsedBoq | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [title, setTitle] = useState(defaultTitle)
  const [importing, setImporting] = useState(false)

  async function handleFile(file: File) {
    setFileName(file.name)
    setParsed(null)
    setParseError(null)
    setParsing(true)
    try {
      const buf = await file.arrayBuffer()
      const result = await parseBoqExcel(buf)
      setParsed(result)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Failed to parse this file')
    } finally {
      setParsing(false)
    }
  }

  async function handleImport() {
    if (!parsed) return
    if (!title.trim()) { toast('A title is required', 'error'); return }
    setImporting(true)
    const tree = parsed.nodes.map(n => ({
      client_key: n.client_key,
      parent_client_key: n.parent_client_key,
      node_type: n.node_type,
      name: n.name,
      notes: n.notes,
      unit: n.unit,
      quantity: n.quantity,
      unit_rate_etb: n.unit_rate_etb,
      total_etb: n.total_etb,
      is_priced_elsewhere: n.is_priced_elsewhere,
      display_order: n.display_order,
    }))
    const { data, error } = await supabase.rpc('create_boq_from_parsed_tree', {
      p_project_id: projectId, p_title: title.trim(), p_tree: tree, p_replace_boq_id: replaceBoqId ?? null,
    })
    setImporting(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`Imported ${parsed.nodes.length} item(s)`, 'success')
    onImported(data as string)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-2xl rounded-xl bg-white dark:bg-slate-800 p-5 shadow-xl space-y-3 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <FileSpreadsheet className="h-4 w-4" /> Import BOQ from Excel
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="h-4 w-4" /></button>
        </div>

        {!parsed && !parsing && (
          <label className="flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed dark:border-slate-600 p-8 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40">
            <Upload className="h-6 w-6 text-slate-400" />
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {fileName ? `Re-select a file (last: ${fileName})` : 'Click to choose an .xlsx file'}
            </span>
            <input type="file" accept=".xlsx" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
          </label>
        )}

        {parsing && <div className="py-8 text-center text-sm text-slate-400">Parsing {fileName}…</div>}

        {parseError && (
          <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{parseError}</span>
          </div>
        )}

        {parsed && (
          <>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">BOQ Title</label>
              <input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} />
            </div>

            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="rounded-md border dark:border-slate-700 p-2.5">
                <p className="text-slate-400">File's declared total (itemized section only)</p>
                <p className="font-semibold text-slate-700 dark:text-slate-200">
                  {parsed.declaredGrandTotal != null ? formatCurrency(parsed.declaredGrandTotal) : '—'}
                </p>
              </div>
              <div className={`rounded-md border p-2.5 ${itemizedGapIsSignificant(parsed) ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/10' : 'dark:border-slate-700'}`}>
                <p className="text-slate-400">Parsed itemized total (same scope)</p>
                <p className="font-semibold text-slate-700 dark:text-slate-200">{formatCurrency(itemizedTotal(parsed))}</p>
              </div>
              <div className="rounded-md border dark:border-slate-700 p-2.5">
                <p className="text-slate-400">Full parsed total (incl. lump sums)</p>
                <p className="font-semibold text-slate-700 dark:text-slate-200">{formatCurrency(parsed.computedGrandTotal)}</p>
              </div>
            </div>

            {(parsed.warnings.length > 0 || parsed.skippedRows.length > 0) && (
              <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 space-y-1.5 text-xs text-amber-800 dark:text-amber-300 max-h-32 overflow-y-auto">
                {parsed.warnings.map((w, i) => (
                  <p key={`w${i}`} className="flex items-start gap-1.5"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />{w}</p>
                ))}
                {parsed.skippedRows.map((s, i) => (
                  <p key={`s${i}`} className="pl-5">Row {s.row}: {s.reason}</p>
                ))}
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto border rounded-md dark:border-slate-700 divide-y dark:divide-slate-800 text-xs">
              {parsed.nodes.map(n => (
                <div key={n.client_key} className="flex items-center justify-between px-2.5 py-1.5" style={{ paddingLeft: `${8 + (n.depth - 1) * 14}px` }}>
                  <span className={`truncate ${n.node_type === 'section' ? 'font-semibold text-slate-700 dark:text-slate-200' : 'text-slate-600 dark:text-slate-300'}`}>
                    {n.name}
                    {n.is_priced_elsewhere && <span className="ml-1.5 text-[10px] text-amber-600 dark:text-amber-400">(priced elsewhere)</span>}
                  </span>
                  {n.node_type !== 'section' && (
                    <span className="shrink-0 text-slate-400">
                      {n.node_type === 'line_item' && !n.is_priced_elsewhere ? `${n.quantity} ${n.unit ?? ''} × ${formatCurrency(n.unit_rate_etb ?? 0)} = ` : ''}
                      {formatCurrency(n.total_etb ?? 0)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-md px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
          {parsed && (
            <button onClick={handleImport} disabled={importing}
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60">
              {importing ? 'Importing…' : `Import ${parsed.nodes.length} Item${parsed.nodes.length === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function itemizedTotal(p: ParsedBoq): number {
  return p.nodes.filter(n => n.node_type === 'line_item').reduce((sum, n) => sum + (n.total_etb ?? 0), 0)
}

function itemizedGapIsSignificant(p: ParsedBoq): boolean {
  if (p.declaredGrandTotal == null) return false
  return Math.abs(itemizedTotal(p) - p.declaredGrandTotal) > 1
}
