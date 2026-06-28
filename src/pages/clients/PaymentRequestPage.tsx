import { useState, useRef, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Printer } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Client } from '@/types/database'

const inputCls =
  'w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:text-slate-100'

function fmt(n: number): string {
  return `ETB ${n.toLocaleString('en-ET', { minimumFractionDigits: 2 })}`
}

function buildHtml(p: {
  client?: Client
  type: 'new' | 'existing'
  refNum: string
  date: string
  projectName: string
  contractNumber: string
  contractValue: number
  advancePct: number
  milestone: string
  previouslyPaid: number
  amountRequested: number
  bankName: string
  accountNumber: string
  accountName: string
  notes: string
  computedAdvance: number
  effectiveAmount: number
}): string {
  const isNew = p.type === 'new'

  const detailRows = [
    `<tr><td class="l">Project / Contract</td><td>${p.projectName || '—'}</td></tr>`,
    p.contractNumber ? `<tr><td class="l">Contract Number</td><td>${p.contractNumber}</td></tr>` : '',
    `<tr><td class="l">Total Contract Value</td><td>${fmt(p.contractValue)}</td></tr>`,
    isNew
      ? `<tr><td class="l">Advance Payment (${p.advancePct}%)</td><td>${fmt(p.computedAdvance)}</td></tr>`
      : (p.milestone ? `<tr><td class="l">Milestone / Progress</td><td>${p.milestone}</td></tr>` : ''),
    (!isNew && p.previouslyPaid > 0)
      ? `<tr><td class="l">Previously Paid</td><td>${fmt(p.previouslyPaid)}</td></tr>` : '',
    `<tr class="g"><td class="l">Amount Requested</td><td>${fmt(p.effectiveAmount)}</td></tr>`,
  ].filter(Boolean).join('')

  const bankRows = (p.bankName || p.accountNumber) ? [
    p.bankName ? `<tr><td class="l">Bank Name</td><td>${p.bankName}</td></tr>` : '',
    `<tr><td class="l">Account Name</td><td>${p.accountName}</td></tr>`,
    p.accountNumber ? `<tr><td class="l">Account Number</td><td>${p.accountNumber}</td></tr>` : '',
  ].filter(Boolean).join('') : ''

  const subject = `Payment Request — ${isNew ? 'New Contract' : 'Existing Contract'}${p.projectName ? ` for ${p.projectName}` : ''}${p.contractNumber ? ` (${p.contractNumber})` : ''}`

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html{zoom:0.58}
body{font-family:Georgia,serif;padding:40px 52px;color:#111;font-size:11pt;line-height:1.55;min-height:1123px}
.lh{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px}
.brand{font-size:26pt;font-weight:900;font-family:Arial,sans-serif}
.sub{font-size:10pt;color:#666;margin-top:2px}
.city{font-size:8.5pt;color:#999;margin-top:1px}
.meta{text-align:right;font-size:9.5pt;color:#555;line-height:1.6}
.meta b{font-weight:700}
hr{border:none;border-top:1.5px solid #111;margin:10px 0 16px}
.sl{font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#888;margin-bottom:3px}
.to-name{font-size:11.5pt;font-weight:700}
.to-sub{font-size:9.5pt;color:#555;line-height:1.6}
.subj{font-size:10.5pt;font-weight:700;text-decoration:underline;text-transform:uppercase;letter-spacing:.02em;margin:14px 0 12px}
p{margin-bottom:10px;font-size:10.5pt;color:#222}
table{width:100%;border-collapse:collapse;font-size:9.5pt;margin:10px 0}
td{border:1px solid #ccc;padding:6px 10px;vertical-align:top}
td.l{background:#f7f7f7;font-weight:700;width:200px;color:#333}
tr.g td{background:#111;color:#fff;font-weight:700;font-size:10pt}
.sig{display:grid;grid-template-columns:1fr 1fr;gap:64px;margin-top:32px;font-size:9.5pt}
.sp{color:#777;margin-bottom:32px}
.sl2{border-top:1px solid #aaa;padding-top:4px}
.sn{font-weight:700}
.so{color:#666}
.footer{position:fixed;bottom:28px;left:52px;right:52px;font-size:7.5pt;color:#bbb;border-top:1px solid #e0e0e0;padding-top:5px}
@media print{html{zoom:1}body{padding:32px 40px}.footer{position:static;margin-top:32px}}
</style>
</head>
<body>
<div class="lh">
  <div>
    <div class="brand">ቁ KUNCHO</div>
    <div class="sub">Construction &amp; Events</div>
    <div class="city">Addis Ababa, Ethiopia</div>
  </div>
  <div class="meta">
    ${p.refNum ? `<div><b>Ref: ${p.refNum}</b></div>` : ''}
    <div>${p.date}</div>
  </div>
</div>
<hr>
<div style="margin-bottom:14px">
  <div class="sl">To:</div>
  <div class="to-name">${p.client?.client_name ?? '—'}</div>
  <div class="to-sub">${[p.client?.address, p.client?.email, p.client?.phone_number].filter(Boolean).join('<br>')}</div>
</div>
<div class="subj">Subject: ${subject}</div>
<p>Dear Sir / Madam,</p>
<p>${isNew
  ? `We are pleased to submit our payment request for the advance payment in connection with the captioned project. As per the terms of the contract, we hereby request the release of the advance payment of ${p.advancePct}% of the total contract value.`
  : `We are pleased to submit our payment request for the progress payment in connection with the captioned project. The works have been executed in accordance with the contract specifications and we request the release of the payment for the completed milestone.`
}</p>
<p>The details of the ${isNew ? 'contract and the requested payment' : 'progress payment'} are as follows:</p>
<table>${detailRows}</table>
${bankRows ? `<p>We kindly request that the payment be made to our bank account as detailed below:</p><table>${bankRows}</table>` : ''}
${p.notes ? `<p style="font-style:italic;color:#555">${p.notes}</p>` : ''}
<p>We trust that the above request will receive your favourable consideration and look forward to your prompt response.</p>
<p>Thank you for your continued partnership.</p>
<div class="sig">
  <div><div class="sp">Prepared by:</div><div class="sl2"><div class="sn">Authorised Signatory</div><div class="so">Kuncho Construction &amp; Events</div></div></div>
  <div><div class="sp">Received by:</div><div class="sl2"><div class="sn">Representative</div><div class="so">${p.client?.client_name ?? ''}</div></div></div>
</div>
<div class="footer">Kuncho Construction &amp; Events &middot; Addis Ababa, Ethiopia${p.refNum ? ` &middot; Ref: ${p.refNum}` : ''} &middot; ${p.date}</div>
</body>
</html>`
}

export default function PaymentRequestPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const previewRef = useRef<HTMLIFrameElement>(null)
  const type = searchParams.get('type') === 'existing' ? 'existing' : 'new'
  const isNew = type === 'new'

  const { data: client, isLoading } = useQuery<Client>({
    queryKey: ['client', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('*').eq('id', id!).single()
      if (error) throw error
      return data as Client
    },
    enabled: !!id,
  })

  const [refNum, setRefNum]                 = useState('')
  const [date, setDate]                     = useState(() => new Date().toISOString().slice(0, 10))
  const [projectName, setProjectName]       = useState('')
  const [contractNumber, setContractNumber] = useState('')
  const [contractValue, setContractValue]   = useState<number>(0)
  const [advancePct, setAdvancePct]         = useState<number>(30)
  const [milestone, setMilestone]           = useState('')
  const [previouslyPaid, setPreviouslyPaid] = useState<number>(0)
  const [amountRequested, setAmountRequested] = useState<number>(0)
  const [bankName, setBankName]             = useState('')
  const [accountNumber, setAccountNumber]   = useState('')
  const [accountName, setAccountName]       = useState('Kuncho Construction & Events')
  const [notes, setNotes]                   = useState('')

  const computedAdvance = isNew ? (contractValue * advancePct) / 100 : 0
  const effectiveAmount = isNew ? (amountRequested || computedAdvance) : amountRequested

  const previewDoc = useMemo(
    () => buildHtml({ client, type, refNum, date, projectName, contractNumber, contractValue, advancePct, milestone, previouslyPaid, amountRequested, bankName, accountNumber, accountName, notes, computedAdvance, effectiveAmount }),
    [client, type, refNum, date, projectName, contractNumber, contractValue, advancePct, milestone, previouslyPaid, amountRequested, bankName, accountNumber, accountName, notes, computedAdvance, effectiveAmount],
  )

  function handlePrint() {
    const iframe = previewRef.current
    if (iframe?.contentWindow) {
      iframe.contentWindow.print()
    }
  }

  if (isLoading) return <div className="flex items-center justify-center h-64 text-slate-500 dark:text-slate-400">Loading…</div>

  const title = isNew ? 'Payment Request — New Contract' : 'Payment Request — Existing Contract'

  return (
    <div className="flex flex-col gap-4">
      {/* Top bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <button onClick={() => navigate(`/clients/${id}`)}
          className="inline-flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white">
          <ArrowLeft className="w-4 h-4" /> Back to Client
        </button>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">{title}</h1>
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

          {/* Letter details */}
          <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Letter Details</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Reference Number</label>
                <input className={inputCls} placeholder="KUNCHO/PR/001" value={refNum} onChange={e => setRefNum(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Date</label>
                <input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Project / Contract Name</label>
                <input className={inputCls} placeholder="e.g. Office Construction Phase 1" value={projectName} onChange={e => setProjectName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Contract Number</label>
                <input className={inputCls} placeholder="e.g. CTR-2025-001" value={contractNumber} onChange={e => setContractNumber(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Contract Value (ETB)</label>
                <input type="number" min={0} className={inputCls} value={contractValue || ''} onChange={e => setContractValue(Number(e.target.value))} />
              </div>
              {isNew ? (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Advance %</label>
                  <input type="number" min={0} max={100} className={inputCls} value={advancePct} onChange={e => setAdvancePct(Number(e.target.value))} />
                  {contractValue > 0 && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">{fmt(computedAdvance)}</p>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Milestone / Progress</label>
                  <input className={inputCls} placeholder="e.g. Phase 1 — 50% completion" value={milestone} onChange={e => setMilestone(e.target.value)} />
                </div>
              )}
              {!isNew && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Previously Paid (ETB)</label>
                  <input type="number" min={0} className={inputCls} value={previouslyPaid || ''} onChange={e => setPreviouslyPaid(Number(e.target.value))} />
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Amount Requested (ETB){isNew ? ' — leave 0 to use computed advance' : ''}
                </label>
                <input type="number" min={0} className={inputCls} value={amountRequested || ''} onChange={e => setAmountRequested(Number(e.target.value))} />
              </div>
            </div>
          </div>

          {/* Bank details */}
          <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Bank Details</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Bank Name</label>
                <input className={inputCls} placeholder="Commercial Bank of Ethiopia" value={bankName} onChange={e => setBankName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Account Number</label>
                <input className={inputCls} placeholder="1000123456789" value={accountNumber} onChange={e => setAccountNumber(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Account Name</label>
                <input className={inputCls} value={accountName} onChange={e => setAccountName(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Additional Notes</h2>
            <textarea className={inputCls} rows={3} placeholder="Any additional terms or conditions…" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>

        {/* ── Preview column ── */}
        <div className="hidden lg:block w-[460px] flex-shrink-0 sticky top-0">
          <p className="text-[10px] uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2 text-center font-semibold">Live Preview</p>
          <div className="rounded-xl overflow-hidden border dark:border-slate-700 shadow-lg bg-white" style={{ height: 'min(710px, calc(100vh - 155px))' }}>
            <iframe ref={previewRef} srcDoc={previewDoc} className="w-full h-full border-0" title="Payment Request Preview" />
          </div>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center mt-2">Updates live as you type · Print button prints this view</p>
        </div>

      </div>
    </div>
  )
}
