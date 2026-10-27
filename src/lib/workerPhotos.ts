// A casual worker's photo (migration 481): taken when they are hired, shown
// wherever someone has to tell who is who — the picker, the request, the
// day sheet, HR's register. Stored with the other staff photos.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/** Phones take 3–8 MB pictures; a face needs far less. */
async function shrink(file: File, max = 800): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * k)
    canvas.height = Math.round(bmp.height * k)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('no image'))), 'image/jpeg', 0.82))
  } catch {
    return file // a format the browser can't draw: send it as it is
  }
}

/** Uploads the photo and returns its address. */
export async function uploadWorkerPhoto(file: File): Promise<string> {
  const blob = await shrink(file)
  const path = `staff-photos/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from('documents').upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false })
  if (error) throw new Error(`The photo didn't upload: ${error.message}`)
  return supabase.storage.from('documents').getPublicUrl(path).data.publicUrl
}

/** Photos by id, for workers (staff) and people named but not hired yet (candidates). */
export function useWorkerPhotos(staffIds: (string | null | undefined)[], candidateIds: (string | null | undefined)[] = []) {
  const s = [...new Set(staffIds.filter(Boolean) as string[])].sort()
  const c = [...new Set(candidateIds.filter(Boolean) as string[])].sort()
  return useQuery({
    queryKey: ['worker-photos', s.join(','), c.join(',')],
    enabled: s.length + c.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const out: Record<string, string> = {}
      if (s.length) {
        const { data } = await supabase.from('staff').select('id, photo_url').in('id', s).not('photo_url', 'is', null)
        for (const r of (data ?? []) as { id: string; photo_url: string }[]) out[r.id] = r.photo_url
      }
      if (c.length) {
        const { data } = await supabase.from('candidates').select('id, photo_url').in('id', c).not('photo_url', 'is', null)
        for (const r of (data ?? []) as { id: string; photo_url: string }[]) out[r.id] = r.photo_url
      }
      return out
    },
  })
}

/** Save a photo taken for someone already on a request. */
export async function setWorkerPhoto(who: { staff_id?: string | null; candidate_id?: string | null }, url: string) {
  const { error } = await supabase.rpc('set_worker_photo', { p_staff: who.staff_id ?? null, p_candidate: who.staff_id ? null : who.candidate_id ?? null, p_url: url })
  if (error) throw new Error(error.message)
}
