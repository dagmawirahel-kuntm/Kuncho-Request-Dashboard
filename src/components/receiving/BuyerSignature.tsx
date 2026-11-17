import { PenLine } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { SignaturePad } from '@/components/shared/SignaturePad'

// Only the PO's buyer signs for its goods (531); an admin may too. Anyone
// else who receives them records them with a photo instead.
export function BuyerSignature({ buyerId, buyerName, value, onChange }: {
  buyerId: string | null | undefined
  buyerName: string | null | undefined
  value: string | null
  onChange: (sig: string | null) => void
}) {
  const { profile } = useAuth()
  const isBuyer = !!profile && (profile.role === 'admin' || (!!buyerId && profile.id === buyerId))
  if (!isBuyer) {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
        <PenLine className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span>Only <b>{buyerName ?? 'the buyer'}</b>, the buyer, signs for these goods. Record them with a photo below, or ask {buyerName?.split(' ')[0] ?? 'them'} to mark them collected.</span>
      </p>
    )
  }
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">
        {profile?.full_name ?? 'You'} signs as the buyer <span className="text-brand">*</span>
      </p>
      <SignaturePad value={value} onChange={onChange} label="Sign: the goods are as counted above" />
    </div>
  )
}
