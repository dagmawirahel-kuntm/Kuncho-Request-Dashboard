import { useEffect, useRef, useState } from 'react'
import { Camera, ImageUp, Loader2 } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import { uploadWorkerPhoto } from '@/lib/workerPhotos'

const SIZE = { sm: 'h-7 w-7 text-[10px]', md: 'h-10 w-10 text-xs', lg: 'h-16 w-16 text-base' } as const
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')

/** The worker's photo, or their initials when there is none yet. */
export function WorkerAvatar({ url, name, size = 'md' }: { url?: string | null; name: string; size?: keyof typeof SIZE }) {
  return url
    ? <img src={url} alt={name} loading="lazy" className={`${SIZE[size]} shrink-0 rounded-full border object-cover dark:border-slate-600`} />
    : <span aria-hidden className={`${SIZE[size]} inline-flex shrink-0 items-center justify-center rounded-full bg-slate-100 font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-300`}>{initials(name) || '?'}</span>
}

/** Tap for the worker's photo: take it with the camera, or choose a picture
 *  from the phone's gallery or the computer's files. Shows the photo once
 *  added; tap again to change it. */
export function PhotoButton({ url, name, onPhoto, size = 'md', disabled }: {
  url?: string | null; name: string; onPhoto: (url: string) => void | Promise<void>; size?: keyof typeof SIZE; disabled?: boolean
}) {
  const { toast } = useToast()
  const camera = useRef<HTMLInputElement>(null)
  const files = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState(false)
  const [busy, setBusy] = useState(false)

  // Close the choice when tapping anywhere else.
  useEffect(() => {
    if (!menu) return
    const close = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setMenu(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menu])

  async function pick(input: HTMLInputElement | null) {
    const file = input?.files?.[0]
    if (!file) return
    setMenu(false)
    if (!file.type.startsWith('image/')) { toast('Choose a picture (a photo file)', 'error'); input.value = ''; return }
    setBusy(true)
    try {
      await onPhoto(await uploadWorkerPhoto(file))
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
      input.value = ''
    }
  }

  const who = name.trim() ? `${name.trim()}'s` : 'the'
  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" disabled={disabled || busy} onClick={() => setMenu(m => !m)}
        title={url ? `Change ${who} photo` : `Add ${who} photo`} aria-haspopup="menu" aria-expanded={menu}
        className="relative block rounded-full disabled:opacity-60">
        {url ? <WorkerAvatar url={url} name={name} size={size} /> : (
          <span className={`${SIZE[size]} inline-flex items-center justify-center rounded-full border-2 border-dashed border-brand/50 bg-brand/5 text-brand`}>
            <Camera className="h-4 w-4" />
          </span>
        )}
        {busy && <span className="absolute inset-0 inline-flex items-center justify-center rounded-full bg-white/70 dark:bg-slate-900/70"><Loader2 className="h-4 w-4 animate-spin text-brand" /></span>}
        {url && !busy && <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-brand p-0.5 text-white"><Camera className="h-2.5 w-2.5" /></span>}
      </button>
      {menu && (
        <div role="menu" className="absolute left-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-lg border bg-white py-1 text-sm shadow-lg dark:border-slate-600 dark:bg-slate-800">
          <button type="button" role="menuitem" onClick={() => camera.current?.click()} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700">
            <Camera className="h-4 w-4 text-slate-400" /> Take photo
          </button>
          <button type="button" role="menuitem" onClick={() => files.current?.click()} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700">
            <ImageUp className="h-4 w-4 text-slate-400" /> Choose from files
          </button>
        </div>
      )}
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => pick(e.currentTarget)} />
      <input ref={files} type="file" accept="image/*" className="hidden" onChange={e => pick(e.currentTarget)} />
    </div>
  )
}
