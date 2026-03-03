const builtinAllowedDomains = ['nxtwave.in', 'nxtwave.tech'] as const

const normalizeDomain = (value: string): string => {
  return value.trim().toLowerCase().replace(/^@+/, '')
}

const dedupeDomains = (domains: string[]): string[] => {
  return Array.from(new Set(domains.map(normalizeDomain).filter((domain) => domain.length > 0)))
}

export const parseAllowedDomains = (value: string): string[] => {
  const envDomains = value
    .split(',')
    .map((domain) => domain.trim())
    .filter((domain) => domain.length > 0)

  return dedupeDomains([...envDomains, ...builtinAllowedDomains])
}

export const isAllowedEmailDomain = (email: string, allowedDomains: string[]): boolean => {
  const normalizedEmail = email.trim().toLowerCase()
  return allowedDomains.some((domain) => normalizedEmail.endsWith(`@${normalizeDomain(domain)}`))
}
