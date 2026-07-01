import { useState, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Trash2, Printer, Save, ArrowRight, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import type { Client } from '@/types/database'

const VAT_RATE = 0.15

interface LineItem {
  id: string
  description: string
  qty: number
  unit: string
  unitPrice: number
}

const inputCls =
  'w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:text-slate-100'

function fmt(n: number): string {
  return `ETB ${n.toLocaleString('en-ET', { minimumFractionDigits: 2 })}`
}

function buildHtml(p: {
  client?: Client
  items: LineItem[]
  proformaNum: string
  date: string
  validityDays: number
  paymentTerms: string
  notes: string
  subtotal: number
  vat: number
  total: number
}): string {
  const rows = p.items.map((it, i) => `
    <tr>
      <td class="c">${i + 1}</td>
      <td>${it.description || '—'}</td>
      <td class="r">${it.qty}</td>
      <td class="r">${it.unit}</td>
      <td class="r">${fmt(it.unitPrice)}</td>
      <td class="r">${fmt(it.qty * it.unitPrice)}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html{zoom:0.58}
body{font-family:Georgia,serif;padding:40px 52px;color:#111;font-size:11pt;line-height:1.5;min-height:1123px}
.lh{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px}
.brand{font-size:26pt;font-weight:900;font-family:Arial,sans-serif}
.sub{font-size:10pt;color:#666;margin-top:2px}
.meta{text-align:right;font-size:9.5pt;color:#555;line-height:1.6}
.meta b{font-weight:700}
hr{border:none;border-top:1.5px solid #111;margin:10px 0 16px}
.to{font-size:10pt;margin-bottom:20px}
.to b{font-size:11pt}
table{width:100%;border-collapse:collapse;margin-bottom:20px;font-size:10pt}
thead tr{background:#1B3A5C;color:#fff}
th{padding:8px 10px;text-align:left;font-weight:600;font-size:9pt;letter-spacing:.4px}
th.r,td.r{text-align:right}
th.c,td.c{text-align:center}
tbody tr:nth-child(even){background:#f7f9fb}
td{padding:7px 10px;border-bottom:1px solid #ddd}
.tot{font-size:11pt;font-weight:700}
.subtot td{border-top:2px solid #1B3A5C;background:#f0f4f8}
.foot{margin-top:60px;font-size:9pt;color:#888;border-top:1px solid #ddd;padding-top:10px;display:flex;justify-content:space-between}
.notice{font-size:9pt;color:#888;margin-top:20px;font-style:italic}
</style>
</head>
<body>
<div class="lh">
  <div>
    <div class="brand" style="color:#1B3A5C">KUNCHO</div>
    <div class="sub">Kuncho Construction & Events PLC</div>
    <div class="sub" style="margin-top:4px;color:#999">Addis Ababa, Ethiopia</div>
  </div>
  <div class="meta">
    <div style="font-size:16pt;font-weight:900;color:#1B3A5C;letter-spacing:-0.5px">PROFORMA INVOICE</div>
    <div><b>${p.proformaNum || '—'}</b></div>
    <div>${p.date}</div>
    ${p.validityDays ? `<div>Valid for: ${p.validityDays} days</div>` : ''}
  </div>
</div>
<hr/>
${p.client ? `
<div class="to">
  <div style="color:#888;font-size:9pt;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Bill To</div>
  <b>${p.client.client_name}</b>
  ${p.client.phone_number ? `<div>${p.client.phone_number}</div>` : ''}
  ${p.client.email ? `<div>${p.client.email}</div>` : ''}
</div>` : ''}
<table>
  <thead>
    <tr>
      <th class="c" style="width:36px">#</th>
      <th>Description</th>
      <th class="r" style="width:60px">Qty</th>
      <th class="r" style="width:60px">Unit</th>
      <th class="r" style="width:130px">Unit Price</th>
      <th class="r" style="width:130px">Total</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
  <tbody>
    <tr><td colspan="5" style="text-align:right;padding-right:12px;color:#555;font-size:10pt">Subtotal</td><td class="r">${fmt(p.subtotal)}</td></tr>
    <tr><td colspan="5" style="text-align:right;padding-right:12px;color:#555;font-size:10pt">VAT (15%)</td><td class="r">${fmt(p.vat)}</td></tr>
    <tr class="subtot"><td colspan="5" style="text-align:right;padding-right:12px" class="tot">Grand Total</td><td class="r tot" style="color:#1B3A5C">${fmt(p.total)}</td></tr>
  </tbody>
</table>
${p.paymentTerms ? `<div style="font-size:10pt;margin-bottom:8px"><b>Payment Terms:</b> ${p.paymentTerms}</div>` : ''}
${p.notes ? `<div style="font-size:10pt;color:#555">${p.notes}</div>` : ''}
<div class="notice">This proforma invoice is not a tax invoice. Subject to change.</div>
<div class="foot">
  <span>Kuncho Construction & Events · Addis Ababa, Ethiopia</span>
  <span>Ref: ${p.proformaNum || '—'}</span>
</div>
</body>
</html>`
}

export default function ProformaInvoicePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const previewRef = useRef<HTMLIFrameElement>(null)

  const { data: client, isLoading } = useQuery<Client>({
    queryKey: ['client', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('*').eq('id', id!).single()
      if (error) throw error
      return data as Client
    },
    enabled: !!id,
  })

  const [proformaNum, setProformaNum]   = useState('')
  const [date, setDate]                 = useState(() => new Date().toISOString().slice(0, 10))
  const [validityDays, setValidityDays] = useState(30)
  const [paymentTerms, setPaymentTerms] = useState('Net 30 days')
  const [notes, setNotes]               = useState('')
  const [items, setItems]               = useState<LineItem[]>([
    { id: crypto.randomUUID(), description: '', qty: 1, unit: 'pcs', unitPrice: 0 },
  ])

  const [saving, setSaving]           = useState(false)
  const [converting, setConverting]   = useState(false)
  const [savedProforma, setSavedProforma] = useState<{ id: string; proforma_number: string } | null>(null)

  const addItem    = () => setItems(p => [...p, { id: crypto.randomUUID(), description: '', qty: 1, unit: 'pcs', unitPrice: 0 }])
  const removeItem = (itemId: string) => setItems(p => p.filter(i => i.id !== itemId))
  const updateItem = (itemId: string, field: keyof LineItem, value: string | number) =>
    setItems(p => p.map(i => i.id === itemId ? { ...i, [field]: value } : i))

  const subtotal = items.reduce((s, i) => s + i.qty * i.unitPrice, 0)
  const vat      = subtotal * VAT_RATE
  const total    = subtotal + vat

  const previewDoc = useMemo(
    () => buildHtml({ client, items, proformaNum, date, validityDays, paymentTerms, notes, subtotal, vat, total }),
    [client, items, proformaNum, date, validityDays, paymentTerms, notes, subtotal, vat, total],
  )

  function handlePrint() {
    previewRef.current?.contentWindow?.print()
  }

  async function handleSave() {
    if (items.every(i => !i.description.trim())) {
      toast('Add at least one line item description', 'error'); return
    }
    setSaving(true)
    const { data: pf, error: pfErr } = await supabase
      .from('proformas')
      .insert([{
        proforma_number: proformaNum || null,
        client_id: id,
        date,
        validity_days: validityDays,
        payment_terms: paymentTerms,
        notes,
        subtotal,
        vat_amount: vat,
        total,
        status: 'draft',
        created_by: user?.id ?? null,
      }])
      .select('id, proforma_number')
      .single()

    if (pfErr || !pf) { toast(pfErr?.message ?? 'Save failed', 'error'); setSaving(false); return }

    const { error: itemErr } = await supabase.from('proforma_items').insert(
      items.map((it, idx) => ({
        proforma_id: pf.id,
        description: it.description,
        qty: it.qty,
        unit: it.unit,
        unit_price: it.unitPrice,
        vat_rate: VAT_RATE,
        sort_order: idx,
      }))
    )
    if (itemErr) { toast(itemErr.message, 'error'); setSaving(false); return }

    setSavedProforma({ id: pf.id, proforma_number: pf.proforma_number ?? '' })
    if (!proformaNum) setProformaNum(pf.proforma_number ?? '')
    qc.invalidateQueries({ queryKey: ['proformas'] })
    toast(`Proforma ${pf.proforma_number} saved`, 'success')
    setSaving(false)
  }

  async function handleConvert() {
    if (!savedProforma) return
    setConverting(true)
    const { data: sale, error: saleErr } = await supabase
      .from('sales')
      .insert([{
        sales_description: `${proformaNum || savedProforma.proforma_number} — ${client?.client_name ?? 'Client'}`,
        amount: total,
        date,
        sales_status: 'Invoiced',
        client_id: id,
        payment_method: paymentTerms ? 'Bank Transfer' : null,
        notes,
        proforma_id: savedProforma.id,
      }])
      .select('id')
      .single()

    if (saleErr || !sale) { toast(saleErr?.message ?? 'Conversion failed', 'error'); setConverting(false); return }

    await supabase.from('proformas').update({ status: 'converted', converted_sale_id: sale.id }).eq('id', savedProforma.id)
    qc.invalidateQueries({ queryKey: ['proformas'] })
    qc.invalidateQueries({ queryKey: ['sales'] })
    toast('Converted to invoice — redirecting…', 'success')
    navigate(`/sales/${sale.id}`)
  }

  if (isLoading) return <div className="flex items-center justify-center h-64 text-slate-500 dark:text-slate-400">Loading…</div>

  return (
    <div className="flex flex-col gap-4">
      {/* Top bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <button onClick={() => navigate(`/clients/${id}`)}
          className="inline-flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white">
          <ArrowLeft className="w-4 h-4" /> Back to Client
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Proforma Invoice</h1>
          {savedProforma && (
            <span className="rounded-full bg-green-100 dark:bg-green-900/30 px-2.5 py-0.5 text-xs font-semibold text-green-700 dark:text-green-300 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> {savedProforma.proforma_number}
            </span>
          )}
          <button onClick={handlePrint}
            className="inline-flex items-center gap-1.5 rounded-lg border dark:border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">
            <Printer className="w-4 h-4" /> Print
          </button>
          {!savedProforma ? (
            <button onClick={handleSave} disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60">
              <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save Proforma'}
            </button>
          ) : (
            <button onClick={handleConvert} disabled={converting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60">
              <ArrowRight className="w-4 h-4" /> {converting ? 'Converting…' : 'Convert to Invoice'}
            </button>
          )}
        </div>
      </div>

      {/* Body: form + preview */}
      <div className="flex gap-5 items-start">
        {/* ── Form column ── */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* Invoice meta */}
          <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Proforma Details</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Proforma Number <span className="text-slate-300">(auto)</span></label>
                <input className={inputCls} placeholder="PI-2026-001" value={proformaNum} onChange={e => setProformaNum(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Date</label>
                <input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Validity (days)</label>
                <input type="number" min={1} className={inputCls} value={validityDays} onChange={e => setValidityDays(Number(e.target.value))} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Payment Terms</label>
                <input className={inputCls} placeholder="Net 30 days" value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-4">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Notes</label>
                <textarea className={inputCls} rows={2} placeholder="Additional notes…" value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Line items */}
          <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Line Items</h2>
              <button onClick={addItem}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">
                <Plus className="w-3.5 h-3.5" /> Add Item
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b dark:border-slate-700 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                    <th className="pb-2 pr-3 w-[38%]">Description</th>
                    <th className="pb-2 pr-3 w-[10%]">Qty</th>
                    <th className="pb-2 pr-3 w-[10%]">Unit</th>
                    <th className="pb-2 pr-3 w-[15%]">Unit Price</th>
                    <th className="pb-2 pr-3 w-[15%]">Total</th>
                    <th className="pb-2 w-[12%]"></th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-slate-700">
                  {items.map(item => (
                    <tr key={item.id}>
                      <td className="py-2 pr-3">
                        <input className={inputCls} placeholder="Description" value={item.description} onChange={e => updateItem(item.id, 'description', e.target.value)} />
                      </td>
                      <td className="py-2 pr-3">
                        <input type="number" min={0} className={inputCls} value={item.qty} onChange={e => updateItem(item.id, 'qty', Number(e.target.value))} />
                      </td>
                      <td className="py-2 pr-3">
                        <input className={inputCls} value={item.unit} onChange={e => updateItem(item.id, 'unit', e.target.value)} />
                      </td>
                      <td className="py-2 pr-3">
                        <input type="number" min={0} className={inputCls} value={item.unitPrice} onChange={e => updateItem(item.id, 'unitPrice', Number(e.target.value))} />
                      </td>
                      <td className="py-2 pr-3 text-slate-700 dark:text-slate-200 font-medium tabular-nums">
                        {fmt(item.qty * item.unitPrice)}
                      </td>
                      <td className="py-2">
                        <button onClick={() => removeItem(item.id)} className="text-slate-400 hover:text-red-500 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Summary */}
          <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
            <div className="ml-auto max-w-xs space-y-2 text-sm">
              <div className="flex justify-between text-slate-600 dark:text-slate-300"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
              <div className="flex justify-between text-slate-600 dark:text-slate-300"><span>VAT (15%)</span><span>{fmt(vat)}</span></div>
              <div className="flex justify-between border-t dark:border-slate-700 pt-2 font-bold text-slate-800 dark:text-slate-100 text-base"><span>Grand Total</span><span>{fmt(total)}</span></div>
            </div>
          </div>
        </div>

        {/* ── Preview column ── */}
        <div className="hidden lg:block w-[460px] flex-shrink-0 sticky top-0">
          <p className="text-[10px] uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2 text-center font-semibold">Live Preview</p>
          <div className="rounded-xl overflow-hidden border dark:border-slate-700 shadow-lg bg-white" style={{ height: 'min(710px, calc(100vh - 155px))' }}>
            <iframe ref={previewRef} srcDoc={previewDoc} className="w-full h-full border-0" title="Proforma Invoice Preview" />
          </div>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center mt-2">Updates live as you type · Print button prints this view</p>
        </div>
      </div>
    </div>
  )
}
