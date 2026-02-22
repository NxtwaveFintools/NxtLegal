import { AuthorizationError } from '@/core/http/errors'

const mockSession = {
  employeeId: 'admin-user-id',
  tenantId: '00000000-0000-0000-0000-000000000000',
  role: 'SUPER_ADMIN',
  email: 'admin@nxtwave.co.in',
  fullName: 'Admin User',
}

const mockRoleGovernanceService = {
  changeUserRole: jest.fn(),
}

type MockRequest = {
  json?: () => Promise<unknown>
}

type MockContext = {
  params?: Record<string, string>
}

type MockAuthHandler = (
  request: MockRequest,
  context: { session: typeof mockSession; params?: Record<string, string> }
) => unknown

jest.mock('@/core/http/with-auth', () => ({
  withAuth: (handler: MockAuthHandler) => {
    return async (request: MockRequest, context: MockContext = {}) => {
      return handler(request, {
        session: mockSession,
        params: context.params,
      })
    }
  },
}))

jest.mock('@/core/registry/service-registry', () => ({
  getRoleGovernanceService: () => mockRoleGovernanceService,
}))

jest.mock('@/core/config/app-config', () => ({
  appConfig: {
    features: {
      enableAdminGovernance: true,
    },
  },
}))

import { appConfig } from '@/core/config/app-config'
import { PATCH } from '@/app/api/admin/users/[userId]/roles/route'

type PatchRequestArg = Parameters<typeof PATCH>[0]
type PatchContextArg = Parameters<typeof PATCH>[1]

describe('Admin role management route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(appConfig.features as { enableAdminGovernance: boolean }).enableAdminGovernance = true
  })

  it('returns feature disabled when admin governance is off', async () => {
    ;(appConfig.features as { enableAdminGovernance: boolean }).enableAdminGovernance = false

    const response = await PATCH(
      {
        json: async () => ({ operation: 'grant', roleKey: 'LEGAL_TEAM' }),
      } as unknown as PatchRequestArg,
      { params: { userId: '95d8fba8-bf5c-4448-97b4-f6d580a992f2' } } as PatchContextArg
    )

    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('FEATURE_DISABLED')
  })

  it('returns validation error for invalid payload', async () => {
    const response = await PATCH(
      {
        json: async () => ({ operation: 'grant', roleKey: 'bad role key' }),
      } as unknown as PatchRequestArg,
      { params: { userId: '95d8fba8-bf5c-4448-97b4-f6d580a992f2' } } as PatchContextArg
    )

    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(mockRoleGovernanceService.changeUserRole).not.toHaveBeenCalled()
  })

  it('returns role change and reauthentication payload on success', async () => {
    mockRoleGovernanceService.changeUserRole.mockResolvedValueOnce({
      changed: true,
      operation: 'grant',
      roleKey: 'LEGAL_TEAM',
      targetUserId: '95d8fba8-bf5c-4448-97b4-f6d580a992f2',
      targetEmail: 'target@nxtwave.co.in',
      beforeStateSnapshot: { role_keys: ['USER'] },
      afterStateSnapshot: { role_keys: ['USER', 'LEGAL_TEAM'] },
      oldTokenVersion: 0,
      newTokenVersion: 1,
    })

    const response = await PATCH(
      {
        json: async () => ({ operation: 'grant', roleKey: 'LEGAL_TEAM', reason: 'Access upgrade' }),
      } as unknown as PatchRequestArg,
      { params: { userId: '95d8fba8-bf5c-4448-97b4-f6d580a992f2' } } as PatchContextArg
    )

    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.roleChange.changed).toBe(true)
    expect(body.data.reauthentication.required).toBe(true)
    expect(mockRoleGovernanceService.changeUserRole).toHaveBeenCalledWith({
      session: mockSession,
      targetUserId: '95d8fba8-bf5c-4448-97b4-f6d580a992f2',
      roleKey: 'LEGAL_TEAM',
      operation: 'grant',
      reason: 'Access upgrade',
    })
  })

  it('maps app errors with status and code', async () => {
    mockRoleGovernanceService.changeUserRole.mockRejectedValueOnce(
      new AuthorizationError('FORBIDDEN_ROLE_MANAGEMENT', 'Denied')
    )

    const response = await PATCH(
      {
        json: async () => ({ operation: 'revoke', roleKey: 'LEGAL_TEAM' }),
      } as unknown as PatchRequestArg,
      { params: { userId: '95d8fba8-bf5c-4448-97b4-f6d580a992f2' } } as PatchContextArg
    )

    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('FORBIDDEN_ROLE_MANAGEMENT')
  })
})
