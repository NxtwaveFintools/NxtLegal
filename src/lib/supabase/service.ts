import { createClient } from '@supabase/supabase-js'
import { appConfig } from '@/core/config/app-config'

export function createServiceSupabase() {
  return createClient(appConfig.supabase.url, appConfig.supabase.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
