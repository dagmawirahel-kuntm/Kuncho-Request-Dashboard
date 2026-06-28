import { useState, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Plus, Trash2, Printer } from 'lucide-react'
import { supabase } from '@/lib/supabase'
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
  invoiceNum: string
  date: string
  validity: string
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
.sl{font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#888;margin-bottom:3px}
.bn{font-size:12pt;font-weight:700}
.bs{font-size:9.5pt;color:#555;line-height:1.6}
.title{font-size:13pt;font-weight:700;text-align:center;text-transform:uppercase;letter-spacing:.04em;border-top:1px solid #ddd;border-bottom:1px solid #ddd;padding:7px 0;margin:14px 0 12px}
table{width:100%;border-collapse:collapse;font-size:9.5pt}
thead tr{border-bottom:2px solid #111}
th{padding:5px 6px 5px 0;font-weight:700;text-align:left}
th.r{text-align:right}
td{padding:5px 6px 5px 0;color:#222;border-bottom:1px solid #eee;vertical-align:top}
td.c{color:#777}
td.r{text-align:right}
.totals{display:flex;justify-content:flex-end;margin:10px 0 14px}
.tw{width:210px;font-size:9.5pt}
.tr{display:flex;justify-content:space-between;padding:2px 0;color:#444}
.tr.g{font-size:11pt;font-weight:700;color:#111;border-top:2px solid #111;padding-top:5px;margin-top:4px}
.terms{display:flex;flex-wrap:wrap;gap:20px;font-size:8.5pt;color:#555;border-top:1px solid #ddd;padding-top:8px;margin-bottom:14px}
.terms b{color:#333}
.footer{font-size:7.5pt;color:#aaa;border-top:1px solid #e0e0e0;padding-top:6px;line-height:1.6}
@media print{html{zoom:1}body{padding:32px 40px}}
</style>
</head>
<body>
<div class="lh">
  <div><div class="brand">ቁ KUNCHO</div><div class="sub">Construction &amp; Events</div></div>
  <div class="meta"><div>${p.date}</div>${p.invoiceNum ? `<div><b>Invoice #: ${p.invoiceNum}</b></div>` : ''}</div>
</div>
<hr>
<div style="margin-bottom:14px">
  <div class="sl">Bill To:</div>
  <div class="bn">${p.client?.client_name ?? '—'}</div>
  <div class="bs">${[p.client?.address, p.client?.email, p.client?.phone_number].filter(Boolean).join('<br>')}</div>
</div>
<div class="title">Proforma Invoice</div>
<table>
  <thead>
    <tr>
      <th style="width:24px">#</th>
      <th>Description</th>
      <th class="r" style="width:40px">Qty</th>
      <th class="r" style="width:48px">Unit</th>
      <th class="r" style="width:106px">Unit Price</th>
      <th class="r" style="width:106px">Total</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>
<div class="totals">
  <div class="tw">
    <div class="tr"><span>Subtotal</span><span>${fmt(p.subtotal)}</span></div>
    <div class="tr"><span>VAT (15%)</span><span>${fmt(p.vat)}</span></div>
    <div class="tr g"><span>GRAND TOTAL</span><span>${fmt(p.total)}</span></div>
  </div>
</div>
<div class="terms">
  <div><b>Validity:</b> ${p.validity || '—'}</div>
  <div><b>Payment Terms:</b> ${p.paymentTerms || '—'}</div>
  ${p.notes ? `<div><b>Notes:</b> ${p.notes}</div>` : ''}
</div>
<div class="footer">
  <div>This proforma invoice is not a tax invoice. Subject to change.</div>
  <div>Kuncho Construction &amp; Events &middot; Addis Ababa, Ethiopia</div>
</div>
</body>
</html>`
}

export default function ProformaInvoicePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
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

  const [invoiceNum, setInvoiceNum] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [validity, setValidity] = useState('30 days')
  const [paymentTerms, setPaymentTerms] = useState('Net 30 days')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<LineItem[]>([
    { id: crypto.randomUUID(), description: '', qty: 1, unit: 'pcs', unitPrice: 0 },
  ])

  const addItem = () => setItems(prev => [...prev, { id: crypto.randomUUID(), description: '', qty: 1, unit: 'pcs', unitPrice: 0 }])
  const removeItem = (itemId: string) => setItems(prev => prev.filter(i => i.id !== itemId))
  const updateItem = (itemId: string, field: keyof LineItem, value: string | number) =>
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, [field]: value } : i))

  const subtotal = items.reduce((s, i) => s + i.qty * i.unitPrice, 0)
  const vat = subtotal * VAT_RATE
  const total = subtotal + vat

  const previewDoc = useMemo(
    () => buildHtml({ client, items, invoiceNum, date, validity, paymentTerms, notes, subtotal, vat, total }),
    [client, items, invoiceNum, date, validity, paymentTerms, notes, subtotal, vat, total],
  )

  function handlePrint() {
    const iframe = previewRef.current
    if (iframe?.contentWindow) {
      iframe.contentWindow.print()
    }
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
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Proforma Invoice</h1>
          <button onClick={handlePrint}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
            <Printer className="w-4 h-4" /> Print / Save PDF
          </button>
        </div>
      </div>

      {/* Body: form + preview */}
      <div className="flex gap-5 items-start">

        {/* ── Form column ── */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* Invoice meta */}
          <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Invoice Details</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Invoice Number</label>
                <input className={inputCls} placeholder="PI-001" value={invoiceNum} onChange={e => setInvoiceNum(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Date</label>
                <input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Validity</label>
                <input className={inputCls} placeholder="30 days" value={validity} onChange={e => setValidity(e.target.value)} />
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
                        <button onClick={() => removeItem(item.id)} className="text-slate-400 hover:text-red-500 transition-colors" aria-label="Remove">
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
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Summary</h2>
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
