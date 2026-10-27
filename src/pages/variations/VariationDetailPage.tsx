import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency as fmtMoney, formatDate } from '@/lib/utils'
import { fieldCls } from '@/lib/formStyles'
import { RecordHeader, RecordLayout, Panel, FactList, Pill, Stat, type RecordAction } from '@/components/record/Record'
import { ActionDialog } from '@/components/shared/ActionDialog'
import { FileUpload } from '@/components/shared/FileUpload'
import { DocumentFrame } from '@/components/documents/DocumentFrame'
import { printHtml } from '@/lib/documents/issue'
import { useCompanyProfile, useCompanySignoff } from '@/lib/companyProfile'
import { buildVariationAddendumHtml } from '@/lib/documents/variationDocument'
import {
  useVariation, useVariations, useContractSum, useVoSettings, VO_STATUS, VO_ORIGIN, VO_MANAGE_ROLES, VO_APPROVER_ROLES, BASE_SOURCE_LABEL,
} from '@/lib/variations'
import { Pencil, Send, CheckCircle2, XCircle, Printer, FileSignature, ShieldCheck, Undo2, Ban, Gift, ExternalLink, AtSign } from 'lucide-react'
import { EmailDocumentDialog } from '@/components/documents/EmailDocumentDialog'

const formatCurrency = (n: number) => fmtMoney(n).replace(/\.00$/, '')

// One variation order: what changed and its price, where it stands —
// to price → (executive) → ready → with the client → agreed — the addendum
// to print and send, and the signed copy once it's back (migration 459).

type Dialog = null | 'submit' | 'approve' | 'reject' | 'sent' | 'agreed' | 'declined' | 'absorbed' | 'cancelled' | 'email'

