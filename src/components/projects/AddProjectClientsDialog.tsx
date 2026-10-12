import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileSpreadsheet, Users, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { fieldCls } from '@/lib/formStyles'
import { useToast } from '@/contexts/ToastContext'

// Adding the clients who each pay their own part of a project (migration
// 447), e.g. the exhibitors of an event: paste the rows from Excel or open
// the file, check who is already on file, then add them all at once. Each
// becomes (or stays) a client and gets a numbered draft contract under the
// project; running it again with the same list adds nothing twice.

interface Row {
  name: string
  tin: string
  phone: string
  email: string
  amount: string
  wht: boolean
  paid: boolean | null
  include: boolean
  /** The client on file to use; null for a new one. */
  clientId: string | null
  match: { id: string; name: string; how: 'same' | 'similar' } | null
  dupOf: number | null
}

type Col = 'name' | 'tin' | 'phone' | 'email' | 'amount' | 'wht' | 'paid' | 'skip'

// Header words → what the column holds.
function colOf(header: string): Col {
  const h = header.trim().toLowerCase()
  if (!h || /^(no\.?|#|s\.?\s?no\.?|sn)$/.test(h)) return 'skip'
  if (/withhold|wht|\btype\b/.test(h)) return 'wht'
  if (/\btin\b|tax id|taxpayer/.test(h)) return 'tin'
  if (/phone|tel|mobile|contact/.test(h)) return 'phone'
  if (/mail/.test(h)) return 'email'
  if (/amount|price|fee|total|value|etb|birr/.test(h)) return 'amount'
  if (/paid|payment|status/.test(h)) return 'paid'
  if (/name|organi[sz]ation|institution|company|client|exhibitor/.test(h)) return 'name'
  return 'skip'
}

/** The name as the database compares it (client_name_key, migration 447). */
function nameKey(s: string) {
  return s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(s ?c|share company|plc|p l c|s ?a|inc|ltd|limited|the)\b/g, ' ').replace(/\s+/g, ' ').trim()
}

function toRows(grid: string[][]): Row[] {
  const lines = grid.map(r => r.map(c => (c ?? '').toString().trim())).filter(r => r.some(Boolean))
  if (!lines.length) return []
  let cols = lines[0].map(colOf)
  let body = lines
  if (cols.includes('name')) body = lines.slice(1)
  else {
    // No header row: the first column with letters in it is the name.
    const first = lines[0].findIndex(c => /[a-z]/i.test(c))
    cols = lines[0].map((_, i) => (i === first ? 'name' : 'skip'))
  }
  const at = (r: string[], c: Col) => { const i = cols.indexOf(c); return i < 0 ? '' : (r[i] ?? '') }
  const seen = new Map<string, number>()
  const out: Row[] = []
  for (const r of body) {
    const name = at(r, 'name').replace(/\s+/g, ' ').trim()
    if (!name) continue
    const k = nameKey(name)
    const dupOf = seen.has(k) ? seen.get(k)! : null
    if (dupOf == null) seen.set(k, out.length)
    const paidRaw = at(r, 'paid').toLowerCase()
    out.push({
      name, tin: at(r, 'tin'), phone: at(r, 'phone'), email: at(r, 'email'),
      amount: at(r, 'amount').replace(/[^0-9.]/g, ''),
      wht: /withhold|yes|true|✓|wht/i.test(at(r, 'wht')),
      paid: cols.includes('paid') ? /paid/.test(paidRaw) && !/unpaid|not/.test(paidRaw) : null,
      include: dupOf == null, clientId: null, match: null, dupOf,
    })
  }
  return out
}

async function readWorkbook(file: File): Promise<{ name: string; grid: string[][] }[]> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  return wb.worksheets.map(ws => {
    const grid: string[][] = []
    ws.eachRow({ includeEmpty: false }, row => {
      const cells: string[] = []
      for (let i = 1; i <= ws.columnCount; i++) cells.push(row.getCell(i).text ?? '')
      grid.push(cells)
    })
    return { name: ws.name, grid }
  })
}

