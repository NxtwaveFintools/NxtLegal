import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { appConfig } from '@/core/config/app-config'

// Module-level singleton — one Supabase client reused across all server-side
// calls within the same Node.js process/worker. The client itself is stateless
// for query operations (each query issues a fresh HTTP request); persisting the
// instance only avoids repeated object allocation and config validation.
let _serviceClient: SupabaseClient | null = null

export function createServiceSupabase(): SupabaseClient {
  if (!_serviceClient) {
    _serviceClient = createClient(appConfig.supabase.url, appConfig.supabase.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }

  return _serviceClient
}
