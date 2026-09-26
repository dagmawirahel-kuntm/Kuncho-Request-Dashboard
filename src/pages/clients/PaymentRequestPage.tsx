import { useState, useRef } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Printer, Save, ReceiptText, Ban, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency } from '@/lib/utils'
import { RequestStatus } from '@/components/shared/ClientPaymentRequests'
import { documentBaseCss, renderLetterhead, COMPANY_NAME, COMPANY_ADDRESS, BRAND_NAVY } from '@/lib/documentTheme'
import type { Client, ClientPaymentRequest, PaymentMilestoneKind } from '@/types/database'

const inputCls =
  'w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:text-slate-100 disabled:opacity-70'

function fmt(n: number): string {
  return `ETB ${n.toLocaleString('en-ET', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
const round2 = (n: number) => Math.round(n * 100) / 100
const pctText = (n: number) => `${Number(n.toFixed(4))}%`

const KIND_LABEL: Record<PaymentMilestoneKind, string> = {
  advance: 'Advance payment', progress: 'Progress payment', final: 'Final payment', other: 'Payment',
}

type ProformaOpt = { id: string; proforma_number: string | null; total: number | null; payment_terms: string | null; project_id: string | null; status: string }
type ContractOpt = { id: string; contract_no: string | null; contract_value: number | null; project_id: string | null; projects: { project_name: string } | null }
type MilestoneOpt = { id: string; contract_id: string; title: string; kind: PaymentMilestoneKind; status: string; percent_of_contract_value: number }
type Asked = Pick<ClientPaymentRequest, 'id' | 'proforma_id' | 'contract_id' | 'amount' | 'status'>

/** "30% advance on signing, …" → 30 */
function advanceFromTerms(terms: string | null): number | null {
  const m = terms?.match(/(\d+(?:\.\d+)?)\s*%\s*(?:advance|upon signing|on signing)/i)
  return m ? Number(m[1]) : null
}

function buildHtml(p: {
  client?: Client
  kind: PaymentMilestoneKind
  refNum: string
  date: string
  projectName: string
  basisLabel: string
  contractNumber: string
  basisAmount: number
  percent: number
  title: string
  previouslyPaid: number
  amount: number
  bankName: string
  accountNumber: string
  accountName: string
  notes: string
}): string {
  const isAdvance = p.kind === 'advance'
  const share = p.title || KIND_LABEL[p.kind]

  const detailRows = [
    `<tr><td class="l">Project</td><td>${p.projectName || '—'}</td></tr>`,
    p.contractNumber ? `<tr><td class="l">Contract Number</td><td>${p.contractNumber}</td></tr>` : '',
    `<tr><td class="l">${p.basisLabel}</td><td>${fmt(p.basisAmount)}</td></tr>`,
    `<tr><td class="l">${share}${p.percent ? ` (${pctText(p.percent)})` : ''}</td><td>${fmt(p.amount)}</td></tr>`,
    p.previouslyPaid > 0 ? `<tr><td class="l">Previously Paid</td><td>${fmt(p.previouslyPaid)}</td></tr>` : '',
    `<tr class="g"><td class="l">Amount Requested</td><td>${fmt(p.amount)}</td></tr>`,
  ].filter(Boolean).join('')

  const bankRows = (p.bankName || p.accountNumber) ? [
    p.bankName ? `<tr><td class="l">Bank Name</td><td>${p.bankName}</td></tr>` : '',
    `<tr><td class="l">Account Name</td><td>${p.accountName}</td></tr>`,
    p.accountNumber ? `<tr><td class="l">Account Number</td><td>${p.accountNumber}</td></tr>` : '',
  ].filter(Boolean).join('') : ''

  const subject = `Payment Request — ${share}${p.projectName ? ` for ${p.projectName}` : ''}${p.contractNumber ? ` (${p.contractNumber})` : ''}`
  const ofWhat = p.basisLabel.toLowerCase().startsWith('proforma') ? 'the proforma value' : 'the total contract value'
  const opening = isAdvance
    ? `We are pleased to submit our payment request for the advance payment in connection with the captioned project, so that the work can be mobilised. We hereby request the release of the advance payment${p.percent ? ` of ${pctText(p.percent)} of ${ofWhat}` : ''}.`
    : p.kind === 'final'
      ? `We are pleased to submit our payment request for the final payment in connection with the captioned project. The works have been completed and we request the release of the remaining balance${p.percent ? ` of ${pctText(p.percent)} of ${ofWhat}` : ''}.`
      : `We are pleased to submit our payment request for the progress payment in connection with the captioned project. The works have been executed in accordance with the agreed specifications and we request the release of the payment${p.percent ? ` of ${pctText(p.percent)} of ${ofWhat}` : ''}.`

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
${documentBaseCss}
html{zoom:0.58}
body{padding:40px 52px;color:#111;font-size:11pt;line-height:1.55;min-height:1123px}
.sl{font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#888;margin-bottom:3px}
.to-name{font-size:11.5pt;font-weight:700}
.to-sub{font-size:9.5pt;color:#555;line-height:1.6}
.subj{font-size:10.5pt;font-weight:700;text-decoration:underline;text-transform:uppercase;letter-spacing:.02em;margin:14px 0 12px}
p{margin-bottom:10px;font-size:10.5pt;color:#222}
table{width:100%;border-collapse:collapse;font-size:9.5pt;margin:10px 0}
td{border:1px solid #ccc;padding:6px 10px;vertical-align:top}
td.l{background:#f7f7f7;font-weight:700;width:220px;color:#333}
tr.g td{background:${BRAND_NAVY};color:#fff;font-weight:700;font-size:10pt}
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
${renderLetterhead({
  docTitle: 'PAYMENT REQUEST',
  docCode: p.refNum ? `Ref: ${p.refNum}` : undefined,
  metaLines: [p.date],
  gradient: 'paymentRequestLetter',
})}
<div style="margin-bottom:14px">
  <div class="sl">To:</div>
  <div class="to-name">${p.client?.client_name ?? '—'}</div>
  <div class="to-sub">${[p.client?.address, p.client?.email, p.client?.phone_number].filter(Boolean).join('<br>')}</div>
</div>
<div class="subj">Subject: ${subject}</div>
<p>Dear Sir / Madam,</p>
<p>${opening}</p>
<p>The details of the requested payment are as follows:</p>
<table>${detailRows}</table>
${bankRows ? `<p>We kindly request that the payment be made to our bank account as detailed below:</p><table>${bankRows}</table>` : ''}
${p.notes ? `<p style="font-style:italic;color:#555">${p.notes}</p>` : ''}
<p>We trust that the above request will receive your favourable consideration and look forward to your prompt response.</p>
<p>Thank you for your continued partnership.</p>
<div class="sig">
  <div><div class="sp">Prepared by:</div><div class="sl2"><div class="sn">Authorised Signatory</div><div class="so">${COMPANY_NAME}</div></div></div>
  <div><div class="sp">Received by:</div><div class="sl2"><div class="sn">Representative</div><div class="so">${p.client?.client_name ?? ''}</div></div></div>
</div>
<div class="footer">${COMPANY_NAME} &middot; ${COMPANY_ADDRESS}${p.refNum ? ` &middot; Ref: ${p.refNum}` : ''} &middot; ${p.date}</div>
</body>
</html>`
}

