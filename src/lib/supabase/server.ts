import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { appConfig } from '@/core/config/app-config'

export async function createServerSupabase() {
  const cookieStore = await cookies()

  return createServerClient(appConfig.supabase.url, appConfig.supabase.anonKey, {
    cookies: {
      get(name) {
        return cookieStore.get(name)?.value
      },
      set(name, value, options) {
        try {
          cookieStore.set(name, value, options)
        } catch {
          // The `set` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing
          // user sessions.
        }
      },
      remove(name, options) {
        try {
          cookieStore.set(name, '', options)
        } catch {
          // The `delete` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing
          // user sessions.
        }
      },
    },
  })
}
