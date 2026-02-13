import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { getAuthService } from '@/core/registry/service-registry'
import { authErrorCodes } from '@/core/constants/auth-errors'
import { appConfig } from '@/core/config/app-config'

const resolveUserEmail = (user: {
  email?: string | null
  user_metadata?: Record<string, unknown>
  identities?: Array<{ identity_data?: Record<string, unknown> | null }>
}): string | null => {
  if (user.email) {
    return user.email
  }

  const metadataEmail = user.user_metadata?.email
  if (typeof metadataEmail === 'string' && metadataEmail.length > 0) {
    return metadataEmail
  }

  const preferredUsername = user.user_metadata?.preferred_username
  if (typeof preferredUsername === 'string' && preferredUsername.length > 0) {
    return preferredUsername
  }

  const metadataUpn = user.user_metadata?.upn
  if (typeof metadataUpn === 'string' && metadataUpn.length > 0) {
    return metadataUpn
  }

  const identityClaim = user.identities
    ?.flatMap((identity) => {
      const identityData = identity.identity_data ?? {}
      return [identityData.email, identityData.preferred_username, identityData.upn]
    })
    .find((value): value is string => typeof value === 'string' && value.length > 0)

  return identityClaim ?? null
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const error = requestUrl.searchParams.get('error')
  const errorCode = requestUrl.searchParams.get('error_code')
  const errorDescription = requestUrl.searchParams.get('error_description')
  const origin = requestUrl.origin

  if (error) {
    const params = new URLSearchParams({
      error: authErrorCodes.oauthFailed,
    })
    if (errorCode) {
      params.set('error_code', errorCode)
    }
    if (errorDescription) {
      params.set('error_description', errorDescription)
    }
    return NextResponse.redirect(`${origin}${appConfig.routes.public.login}?${params.toString()}`)
  }

  if (!code) {
    return NextResponse.redirect(`${origin}${appConfig.routes.public.login}?error=${authErrorCodes.noCode}`)
  }

  try {
    // Exchange code for session with Supabase
    const supabase = await createServerSupabase()
    await supabase.auth.exchangeCodeForSession(code)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      await supabase.auth.signOut()
      return NextResponse.redirect(`${origin}${appConfig.routes.public.login}?error=${authErrorCodes.unauthorized}`)
    }

    const email = resolveUserEmail(user)

    if (!email) {
      await supabase.auth.signOut()
      return NextResponse.redirect(`${origin}${appConfig.routes.public.login}?error=${authErrorCodes.unauthorized}`)
    }

    // Log all user metadata from Azure AD
    console.log('=== OAUTH USER METADATA ===')
    console.log('User ID:', user.id)
    console.log('User email:', user.email)
    console.log('Resolved email:', email)
    console.log('User metadata keys:', Object.keys(user.user_metadata || {}))
    console.log('User metadata:', JSON.stringify(user.user_metadata, null, 2))
    console.log('User identities:', JSON.stringify(user.identities, null, 2))
    console.log('=== END METADATA ===')

    // Extract user name from OAuth metadata or derive from email
    let name = (user.user_metadata?.name || user.user_metadata?.full_name || user.user_metadata?.given_name) as
      | string
      | undefined

    // If name not found in metadata, derive from email (e.g., vadla.tejeswarachari -> Vadla Tejeswarachari)
    if (!name && email) {
      const emailLocal = email.split('@')[0] // Get part before @
      const nameParts = emailLocal.split('.') // Split by dots
      name = nameParts
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()) // Capitalize each part
        .join(' ') // Join with space
    }

    console.log('Final name value:', name)

    const authService = getAuthService()
    // Extract tenant ID from OAuth callback state or use default
    const tenantId = requestUrl.searchParams.get('tenantId') || '00000000-0000-0000-0000-000000000000'
    await authService.loginWithOAuth({ email, name }, tenantId)

    return NextResponse.redirect(`${origin}${appConfig.routes.protected.dashboard}`)
  } catch {
    try {
      const supabase = await createServerSupabase()
      await supabase.auth.signOut()
    } catch {
      // Best-effort sign-out before redirecting.
    }

    return NextResponse.redirect(`${origin}${appConfig.routes.public.login}?error=${authErrorCodes.authFailed}`)
  }
}