type Lookups = {
  client: Client
  proformas: ProformaOpt[]
  contracts: ContractOpt[]
  milestones: MilestoneOpt[]
  asked: Asked[]
  saved: ClientPaymentRequest | null
}

/**
 * A payment request asks the client for a share of a proforma (or of a
 * contract). It is saved and numbered, and the invoice is raised from it —
 * never straight from the proforma (migration 340).
 *
 * ?request_id=  opens a saved request.
 * ?proforma_id= / ?contract_id= [&milestone_id=] start one against that basis.
 * ?type=existing starts a progress payment; anything else an advance.
 */
export default function PaymentRequestPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const requestId = searchParams.get('request_id')

  const { data, isLoading, error } = useQuery<Lookups>({
    queryKey: ['client-payment-request', id, requestId],
    enabled: !!id,
    queryFn: async () => {
      const [cl, pf, co, ms, rq, sv] = await Promise.all([
        supabase.from('clients').select('*').eq('id', id!).single(),
        supabase.from('proformas').select('id, proforma_number, total, payment_terms, project_id, status')
          .eq('client_id', id!).order('date', { ascending: false }),
        supabase.from('contracts').select('id, contract_no, contract_value, project_id, projects:project_id ( project_name )')
          .eq('client_id', id!).order('created_at', { ascending: false }),
        supabase.from('payment_milestones').select('id, contract_id, title, kind, status, percent_of_contract_value, contracts!inner(client_id)')
          .eq('contracts.client_id', id!).order('sequence_number'),
        supabase.from('client_payment_requests').select('id, proforma_id, contract_id, amount, status').eq('client_id', id!),
        requestId
          ? supabase.from('client_payment_requests').select('*').eq('id', requestId).single()
          : Promise.resolve({ data: null, error: null }),
      ])
      for (const r of [cl, pf, co, ms, rq, sv]) if (r.error) throw r.error
      return {
        client: cl.data as Client,
        proformas: (pf.data ?? []) as ProformaOpt[],
        contracts: (co.data ?? []) as unknown as ContractOpt[],
        milestones: (ms.data ?? []) as unknown as MilestoneOpt[],
        asked: (rq.data ?? []) as Asked[],
        saved: (sv.data ?? null) as ClientPaymentRequest | null,
      }
    },
  })

  if (isLoading) return <div className="flex items-center justify-center h-64 text-slate-500 dark:text-slate-400">Loading…</div>
  if (error || !data) return <div className="py-16 text-center text-sm text-red-600">{(error as Error)?.message ?? 'Could not load the client'}</div>

  // Keyed on the request so saving (which swaps the URL to ?request_id=)
  // starts the body fresh from the saved row.
  return <PaymentRequestBody key={requestId ?? 'new'} clientId={id!} lookups={data} />
}

