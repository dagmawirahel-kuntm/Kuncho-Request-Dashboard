import { useRef, useMemo, useState, useEffect } from 'react'
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/utils'
import type { Vendor, SourcingBundle, SourcingBundleItem, Expense } from '@/types/database'
import { ArrowLeft, Printer, FileText } from 'lucide-react'

const inputCls = 'w-full rounded-md border dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand text-slate-800 dark:text-slate-100 transition-colors'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>
      {children}
    </div>
  )
}

const ONES = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten',
  'Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen']
const TENS = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety']
function numToWords(n: number): string {
  if (n === 0) return 'Zero'
  if (n < 20) return ONES[n]
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '')
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + numToWords(n % 100) : '')
  if (n < 1_000_000) return numToWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + numToWords(n % 1000) : '')
  return numToWords(Math.floor(n / 1_000_000)) + ' Million' + (n % 1_000_000 ? ' ' + numToWords(n % 1_000_000) : '')
}
function etbInWords(amount: number) {
  const whole = Math.floor(amount)
  const cents = Math.round((amount - whole) * 100)
  let words = numToWords(whole) + ' Birr'
  if (cents > 0) words += ` and ${numToWords(cents)} Cents`
  return words
}

function buildHtml(f: {
  contractRef: string; contractDate: string; kunchoRep: string; kunchoTitle: string
  vendorName: string; vendorTin: string; vendorAddress: string; vendorPhone: string; contactPerson: string
  scope: string; contractValue: string; paymentTerms: string; startDate: string; endDate: string
  specialConditions: string; bundleCode: string; linkedExpenses?: string
}) {
  const val = parseFloat(f.contractValue) || 0
  const valWords = val > 0 ? etbInWords(val) : '—'
  const isHighValue = val >= 100_000

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  @page { size: A4; margin: 22mm 20mm 22mm 20mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { zoom: 0.58; }
  @media print { html { zoom: 1; } }
  body { font-family: 'Times New Roman', Times, serif; font-size: 11pt; line-height: 1.55; color: #000; }
  h1 { font-size: 13pt; text-align: center; letter-spacing: .05em; text-transform: uppercase; margin-bottom: 3mm; }
  h2 { font-size: 10.5pt; text-transform: uppercase; letter-spacing: .04em; margin: 6mm 0 2mm; border-bottom: 1px solid #bbb; padding-bottom: 1mm; }
  p { margin-bottom: 2mm; }
  table { width: 100%; border-collapse: collapse; margin: 3mm 0; font-size: 10pt; }
  td, th { border: 1px solid #bbb; padding: 2.5mm 3mm; vertical-align: top; }
  th { background: #f2f2f2; font-weight: bold; text-align: left; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; margin: 3mm 0; }
  .party { border: 1px solid #bbb; padding: 4mm; font-size: 10pt; line-height: 1.6; }
  .party .role { font-size: 8.5pt; text-transform: uppercase; letter-spacing: .05em; color: #555; margin-bottom: 1mm; }
  .amount { font-weight: 700; font-size: 12pt; }
  .hv-badge { display: inline-block; background: #1a1a1a; color: #fff; font-size: 9pt; padding: 1.5mm 4mm; border-radius: 2px; margin-bottom: 3mm; }
  ol { margin: 2mm 0 2mm 6mm; }
  ol li { margin-bottom: 1.5mm; }
  .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 15mm; margin-top: 12mm; }
  .sig-area { border-top: 1.5px solid #000; padding-top: 3mm; font-size: 10pt; line-height: 2; }
  .witness-area { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; margin-top: 8mm; }
  .witness-line { border-top: 1px solid #888; padding-top: 2mm; font-size: 9.5pt; line-height: 2; }
  .footer { margin-top: 8mm; border-top: 1px solid #ddd; padding-top: 2mm; font-size: 8pt; color: #777; text-align: center; }
  .letterhead { text-align: center; padding-bottom: 4mm; margin-bottom: 5mm; border-bottom: 2.5px double #000; }
  .letterhead .name { font-size: 16pt; font-weight: 900; letter-spacing: -.01em; }
  .letterhead .sub { font-size: 8.5pt; color: #555; margin-top: 1mm; }
  .meta { text-align: center; font-size: 10pt; margin-bottom: 4mm; }
</style>
</head>
<body>

<div class="letterhead">
  <div class="name">KUNCHO CONSTRUCTION &amp; TRADING PLC</div>
  <div class="sub">Addis Ababa, Ethiopia &nbsp;|&nbsp; Tel: +251 XXX XXX XXX &nbsp;|&nbsp; kuncho@example.com</div>
</div>

${isHighValue ? '<div style="text-align:center;margin-bottom:4mm"><span class="hv-badge">HIGH VALUE CONTRACT ≥ ETB 100,000</span></div>' : ''}

<h1>Service / Procurement Agreement</h1>
<div class="meta">
  <strong>Contract Reference:</strong> ${f.contractRef || '—'}
  &nbsp;&nbsp;|&nbsp;&nbsp;
  <strong>Date:</strong> ${f.contractDate || '—'}
  ${f.bundleCode ? `&nbsp;&nbsp;|&nbsp;&nbsp;<strong>Bundle:</strong> ${f.bundleCode}` : ''}
  ${f.linkedExpenses ? `<br/><small style="color:#555"><strong>Expenses:</strong> ${f.linkedExpenses}</small>` : ''}
</div>

<h2>1. Parties to the Agreement</h2>
<div class="parties">
  <div class="party">
    <div class="role">Party A — Client</div>
    <strong>Kuncho Construction &amp; Trading PLC</strong><br/>
    Addis Ababa, Ethiopia<br/>
    TIN: ______________________<br/>
    Represented by: ${f.kunchoRep || '______________________'}<br/>
    Title: ${f.kunchoTitle || '______________________'}<br/>
    Date: ______________________
  </div>
  <div class="party">
    <div class="role">Party B — Vendor / Contractor</div>
    <strong>${f.vendorName || '______________________'}</strong><br/>
    ${f.vendorAddress ? f.vendorAddress + '<br/>' : ''}
    TIN: ${f.vendorTin || '______________________'}<br/>
    Phone: ${f.vendorPhone || '______________________'}<br/>
    Represented by: ${f.contactPerson || '______________________'}<br/>
    Date: ______________________
  </div>
</div>

<h2>2. Scope of Services / Goods</h2>
<p style="white-space:pre-wrap;">${f.scope || 'To be described in detail between the parties.'}</p>

<h2>3. Contract Value &amp; Payment</h2>
<p>The total contract value is <span class="amount">${val > 0 ? formatCurrencyStr(val) : '______________________'}</span>
${val > 0 ? `<br/><em>(${valWords} only)</em>` : ''}</p>
<p><strong>Payment Terms:</strong> ${f.paymentTerms || 'As agreed between the parties.'}</p>

<h2>4. Duration</h2>
<p><strong>Start Date:</strong> ${f.startDate || '______________________'} &nbsp;&nbsp;&nbsp;
<strong>End Date:</strong> ${f.endDate || '______________________'}</p>

<h2>5. General Terms &amp; Conditions</h2>
<ol>
  <li>The Vendor/Contractor shall complete the agreed scope of work within the specified timeline and to the quality standards of Kuncho Construction &amp; Trading PLC.</li>
  <li>Payment will be released upon satisfactory completion of each milestone, submission of a valid VAT invoice, and provision of all required receipts.</li>
  <li>The Vendor/Contractor shall comply with all applicable Ethiopian tax obligations, including Withholding Tax (WHT) where applicable.</li>
  <li>Any changes to the scope, timeline, or contract value must be documented via a written variation order signed by both parties.</li>
  <li>Either party may terminate this agreement with fourteen (14) days written notice in the event of a material breach that remains unremedied.</li>
  <li>Confidentiality: Both parties agree to keep the terms of this agreement and any shared business information confidential.</li>
  <li>Disputes shall be resolved through mutual negotiation. If unresolved within 30 days, the matter shall be referred to Ethiopian commercial arbitration under the Arbitration and Conciliation Proclamation No. 1237/2021.</li>
  <li>This agreement is governed by the laws of the Federal Democratic Republic of Ethiopia.</li>
</ol>

${f.specialConditions ? `<h2>6. Special Conditions</h2><p style="white-space:pre-wrap;">${f.specialConditions}</p>` : ''}

<h2>Signatures</h2>
<p>In witness whereof, the duly authorised representatives of the parties have executed this Agreement as of the date first written above.</p>

<div class="signatures">
  <div>
    <div class="sig-area">
      <strong>For Kuncho Construction &amp; Trading PLC</strong><br/>
      Name: ${f.kunchoRep || '______________________'}<br/>
      Title: ${f.kunchoTitle || '______________________'}<br/>
      Signature: ______________________<br/>
      Date: ______________________<br/>
      Official Seal / Stamp: ____________
    </div>
  </div>
  <div>
    <div class="sig-area">
      <strong>For ${f.vendorName || '______________________'}</strong><br/>
      Name: ${f.contactPerson || '______________________'}<br/>
      Title: ______________________<br/>
      Signature: ______________________<br/>
      Date: ______________________<br/>
      Official Seal / Stamp: ____________
    </div>
  </div>
</div>

<div style="margin-top:8mm">
  <p style="font-size:10pt;font-weight:bold;margin-bottom:3mm">Witnessed by:</p>
  <div class="witness-area">
    <div class="witness-line">
      Full Name: ______________________<br/>
      ID No: ______________________<br/>
      Signature: ______________________<br/>
      Date: ______________________
    </div>
    <div class="witness-line">
      Full Name: ______________________<br/>
      ID No: ______________________<br/>
      Signature: ______________________<br/>
      Date: ______________________
    </div>
  </div>
</div>

<div class="footer">
  This is a legally binding document. · Kuncho Request Dashboard · ${f.contractDate || ''}
  · This contract is page 1 of 1
</div>

</body>
</html>`
}

function formatCurrencyStr(n: number) {
  return 'ETB ' + n.toLocaleString('en-ET', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function genRef() {
  const yr = new Date().getFullYear()
  const seq = String(Math.floor(Math.random() * 9000) + 1000)
  return `KCT-${yr}-${seq}`
}

export default function VendorContractPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const bundleId = searchParams.get('bundle_id')
  const expenseIdsParam = searchParams.get('expense_ids')
  const expenseIds = useMemo(
    () => expenseIdsParam ? expenseIdsParam.split(',').filter(Boolean) : [],
    [expenseIdsParam]
  )
  const navigate = useNavigate()
  const previewRef = useRef<HTMLIFrameElement>(null)

  const { data: vendor } = useQuery<Vendor>({
    queryKey: ['vendor', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('vendors').select('*').eq('id', id!).single()
      if (error) throw error
      return data as Vendor
    },
    enabled: !!id,
  })

  const { data: bundle } = useQuery<SourcingBundle>({
    queryKey: ['sourcing-bundle', bundleId],
    queryFn: async () => {
      const { data, error } = await supabase.from('sourcing_bundles').select('*').eq('id', bundleId!).single()
      if (error) throw error
      return data as SourcingBundle
    },
    enabled: !!bundleId,
  })

  const { data: bundleItems = [] } = useQuery<SourcingBundleItem[]>({
    queryKey: ['sourcing-bundle-items', bundleId],
    queryFn: async () => {
      const { data, error } = await supabase.from('sourcing_bundle_items').select('*').eq('bundle_id', bundleId!)
      if (error) throw error
      return data as SourcingBundleItem[]
    },
    enabled: !!bundleId,
  })

  const bundleTotal = useMemo(
    () => bundleItems.reduce((s, i) => s + (i.quantity_actual ?? 0) * (i.unit_price_actual ?? 0), 0),
    [bundleItems]
  )

  const { data: linkedExpenses = [] } = useQuery<Expense[]>({
    queryKey: ['contract-expenses', expenseIds.join(',')],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('id, expense_code, amount_etb, date, item_service_description, description_of_item')
        .in('id', expenseIds)
      if (error) throw error
      return data as Expense[]
    },
    enabled: expenseIds.length > 0,
  })

  const expenseTotal = useMemo(
    () => linkedExpenses.reduce((s, e) => s + (e.amount_etb ?? 0), 0),
    [linkedExpenses]
  )

  const [contractRef] = useState(genRef)
  const [form, setForm] = useState({
    contractDate: todayISO(),
    kunchoRep: '',
    kunchoTitle: 'General Manager',
    scope: '',
    contractValue: '',
    paymentTerms: '',
    startDate: '',
    endDate: '',
    specialConditions: '',
  })

  useEffect(() => {
    if (vendor) {
      setForm(f => ({
        ...f,
        paymentTerms: vendor.payment_terms ?? f.paymentTerms,
      }))
    }
  }, [vendor])

  useEffect(() => {
    if (bundle) {
      setForm(f => ({
        ...f,
        scope: bundle.notes ?? f.scope,
        startDate: bundle.submitted_at ? bundle.submitted_at.slice(0, 10) : f.startDate,
        endDate: bundle.expected_delivery_date ? bundle.expected_delivery_date.slice(0, 10) : f.endDate,
        ...(bundleTotal > 0 ? { contractValue: String(bundleTotal) } : {}),
      }))
    }
  }, [bundle, bundleTotal])

  useEffect(() => {
    if (expenseIds.length > 0 && expenseTotal > 0) {
      setForm(f => ({ ...f, contractValue: String(expenseTotal) }))
    }
  }, [expenseTotal, expenseIds.length])

  function set(k: keyof typeof form, v: string) { setForm(f => ({ ...f, [k]: v })) }

  const linkedExpensesStr = useMemo(() => {
    if (!linkedExpenses.length) return ''
    return linkedExpenses
      .map(e => e.expense_code ?? e.id.slice(0, 8))
      .join(', ')
  }, [linkedExpenses])

  const previewDoc = useMemo(() => buildHtml({
    contractRef,
    contractDate: form.contractDate,
    kunchoRep: form.kunchoRep,
    kunchoTitle: form.kunchoTitle,
    vendorName: vendor?.vendor_name ?? '',
    vendorTin: vendor?.tin ?? '',
    vendorAddress: vendor?.address ?? vendor?.location ?? '',
    vendorPhone: vendor?.phone_contact ?? '',
    contactPerson: vendor?.contact_person ?? '',
    scope: form.scope,
    contractValue: form.contractValue,
    paymentTerms: form.paymentTerms,
    startDate: form.startDate,
    endDate: form.endDate,
    specialConditions: form.specialConditions,
    bundleCode: bundle?.bundle_code ?? '',
    linkedExpenses: linkedExpensesStr,
  }), [form, vendor, bundle, contractRef, linkedExpensesStr])

  function handlePrint() {
    previewRef.current?.contentWindow?.print()
  }

  const contractVal = parseFloat(form.contractValue) || 0
  const isHighValue = contractVal >= 100_000

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(`/vendors/${id}`)}
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            {vendor?.vendor_name ?? 'Vendor'}
          </button>
          <span className="text-slate-300 dark:text-slate-600">/</span>
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Generate Contract</span>
          {isHighValue && (
            <span className="rounded-full bg-amber-100 dark:bg-amber-900/30 px-2.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wide">
              Contract Required ≥ ETB 100K
            </span>
          )}
        </div>
        <button
          onClick={handlePrint}
          className="flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90"
        >
          <Printer className="h-4 w-4" /> Print / Save PDF
        </button>
      </div>

      {bundle && (
        <div className="rounded-lg border dark:border-slate-600 bg-blue-50 dark:bg-blue-900/20 px-4 py-3 text-sm">
          <p className="font-medium text-blue-800 dark:text-blue-300">
            Sourcing Bundle: {bundle.bundle_code}
            {bundleTotal > 0 && <span className="ml-2 text-blue-600 dark:text-blue-400">— Total: {formatCurrency(bundleTotal)}</span>}
          </p>
          <Link to={`/sourcing/${bundleId}`} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">View bundle →</Link>
        </div>
      )}

      {linkedExpenses.length > 0 && (
        <div className="rounded-lg border dark:border-slate-600 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 text-sm space-y-2">
          <p className="font-medium text-emerald-800 dark:text-emerald-300">
            Based on {linkedExpenses.length} selected expense{linkedExpenses.length !== 1 ? 's' : ''}
            {expenseTotal > 0 && <span className="ml-2 text-emerald-700 dark:text-emerald-400">— Contract amount: {formatCurrency(expenseTotal)}</span>}
          </p>
          <div className="space-y-1">
            {linkedExpenses.map(e => (
              <div key={e.id} className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
                <FileText className="h-3 w-3 flex-shrink-0" />
                <span className="font-mono">{e.expense_code ?? e.id.slice(0, 8)}</span>
                {e.amount_etb != null && <span className="text-emerald-600 dark:text-emerald-500">{formatCurrency(e.amount_etb)}</span>}
                {((e as any).description_of_item || e.item_service_description) && (
                  <span className="truncate text-emerald-600/70 dark:text-emerald-500/70">
                    {(e as any).description_of_item || e.item_service_description}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Side-by-side form + preview */}
      <div className="flex gap-5 items-start">
        {/* Form column */}
        <div className="flex-1 min-w-0 space-y-4">

          <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm p-5 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Contract Details</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Contract Reference">
                <input type="text" className={inputCls} value={contractRef} readOnly />
              </Field>
              <Field label="Date">
                <input type="date" className={inputCls} value={form.contractDate} onChange={e => set('contractDate', e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kuncho Representative">
                <input type="text" className={inputCls} placeholder="Full name" value={form.kunchoRep} onChange={e => set('kunchoRep', e.target.value)} />
              </Field>
              <Field label="Title / Position">
                <input type="text" className={inputCls} value={form.kunchoTitle} onChange={e => set('kunchoTitle', e.target.value)} />
              </Field>
            </div>
          </div>

          <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm p-5 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Vendor (Party B)</p>
            {vendor ? (
              <div className="rounded-lg bg-slate-50 dark:bg-slate-700/40 px-3 py-2.5 text-sm space-y-0.5">
                <p className="font-semibold text-slate-800 dark:text-slate-100">{vendor.vendor_name}</p>
                {vendor.tin && <p className="text-slate-500 dark:text-slate-400">TIN: {vendor.tin}</p>}
                {vendor.contact_person && <p className="text-slate-500 dark:text-slate-400">Contact: {vendor.contact_person}</p>}
                {vendor.phone_contact && <p className="text-slate-500 dark:text-slate-400">Phone: {vendor.phone_contact}</p>}
                {(vendor.address || vendor.location) && <p className="text-slate-500 dark:text-slate-400">Address: {vendor.address || vendor.location}</p>}
                <Link to={`/vendors/${id}/edit`} className="text-xs text-brand hover:underline">Edit vendor profile →</Link>
              </div>
            ) : (
              <p className="text-sm text-slate-400">Loading vendor…</p>
            )}
          </div>

          <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm p-5 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Scope &amp; Value</p>
            <Field label="Scope of Services / Goods">
              <textarea rows={4} className={inputCls + ' resize-none'} placeholder="Describe the services or goods to be supplied…" value={form.scope} onChange={e => set('scope', e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Contract Value (ETB)">
                <input type="number" step="0.01" className={inputCls} placeholder="0.00" value={form.contractValue} onChange={e => set('contractValue', e.target.value)} />
              </Field>
              <Field label="Payment Terms">
                <input type="text" className={inputCls} placeholder="e.g. Net 30, 50% advance" value={form.paymentTerms} onChange={e => set('paymentTerms', e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start Date">
                <input type="date" className={inputCls} value={form.startDate} onChange={e => set('startDate', e.target.value)} />
              </Field>
              <Field label="End Date">
                <input type="date" className={inputCls} value={form.endDate} onChange={e => set('endDate', e.target.value)} />
              </Field>
            </div>
          </div>

          <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm p-5 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Special Conditions (optional)</p>
            <textarea rows={3} className={inputCls + ' resize-none'} placeholder="Any special terms or conditions…" value={form.specialConditions} onChange={e => set('specialConditions', e.target.value)} />
          </div>
        </div>

        {/* Preview column */}
        <div
          className="hidden lg:block w-[480px] flex-shrink-0 sticky top-0"
          style={{ height: 'min(740px, calc(100vh - 140px))' }}
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Live Preview</p>
            <button onClick={handlePrint} className="text-xs text-brand hover:underline flex items-center gap-1">
              <Printer className="h-3 w-3" /> Print / PDF
            </button>
          </div>
          <iframe
            ref={previewRef}
            srcDoc={previewDoc}
            className="w-full h-full rounded-xl border dark:border-slate-600 bg-white shadow-sm"
            title="Contract preview"
          />
        </div>
      </div>
    </div>
  )
}
