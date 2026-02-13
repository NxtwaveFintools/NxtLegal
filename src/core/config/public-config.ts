import { envPublic } from '@/core/config/env.public'

const parseAllowedDomains = (value: string): string[] => {
  return value
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => domain.length > 0)
}

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
