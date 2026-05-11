export const envPublic = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? '',
  allowedDomains: process.env.NEXT_PUBLIC_AUTH_ALLOWED_DOMAINS ?? '',
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  featureMicrosoftOAuth: process.env.NEXT_PUBLIC_FEATURE_MICROSOFT_OAUTH ?? '',
  featureGoogleOAuth: process.env.NEXT_PUBLIC_FEATURE_GOOGLE_OAUTH ?? '',
  featurePasswordLogin: process.env.NEXT_PUBLIC_FEATURE_PASSWORD_LOGIN ?? '',
} as const
