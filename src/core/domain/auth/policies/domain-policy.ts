import { appConfig } from '@/core/config/app-config'
import { isAllowedEmailDomain } from '@/core/config/allowed-domains'

export const isAllowedDomain = (email: string): boolean => {
  return isAllowedEmailDomain(email, appConfig.auth.allowedDomains)
}
