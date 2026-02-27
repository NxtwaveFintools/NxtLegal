const mockSession = {
  employeeId: 'employee-1',
  tenantId: '00000000-0000-0000-0000-000000000000',
  role: 'LEGAL_TEAM',
  email: 'legal@nxtwave.co.in',
  fullName: 'Legal User',
}

const mockContractQueryService = {
  listRepositoryExportRowsChunk: jest.fn(),
  listRepositoryExportRows: jest.fn(),
}

type MockRequest = {
  nextUrl: {
    searchParams: URLSearchParams
  }
  signal: AbortSignal
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
  getContractQueryService: () => mockContractQueryService,
}))

import { GET } from '@/app/api/contracts/repository/export/route'

type GetRequestArg = Parameters<typeof GET>[0]

describe('Contracts repository export route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('streams CSV in chunks without materializing full export rows', async () => {
    mockContractQueryService.listRepositoryExportRowsChunk
      .mockResolvedValueOnce({
        items: [
          {
            contract_title: 'Master Service Agreement',
            status: 'COMPLETED',
          },
        ],
        nextCursor: 'cursor-1',
      })
      .mockResolvedValueOnce({
        items: [
          {
            contract_title: 'NDA',
            status: 'UNDER_REVIEW',
          },
        ],
        nextCursor: undefined,
      })

    const controller = new AbortController()
    const response = await GET({
      nextUrl: {
        searchParams: new URLSearchParams('format=csv&columns=contract_title,status'),
      },
      signal: controller.signal,
    } as unknown as GetRequestArg)

    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/csv')
    expect(body).toContain('Master Service Agreement')
    expect(body).toContain('NDA')
    expect(mockContractQueryService.listRepositoryExportRowsChunk).toHaveBeenCalledTimes(2)
    expect(mockContractQueryService.listRepositoryExportRows).not.toHaveBeenCalled()
  })
})
