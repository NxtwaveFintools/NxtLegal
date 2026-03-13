import { envPublic } from '@/core/config/env.public'
import { parseAllowedDomains } from '@/core/config/allowed-domains'

export const publicConfig = {
  siteUrl: envPublic.siteUrl,
  auth: {
    allowedDomains: parseAllowedDomains(envPublic.allowedDomains ?? ''),
  },
  features: {
    enableMicrosoftOAuth: envPublic.featureMicrosoftOAuth.toLowerCase() !== 'false',
    enableGoogleOAuth: envPublic.featureGoogleOAuth.toLowerCase() !== 'false',
    enablePasswordLogin: envPublic.featurePasswordLogin.toLowerCase() !== 'false',
  },
} as const
