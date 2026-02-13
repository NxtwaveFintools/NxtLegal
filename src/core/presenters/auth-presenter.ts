import 'server-only'

import { requireAuthenticatedUser } from '@/core/domain/auth/guards/route-guard'

export const getAuthenticatedEmployeeView = async () => {
  return requireAuthenticatedUser()
}
