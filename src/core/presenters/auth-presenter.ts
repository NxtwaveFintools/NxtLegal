import 'server-only'

import { requireAuthenticatedUser } from '@/core/domain/auth/guards/route-guard'
import { supabaseEmployeeRepository } from '@/core/infra/repositories/supabase-employee-repository'

export const getAuthenticatedEmployeeView = async () => {
  return requireAuthenticatedUser()
}

const adminHistoryRoles = new Set(['ADMIN', 'LEGAL_ADMIN', 'SUPER_ADMIN'])

export const getAuthenticatedEmployeeViewWithApproverHistoryAccess = async () => {
  const session = await requireAuthenticatedUser()

  const normalizedRole = (session.role ?? '').toUpperCase()
  if (adminHistoryRoles.has(normalizedRole)) {
    return {
      ...session,
      canAccessApproverHistory: true,
    }
  }

  const hasAdditionalApproverParticipation = await supabaseEmployeeRepository.hasAdditionalApproverParticipation({
    email: session.email,
    tenantId: session.tenantId,
  })

  return {
    ...session,
    canAccessApproverHistory: hasAdditionalApproverParticipation,
  }
}
