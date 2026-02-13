import { isAllowedDomain } from '@/core/domain/auth/policies/domain-policy'

export function validateDomain(email: string) {
  return isAllowedDomain(email)
}
