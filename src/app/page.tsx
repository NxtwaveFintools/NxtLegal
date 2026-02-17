import 'server-only'

import { redirect } from 'next/navigation'
import { getSession } from '@/core/infra/session/jwt-session-store'
import { appConfig } from '@/core/config/app-config'

export default async function Home() {
  const session = await getSession()

  if (session?.employeeId) {
    // Authenticated → redirect to dashboard
    redirect(appConfig.routes.protected.dashboard)
  }

  // Unauthenticated → redirect to login
  redirect(appConfig.routes.public.login)
}
