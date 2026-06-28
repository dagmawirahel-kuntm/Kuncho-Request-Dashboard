import { useState } from 'react'
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

function formatCurrency(n: number): string {
  return `ETB ${n.toLocaleString('en-ET', { minimumFractionDigits: 2 })}`
}

export default function ProformaInvoicePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data: client, isLoading } = useQuery<Client>({
    queryKey: ['client', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('id', id!)
        .single()
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

  const addItem = () =>
    setItems((prev) => [
      ...prev,
      { id: crypto.randomUUID(), description: '', qty: 1, unit: 'pcs', unitPrice: 0 },
    ])

  const removeItem = (itemId: string) =>
    setItems((prev) => prev.filter((i) => i.id !== itemId))

  const updateItem = (itemId: string, field: keyof LineItem, value: string | number) =>
    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, [field]: value } : i))
    )

  const subtotal = items.reduce((sum, i) => sum + i.qty * i.unitPrice, 0)
  const vat = subtotal * VAT_RATE
  const total = subtotal + vat

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500 dark:text-slate-400">
        Loading…
      </div>
    )
  }

  return (
    <div>
      <style>{`
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
        }
      `}</style>

      {/* ── Screen UI ── */}
      <div className="space-y-5 no-print">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate(`/clients/${id}`)}
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Client
          </button>

          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">
              Proforma Invoice
            </h1>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90"
            >
              <Printer className="w-4 h-4" />
              Print / Download
            </button>
          </div>
        </div>

        {/* Invoice meta */}
        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Invoice Details
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Invoice Number
              </label>
              <input
                className={inputCls}
                placeholder="PI-001"
                value={invoiceNum}
                onChange={(e) => setInvoiceNum(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Date
              </label>
              <input
                type="date"
                className={inputCls}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Validity
              </label>
              <input
                className={inputCls}
                placeholder="30 days"
                value={validity}
                onChange={(e) => setValidity(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Payment Terms
              </label>
              <input
                className={inputCls}
                placeholder="Net 30 days"
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-4">
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Notes
              </label>
              <textarea
                className={inputCls}
                rows={2}
                placeholder="Additional notes…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Line items */}
        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Line Items
            </h2>
            <button
              onClick={addItem}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Item
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b dark:border-slate-700 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                  <th className="pb-2 pr-3 w-[40%]">Description</th>
                  <th className="pb-2 pr-3 w-[10%]">Qty</th>
                  <th className="pb-2 pr-3 w-[10%]">Unit</th>
                  <th className="pb-2 pr-3 w-[15%]">Unit Price</th>
                  <th className="pb-2 pr-3 w-[15%]">Total</th>
                  <th className="pb-2 w-[10%]"></th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="py-2 pr-3">
                      <input
                        className={inputCls}
                        placeholder="Service or item description"
                        value={item.description}
                        onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={0}
                        className={inputCls}
                        value={item.qty}
                        onChange={(e) => updateItem(item.id, 'qty', Number(e.target.value))}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        className={inputCls}
                        value={item.unit}
                        onChange={(e) => updateItem(item.id, 'unit', e.target.value)}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={0}
                        className={inputCls}
                        value={item.unitPrice}
                        onChange={(e) => updateItem(item.id, 'unitPrice', Number(e.target.value))}
                      />
                    </td>
                    <td className="py-2 pr-3 text-slate-700 dark:text-slate-200 font-medium">
                      {formatCurrency(item.qty * item.unitPrice)}
                    </td>
                    <td className="py-2">
                      <button
                        onClick={() => removeItem(item.id)}
                        className="text-slate-400 hover:text-red-500 transition-colors"
                        aria-label="Remove item"
                      >
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
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Summary
          </h2>
          <div className="ml-auto max-w-xs space-y-2 text-sm">
            <div className="flex justify-between text-slate-600 dark:text-slate-300">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between text-slate-600 dark:text-slate-300">
              <span>VAT (15%)</span>
              <span>{formatCurrency(vat)}</span>
            </div>
            <div className="flex justify-between border-t dark:border-slate-700 pt-2 font-bold text-slate-800 dark:text-slate-100 text-base">
              <span>Grand Total</span>
              <span>{formatCurrency(total)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Print Layout ── */}
      <div className="print-only hidden fixed inset-0 bg-white p-10 text-black z-50">
        {/* Letterhead */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="text-3xl font-black tracking-tight text-gray-900">ቁ KUNCHO</div>
            <div className="text-base text-gray-500 mt-0.5">Construction &amp; Events</div>
          </div>
          <div className="text-right text-sm text-gray-600">
            <div>{date}</div>
            {invoiceNum && <div className="font-semibold mt-1">Invoice #: {invoiceNum}</div>}
          </div>
        </div>

        {/* Divider */}
        <hr className="border-gray-800 mb-6" />

        {/* Bill To */}
        <div className="mb-6">
          <div className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">
            Bill To:
          </div>
          <div className="text-base font-bold text-gray-900">{client?.client_name}</div>
          {client?.address && <div className="text-sm text-gray-600">{client.address}</div>}
          {client?.email && <div className="text-sm text-gray-600">{client.email}</div>}
          {client?.phone_number && <div className="text-sm text-gray-600">{client.phone_number}</div>}
        </div>

        {/* Items table */}
        <table className="w-full text-sm mb-4 border-collapse">
          <thead>
            <tr className="border-b-2 border-gray-800 text-left">
              <th className="pb-1 pr-2 w-6 font-semibold">#</th>
              <th className="pb-1 pr-2 font-semibold">Description</th>
              <th className="pb-1 pr-2 text-right font-semibold">Qty</th>
              <th className="pb-1 pr-2 text-right font-semibold">Unit</th>
              <th className="pb-1 pr-2 text-right font-semibold">Unit Price</th>
              <th className="pb-1 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={item.id} className="border-b border-gray-200">
                <td className="py-1 pr-2 text-gray-500">{idx + 1}</td>
                <td className="py-1 pr-2">{item.description || '—'}</td>
                <td className="py-1 pr-2 text-right">{item.qty}</td>
                <td className="py-1 pr-2 text-right">{item.unit}</td>
                <td className="py-1 pr-2 text-right">{formatCurrency(item.unitPrice)}</td>
                <td className="py-1 text-right">{formatCurrency(item.qty * item.unitPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="flex justify-end mb-6">
          <div className="w-64 space-y-1 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>VAT (15%)</span>
              <span>{formatCurrency(vat)}</span>
            </div>
            <div className="flex justify-between border-t-2 border-gray-800 pt-1 font-bold text-base">
              <span>GRAND TOTAL</span>
              <span>{formatCurrency(total)}</span>
            </div>
          </div>
        </div>

        {/* Terms row */}
        <div className="flex gap-8 text-xs text-gray-600 border-t border-gray-200 pt-3 mb-6">
          <div>
            <span className="font-semibold">Validity:</span> {validity}
          </div>
          <div>
            <span className="font-semibold">Payment Terms:</span> {paymentTerms}
          </div>
          {notes && (
            <div>
              <span className="font-semibold">Notes:</span> {notes}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-xs text-gray-400 border-t border-gray-200 pt-3 space-y-0.5">
          <div>This proforma invoice is not a tax invoice. Subject to change.</div>
          <div>Kuncho Construction &amp; Events · Addis Ababa, Ethiopia</div>
        </div>
      </div>
    </div>
  )
}
