import { envPublic } from '@/core/config/env.public'
import { parseAllowedDomains } from '@/core/config/allowed-domains'

export const publicConfig = {
  siteUrl: envPublic.siteUrl,
  auth: {
    allowedDomains: parseAllowedDomains(envPublic.allowedDomains ?? ''),
    oauthProvider: envPublic.oauthProvider,
  },
  features: {
    enableMicrosoftOAuth: envPublic.featureMicrosoftOAuth.toLowerCase() !== 'false',
    enablePasswordLogin: envPublic.featurePasswordLogin.toLowerCase() !== 'false',
  },
} as const
