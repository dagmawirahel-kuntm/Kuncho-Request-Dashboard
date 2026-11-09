import { useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import { saveReceiptPhoto, useTaxRefresh } from '@/lib/taxes'

/**
 * Collect a VAT receipt as a picture (510): on a phone it opens the camera,
 * elsewhere a file picker (a photo, or a PDF the supplier sent). The picture
 * is kept with the purchase and the receipt counts as in hand.
 */
export function ReceiptPhotoButton({ expenseId, label = 'Photo', askNumber = true, className }: {
  expenseId: string
  label?: string
  /** Ask for the receipt number after the picture (optional to answer). */
  askNumber?: boolean
  className?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()
  const refresh = useTaxRefresh()

  async function onPick(file: File | undefined) {
    if (!file) return
    const no = askNumber ? window.prompt('The receipt number, if it shows (optional)') : ''
    if (no === null) { if (input.current) input.current.value = ''; return }
    setBusy(true)
    try {
      await saveReceiptPhoto(expenseId, file, no || null)
      toast('Receipt picture saved: its VAT is claimed', 'success')
      refresh()
    } catch (e) { toast((e as Error).message, 'error') }
    setBusy(false)
    if (input.current) input.current.value = ''
  }

  return (
    <>
      <input ref={input} type="file" accept="image/*,application/pdf" capture="environment" className="hidden"
        aria-hidden tabIndex={-1} onChange={e => onPick(e.target.files?.[0])} />
      <button type="button" disabled={busy} onClick={() => input.current?.click()}
        title="Take or upload a picture of the VAT receipt: it counts as in hand"
        className={className ?? 'inline-flex items-center gap-1 rounded-md border border-sky-300 px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-40 dark:border-sky-800 dark:text-sky-300 dark:hover:bg-sky-900/30'}>
        <Camera className="h-3 w-3" /> {busy ? 'Saving…' : label}
      </button>
    </>
  )
}
