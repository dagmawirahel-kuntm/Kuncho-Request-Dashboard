import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { CONTACT_ROLES, INTERACTION_KINDS } from '@/lib/clientHistory'
import type { ClientContact, ContactRole, InteractionKind } from '@/types/database'
import { X } from 'lucide-react'
import { useRefreshClientHistory } from './useRefreshClientHistory'

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const labelCls = 'mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400'

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800 sm:rounded-xl"
        onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Log a call, meeting, site visit, WhatsApp or email with a client — who it
 * was with, what it was about, and the next step (migration 334).
 */
export function LogInteractionDialog({ clientId, contacts, deals, projects, defaultContactId, userId, onClose }: {
  clientId: string
  contacts: ClientContact[]
  deals: { id: string; title: string }[]
  projects: { id: string; project_name: string }[]
  defaultContactId?: string | null
  userId: string | undefined
  onClose: () => void
}) {
  const { toast } = useToast()
  const refresh = useRefreshClientHistory(clientId)
  const [kind, setKind] = useState<InteractionKind>('call')
  const [contactId, setContactId] = useState<string>(defaultContactId ?? '')
  const [dealId, setDealId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [when, setWhen] = useState(toLocalInput(new Date()))
  const [summary, setSummary] = useState('')
  const [nextStep, setNextStep] = useState('')
  const [nextDue, setNextDue] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!summary.trim()) { toast('Say what the conversation was about', 'error'); return }
    if (nextDue && !nextStep.trim()) { toast('Add the next step for that due date', 'error'); return }
    setBusy(true)
    const { error } = await supabase.from('client_interactions').insert([{
      client_id: clientId, kind, summary: summary.trim(),
      contact_id: contactId || null, opportunity_id: dealId || null, project_id: projectId || null,
      occurred_at: new Date(when).toISOString(),
      next_step: nextStep.trim() || null, next_step_due: nextDue || null,
      logged_by: userId,
    }])
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    refresh()
    toast('Logged', 'success')
    onClose()
  }

  return (
    <Shell title="Log a conversation" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          {INTERACTION_KINDS.map(k => (
            <button key={k.value} type="button" onClick={() => setKind(k.value)} aria-pressed={kind === k.value}
              className={`flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[11px] font-medium transition-colors ${kind === k.value ? 'border-brand bg-brand/10 text-brand' : 'text-slate-500 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
              <k.icon className="h-4 w-4" /> {k.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block"><span className={labelCls}>With</span>
            <select className={inputCls} value={contactId} onChange={e => setContactId(e.target.value)}>
              <option value="">— No one in particular —</option>
              {contacts.filter(c => c.is_active).map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select>
          </label>
          <label className="block"><span className={labelCls}>When</span>
            <input type="datetime-local" className={inputCls} value={when} onChange={e => setWhen(e.target.value)} />
          </label>
          <label className="block"><span className={labelCls}>About a deal</span>
            <select className={inputCls} value={dealId} onChange={e => setDealId(e.target.value)}>
              <option value="">—</option>
              {deals.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
          </label>
          <label className="block"><span className={labelCls}>About a project</span>
            <select className={inputCls} value={projectId} onChange={e => setProjectId(e.target.value)}>
              <option value="">—</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.project_name}</option>)}
            </select>
          </label>
        </div>
        <label className="block"><span className={labelCls}>What was said *</span>
          <textarea rows={3} className={inputCls} value={summary} onChange={e => setSummary(e.target.value)} autoFocus
            placeholder="e.g. Walked the villa with the owner; wants the kitchen and two bathrooms quoted" />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_10rem]">
          <label className="block"><span className={labelCls}>Next step</span>
            <input className={inputCls} value={nextStep} onChange={e => setNextStep(e.target.value)} placeholder="e.g. Send the proforma" />
          </label>
          <label className="block"><span className={labelCls}>Due</span>
            <input type="date" className={inputCls} value={nextDue} onChange={e => setNextDue(e.target.value)} />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">Cancel</button>
          <button type="button" onClick={save} disabled={busy} className="rounded-md bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-50">{busy ? 'Saving…' : 'Log it'}</button>
        </div>
      </div>
    </Shell>
  )
}

/** Add someone at the client, or edit them. */
export function ContactDialog({ clientId, contact, onClose }: {
  clientId: string
  contact: ClientContact | null
  onClose: () => void
}) {
  const { toast } = useToast()
  const refresh = useRefreshClientHistory(clientId)
  const [form, setForm] = useState({
    full_name: contact?.full_name ?? '',
    role: (contact?.role ?? 'other') as ContactRole,
    job_title: contact?.job_title ?? '',
    phone: contact?.phone ?? '',
    email: contact?.email ?? '',
    is_primary: contact?.is_primary ?? false,
    is_active: contact?.is_active ?? true,
    notes: contact?.notes ?? '',
  })
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    if (!form.full_name.trim()) { toast('Add their name', 'error'); return }
    setBusy(true)
    // Only one primary contact per client: hand the flag over first.
    if (form.is_primary && !contact?.is_primary) {
      const { error } = await supabase.from('client_contacts').update({ is_primary: false }).eq('client_id', clientId).eq('is_primary', true)
      if (error) { setBusy(false); toast(error.message, 'error'); return }
    }
    const payload = {
      full_name: form.full_name.trim(), role: form.role,
      job_title: form.job_title.trim() || null, phone: form.phone.trim() || null, email: form.email.trim() || null,
      is_primary: form.is_primary, is_active: form.is_active, notes: form.notes.trim() || null,
    }
    const { error } = contact
      ? await supabase.from('client_contacts').update(payload).eq('id', contact.id)
      : await supabase.from('client_contacts').insert([{ ...payload, client_id: clientId }])
    setBusy(false)
    if (error) { toast(error.message, 'error'); return }
    refresh()
    toast(contact ? 'Contact updated' : 'Contact added', 'success')
    onClose()
  }

  return (
    <Shell title={contact ? `Edit ${contact.full_name}` : 'Add a contact'} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block"><span className={labelCls}>Name *</span>
            <input className={inputCls} value={form.full_name} onChange={e => set('full_name', e.target.value)} autoFocus />
          </label>
          <label className="block"><span className={labelCls}>Job title</span>
            <input className={inputCls} value={form.job_title} onChange={e => set('job_title', e.target.value)} placeholder="e.g. Procurement Manager" />
          </label>
          <label className="block"><span className={labelCls}>Phone</span>
            <input className={inputCls} value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="09…" inputMode="tel" />
          </label>
          <label className="block"><span className={labelCls}>Email</span>
            <input type="email" className={inputCls} value={form.email} onChange={e => set('email', e.target.value)} />
          </label>
        </div>
        <div>
          <span className={labelCls}>What they do for us</span>
          <div className="flex flex-wrap gap-1.5">
            {CONTACT_ROLES.map(r => (
              <button key={r.value} type="button" onClick={() => set('role', r.value)} aria-pressed={form.role === r.value}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${form.role === r.value ? 'border-brand bg-brand text-white' : 'text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <label className="block"><span className={labelCls}>Notes</span>
          <textarea rows={2} className={inputCls} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="e.g. Prefers WhatsApp; signs off anything above 1M" />
        </label>
        <div className="flex flex-wrap gap-4 text-sm text-slate-600 dark:text-slate-300">
          <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={form.is_primary} onChange={e => set('is_primary', e.target.checked)} /> Main contact</label>
          <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} /> Still there</label>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">Cancel</button>
          <button type="button" onClick={save} disabled={busy} className="rounded-md bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-50">{busy ? 'Saving…' : contact ? 'Save' : 'Add'}</button>
        </div>
      </div>
    </Shell>
  )
}
