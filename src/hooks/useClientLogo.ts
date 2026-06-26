/**
 * Returns the best available logo URL for a client:
 * 1. Manually set logo_url
 * 2. DuckDuckGo favicon derived from email domain
 * 3. null (caller should render initials)
 */
export function getClientLogoUrl(logoUrl: string | null, email: string | null): string | null {
  if (logoUrl) return logoUrl
  if (email) {
    const atIdx = email.indexOf('@')
    if (atIdx > 0) {
      const domain = email.slice(atIdx + 1).toLowerCase().trim()
      if (domain) return `https://icons.duckduckgo.com/ip3/${domain}.ico`
    }
  }
  return null
}
