import type { ContactRole, InteractionKind, TimelineKind } from '@/types/database'
import {
  Banknote, CalendarCheck, FileSignature, FileText, Flag, Handshake, HardHat, Mail, MessageCircle,
  MessagesSquare, MoveRight, Paperclip, Phone, Receipt, ThumbsDown, Trophy, Users, type LucideIcon,
} from 'lucide-react'

/** The strands of a client relationship; each timeline event belongs to one. */
export type Strand = 'deals' | 'money' | 'projects' | 'talks' | 'docs'

export const STRANDS: { value: Strand; label: string; dot: string; hollow: string; chip: string }[] = [
  { value: 'deals',    label: 'Deals & contracts', dot: 'bg-indigo-500', hollow: 'border-indigo-500',  chip: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-300 dark:border-indigo-800/40' },
  { value: 'money',    label: 'Invoices & payments', dot: 'bg-emerald-500', hollow: 'border-emerald-500', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800/40' },
  { value: 'projects', label: 'Projects',          dot: 'bg-amber-500', hollow: 'border-amber-500',   chip: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800/40' },
  { value: 'talks',    label: 'Conversations',     dot: 'bg-sky-500', hollow: 'border-sky-500',     chip: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/20 dark:text-sky-300 dark:border-sky-800/40' },
  { value: 'docs',     label: 'Documents',         dot: 'bg-slate-400', hollow: 'border-slate-400',   chip: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700' },
]
export const STRAND_BY_VALUE = Object.fromEntries(STRANDS.map(s => [s.value, s])) as Record<Strand, (typeof STRANDS)[number]>

export const EVENT_META: Record<TimelineKind, { label: string; strand: Strand; icon: LucideIcon }> = {
  deal_opened:      { label: 'Deal opened',       strand: 'deals',    icon: Flag },
  deal_moved:       { label: 'Deal moved',        strand: 'deals',    icon: MoveRight },
  deal_won:         { label: 'Deal won',          strand: 'deals',    icon: Trophy },
  deal_lost:        { label: 'Deal lost',         strand: 'deals',    icon: ThumbsDown },
  proforma:         { label: 'Proforma',          strand: 'deals',    icon: FileText },
  contract_drafted: { label: 'Contract drafted',  strand: 'deals',    icon: FileSignature },
  contract_signed:  { label: 'Contract signed',   strand: 'deals',    icon: Handshake },
  invoice:          { label: 'Invoice',           strand: 'money',    icon: Receipt },
  payment:          { label: 'Payment received',  strand: 'money',    icon: Banknote },
  project_started:  { label: 'Project started',   strand: 'projects', icon: HardHat },
  handover_due:     { label: 'Handover due',      strand: 'projects', icon: CalendarCheck },
  interaction:      { label: 'Conversation',      strand: 'talks',    icon: MessagesSquare },
  document:         { label: 'Document filed',    strand: 'docs',     icon: Paperclip },
}

export const CONTACT_ROLES: { value: ContactRole; label: string }[] = [
  { value: 'decision_maker', label: 'Decision maker' },
  { value: 'procurement',    label: 'Procurement' },
  { value: 'finance',        label: 'Finance' },
  { value: 'project',        label: 'Project lead' },
  { value: 'site',           label: 'Site' },
  { value: 'other',          label: 'Other' },
]
export const CONTACT_ROLE_LABEL = Object.fromEntries(CONTACT_ROLES.map(r => [r.value, r.label])) as Record<ContactRole, string>

export const INTERACTION_KINDS: { value: InteractionKind; label: string; icon: LucideIcon }[] = [
  { value: 'call',       label: 'Call',       icon: Phone },
  { value: 'meeting',    label: 'Meeting',    icon: Users },
  { value: 'site_visit', label: 'Site visit', icon: HardHat },
  { value: 'whatsapp',   label: 'WhatsApp',   icon: MessageCircle },
  { value: 'email',      label: 'Email',      icon: Mail },
  { value: 'other',      label: 'Other',      icon: MessagesSquare },
]
export const INTERACTION_BY_VALUE = Object.fromEntries(INTERACTION_KINDS.map(k => [k.value, k])) as Record<InteractionKind, (typeof INTERACTION_KINDS)[number]>

export function daysSince(iso: string | null): number | null {
  if (!iso) return null
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
}

/**
 * How recently we spoke to someone, against the windows in sales_settings:
 * warm within `warmDays`, active within `activeDays`, cold after that.
 */
export function warmth(lastIso: string | null, warmDays: number, activeDays: number) {
  const d = daysSince(lastIso)
  if (d == null) return { tone: 'never' as const, label: 'Not contacted yet', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400' }
  const label = d === 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`
  if (d <= warmDays) return { tone: 'warm' as const, label, cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' }
  if (d <= activeDays) return { tone: 'cooling' as const, label, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' }
  return { tone: 'cold' as const, label, cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' }
}

/** WhatsApp link for an Ethiopian number written locally (09…) or internationally. */
export function whatsappLink(phone: string) {
  let d = phone.replace(/\D/g, '')
  if (d.startsWith('0')) d = '251' + d.slice(1)
  return `https://wa.me/${d}`
}
