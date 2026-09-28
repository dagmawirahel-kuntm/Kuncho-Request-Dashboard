import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { setDocumentProfile, DEFAULT_PROFILE, type CompanyProfile, type CompanySignoff } from '@/lib/documentTheme'

/** Roles that edit the company profile and can put the signature and stamp on documents (migration 368). */
export const PROFILE_EDIT_ROLES = ['admin', 'executive', 'finance']

/**
 * The company's identity for documents. Loading it also hands it to the
 * document builders, so every letterhead picks it up; pages that build a
 * document should call this and include the result in their memo deps.
 */
export function useCompanyProfile() {
  const q = useQuery({
    queryKey: ['company-profile'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('company_profile').select('*').maybeSingle()
      if (error) throw error
      return (data ?? DEFAULT_PROFILE) as CompanyProfile
    },
  })
  // Set synchronously on the render that has the data, so a memo that
  // builds a document in the same render already sees it.
  if (q.data) setDocumentProfile(q.data)
  useEffect(() => { if (q.data) setDocumentProfile(q.data) }, [q.data])
  return q
}

/** The signatory, signature and stamp — only for the roles that issue documents. */
export function useCompanySignoff() {
  const { role } = useAuth()
  const allowed = PROFILE_EDIT_ROLES.includes(role ?? '')
  return useQuery({
    queryKey: ['company-signoff'],
    enabled: allowed,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('company_signoff').select('*').maybeSingle()
      if (error) throw error
      return (data ?? null) as CompanySignoff | null
    },
  })
}

/** Read an image file, scale it down, and return it as a data URL small enough to store on the row. */
export function imageToDataUrl(file: File, maxSide = 600): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) { reject(new Error('Pick an image file')); return }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the file'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Could not open the image'))
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.width * scale))
        canvas.height = Math.max(1, Math.round(img.height * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('Could not process the image')); return }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        // PNG keeps a transparent signature or stamp transparent.
        resolve(canvas.toDataURL('image/png'))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}
