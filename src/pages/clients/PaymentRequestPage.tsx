import { useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Printer } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Client } from '@/types/database'

const inputCls =
  'w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:text-slate-100'

function formatCurrency(n: number): string {
  return `ETB ${n.toLocaleString('en-ET', { minimumFractionDigits: 2 })}`
}

export default function PaymentRequestPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
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

  const [refNum, setRefNum] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [projectName, setProjectName] = useState('')
  const [contractNumber, setContractNumber] = useState('')
  const [contractValue, setContractValue] = useState<number>(0)
  const [advancePct, setAdvancePct] = useState<number>(30)
  const [milestone, setMilestone] = useState('')
  const [previouslyPaid, setPreviouslyPaid] = useState<number>(0)
  const [amountRequested, setAmountRequested] = useState<number>(0)
  const [bankName, setBankName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountName, setAccountName] = useState('Kuncho Construction & Events')
  const [notes, setNotes] = useState('')

  const computedAdvance = isNew ? (contractValue * advancePct) / 100 : 0
  const effectiveAmount = isNew ? (amountRequested || computedAdvance) : amountRequested

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500 dark:text-slate-400">
        Loading…
      </div>
    )
  }

  const title = isNew
    ? 'Payment Request — New Contract'
    : 'Payment Request — Existing Contract'

  const bodyParagraphs = isNew
    ? [
        `We are pleased to submit our payment request for the advance payment in connection with the captioned project. As per the terms of the contract, we hereby request the release of the advance payment of ${advancePct}% of the total contract value.`,
        `The details of the contract and the requested payment are as follows:`,
      ]
    : [
        `We are pleased to submit our payment request for the progress payment in connection with the captioned project. The works have been executed in accordance with the contract specifications and we request the release of the payment for the completed milestone.`,
        `The details of the progress payment are as follows:`,
      ]

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
        <div className="flex items-center justify-between flex-wrap gap-3">
          <button
            onClick={() => navigate(`/clients/${id}`)}
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Client
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">{title}</h1>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90"
            >
              <Printer className="w-4 h-4" />
              Print / Download
            </button>
          </div>
        </div>

        {/* Letter meta */}
        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Letter Details
          </h2>
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
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Advance Payment % (auto-computes amount)</label>
                <input type="number" min={0} max={100} className={inputCls} value={advancePct} onChange={e => setAdvancePct(Number(e.target.value))} />
                {contractValue > 0 && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    = {formatCurrency(computedAdvance)}
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Milestone / Progress Description</label>
                <input className={inputCls} placeholder="e.g. Phase 1 — 50% completion" value={milestone} onChange={e => setMilestone(e.target.value)} />
              </div>
            )}
            {!isNew && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Previously Paid Amount (ETB)</label>
                <input type="number" min={0} className={inputCls} value={previouslyPaid || ''} onChange={e => setPreviouslyPaid(Number(e.target.value))} />
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Amount Requested (ETB){isNew ? ' — leave 0 to use computed advance' : ''}</label>
              <input type="number" min={0} className={inputCls} value={amountRequested || ''} onChange={e => setAmountRequested(Number(e.target.value))} />
            </div>
          </div>
        </div>

        {/* Bank details */}
        <div className="rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Bank Details
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Bank Name</label>
              <input className={inputCls} placeholder="e.g. Commercial Bank of Ethiopia" value={bankName} onChange={e => setBankName(e.target.value)} />
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
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Additional Notes
          </h2>
          <textarea
            className={inputCls}
            rows={3}
            placeholder="Any additional terms, conditions, or notes…"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>
      </div>

      {/* ── Print Layout ── */}
      <div className="print-only hidden fixed inset-0 bg-white p-12 text-black z-50" style={{ fontFamily: 'Georgia, serif' }}>
        {/* Letterhead */}
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="text-3xl font-black tracking-tight text-gray-900">ቁ KUNCHO</div>
            <div className="text-sm text-gray-500 mt-0.5">Construction &amp; Events</div>
            <div className="text-xs text-gray-400 mt-0.5">Addis Ababa, Ethiopia</div>
          </div>
          <div className="text-right text-sm text-gray-700">
            {refNum && <div className="font-semibold">Ref: {refNum}</div>}
            <div>{date}</div>
          </div>
        </div>

        <hr className="border-gray-800 mb-5" />

        {/* Addressee */}
        <div className="mb-5">
          <div className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">To:</div>
          <div className="font-bold text-gray-900">{client?.client_name}</div>
          {client?.address && <div className="text-sm text-gray-700">{client.address}</div>}
          {client?.email && <div className="text-sm text-gray-700">{client.email}</div>}
          {client?.phone_number && <div className="text-sm text-gray-700">{client.phone_number}</div>}
        </div>

        {/* Subject */}
        <div className="mb-5">
          <div className="text-sm font-bold text-gray-900 underline">
            SUBJECT: PAYMENT REQUEST — {projectName ? projectName.toUpperCase() : '[PROJECT NAME]'}
            {contractNumber && ` (${contractNumber})`}
          </div>
        </div>

        {/* Body */}
        <div className="space-y-3 text-sm text-gray-800 mb-5 leading-relaxed">
          {bodyParagraphs.map((p, i) => <p key={i}>{p}</p>)}

          {/* Contract details table */}
          <table className="w-full border-collapse border border-gray-400 text-sm mt-3">
            <tbody>
              <tr className="border border-gray-300">
                <td className="py-1.5 px-3 font-semibold bg-gray-50 w-52">Project / Contract</td>
                <td className="py-1.5 px-3">{projectName || '—'}</td>
              </tr>
              {contractNumber && (
                <tr className="border border-gray-300">
                  <td className="py-1.5 px-3 font-semibold bg-gray-50">Contract Number</td>
                  <td className="py-1.5 px-3">{contractNumber}</td>
                </tr>
              )}
              <tr className="border border-gray-300">
                <td className="py-1.5 px-3 font-semibold bg-gray-50">Total Contract Value</td>
                <td className="py-1.5 px-3">{formatCurrency(contractValue)}</td>
              </tr>
              {isNew && (
                <tr className="border border-gray-300">
                  <td className="py-1.5 px-3 font-semibold bg-gray-50">Advance Payment ({advancePct}%)</td>
                  <td className="py-1.5 px-3">{formatCurrency(computedAdvance)}</td>
                </tr>
              )}
              {!isNew && milestone && (
                <tr className="border border-gray-300">
                  <td className="py-1.5 px-3 font-semibold bg-gray-50">Milestone / Progress</td>
                  <td className="py-1.5 px-3">{milestone}</td>
                </tr>
              )}
              {!isNew && previouslyPaid > 0 && (
                <tr className="border border-gray-300">
                  <td className="py-1.5 px-3 font-semibold bg-gray-50">Previously Paid</td>
                  <td className="py-1.5 px-3">{formatCurrency(previouslyPaid)}</td>
                </tr>
              )}
              <tr className="border border-gray-300 bg-gray-900 text-white">
                <td className="py-2 px-3 font-bold">Amount Requested</td>
                <td className="py-2 px-3 font-bold">{formatCurrency(effectiveAmount)}</td>
              </tr>
            </tbody>
          </table>

          {/* Bank details */}
          {(bankName || accountNumber) && (
            <>
              <p className="mt-4">
                We kindly request that the payment be made to our bank account as detailed below:
              </p>
              <table className="w-full border-collapse border border-gray-400 text-sm">
                <tbody>
                  {bankName && (
                    <tr className="border border-gray-300">
                      <td className="py-1.5 px-3 font-semibold bg-gray-50 w-52">Bank Name</td>
                      <td className="py-1.5 px-3">{bankName}</td>
                    </tr>
                  )}
                  <tr className="border border-gray-300">
                    <td className="py-1.5 px-3 font-semibold bg-gray-50">Account Name</td>
                    <td className="py-1.5 px-3">{accountName}</td>
                  </tr>
                  {accountNumber && (
                    <tr className="border border-gray-300">
                      <td className="py-1.5 px-3 font-semibold bg-gray-50">Account Number</td>
                      <td className="py-1.5 px-3">{accountNumber}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}

          {notes && <p className="mt-3 italic text-gray-600">{notes}</p>}

          <p className="mt-4">
            We trust that the above request will receive your favourable consideration and look forward to your prompt response.
          </p>
          <p>Thank you for your continued partnership.</p>
        </div>

        {/* Signature */}
        <div className="mt-8 grid grid-cols-2 gap-16 text-sm">
          <div>
            <div className="text-gray-500 mb-8">Prepared by:</div>
            <div className="border-t border-gray-400 pt-1">
              <div className="font-semibold">Authorised Signatory</div>
              <div className="text-gray-600">Kuncho Construction &amp; Events</div>
            </div>
          </div>
          <div>
            <div className="text-gray-500 mb-8">Received by:</div>
            <div className="border-t border-gray-400 pt-1">
              <div className="font-semibold">Representative</div>
              <div className="text-gray-600">{client?.client_name}</div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="absolute bottom-8 left-12 right-12 text-xs text-gray-400 border-t border-gray-200 pt-3">
          Kuncho Construction &amp; Events · Addis Ababa, Ethiopia · {refNum && `Ref: ${refNum} · `}Date: {date}
        </div>
      </div>
    </div>
  )
}
