import { appConfig } from '@/core/config/app-config'

export const isAllowedDomain = (email: string): boolean => {
  const value = email.toLowerCase()
  return appConfig.auth.allowedDomains.some((domain) => value.endsWith(domain))
}
