import { useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { Upload, X, FileText, ExternalLink, Link } from 'lucide-react'

interface FileUploadProps {
  bucket?: string
  folder?: string
  fileUrl: string | null
  fileName: string | null
  onUpload: (url: string, name: string) => void
  onClear: () => void
  accept?: string
  label?: string
}

export function FileUpload({
  bucket = 'documents',
  folder = 'uploads',
  fileUrl,
  fileName,
  onUpload,
  onClear,
  accept = 'image/*,application/pdf,.doc,.docx',
  label = 'Upload File',
}: FileUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setUploading(true)
    setError(null)
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${folder}/${Date.now()}-${safeName}`
    const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, { upsert: true })
    if (upErr) {
      setError(`Upload failed: ${upErr.message}`)
      setUploading(false)
      setShowUrlInput(true)
      return
    }
    const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(path)
    onUpload(publicUrl, file.name)
    setUploading(false)
  }

  function handleUrlAttach() {
    if (!urlInput.trim()) return
    onUpload(urlInput.trim(), urlInput.split('/').pop() ?? 'file')
    setUrlInput('')
    setShowUrlInput(false)
  }

  if (fileUrl) {
    return (
      <div className="flex items-center gap-2 rounded-lg border dark:border-slate-600 bg-slate-50 dark:bg-slate-800/60 px-3 py-2">
        <FileText className="h-4 w-4 text-brand flex-shrink-0" />
        <a
          href={fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-1 items-center gap-1 truncate text-sm text-brand hover:underline"
        >
          {fileName || 'Attached file'} <ExternalLink className="h-3 w-3 flex-shrink-0" />
        </a>
        <button
          type="button"
          onClick={onClear}
          className="flex-shrink-0 rounded p-0.5 text-slate-400 hover:text-red-500"
          title="Remove attachment"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-1.5 rounded-md border dark:border-slate-600 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5" />
          {uploading ? 'Uploading…' : label}
        </button>
        <button
          type="button"
          onClick={() => setShowUrlInput(s => !s)}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 underline"
        >
          <Link className="h-3 w-3" /> paste URL
        </button>
      </div>

      {showUrlInput && (
        <div className="flex gap-2">
          <input
            type="url"
            placeholder="https://..."
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleUrlAttach()}
            className="flex-1 rounded-md border dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand"
          />
          <button
            type="button"
            onClick={handleUrlAttach}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand/90"
          >
            Attach
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error} — try pasting the URL instead.</p>}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}
