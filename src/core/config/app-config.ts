import 'server-only'

import { envServer } from '@/core/config/env.server'
import { featureFlags } from '@/core/config/feature-flags'
import { routeRegistry } from '@/core/config/route-registry'

const parseAllowedDomains = (value: string): string[] => {
  return value
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => domain.length > 0)
}

const parseBoolean = (value: string | undefined, fallback = false): boolean => {
  if (!value) {
    return fallback
  }

  return value.toLowerCase() === 'true'
}

const requireConfigGroup = (params: {
  enabled: boolean
  groupName: string
  values: Record<string, string | undefined>
}): Record<string, string | undefined> => {
  if (!params.enabled) {
    return params.values
  }

  const missingKeys = Object.entries(params.values)
    .filter(([, value]) => !value)
    .map(([key]) => key)

  if (missingKeys.length > 0) {
    throw new Error(`Missing required ${params.groupName} environment variables: ${missingKeys.join(', ')}`)
  }

  return params.values
}

const docusignConfig = requireConfigGroup({
  enabled: featureFlags.enableContractWorkflow,
  groupName: 'DocuSign',
  values: {
    DOCUSIGN_AUTH_BASE_URL: envServer.docusignAuthBaseUrl,
    DOCUSIGN_API_BASE_URL: envServer.docusignApiBaseUrl,
    DOCUSIGN_ACCOUNT_ID: envServer.docusignAccountId,
    DOCUSIGN_USER_ID: envServer.docusignUserId,
    DOCUSIGN_INTEGRATION_KEY: envServer.docusignIntegrationKey,
    DOCUSIGN_RSA_PRIVATE_KEY: envServer.docusignRsaPrivateKey,
    DOCUSIGN_WEBHOOK_SECRET: envServer.docusignWebhookSecret,
  },
})

const mailConfig = requireConfigGroup({
  enabled: featureFlags.enableContractWorkflow,
  groupName: 'Brevo SMTP',
  values: {
    BREVO_SMTP_HOST: envServer.brevoSmtpHost,
    BREVO_SMTP_PORT: envServer.brevoSmtpPort,
    BREVO_SMTP_USER: envServer.brevoSmtpUser,
    BREVO_SMTP_PASS: envServer.brevoSmtpPass,
    MAIL_FROM_NAME: envServer.mailFromName,
    MAIL_FROM_EMAIL: envServer.mailFromEmail,
  },
})

export const appConfig = {
  environment: envServer.nodeEnv,
  routes: routeRegistry,
  features: featureFlags,
  auth: {
    allowedDomains: parseAllowedDomains(envServer.allowedDomains),
    siteUrl: envServer.siteUrl,
  },
  supabase: {
    url: envServer.supabaseUrl,
    anonKey: envServer.supabaseAnonKey,
    serviceRoleKey: envServer.supabaseServiceRoleKey,
  },
  security: {
    jwtSecretKey: envServer.jwtSecretKey,
  },
  docusign: {
    authBaseUrl: docusignConfig.DOCUSIGN_AUTH_BASE_URL,
    apiBaseUrl: docusignConfig.DOCUSIGN_API_BASE_URL,
    accountId: docusignConfig.DOCUSIGN_ACCOUNT_ID,
    userId: docusignConfig.DOCUSIGN_USER_ID,
    integrationKey: docusignConfig.DOCUSIGN_INTEGRATION_KEY,
    rsaPrivateKey: docusignConfig.DOCUSIGN_RSA_PRIVATE_KEY,
    webhookSecret: docusignConfig.DOCUSIGN_WEBHOOK_SECRET,
  },
  mail: {
    brevoSmtpHost: mailConfig.BREVO_SMTP_HOST,
    brevoSmtpPort: mailConfig.BREVO_SMTP_PORT,
    brevoSmtpUser: mailConfig.BREVO_SMTP_USER,
    brevoSmtpPass: mailConfig.BREVO_SMTP_PASS,
    brevoSmtpAllowSelfSigned: parseBoolean(envServer.brevoSmtpAllowSelfSigned, false),
    fromName: mailConfig.MAIL_FROM_NAME,
    fromEmail: mailConfig.MAIL_FROM_EMAIL,
  },
} as const
