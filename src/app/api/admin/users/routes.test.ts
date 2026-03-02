import { AuthorizationError } from '@/core/http/errors'

const mockSession = {
  employeeId: 'admin-user-id',
  tenantId: '00000000-0000-0000-0000-000000000000',
  role: 'SUPER_ADMIN',
  email: 'admin@nxtwave.co.in',
  fullName: 'Admin User',
}

const mockAdminQueryService = {
  listUsers: jest.fn(),
  listUsersGroupedByDepartment: jest.fn(),
  createUser: jest.fn(),
  setUserStatus: jest.fn(),
  assignUserDepartmentRole: jest.fn(),
}

type MockRequest = {
  json?: () => Promise<unknown>
  nextUrl?: {
    searchParams: URLSearchParams
  }
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
  getAdminQueryService: () => mockAdminQueryService,
}))

jest.mock('@/core/config/app-config', () => ({
  appConfig: {
    features: {
      enableAdminGovernance: true,
    },
    auth: {
      allowedDomains: ['@nxtwave.co.in'],
    },
  },
}))

import { appConfig } from '@/core/config/app-config'
import { GET, POST } from '@/app/api/admin/users/route'
import { PATCH as PATCHStatus } from '@/app/api/admin/users/[userId]/status/route'
import { PUT as PUTDepartment } from '@/app/api/admin/users/[userId]/department/route'

type GetRequestArg = Parameters<typeof GET>[0]
type PostRequestArg = Parameters<typeof POST>[0]
type PostContextArg = Parameters<typeof POST>[1]
type PatchStatusRequestArg = Parameters<typeof PATCHStatus>[0]
type PatchStatusContextArg = Parameters<typeof PATCHStatus>[1]
type PutDepartmentRequestArg = Parameters<typeof PUTDepartment>[0]
type PutDepartmentContextArg = Parameters<typeof PUTDepartment>[1]

describe('Admin users API routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(appConfig.features as { enableAdminGovernance: boolean }).enableAdminGovernance = true
  })

  it('returns users for GET /api/admin/users', async () => {
    mockAdminQueryService.listUsers.mockResolvedValueOnce([
      {
        id: 'user-id-1',
        email: 'user1@nxtwave.co.in',
        fullName: 'User One',
        isActive: true,
        roles: ['USER'],
        departmentAssignments: [],
      },
    ])

    const response = await GET({
      nextUrl: {
        searchParams: new URLSearchParams(),
      },
    } as unknown as GetRequestArg)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mockAdminQueryService.listUsers).toHaveBeenCalledWith(mockSession)
  })

  it('returns grouped users for GET /api/admin/users?groupBy=department', async () => {
    mockAdminQueryService.listUsersGroupedByDepartment.mockResolvedValueOnce([
      {
        departmentId: 'dep-1',
        departmentName: 'Legal',
        isDepartmentActive: true,
        users: [],
      },
    ])

    const response = await GET({
      nextUrl: {
        searchParams: new URLSearchParams('groupBy=department'),
      },
    } as unknown as GetRequestArg)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mockAdminQueryService.listUsersGroupedByDepartment).toHaveBeenCalledWith(mockSession)
  })

  it('returns validation error for invalid POST payload', async () => {
    const response = await POST(
      {
        json: async () => ({ email: 'invalid-email' }),
      } as unknown as PostRequestArg,
      {} as PostContextArg
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(mockAdminQueryService.createUser).not.toHaveBeenCalled()
  })

  it('creates user for valid POST payload', async () => {
    mockAdminQueryService.createUser.mockResolvedValueOnce({
      id: 'user-id-2',
      email: 'legal.member@nxtwave.co.in',
      fullName: 'Legal Member',
      isActive: true,
      roles: ['LEGAL_TEAM'],
      departmentAssignments: [],
    })

    const response = await POST(
      {
        json: async () => ({
          email: 'legal.member@nxtwave.co.in',
          fullName: 'Legal Member',
          role: 'LEGAL_TEAM',
          isActive: true,
        }),
      } as unknown as PostRequestArg,
      {} as PostContextArg
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mockAdminQueryService.createUser).toHaveBeenCalledWith({
      session: mockSession,
      email: 'legal.member@nxtwave.co.in',
      fullName: 'Legal Member',
      role: 'LEGAL_TEAM',
      isActive: true,
    })
  })

  it('updates user status for PATCH /api/admin/users/[userId]/status', async () => {
    mockAdminQueryService.setUserStatus.mockResolvedValueOnce({
      id: 'user-id-2',
      email: 'legal.member@nxtwave.co.in',
      fullName: 'Legal Member',
      isActive: false,
      roles: ['LEGAL_TEAM'],
      departmentAssignments: [],
    })

    const response = await PATCHStatus(
      {
        json: async () => ({ isActive: false }),
      } as unknown as PatchStatusRequestArg,
      { params: { userId: '6bc8d6e8-51b5-4a5f-9f57-5168b3729513' } } as PatchStatusContextArg
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mockAdminQueryService.setUserStatus).toHaveBeenCalledWith({
      session: mockSession,
      userId: '6bc8d6e8-51b5-4a5f-9f57-5168b3729513',
      isActive: false,
    })
  })

  it('returns app error for PUT /api/admin/users/[userId]/department', async () => {
    mockAdminQueryService.assignUserDepartmentRole.mockRejectedValueOnce(
      new AuthorizationError('FORBIDDEN_ADMIN_CONSOLE', 'Denied')
    )

    const response = await PUTDepartment(
      {
        json: async () => ({
          departmentId: '6bc8d6e8-51b5-4a5f-9f57-5168b3729513',
          departmentRole: 'POC',
        }),
      } as unknown as PutDepartmentRequestArg,
      { params: { userId: '6bc8d6e8-51b5-4a5f-9f57-5168b3729513' } } as PutDepartmentContextArg
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('FORBIDDEN_ADMIN_CONSOLE')
  })

  it('returns feature disabled when admin governance flag is off', async () => {
    ;(appConfig.features as { enableAdminGovernance: boolean }).enableAdminGovernance = false

    const response = await GET({
      nextUrl: {
        searchParams: new URLSearchParams(),
      },
    } as unknown as GetRequestArg)
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('FEATURE_DISABLED')
  })
})