export function AddProjectClientsDialog({ projectId, projectName, onClose }: { projectId: string; projectName: string; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [pasted, setPasted] = useState('')
  const [sheets, setSheets] = useState<{ name: string; grid: string[][] }[]>([])
  const [sheet, setSheet] = useState(0)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [includesVat, setIncludesVat] = useState(true)
  const [scope, setScope] = useState(`Participation in ${projectName}: the client's own portion of the work, as registered.`)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  async function openFile(f: File) {
    try {
      const s = await readWorkbook(f)
      setSheets(s); setSheet(0)
      await check(toRows(s[0]?.grid ?? []))
    } catch (e) {
      toast(`Couldn't read that file: ${(e as Error).message}`, 'error')
    }
  }

  // Who is already on file: same name (used as is) or a close spelling
  // (offered, never assumed).
  async function check(list: Row[]) {
    setChecking(true)
    const { data, error } = await supabase.rpc('client_matches', { p_names: list.map(r => r.name) })
    setChecking(false)
    if (error) { toast(error.message, 'error'); setRows(list); return }
    const found = (data ?? []) as { idx: number; client_id: string | null; client_name: string | null; how: 'same' | 'similar' | null }[]
    setRows(list.map((r, i) => {
      const m = found.find(f => f.idx === i + 1)
      if (!m?.client_id) return r
      const match = { id: m.client_id, name: m.client_name ?? '', how: m.how ?? 'similar' }
      return { ...r, match, clientId: match.how === 'same' ? match.id : null }
    }))
  }

  function patch(i: number, p: Partial<Row>) { setRows(rs => rs && rs.map((r, j) => (j === i ? { ...r, ...p } : r))) }

  const chosen = (rows ?? []).filter(r => r.include)
  const counts = useMemo(() => ({
    onFile: chosen.filter(r => r.clientId).length,
    fresh: chosen.filter(r => !r.clientId).length,
    unsure: chosen.filter(r => !r.clientId && r.match?.how === 'similar').length,
  }), [chosen])

  async function add() {
    if (!chosen.length) return
    setBusy(true)
    const payload = chosen.map(r => ({
      name: r.name, client_id: r.clientId, tin: r.tin || null, phone: r.phone || null, email: r.email || null,
      amount: r.amount || null, includes_vat: includesVat, wht: r.wht, scope: scope.trim() || null,
      note: [r.paid === true ? 'Marked paid on the registration list' : r.paid === false ? 'Not marked paid on the registration list' : null,
        r.wht ? 'withholds tax' : null].filter(Boolean).join('; ') || null,
    }))
    const { data, error } = await supabase.rpc('project_add_clients', { p_project_id: projectId, p_rows: payload })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    const res = (data ?? []) as { client: string; contract: string }[]
    const made = res.filter(x => x.client === 'new').length
    const contracts = res.filter(x => x.contract === 'new').length
    toast(`${res.length} client${res.length === 1 ? '' : 's'} on ${projectName}: ${made} new, ${contracts} new contract${contracts === 1 ? '' : 's'}`, 'success')
    for (const k of ['project-clients', 'project-clients-extra', 'sales-engagements', 'clients', 'contracts', 'project-workspace', 'project-contract']) qc.invalidateQueries({ queryKey: [k] })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label="Add paying clients"
        className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-slate-800 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4 dark:border-slate-700">
          <div>
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">Add the clients who pay their own part</h2>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              Each one becomes a client of its own with a draft contract under <b>{projectName}</b>. Clients already on file are reused, and nobody is added twice.
            </p>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {!rows ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <input ref={fileInput} type="file" accept=".xlsx" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void openFile(f) }} />
                <button onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200">
                  <FileSpreadsheet className="h-4 w-4" /> Open an Excel file
                </button>
                <span className="text-xs text-slate-400">or paste the rows below, with their header row</span>
              </div>
              <textarea value={pasted} onChange={e => setPasted(e.target.value)} rows={10}
                placeholder={'Organization\tTIN\tPhone\tAmount\tType\nAwash Bank S.C.\t0000012345\t0911163163\t150000\tWithholding'}
                className={`${fieldCls} font-mono text-xs`} />
              <p className="text-xs text-slate-500">
                Columns are recognised by their heading: name / organization, TIN, phone, amount / price, "Withholding", payment status. Only the name is required.
              </p>
            </>
          ) : (
            <>
              {sheets.length > 1 && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-slate-500">Sheet</span>
                  {sheets.map((s, i) => (
                    <button key={s.name} onClick={() => { setSheet(i); void check(toRows(s.grid)) }}
                      className={`rounded-full border px-3 py-1 font-medium ${sheet === i ? 'border-brand bg-brand text-white' : 'border-slate-200 text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
                      {s.name} ({toRows(s.grid).length})
                    </button>
                  ))}
                </div>
              )}
              <p className="text-sm text-slate-600 dark:text-slate-300">
                <b>{chosen.length}</b> to add: {counts.onFile} already on file, {counts.fresh} new
                {counts.unsure > 0 && <span className="text-amber-600"> · {counts.unsure} look like a client on file — tick "same" if so</span>}
                {checking && <span className="text-slate-400"> · checking…</span>}
              </p>
              <div className="overflow-x-auto rounded-lg border dark:border-slate-700">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900/40">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">Add</th>
                      <th className="px-2 py-1.5 text-left font-medium">Name</th>
                      <th className="px-2 py-1.5 text-left font-medium">On file</th>
                      <th className="px-2 py-1.5 text-left font-medium">TIN</th>
                      <th className="px-2 py-1.5 text-left font-medium">Phone</th>
                      <th className="px-2 py-1.5 text-right font-medium">Amount</th>
                      <th className="px-2 py-1.5 text-center font-medium">Withholds</th>
                      <th className="px-2 py-1.5 text-left font-medium">Paid?</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-slate-700/60">
                    {rows.map((r, i) => (
                      <tr key={i} className={r.include ? '' : 'opacity-50'}>
                        <td className="px-2 py-1"><input type="checkbox" checked={r.include} onChange={e => patch(i, { include: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-brand" /></td>
                        <td className="px-2 py-1">
                          <input value={r.name} onChange={e => patch(i, { name: e.target.value })} className="w-56 rounded border px-1.5 py-1 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
                          {r.dupOf != null && <span className="block text-[10px] text-amber-600">Twice in the list (row {r.dupOf + 1})</span>}
                        </td>
                        <td className="px-2 py-1">
                          {r.match?.how === 'same' ? <span className="text-emerald-700 dark:text-emerald-400">✓ {r.match.name}</span>
                            : r.match ? (
                              <label className="flex items-center gap-1 text-amber-700 dark:text-amber-400" title="A close spelling of a client on file. Tick it if it is the same organisation.">
                                <input type="checkbox" checked={r.clientId === r.match.id} onChange={e => patch(i, { clientId: e.target.checked ? r.match!.id : null })} className="h-3.5 w-3.5 rounded border-slate-300" />
                                same as {r.match.name}?
                              </label>
                            ) : <span className="text-slate-400">new</span>}
                        </td>
                        <td className="px-2 py-1"><input value={r.tin} onChange={e => patch(i, { tin: e.target.value })} className="w-28 rounded border px-1.5 py-1 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" /></td>
                        <td className="px-2 py-1"><input value={r.phone} onChange={e => patch(i, { phone: e.target.value })} className="w-28 rounded border px-1.5 py-1 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" /></td>
                        <td className="px-2 py-1 text-right"><input value={r.amount} inputMode="decimal" onChange={e => patch(i, { amount: e.target.value.replace(/[^0-9.]/g, '') })} className="w-24 rounded border px-1.5 py-1 text-right tabular-nums dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" /></td>
                        <td className="px-2 py-1 text-center"><input type="checkbox" checked={r.wht} onChange={e => patch(i, { wht: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-brand" /></td>
                        <td className="px-2 py-1 text-slate-500">{r.paid === true ? 'paid' : r.paid === false ? '—' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-3 sm:grid-cols-[auto,1fr] sm:items-start">
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <input type="checkbox" checked={includesVat} onChange={e => setIncludesVat(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand" />
                  Amounts include VAT
                </label>
                <label className="block text-xs font-medium text-slate-500">Scope written on each contract
                  <textarea value={scope} onChange={e => setScope(e.target.value)} rows={2} className={`${fieldCls} mt-1`} />
                </label>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-5 py-3 dark:border-slate-700">
          {rows ? <button onClick={() => { setRows(null); setSheets([]) }} disabled={busy} className="text-sm text-slate-500 hover:underline">← Start again</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} disabled={busy} className="rounded-md border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">Cancel</button>
            {rows ? (
              <button onClick={add} disabled={busy || !chosen.length} className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                <Users className="h-4 w-4" /> {busy ? 'Adding…' : `Add ${chosen.length} client${chosen.length === 1 ? '' : 's'}`}
              </button>
            ) : (
              <button onClick={() => void check(toRows(pasted.split(/\r?\n/).map(l => l.split('\t'))))} disabled={!pasted.trim() || checking}
                className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                {checking ? 'Checking…' : 'Check the list'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
