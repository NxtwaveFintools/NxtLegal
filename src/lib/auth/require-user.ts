import type { AuthenticatedEmployee } from '@/core/domain/auth/types'
import { requireAuthenticatedUser } from '@/core/domain/auth/guards/route-guard'

export async function requireUser(): Promise<AuthenticatedEmployee> {
  return requireAuthenticatedUser()
}
