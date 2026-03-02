import { AuthorizationError, ValidationError } from '@/core/http/errors'
import {
  RoleGovernanceService,
  type ChangeUserRoleResult,
  type IRoleGovernanceRepository,
} from '@/core/domain/admin/role-governance-service'

describe('RoleGovernanceService', () => {
  const baseSession = {
    employeeId: 'd8eb4faf-9de9-4d4d-a2ac-3016d3dd38d7',
    tenantId: 'f1641825-c9c0-4e79-a4c9-37cc9af53ef6',
    role: 'LEGAL_ADMIN',
  }

  const mockRepository: jest.Mocked<IRoleGovernanceRepository> = {
    changeUserRole: jest.fn<
      Promise<ChangeUserRoleResult>,
      [
        {
          tenantId: string
          adminUserId: string
          targetUserId: string
          roleKey: string
          operation: 'grant' | 'revoke'
          reason?: string
        },
      ]
    >(),
  }

  const service = new RoleGovernanceService(mockRepository)

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejects missing tenant to enforce isolation', async () => {
    await expect(
      service.changeUserRole({
        session: {
          employeeId: baseSession.employeeId,
          role: baseSession.role,
        },
        targetUserId: '95d8fba8-bf5c-4448-97b4-f6d580a992f2',
        roleKey: 'LEGAL_TEAM',
        operation: 'grant',
      })
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('rejects non-admin actor roles', async () => {
    await expect(
      service.changeUserRole({
        session: {
          employeeId: baseSession.employeeId,
          tenantId: baseSession.tenantId,
          role: 'POC',
        },
        targetUserId: '95d8fba8-bf5c-4448-97b4-f6d580a992f2',
        roleKey: 'LEGAL_TEAM',
        operation: 'grant',
      })
    ).rejects.toBeInstanceOf(AuthorizationError)
  })

  it('blocks self role revocation', async () => {
    await expect(
      service.changeUserRole({
        session: baseSession,
        targetUserId: baseSession.employeeId,
        roleKey: 'LEGAL_ADMIN',
        operation: 'revoke',
      })
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('delegates role changes with tenant-scoped payload', async () => {
    mockRepository.changeUserRole.mockResolvedValueOnce({
      changed: true,
      operation: 'grant',
      roleKey: 'LEGAL_TEAM',
      targetUserId: '95d8fba8-bf5c-4448-97b4-f6d580a992f2',
      targetEmail: 'target@nxtwave.co.in',
      beforeStateSnapshot: {},
      afterStateSnapshot: {},
      oldTokenVersion: 0,
      newTokenVersion: 1,
    })

    const result = await service.changeUserRole({
      session: baseSession,
      targetUserId: '95d8fba8-bf5c-4448-97b4-f6d580a992f2',
      roleKey: 'LEGAL_TEAM',
      operation: 'grant',
      reason: 'Role onboarding',
    })

    expect(result.changed).toBe(true)
    expect(mockRepository.changeUserRole).toHaveBeenCalledWith({
      tenantId: baseSession.tenantId,
      adminUserId: baseSession.employeeId,
      targetUserId: '95d8fba8-bf5c-4448-97b4-f6d580a992f2',
      roleKey: 'LEGAL_TEAM',
      operation: 'grant',
      reason: 'Role onboarding',
    })
  })
})