export default function VariationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { hasRole } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const canManage = hasRole(...VO_MANAGE_ROLES)
  const canApprove = hasRole(...VO_APPROVER_ROLES)
  const { data, isLoading } = useVariation(id)
  const vo = data?.vo
  const lines = useMemo(() => data?.lines ?? [], [data])
  const { data: sum } = useContractSum(vo?.project_id)
  const { data: projectVos = [] } = useVariations(vo?.project_id)
  const { data: settings } = useVoSettings()
  const { data: company } = useCompanyProfile()
  const { data: signoff } = useCompanySignoff()
  const [dialog, setDialog] = useState<Dialog>(null)

  const { data: client } = useQuery({
    queryKey: ['client-for-doc', vo?.client_id],
    enabled: !!vo?.client_id,
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('client_name, tin, address, phone_number, email').eq('id', vo!.client_id!).maybeSingle()
      if (error) throw error
      return data as { client_name: string; tin: string | null; address: string | null; phone_number: string | null; email: string | null } | null
    },
  })

  // The contract sum before this VO: the original plus the VOs agreed ahead of it.
  const earlierAgreed = projectVos.filter(v => v.status === 'agreed' && v.id !== vo?.id && v.vo_number < (vo?.vo_number ?? 0)).reduce((s, v) => s + v.total, 0)
  const original = sum?.base_value ?? null
  const sumBefore = original != null ? original + earlierAgreed : null
  const agreementRef = sum?.base_source === 'contract' || sum?.base_source === 'proforma' ? sum.base_ref : null

  const docInput = useMemo(() => (vo ? {
    code: vo.vo_code, date: vo.submitted_at?.slice(0, 10) ?? vo.instructed_on, projectName: vo.project_name, client: client ?? (vo.client_name ? { client_name: vo.client_name } : null),
    agreementRef, title: vo.title, description: vo.description, instructedBy: vo.instructed_by, instructedOn: vo.instructed_on,
    lines, amount: vo.amount, vatRate: vo.vat_rate, total: vo.total, timeExtensionDays: vo.time_extension_days,
    sumBefore, original, signoff, draft: !['ready', 'sent', 'agreed'].includes(vo.status),
  } : null), [vo, client, agreementRef, lines, sumBefore, original, signoff])
  // The company profile reaches the letterhead through setDocumentProfile,
  // so the preview is rebuilt when it loads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const preview = useMemo(() => (docInput ? buildVariationAddendumHtml({ ...docInput, preview: true }) : ''), [docInput, company])

  function refresh() { for (const k of ['variations', 'variation', 'contract-sum']) qc.invalidateQueries({ queryKey: [k] }) }
  async function run(fn: () => PromiseLike<{ error: { message: string } | null; data?: unknown }>, ok: string) {
    const { error, data: res } = await fn()
    if (error) { toast(error.message, 'error'); return false }
    toast(typeof res === 'string' && res === 'awaiting_exec' ? 'Submitted — it is large against the contract, so an executive approves it first' : ok, 'success')
    refresh(); setDialog(null); return true
  }

  if (isLoading) return <p className="py-12 text-center text-sm text-slate-400">Loading…</p>
  if (!vo) return <p className="py-12 text-center text-sm text-slate-500">Variation not found. <Link to="/variations" className="text-brand">All variations</Link></p>

  const st = VO_STATUS[vo.status]
  const editable = vo.status === 'draft' || vo.status === 'rejected'
  const sendable = vo.status === 'ready' || vo.status === 'sent'
  const open = !['agreed', 'declined', 'absorbed', 'cancelled'].includes(vo.status)
  const print = () => docInput && printHtml(buildVariationAddendumHtml(docInput), `${vo.vo_code} ${vo.project_name}`)

  const actions: RecordAction[] = [
    { label: vo.amount === 0 ? 'Price it' : 'Edit', icon: Pencil, to: `/variations/${vo.id}/edit`, primary: editable && vo.amount === 0, hidden: !canManage || !editable },
    { label: 'Submit', icon: Send, primary: true, onClick: () => setDialog('submit'), hidden: !canManage || !editable || vo.amount === 0 },
    { label: 'Approve', icon: ShieldCheck, primary: true, onClick: () => setDialog('approve'), hidden: !canApprove || vo.status !== 'awaiting_exec' },
    { label: 'Send back', icon: Undo2, onClick: () => setDialog('reject'), hidden: !canApprove || vo.status !== 'awaiting_exec' },
    { label: 'Email to client', icon: AtSign, primary: vo.status === 'ready', onClick: () => setDialog('email'), hidden: !sendable && vo.status !== 'agreed' },
    { label: 'Print addendum', icon: Printer, onClick: print, hidden: !sendable && vo.status !== 'agreed' },
    { label: 'Mark sent to client', icon: Send, onClick: () => setDialog('sent'), hidden: !canManage || vo.status !== 'ready' },
    { label: 'Client agreed', icon: FileSignature, primary: vo.status === 'sent', onClick: () => setDialog('agreed'), hidden: !canManage || !sendable },
    { label: 'Client declined', icon: XCircle, onClick: () => setDialog('declined'), hidden: !canManage || !sendable },
    { label: 'Do it free', icon: Gift, onClick: () => setDialog('absorbed'), hidden: !canManage || !open || (vo.amount !== 0 && !canApprove) },
    { label: 'Cancel', icon: Ban, danger: true, onClick: () => setDialog('cancelled'), hidden: !canManage || !open },
  ]

  const steps = [
    { label: 'Recorded', at: vo.created_at, done: true },
    { label: 'Priced & submitted', at: vo.submitted_at, done: !!vo.submitted_at && vo.status !== 'rejected' && vo.status !== 'draft' },
    ...(vo.needs_exec || vo.status === 'awaiting_exec' ? [{ label: 'Executive approved', at: vo.exec_decided_at, done: ['ready', 'sent', 'agreed'].includes(vo.status) }] : []),
    { label: 'Sent to client', at: vo.sent_at, done: !!vo.sent_at || vo.status === 'agreed' },
    { label: 'Client agreed', at: vo.agreed_at, done: vo.status === 'agreed' },
  ]

  return (
    <div className="space-y-4">
      <RecordHeader
        back={{ to: `/projects/${vo.project_id}?tab=variations`, label: vo.project_name }}
        code={vo.vo_code}
        title={vo.title}
        subtitle={`${vo.project_name}${vo.client_name ? ` · ${vo.client_name}` : ''}`}
        pills={<>
          <Pill tone={st.tone}>{st.label}</Pill>
          {vo.recorded_late && <Pill tone="amber">Recorded late</Pill>}
          {vo.origin === 'site_report' && <Pill>From a site report</Pill>}
        </>}
        actions={actions}
      />

      <RecordLayout
        main={<>
          <div className={`rounded-xl border px-4 py-3 text-sm ${vo.status === 'rejected' ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-800/50 dark:bg-red-900/15 dark:text-red-200' : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-300'}`}>
            <b>{st.label}.</b> {st.hint}.
            {vo.status === 'rejected' && vo.exec_note && <> Executive's note: “{vo.exec_note}”</>}
            {vo.status === 'draft' && vo.amount === 0 && ' Nothing is priced yet.'}
          </div>

          <ol className="flex flex-wrap gap-2">
            {steps.map((s, i) => (
              <li key={s.label} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${s.done ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200' : 'text-slate-500 dark:border-slate-700'}`}>
                {s.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="tabular-nums">{i + 1}</span>}
                {s.label}{s.done && s.at ? <span className="opacity-70">· {formatDate(s.at)}</span> : null}
              </li>
            ))}
          </ol>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="This variation" value={formatCurrency(vo.total)} sub={vo.vat_rate ? `${formatCurrency(vo.amount)} + VAT` : 'no VAT'} />
            <Stat label="Share of contract" value={vo.share_of_contract_pct != null ? `${vo.share_of_contract_pct}%` : original ? `${Math.round(Math.abs(vo.total) / original * 1000) / 10}%` : '—'} sub={`executive from ${settings?.exec_threshold_pct ?? 10}%`} />
            <Stat label="Contract before" value={sumBefore != null ? formatCurrency(sumBefore) : '—'} sub={sum?.base_source ? `from the ${BASE_SOURCE_LABEL[sum.base_source]}` : 'no contract value on record'} tone={sumBefore == null ? 'amber' : undefined} />
            <Stat label="Contract after" value={sumBefore != null ? formatCurrency(sumBefore + vo.total) : '—'} sub={vo.time_extension_days ? `+${vo.time_extension_days} days` : 'no time added'} />
          </div>

          <Panel title="The change">
            {vo.description ? <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{vo.description}</p> : <p className="text-sm text-slate-400">No details written.</p>}
            {lines.length > 0 && (
              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="py-1">Line</th><th className="py-1 text-right">Qty</th><th className="py-1 pl-2">Unit</th><th className="py-1 text-right">Rate</th><th className="py-1 text-right">Amount</th></tr></thead>
                <tbody className="divide-y dark:divide-slate-700/60">
                  {lines.map(l => (
                    <tr key={l.id}><td className="py-1.5 text-slate-700 dark:text-slate-200">{l.description}</td><td className="py-1.5 text-right tabular-nums">{l.quantity}</td><td className="py-1.5 pl-2 text-slate-500">{l.unit}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatCurrency(l.rate)}</td><td className={`py-1.5 text-right font-medium tabular-nums ${l.amount < 0 ? 'text-red-600' : ''}`}>{formatCurrency(l.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          {(vo.status !== 'draft' || vo.amount !== 0) && (
            <Panel title="Addendum" icon={FileSignature} action={<span className="flex items-center gap-3">
              {(sendable || vo.status === 'agreed') && <button onClick={() => setDialog('email')} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"><AtSign className="h-3.5 w-3.5" /> Email</button>}
              <button onClick={print} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"><Printer className="h-3.5 w-3.5" /> Print</button>
            </span>} padded={false}>
              <div className="h-[34rem]"><DocumentFrame html={preview} title="Variation addendum" /></div>
            </Panel>
          )}
        </>}
        rail={<>
          <Panel title="Details">
            <FactList facts={[
              { label: 'Project', value: <Link to={`/projects/${vo.project_id}?tab=variations`} className="text-brand hover:underline">{vo.project_name}</Link> },
              { label: 'Asked by', value: `${VO_ORIGIN[vo.origin]}${vo.instructed_by ? ` · ${vo.instructed_by}` : ''}` },
              { label: 'Instructed', value: formatDate(vo.instructed_on) },
              { label: 'Agreement', value: agreementRef ?? (sum?.base_source === 'project' ? 'Project value (no contract on record)' : 'None on record'), tone: agreementRef ? undefined : 'amber' },
              ...(vo.sent_to ? [{ label: 'Sent to', value: vo.sent_to }] : []),
              ...(vo.agreed_on ? [{ label: 'Agreed on', value: formatDate(vo.agreed_on) }] : []),
            ]} />
          </Panel>
          {(vo.agreement_evidence_url || vo.agreement_note) && (
            <Panel title="Client's agreement">
              {vo.agreement_evidence_url && <a href={vo.agreement_evidence_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-brand hover:underline">Signed addendum <ExternalLink className="h-3 w-3" /></a>}
              {vo.agreement_note && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{vo.agreement_note}</p>}
            </Panel>
          )}
          {vo.close_note && <Panel title="Closed"><p className="text-sm text-slate-600 dark:text-slate-300">{vo.close_note}</p></Panel>}
        </>}
      />

      {dialog === 'submit' && (
        <ActionDialog title={`Submit ${vo.vo_code}`} confirmLabel="Submit" onClose={() => setDialog(null)}
          onConfirm={() => run(() => supabase.rpc('submit_variation', { p_id: vo.id }), 'Submitted — ready to send to the client')}
          description={original
            ? `${formatCurrency(vo.total)} is ${Math.round(Math.abs(vo.total) / original * 1000) / 10}% of the contract. From ${settings?.exec_threshold_pct ?? 10}% an executive approves it before it goes to the client.`
            : 'There is no contract value on record for this project, so an executive approves it before it goes to the client.'} />
      )}
      {dialog === 'approve' && (
        <NoteDialog title={`Approve ${vo.vo_code}`} label="Note (optional)" confirm="Approve" optional onClose={() => setDialog(null)}
          onConfirm={note => run(() => supabase.rpc('decide_variation', { p_id: vo.id, p_approve: true, p_note: note || null }), 'Approved — ready to send to the client')} />
      )}
      {dialog === 'reject' && (
        <NoteDialog title={`Send ${vo.vo_code} back`} label="What to change" confirm="Send back" onClose={() => setDialog(null)}
          onConfirm={note => run(() => supabase.rpc('decide_variation', { p_id: vo.id, p_approve: false, p_note: note }), 'Sent back to the PM')} />
      )}
      {dialog === 'sent' && (
        <NoteDialog title="Sent to the client" label="To whom / how" placeholder="e.g. Emailed to Ato Bereket" confirm="Mark sent" optional onClose={() => setDialog(null)}
          onConfirm={note => run(() => supabase.rpc('mark_variation_sent', { p_id: vo.id, p_sent_to: note || null }), 'Marked sent')} />
      )}
      {dialog === 'email' && docInput && (
        <EmailDocumentDialog kind="variation" sourceId={vo.id} title={`variation order ${vo.vo_code}`} fileName={`${vo.vo_code} ${vo.project_name}`}
          party={client?.client_name ?? vo.client_name} defaultTo={client?.email}
          prepare={() => ({ html: buildVariationAddendumHtml(docInput) })}
          // Emailing a VO that is ready to go is sending it to the client.
          onSent={async to => {
            if (vo.status === 'ready' && canManage) await supabase.rpc('mark_variation_sent', { p_id: vo.id, p_sent_to: `Emailed to ${to.join(', ')}` })
            refresh()
          }}
          onClose={() => setDialog(null)} />
      )}
      {dialog === 'agreed' && <AgreedDialog code={vo.vo_code} onClose={() => setDialog(null)}
        onConfirm={(url, note, on) => run(() => supabase.rpc('record_variation_agreement', { p_id: vo.id, p_evidence_url: url, p_note: note, p_agreed_on: on }), `${vo.vo_code} agreed — the contract sum is updated`)} />}
      {(dialog === 'declined' || dialog === 'absorbed' || dialog === 'cancelled') && (
        <NoteDialog title={dialog === 'declined' ? 'Client declined' : dialog === 'absorbed' ? 'Do it free' : `Cancel ${vo.vo_code}`} label="Why" confirm="Confirm" onClose={() => setDialog(null)}
          onConfirm={note => run(() => supabase.rpc('close_variation', { p_id: vo.id, p_outcome: dialog, p_note: note }), 'Closed')} />
      )}
    </div>
  )
}

function NoteDialog({ title, label, placeholder, confirm, optional, onClose, onConfirm }: {
  title: string; label: string; placeholder?: string; confirm: string; optional?: boolean; onClose: () => void; onConfirm: (note: string) => Promise<boolean>
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <ActionDialog title={title} confirmLabel={confirm} onClose={onClose} busy={busy} canConfirm={optional || !!note.trim()}
      onConfirm={async () => { setBusy(true); await onConfirm(note.trim()); setBusy(false) }}>
      <label className="block text-xs text-slate-500">{label}
        <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} className={fieldCls} placeholder={placeholder} />
      </label>
    </ActionDialog>
  )
}

function AgreedDialog({ code, onClose, onConfirm }: { code: string; onClose: () => void; onConfirm: (url: string | null, note: string | null, on: string) => Promise<boolean> }) {
  const [file, setFile] = useState<{ url: string; name: string } | null>(null)
  const [note, setNote] = useState('')
  const [on, setOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  return (
    <ActionDialog title={`Client agreed ${code}`} description="Attach the signed addendum. If the client agreed another way (email, WhatsApp, a meeting), say how." confirmLabel="Record agreement"
      onClose={onClose} busy={busy} canConfirm={!!file || !!note.trim()}
      onConfirm={async () => { setBusy(true); await onConfirm(file?.url ?? null, note.trim() || null, on); setBusy(false) }}>
      <div className="space-y-2">
        <FileUpload bucket="documents" folder="variation-agreements" fileUrl={file?.url ?? null} fileName={file?.name ?? null}
          onUpload={(url, name) => setFile({ url, name })} onClear={() => setFile(null)} accept="image/*,application/pdf" label="Signed addendum" />
        <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} className={fieldCls} placeholder="e.g. Agreed by email from the client's PM, 26 Oct" />
        <label className="block text-xs text-slate-500">Agreed on<input type="date" value={on} onChange={e => setOn(e.target.value)} className={fieldCls} /></label>
      </div>
    </ActionDialog>
  )
}
