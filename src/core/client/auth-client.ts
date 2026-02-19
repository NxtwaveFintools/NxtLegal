import { apiClient, authApiRoutes } from '@/core/client/api-client'
import type { AuthenticatedEmployee } from '@/core/domain/auth/types'

export const authClient = {
  login: (email: string, password: string) =>
    apiClient.post<{ user: AuthenticatedEmployee }>(authApiRoutes.login, {
      email,
      password,
    }),
  logout: () => apiClient.post(authApiRoutes.logout),
  getSession: () =>
    apiClient.get<{ authenticated: boolean; employee?: AuthenticatedEmployee }>(authApiRoutes.session, {
      cache: 'no-store',
    }),
}
