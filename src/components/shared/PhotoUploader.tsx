import { useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Camera, Loader2, X } from 'lucide-react'
import type { DeliveryPhoto } from '@/types/database'

// Several photos of one thing — a delivery on the truck, the damaged
// bags, the signed paper. On a phone the picker offers the camera.
//
// A phone photo is 3–8 MB, which timed out on a weak signal. Each one is
// shrunk on the phone first (long side 1600 px, JPEG): a few hundred KB,
// still sharp enough to read a receipt.
const MAX_SIDE = 1600

async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.size < 400_000) return file
  try {
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * k)
    canvas.height = Math.round(bmp.height * k)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    bmp.close()
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.72))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file   // a format the browser can't draw (some HEIC): send it as it is
  }
}
export function PhotoUploader({ photos, onChange, folder, label = 'Add photos' }: {
  photos: DeliveryPhoto[]
  onChange: (next: DeliveryPhoto[]) => void
  folder: string
  label?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(0)
  const [error, setError] = useState<string | null>(null)

  async function upload(files: FileList) {
    setError(null)
    const list = Array.from(files)
    setUploading(n => n + list.length)
    const added: DeliveryPhoto[] = []
    for (const original of list) {
      const file = await shrink(original)
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safeName}`
      const { error: upErr } = await supabase.storage.from('documents').upload(path, file, { upsert: false })
      if (upErr) { setError(`${file.name}: ${upErr.message}`) }
      else added.push({ url: supabase.storage.from('documents').getPublicUrl(path).data.publicUrl, name: file.name })
      setUploading(n => n - 1)
    }
    if (added.length) onChange([...photos, ...added])
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {photos.map((p, i) => (
          <div key={p.url} className="group relative h-20 w-20 overflow-hidden rounded-lg border dark:border-slate-600">
            <a href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt={p.name ?? `Photo ${i + 1}`} className="h-full w-full object-cover" /></a>
            <button type="button" onClick={() => onChange(photos.filter((_, j) => j !== i))} aria-label="Remove photo"
              className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white">
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading > 0}
          className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-[11px] text-slate-500 hover:border-brand hover:text-brand disabled:opacity-60 dark:border-slate-600 dark:text-slate-400">
          {uploading > 0 ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
          {uploading > 0 ? 'Uploading…' : label}
        </button>
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
        onChange={e => { if (e.target.files?.length) upload(e.target.files); e.target.value = '' }} />
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
