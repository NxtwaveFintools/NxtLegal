import { cache } from 'react'
import { redirect } from 'next/navigation'
import { appConfig } from '@/core/config/app-config'
import { getSession } from '@/core/infra/session/jwt-session-store'
import type { AuthenticatedEmployee } from '@/core/domain/auth/types'
import { supabaseEmployeeRepository } from '@/core/infra/repositories/supabase-employee-repository'

// Memoised per-request via React cache() — layout and page presenters share a single DB lookup.
export const requireAuthenticatedUser = cache(async (): Promise<AuthenticatedEmployee> => {
  const session = await getSession()

  if (!session || !session.employeeId || session.employeeId.length === 0) {
    redirect(appConfig.routes.public.login)
  }

  if (!session.tenantId) {
    redirect(appConfig.routes.public.login)
  }

  const employee = await supabaseEmployeeRepository.findByEmployeeId({
    employeeId: session.employeeId,
    tenantId: session.tenantId,
  })

  if (!employee || !employee.isActive) {
    redirect(appConfig.routes.public.login)
  }

  return {
    id: employee.id,
    employeeId: employee.id,
    tenantId: session.tenantId,
    email: employee.email,
    fullName: employee.fullName ?? undefined,
    role: employee.role,
    team: employee.teamName ?? null,
  }
})
