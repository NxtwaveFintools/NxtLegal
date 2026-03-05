import { createClient } from '@/lib/supabase/client'
import { routeRegistry } from '@/core/config/route-registry'
import { publicConfig } from '@/core/config/public-config'
import type { Provider } from '@supabase/supabase-js'

export const startMicrosoftOAuth = async () => {
  const supabase = createClient()
  const provider = publicConfig.auth.oauthProvider

  if (!provider) {
    throw new Error('OAuth provider is not configured.')
  }
  const callbackUrl = new URL(`${publicConfig.siteUrl}${routeRegistry.public.authCallback}`)
  const redirectTo = new URL(window.location.href).searchParams.get('redirectTo')?.trim()
  if (redirectTo && redirectTo.startsWith('/') && !redirectTo.startsWith('//')) {
    callbackUrl.searchParams.set('redirectTo', redirectTo)
  }

  await supabase.auth.signInWithOAuth({
    provider: provider as Provider,
    options: {
      redirectTo: callbackUrl.toString(),
    },
  })
}
