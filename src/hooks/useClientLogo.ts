import { useQuery } from '@tanstack/react-query'

interface ClearbitSuggestion {
  name: string
  domain: string
  logo: string
}

async function resolveClientLogo(name: string, email: string | null): Promise<string | null> {
  // Try Clearbit autocomplete by company name (free, no auth required)
  try {
    const res = await fetch(
      `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(name)}`,
      { signal: AbortSignal.timeout(4000) }
    )
    if (res.ok) {
      const data: ClearbitSuggestion[] = await res.json()
      if (data?.[0]?.logo) return data[0].logo
    }
  } catch {
    // network error or timeout — fall through
  }

  // Fallback: derive domain from email
  if (email) {
    const parts = email.split('@')
    if (parts.length === 2 && parts[1]) return `https://logo.clearbit.com/${parts[1].toLowerCase()}`
  }

  return null
}

export function useClientLogo(name: string, email: string | null) {
  return useQuery({
    queryKey: ['client-logo', name],
    queryFn: () => resolveClientLogo(name, email),
    staleTime: 24 * 60 * 60 * 1000, // cache 24 h
    retry: false,
    refetchOnWindowFocus: false,
  })
}
