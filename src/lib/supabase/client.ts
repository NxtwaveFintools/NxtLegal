import { createBrowserClient } from '@supabase/ssr'
import { envPublic } from '@/core/config/env.public'

export function createClient() {
  return createBrowserClient(envPublic.supabaseUrl, envPublic.supabaseAnonKey)
}
