import { redirect } from 'next/navigation'
import { appConfig } from '@/core/config/app-config'
import { getSession } from '@/core/infra/session/jwt-session-store'
import type { AuthenticatedEmployee } from '@/core/domain/auth/types'

export const requireAuthenticatedUser = async (): Promise<AuthenticatedEmployee> => {
  const session = await getSession()

  if (!session || !session.employeeId || session.employeeId.length === 0) {
    redirect(appConfig.routes.public.login)
  }

  return {
    id: session.employeeId,
    employeeId: session.employeeId,
    email: session.email ?? '',
    fullName: session.fullName,
    role: session.role,
  }
}