function PaymentRequestBody({ clientId, lookups }: { clientId: string; lookups: Lookups }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { role } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const previewRef = useRef<HTMLIFrameElement>(null)
  const { client, proformas, contracts, milestones, asked, saved } = lookups
  const canInvoice = role === 'admin' || role === 'finance'

  // Starting values: the saved request, else what the link asked for.
  const init = (() => {
    if (saved) {
      return {
        basis: saved.proforma_id ? `pf:${saved.proforma_id}` : saved.contract_id ? `ct:${saved.contract_id}` : '',
        contractId: saved.contract_id ?? '',
        milestoneId: saved.milestone_id ?? '',
        kind: saved.kind,
        percent: saved.percent != null ? String(Number(saved.percent)) : '',
        amount: String(Number(saved.amount)),
        manualBasis: String(Number(saved.basis_amount)),
      }
    }
    const pfId = searchParams.get('proforma_id')
    const ctId = searchParams.get('contract_id')
    const msId = searchParams.get('milestone_id')
    const ms = milestones.find(m => m.id === msId)
    const pf = proformas.find(p => p.id === pfId)
    const kind: PaymentMilestoneKind = ms?.kind && ms.kind !== 'other' ? ms.kind
      : searchParams.get('type') === 'existing' ? 'progress' : 'advance'
    const pct = ms ? Number(ms.percent_of_contract_value)
      : kind === 'advance' ? (advanceFromTerms(pf?.payment_terms ?? null) ?? 30) : null
    return {
      basis: pfId ? `pf:${pfId}` : ctId ? `ct:${ctId}` : '',
      contractId: ctId ?? (ms?.contract_id ?? ''),
      milestoneId: msId ?? '',
      kind,
      percent: pct != null ? String(pct) : '',
      amount: '',
      manualBasis: '',
    }
  })()

  const locked = !!saved
  const [basis, setBasis]                 = useState(init.basis)
  const [contractId, setContractId]       = useState(init.contractId)
  const [milestoneId, setMilestoneId]     = useState(init.milestoneId)
  const [kind, setKind]                   = useState<PaymentMilestoneKind>(init.kind)
  const [percent, setPercent]             = useState(init.percent)
  const [amountText, setAmountText]       = useState(init.amount)
  const [manualBasis, setManualBasis]     = useState(init.manualBasis)
  const [date, setDate]                   = useState(saved?.request_date ?? new Date().toISOString().slice(0, 10))
  const [title, setTitle]                 = useState(saved?.title ?? '')
  const [previouslyPaid, setPreviouslyPaid] = useState<number>(Number(saved?.previously_paid ?? 0))
  const [bankName, setBankName]           = useState(saved?.bank_name ?? '')
  const [accountNumber, setAccountNumber] = useState(saved?.account_number ?? '')
  const [accountName, setAccountName]     = useState(saved?.account_name ?? COMPANY_NAME)
  const [notes, setNotes]                 = useState(saved?.notes ?? '')
  const [busy, setBusy]                   = useState(false)

  const pf = basis.startsWith('pf:') ? proformas.find(p => `pf:${p.id}` === basis) ?? null : null
  const ctFromBasis = basis.startsWith('ct:') ? contracts.find(c => `ct:${c.id}` === basis) ?? null : null
  const contract = ctFromBasis ?? contracts.find(c => c.id === contractId) ?? null
  const basisAmount = pf ? Number(pf.total ?? 0) : ctFromBasis ? Number(ctFromBasis.contract_value ?? 0) : Number(manualBasis) || 0
  const basisLabel = pf ? `Proforma ${pf.proforma_number ?? ''} Total`.replace('  ', ' ') : 'Total Contract Value'
  const projectName = contract?.projects?.project_name?.trim() ?? ''

  const pctNum = parseFloat(percent)
  const amount = amountText !== '' ? Number(amountText) || 0 : (!isNaN(pctNum) ? round2(basisAmount * pctNum / 100) : 0)

  // What is already asked for on this proforma / contract, this one aside.
  const alreadyAsked = asked
    .filter(r => r.status !== 'cancelled' && r.id !== saved?.id)
    .filter(r => (pf && r.proforma_id === pf.id) || (!pf && contract && r.contract_id === contract.id))
    .reduce((s, r) => s + Number(r.amount), 0)
  const remaining = basisAmount - alreadyAsked
  const overAsk = basisAmount > 0 && amount > remaining + 1

  const contractMilestones = milestones.filter(m => m.contract_id === (contract?.id ?? ''))

  function pickBasis(v: string) {
    setBasis(v)
    setAmountText('')
    if (v.startsWith('ct:')) setContractId(v.slice(3))
    if (v.startsWith('pf:') && kind === 'advance') {
      const terms = proformas.find(p => `pf:${p.id}` === v)?.payment_terms ?? null
      const a = advanceFromTerms(terms)
      if (a != null) setPercent(String(a))
    }
  }
  function pickMilestone(v: string) {
    setMilestoneId(v)
    const m = milestones.find(x => x.id === v)
    if (m) {
      if (m.kind !== 'other') setKind(m.kind)
      if (!pf) { setPercent(String(Number(m.percent_of_contract_value))); setAmountText('') }
    }
  }
  function onPercent(v: string) { setPercent(v); setAmountText('') }
  function onAmount(v: string) {
    setAmountText(v)
    const n = Number(v)
    if (basisAmount > 0 && n > 0) setPercent(String(Number((n / basisAmount * 100).toFixed(4))))
  }

  const previewDoc = buildHtml({
    client, kind, refNum: saved?.request_number ?? '', date, projectName, basisLabel,
    contractNumber: contract?.contract_no ?? '', basisAmount, percent: isNaN(pctNum) ? 0 : pctNum,
    title: title.trim(), previouslyPaid, amount, bankName, accountNumber, accountName, notes,
  })

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['client-payment-request'] })
    qc.invalidateQueries({ queryKey: ['client-payment-requests'] })
    qc.invalidateQueries({ queryKey: ['proformas'] })
    qc.invalidateQueries({ queryKey: ['payment-milestones'] })
    qc.invalidateQueries({ queryKey: ['sales'] })
    qc.invalidateQueries({ queryKey: ['sales-engagements'] })
  }

  async function handleSave() {
    if (basisAmount <= 0) { toast('Pick the proforma or contract this is a share of, or enter its total', 'error'); return }
    if (amount <= 0) { toast('Enter the percentage or the amount to request', 'error'); return }
    if (overAsk) { toast(`Only ${formatCurrency(Math.max(remaining, 0))} of this is left to request`, 'error'); return }
    setBusy(true)
    const milestone = milestones.find(m => m.id === milestoneId) ?? null
    const { data: row, error } = await supabase.from('client_payment_requests').insert([{
      client_id: clientId,
      proforma_id: pf?.id ?? null,
      contract_id: contract?.id ?? null,
      milestone_id: milestone?.id ?? null,
      project_id: contract?.project_id ?? pf?.project_id ?? null,
      kind,
      request_date: date,
      basis_amount: basisAmount,
      percent: isNaN(pctNum) ? null : pctNum,
      amount,
      title: title.trim() || null,
      previously_paid: previouslyPaid || 0,
      bank_name: bankName.trim() || null,
      account_number: accountNumber.trim() || null,
      account_name: accountName.trim() || null,
      notes: notes.trim() || null,
    }]).select('id, request_number').single()
    if (error || !row) { setBusy(false); toast(error?.message ?? 'Save failed', 'error'); return }

    // The request is what goes to the client, so the milestone it is for is
    // now requested (an advance from pending or due; others once progress is met).
    if (milestone && (milestone.kind === 'advance'
      ? milestone.status === 'pending' || milestone.status === 'progress_met'
      : milestone.status === 'progress_met')) {
      const { error: mErr } = await supabase.rpc('mark_milestone_invoiced', {
        p_milestone_id: milestone.id, p_document_url: null, p_invoiced_date: date,
      })
      if (mErr) toast(`Request saved, but the milestone wasn't marked requested: ${mErr.message}`, 'error')
    }
    setBusy(false)
    invalidate()
    toast(`Payment request ${row.request_number} saved`, 'success')
    setSearchParams({ request_id: row.id }, { replace: true })
  }

  async function handleInvoice() {
    if (!saved) return
    if (!window.confirm(`Raise an invoice for ${formatCurrency(Number(saved.amount))} from ${saved.request_number}?`)) return
    setBusy(true)
    const { data: saleId, error } = await supabase.rpc('invoice_client_payment_request', { p_request_id: saved.id })
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    invalidate()
    toast('Invoice raised', 'success')
    navigate(`/sales/${saleId as string}`)
  }

  async function handleCancel() {
    if (!saved) return
    const reason = window.prompt(`Cancel ${saved.request_number}? Say why (the client withdrew, it was re-issued, …):`)
    if (reason == null) return
    setBusy(true)
    const { error } = await supabase.from('client_payment_requests')
      .update({ status: 'cancelled', cancelled_reason: reason.trim() || null }).eq('id', saved.id)
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    invalidate()
    toast(`${saved.request_number} cancelled`, 'success')
  }

  const heading = saved ? `Payment Request ${saved.request_number}` : 'New Payment Request'

  return (
    <div className="flex flex-col gap-4">
      {/* Top bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <button onClick={() => navigate(`/clients/${clientId}`)}
          className="inline-flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white">
          <ArrowLeft className="w-4 h-4" /> Back to Client
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">{heading}</h1>
          {saved && <RequestStatus status={saved.status} />}
          <button onClick={() => previewRef.current?.contentWindow?.print()}
            className="inline-flex items-center gap-1.5 rounded-lg border dark:border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">
            <Printer className="w-4 h-4" /> Print / Save PDF
          </button>
          {!saved && (
            <button onClick={handleSave} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60">
              <Save className="w-4 h-4" /> {busy ? 'Saving…' : 'Save Request'}
            </button>
          )}
          {saved?.status === 'issued' && (
            <>
              <button onClick={handleCancel} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-900/50 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-60">
                <Ban className="w-4 h-4" /> Cancel
              </button>
              {canInvoice && (
                <button onClick={handleInvoice} disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60">
                  <ReceiptText className="w-4 h-4" /> {busy ? 'Working…' : 'Create Invoice'}
                </button>
              )}
            </>
          )}
          {saved?.sale_id && (
            <Link to={`/sales/${saved.sale_id}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700">
              <CheckCircle2 className="w-4 h-4" /> View Invoice
            </Link>
          )}
        </div>
      </div>

      {saved?.status === 'cancelled' && (
        <p className="rounded-lg bg-red-50 dark:bg-red-900/20 px-4 py-2 text-sm text-red-700 dark:text-red-300">
          Cancelled{saved.cancelled_reason ? ` — ${saved.cancelled_reason}` : ''}. Its share is free to request again.
        </p>
      )}

      <div className="flex gap-5 items-start">
        {/* ── Form column ── */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* What is being requested */}
          <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">What you're requesting</h2>
            <p className="mb-4 text-xs text-slate-400">A share of a proforma or contract. The invoice is raised from this request once it is saved.</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">A share of</label>
                <select className={inputCls} value={basis} onChange={e => pickBasis(e.target.value)} disabled={locked}>
                  <option value="">— Neither on record (enter the total below) —</option>
                  {proformas.length > 0 && (
                    <optgroup label="Proformas">
                      {proformas.map(p => (
                        <option key={p.id} value={`pf:${p.id}`}>
                          {p.proforma_number ?? 'Proforma'} · {formatCurrency(Number(p.total ?? 0))}{p.status === 'draft' ? ' · draft' : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {contracts.length > 0 && (
                    <optgroup label="Contracts">
                      {contracts.map(c => (
                        <option key={c.id} value={`ct:${c.id}`}>
                          {c.contract_no ?? 'Contract'} · {formatCurrency(Number(c.contract_value ?? 0))}{c.projects?.project_name ? ` · ${c.projects.project_name}` : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              {!pf && !ctFromBasis && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Total it is a share of (ETB)</label>
                  <input type="number" min={0} className={inputCls} value={manualBasis} disabled={locked}
                    onChange={e => { setManualBasis(e.target.value); setAmountText('') }} />
                </div>
              )}

              {pf && contracts.length > 0 && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Under contract <span className="text-slate-300">(if signed)</span></label>
                  <select className={inputCls} value={contractId} disabled={locked}
                    onChange={e => { setContractId(e.target.value); setMilestoneId('') }}>
                    <option value="">— Not yet —</option>
                    {contracts.map(c => <option key={c.id} value={c.id}>{c.contract_no ?? 'Contract'}{c.projects?.project_name ? ` · ${c.projects.project_name}` : ''}</option>)}
                  </select>
                </div>
              )}

              {contractMilestones.length > 0 && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-500 dark:text-slate-400">For milestone</label>
                  <select className={inputCls} value={milestoneId} onChange={e => pickMilestone(e.target.value)} disabled={locked}>
                    <option value="">— None —</option>
                    {contractMilestones.map(m => (
                      <option key={m.id} value={m.id}>{m.title} · {Number(m.percent_of_contract_value)}%</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Type</label>
                <select className={inputCls} value={kind} onChange={e => setKind(e.target.value as PaymentMilestoneKind)} disabled={locked}>
                  <option value="advance">Advance — before work starts</option>
                  <option value="progress">Progress — for work done</option>
                  <option value="final">Final — on completion</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Percentage</label>
                <div className="relative">
                  <input type="number" min={0} max={100} step="0.01" className={`${inputCls} pr-8`} value={percent}
                    onChange={e => onPercent(e.target.value)} disabled={locked} placeholder="e.g. 30" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">%</span>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Amount requested (ETB)</label>
                <input type="number" min={0} className={inputCls} value={amountText !== '' ? amountText : (amount || '')}
                  onChange={e => onAmount(e.target.value)} disabled={locked} />
              </div>

              {basisAmount > 0 && (
                <div className={`sm:col-span-2 rounded-lg px-3 py-2 text-xs ${overAsk ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300' : 'bg-slate-50 text-slate-600 dark:bg-slate-900/40 dark:text-slate-300'}`}>
                  {formatCurrency(basisAmount)} in all
                  {alreadyAsked > 0 && <> · {formatCurrency(alreadyAsked)} ({pctText(alreadyAsked / basisAmount * 100)}) already requested</>}
                  {' '}· {formatCurrency(Math.max(remaining, 0))} left to request
                  {overAsk && <> — this asks for more than is left</>}
                </div>
              )}
            </div>
          </div>

          {/* Letter details */}
          <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Letter Details</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Reference</label>
                <input className={inputCls} value={saved?.request_number ?? 'Numbered on save (CPR-…)'} disabled />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Date</label>
                <input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} disabled={locked} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Heading <span className="text-slate-300">(optional)</span></label>
                <input className={inputCls} placeholder={KIND_LABEL[kind]} value={title} onChange={e => setTitle(e.target.value)} disabled={locked} />
              </div>
              {kind !== 'advance' && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Previously Paid (ETB)</label>
                  <input type="number" min={0} className={inputCls} value={previouslyPaid || ''}
                    onChange={e => setPreviouslyPaid(Number(e.target.value))} disabled={locked} />
                </div>
              )}
            </div>
          </div>

          {/* Bank details */}
          <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Bank Details</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Bank Name</label>
                <input className={inputCls} placeholder="Commercial Bank of Ethiopia" value={bankName} onChange={e => setBankName(e.target.value)} disabled={locked} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Account Number</label>
                <input className={inputCls} placeholder="1000123456789" value={accountNumber} onChange={e => setAccountNumber(e.target.value)} disabled={locked} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Account Name</label>
                <input className={inputCls} value={accountName} onChange={e => setAccountName(e.target.value)} disabled={locked} />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Additional Notes</h2>
            <textarea className={inputCls} rows={3} placeholder="Any additional terms or conditions…" value={notes} onChange={e => setNotes(e.target.value)} disabled={locked} />
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

